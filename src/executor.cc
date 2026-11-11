#include "executor.h"

#ifndef _WIN32
#include <pthread.h>
#endif

namespace ctypes {

namespace {

constexpr const char* kDefaultThreadName = "node-ctypes";
// Attesa attiva predefinita: copre il giro di una chiamata breve (preparazione,
// esecuzione, completamento) e l'intervallo fra un await e la chiamata successiva.
constexpr double kDefaultSpinMicros = 50;
constexpr double kMaxSpinMicros = 10'000;
// Attesa in linea massima per una funzione che ne ha bisogno (più di spin).
constexpr double kDefaultSpinLimitMicros = 500;
// Attesa attiva massima del thread nativo, dopo una chiamata, per la chiamata
// successiva (l'intervallo fra un await e la chiamata seguente è di pochi µs).
// Oltre dorme sulla condition variable: su una macchina carica un'attesa attiva
// lunga toglierebbe il core al thread JavaScript che deve inviarla.
constexpr std::chrono::nanoseconds kMaxIdleSpin = std::chrono::microseconds(50);
// Margine dell'attesa in linea oltre una volta e mezza la durata tipica.
constexpr std::chrono::nanoseconds kInlineMargin = std::chrono::microseconds(10);
// Peso di una nuova durata nella media mobile (1/8) e tetto delle durate
// considerate (multiplo di spinLimit): un'eccezione rara non domina la media.
constexpr int64_t kTimingWeight = 8;
// Peso di una durata più breve della tipica (1/2): una prima chiamata lenta
// (inizializzazioni, page fault) viene dimenticata in poche chiamate, mentre una
// chiamata lenta isolata sposta poco la media.
constexpr int64_t kTimingFallWeight = 2;
constexpr int64_t kTimingClip = 4;
// Funzioni ricordate per Executor: oltre, la tabella ricomincia.
constexpr size_t kMaxTimings = 4096;
// Attese scadute di fila di una funzione: salta al più 2^10 - 1 attese prima di riprovare.
constexpr uint32_t kMaxSkipShift = 10;
// Tempo massimo di completamenti in linea per giro dell'event loop.
constexpr std::chrono::microseconds kInlineSlice{1000};
// Dato del segnaposto inviato alla TSFN per contare i giri dell'event loop.
char turn_marker;

// Attende attivamente, per al più `spin` (pochi microsecondi), che `counter`
// cambi da `seen`. Non cede il processore: con altri thread pronti sullo
// stesso core, yield() lo cederebbe per un intero quanto (decine di ms).
bool SpinUntilChanged(const std::atomic<uint64_t>& counter, uint64_t seen, std::chrono::nanoseconds spin) {
  const auto deadline = std::chrono::steady_clock::now() + spin;
  while (counter.load(std::memory_order_acquire) == seen) {
    if (std::chrono::steady_clock::now() >= deadline) {
      return false;
    }
  }
  return true;
}

// Come SpinUntilChanged, per il thread JavaScript: si interrompe anche quando un
// thread nativo aspetta il thread JavaScript (un callback thread-safe invocato
// dalla chiamata attesa, che altrimenti non potrebbe concludersi).
bool AwaitUntilChanged(const std::atomic<uint64_t>& counter, uint64_t seen, std::chrono::nanoseconds spin) {
  const auto deadline = std::chrono::steady_clock::now() + spin;
  while (counter.load(std::memory_order_acquire) == seen) {
    if (native_threads_awaiting_js.load(std::memory_order_acquire) != 0 ||
        std::chrono::steady_clock::now() >= deadline) {
      return false;
    }
  }
  return true;
}

// Nome del thread nei debugger e nei profiler (best effort).
void NameCurrentThread(const std::string& name, const std::u16string& wide_name) {
#ifdef _WIN32
  // SetThreadDescription: Windows 10 1607+.
  using SetThreadDescriptionFn = HRESULT(WINAPI*)(HANDLE, PCWSTR);
  static const auto set_description = reinterpret_cast<SetThreadDescriptionFn>(
    reinterpret_cast<void*>(::GetProcAddress(::GetModuleHandleW(L"kernel32.dll"), "SetThreadDescription")));
  if (set_description != nullptr) {
    set_description(::GetCurrentThread(), reinterpret_cast<const wchar_t*>(wide_name.c_str()));
  }
  (void)name;
#elif defined(__APPLE__)
  pthread_setname_np(name.c_str());
  (void)wide_name;
#else
  // Linux: al massimo 15 byte più il terminatore.
  pthread_setname_np(pthread_self(), name.substr(0, 15).c_str());
  (void)wide_name;
#endif
}

// Il thread nativo: esegue le chiamate in ordine di arrivo, una alla volta,
// e notifica il thread JS di ognuna attraverso la TSFN (salvo quella che il
// thread JS sta aspettando in linea).
void ExecutorLoop(std::shared_ptr<ExecutorQueue> queue, std::string name, std::u16string wide_name) {
  NameCurrentThread(name, wide_name);
  std::unique_lock lock(queue->mutex);
  while (true) {
    if (queue->waiting.empty() && !queue->stopping && queue->spin.count() > 0) {
      // La chiamata successiva arriva spesso subito dopo il completamento (await
      // in sequenza): attenderla attivamente evita di svegliare il thread.
      const uint64_t seen = queue->submitted.load(std::memory_order_acquire);
      lock.unlock();
      SpinUntilChanged(queue->submitted, seen, std::min<std::chrono::nanoseconds>(queue->spin, kMaxIdleSpin));
      lock.lock();
    }
    queue->parked = true;
    queue->wake.wait(lock, [&queue] { return queue->stopping || !queue->waiting.empty(); });
    queue->parked = false;
    if (queue->abandoned || queue->waiting.empty()) {
      return;
    }
    const ExecutorJob job = queue->waiting.front();
    queue->waiting.pop_front();
    queue->busy = true;
    lock.unlock();
    job.call->Run();
    lock.lock();
    queue->busy = false;
    if (queue->abandoned) {
      // Environment chiuso durante la chiamata: la PreparedCall si può
      // distruggere solo sul thread JS, che non esiste più.
      return;
    }
    queue->done.push_back(job);
    queue->finished.fetch_add(1, std::memory_order_release);
    if (queue->awaited == job.id) {
      // Il thread JS la sta aspettando e la completa lui.
      queue->awaited = 0;
      queue->awaited_done = true;
      continue;
    }
    // Sotto lock: dopo abandoned la TSFN non viene più usata da questo thread.
    ExecutorChannel(queue->channel).NonBlockingCall();
  }
}

}  // namespace

void DeliverExecutorCompletions(Napi::Env env, Napi::Function, ExecutorQueue* queue, void* data) {
  if (env == nullptr) {
    return;
  }
  if (data == &turn_marker) {
    // Thread JS, a ogni consegna: nessun lock.
    queue->turns++;
    queue->turn_posted = false;
  }
  std::vector<ExecutorJob> jobs;
  std::function<void(Napi::Env, std::vector<ExecutorJob>&&)> deliver;
  {
    std::lock_guard lock(queue->mutex);
    jobs.swap(queue->done);
    deliver = queue->deliver;
  }
  // Anche senza chiamate: un segnaposto può portare un errore di AwaitInline.
  // Callback C della TSFN: nessuna eccezione C++ deve uscirne.
  try {
    if (!deliver) {
      for (const ExecutorJob& job : jobs) {
        delete job.call;
      }
      return;
    }
    deliver(env, std::move(jobs));
  } catch (...) {
  }
}

Napi::Function Executor::GetClass(Napi::Env env) {
  return DefineClass(env, "Executor",
                     {
                       InstanceMethod("close", &Executor::Close),
                       InstanceMethod("_cancel", &Executor::Cancel),
                       InstanceAccessor("pending", &Executor::GetPending, nullptr),
                       InstanceAccessor("completed", &Executor::GetCompleted, nullptr),
                       InstanceAccessor("running", &Executor::GetRunning, nullptr),
                       InstanceAccessor("closed", &Executor::GetClosed, nullptr),
                       InstanceAccessor("_lastJob", &Executor::GetLastJob, nullptr),
                       InstanceAccessor("_inlineCompleted", &Executor::GetInlineCompleted, nullptr),
                       InstanceMethod("_inlineBudget", &Executor::GetInlineBudget),
                     });
}

Executor::Executor(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Executor>(info), env_(info.Env()) {
  Napi::Env env = info.Env();
  info.This().As<Napi::Object>().TypeTag(&kTypeTag);

  name_ = kDefaultThreadName;
  if (info.Length() > 0 && !info[0].IsUndefined() && !info[0].IsNull()) {
    if (!info[0].IsObject()) {
      throw Napi::TypeError::New(env, "Executor options must be an object");
    }
    const Napi::Value name = info[0].As<Napi::Object>().Get("name");
    if (!name.IsUndefined()) {
      if (!name.IsString()) {
        throw Napi::TypeError::New(env, "Executor name must be a string");
      }
      name_ = name.As<Napi::String>().Utf8Value();
    }
  }
  double spin = kDefaultSpinMicros;
  if (info.Length() > 0 && info[0].IsObject()) {
    const Napi::Value value = info[0].As<Napi::Object>().Get("spin");
    if (!value.IsUndefined()) {
      if (!value.IsNumber()) {
        throw Napi::TypeError::New(env, "Executor spin must be a number of microseconds");
      }
      spin = value.As<Napi::Number>().DoubleValue();
      if (!(spin >= 0 && spin <= kMaxSpinMicros)) {
        throw Napi::RangeError::New(env,
                                    std::format("Executor spin must be between 0 and {} microseconds", kMaxSpinMicros));
      }
    }
  }
  double spin_limit = kDefaultSpinLimitMicros;
  if (info.Length() > 0 && info[0].IsObject()) {
    const Napi::Value value = info[0].As<Napi::Object>().Get("spinLimit");
    if (!value.IsUndefined()) {
      if (!value.IsNumber()) {
        throw Napi::TypeError::New(env, "Executor spinLimit must be a number of microseconds");
      }
      spin_limit = value.As<Napi::Number>().DoubleValue();
      if (!(spin_limit >= 0 && spin_limit <= kMaxSpinMicros)) {
        throw Napi::RangeError::New(
          env, std::format("Executor spinLimit must be between 0 and {} microseconds", kMaxSpinMicros));
      }
    }
  }
  queue_->spin = std::chrono::microseconds(static_cast<int64_t>(spin));
  spin_limit_ =
    std::max<std::chrono::nanoseconds>(queue_->spin, std::chrono::microseconds(static_cast<int64_t>(spin_limit)));
}

Executor::~Executor() {
  // Raccolto dal GC: nessuna chiamata in sospeso (l'oggetto è referenziato
  // finché ce ne sono), il thread è inattivo.
  if (started_ && !abandoned_) {
    try {
      Stop(Napi::Env(env_));
    } catch (...) {
    }
  }
}

void Executor::Start(Napi::Env env) {
  using Owner = std::shared_ptr<ExecutorQueue>;
  auto owner = std::make_unique<Owner>(queue_);
  channel_ = ExecutorChannel::New(
    env, "node-ctypes Executor",
    0,  // coda illimitata: il thread nativo non si blocca mai sulla notifica
    1, queue_.get(), [](Napi::Env, Owner* owner, ExecutorQueue*) { delete owner; }, owner.get());
  owner.release();
  channel_.Unref(env);
  {
    std::lock_guard lock(queue_->mutex);
    queue_->channel = channel_;
    queue_->stopping = false;
    queue_->deliver = [this](Napi::Env deliver_env, std::vector<ExecutorJob>&& jobs) {
      std::optional<Napi::Error> error = Deliver(deliver_env, std::move(jobs));
      if (!error && deferred_error_) {
        error = std::move(deferred_error_);
        deferred_error_.reset();
      }
      if (error) {
        // L'errore diventa un'eccezione JS non gestita (il chiamante, nel
        // callback C della TSFN, intercetta le eccezioni C++).
        error->ThrowAsJavaScriptException();
      }
    };
  }
  try {
    const std::u16string wide_name = Napi::String::New(env, name_).Utf16Value();
    thread_ = std::thread(ExecutorLoop, queue_, name_, wide_name);
  } catch (const std::system_error& e) {
    {
      std::lock_guard lock(queue_->mutex);
      queue_->deliver = nullptr;
    }
    channel_.Release();
    throw Napi::Error::New(env, std::format("Executor: cannot start the thread: {}", e.what()));
  }
  // Registrato dopo la TSFN: i cleanup hook girano in ordine inverso, quindi
  // questo ferma il thread prima che l'environment chiuda la TSFN.
  cleanup_hook_ = env.AddCleanupHook(&Executor::EnvCleanup, this);
  started_ = true;
}

void Executor::Stop(Napi::Env env) {
  {
    std::lock_guard lock(queue_->mutex);
    queue_->stopping = true;
    queue_->deliver = nullptr;
  }
  queue_->wake.notify_all();
  if (thread_.joinable()) {
    thread_.join();
  }
  channel_.Release();
  if (!cleanup_hook_.IsEmpty()) {
    cleanup_hook_.Remove(env);
  }
  started_ = false;
}

void Executor::EnvCleanup(Executor* executor) {
  executor->Abandon();
}

// Chiusura dell'environment (uscita del processo o terminazione del worker):
// le chiamate in coda vengono scartate senza essere eseguite; se una è in
// esecuzione il thread viene staccato e termina da solo.
void Executor::Abandon() {
  std::deque<ExecutorJob> waiting;
  std::vector<ExecutorJob> done;
  bool busy = false;
  {
    std::lock_guard lock(queue_->mutex);
    queue_->abandoned = true;
    queue_->stopping = true;
    queue_->deliver = nullptr;
    waiting.swap(queue_->waiting);
    done.swap(queue_->done);
    busy = queue_->busy;
  }
  queue_->wake.notify_all();
  if (busy) {
    thread_.detach();
  } else {
    if (thread_.joinable()) {
      thread_.join();
    }
    channel_.Release();
  }
  for (const ExecutorJob& job : waiting) {
    delete job.call;
  }
  for (const ExecutorJob& job : done) {
    delete job.call;
  }
  abandoned_ = true;
  started_ = false;
}

void Executor::Submit(Napi::Env env, std::unique_ptr<FFIFunction::PreparedCall> call) {
  if (closed_ || abandoned_) {
    call->Reject(Napi::Error::New(env, "Executor is closed").Value());
    return;
  }
  if (!started_) {
    Start(env);
  }
  const uint64_t id = ++next_job_;
  last_job_ = id;
  pending_++;
  Hold(env);
  // Attesa in linea fuori da Deliver, se la funzione di solito termina entro il
  // suo budget e il giro corrente dell'event loop ha ancora tempo; sotto lock,
  // solo se nessuna chiamata attende davanti a questa.
  const void* function = call->Function();
  std::chrono::nanoseconds budget =
    queue_->spin.count() > 0 && !delivering_ ? InlineBudget(function) : std::chrono::nanoseconds{0};
  if (budget.count() > 0 && SkipInline(function)) {
    budget = std::chrono::nanoseconds{0};
  }
  bool await_inline = budget.count() > 0 && InlineSliceLeft();
  bool parked = false;
  uint64_t finished = 0;
  {
    std::lock_guard lock(queue_->mutex);
    await_inline = await_inline && queue_->waiting.empty();
    queue_->waiting.push_back({id, call.release()});
    queue_->submitted.fetch_add(1, std::memory_order_release);
    if (await_inline) {
      queue_->awaited = id;
      queue_->awaited_done = false;
      finished = queue_->finished.load(std::memory_order_relaxed);
    }
    parked = queue_->parked;
  }
  if (parked) {
    queue_->wake.notify_one();
  }
  if (await_inline) {
    AwaitInline(env, finished, budget, function);
  }
}

bool Executor::SkipInline(const void* function) {
  const auto found = timings_.find(function);
  if (found == timings_.end() || found->second.skip == 0) {
    return false;
  }
  found->second.skip--;
  return true;
}

void Executor::InlineOutcome(const void* function, bool completed) {
  const auto found = timings_.find(function);
  if (found == timings_.end()) {
    return;
  }
  FunctionTiming& timing = found->second;
  if (completed) {
    timing.misses = 0;
    return;
  }
  timing.misses = std::min(timing.misses + 1, kMaxSkipShift);
  timing.skip = (1u << timing.misses) - 1;
}

std::chrono::nanoseconds Executor::InlineBudget(const void* function) const {
  const auto found = timings_.find(function);
  if (found == timings_.end()) {
    return queue_->spin;
  }
  const std::chrono::nanoseconds wanted = found->second.expected * 3 / 2 + kInlineMargin;
  if (wanted > spin_limit_) {
    return std::chrono::nanoseconds{0};
  }
  return std::max<std::chrono::nanoseconds>(queue_->spin, wanted);
}

void Executor::Learn(const void* function, std::chrono::nanoseconds duration) {
  const std::chrono::nanoseconds clipped = std::min(duration, spin_limit_ * kTimingClip);
  if (const auto found = timings_.find(function); found != timings_.end()) {
    std::chrono::nanoseconds& expected = found->second.expected;
    expected += (clipped - expected) / (clipped < expected ? kTimingFallWeight : kTimingWeight);
    return;
  }
  if (timings_.size() >= kMaxTimings) {
    timings_.clear();
  }
  timings_.emplace(function, FunctionTiming{clipped});
}

bool Executor::InlineSliceLeft() {
  const auto now = std::chrono::steady_clock::now();
  if (queue_->turns != inline_turn_) {
    inline_turn_ = queue_->turns;
    inline_since_ = now;
  }
  // Consegnato al prossimo giro dell'event loop: lì inizia un nuovo intervallo.
  if (!PostTurnMarker()) {
    return false;
  }
  return now - inline_since_ < kInlineSlice;
}

bool Executor::PostTurnMarker() {
  if (!queue_->turn_posted) {
    if (channel_.NonBlockingCall(&turn_marker) != napi_ok) {
      return false;
    }
    queue_->turn_posted = true;
  }
  return true;
}

void Executor::AwaitInline(Napi::Env env, uint64_t finished, std::chrono::nanoseconds budget, const void* function) {
  AwaitUntilChanged(queue_->finished, finished, budget);
  std::vector<ExecutorJob> jobs;
  {
    std::lock_guard lock(queue_->mutex);
    if (queue_->awaited_done) {
      queue_->awaited_done = false;
      jobs.swap(queue_->done);
    } else {
      // Scaduta: il thread nativo la notificherà con la TSFN.
      queue_->awaited = 0;
    }
  }
  if (jobs.empty()) {
    InlineOutcome(function, false);
    return;
  }
  inline_completed_++;
  // Prima di Deliver, che aggiorna la durata tipica (e può svuotare la tabella).
  InlineOutcome(function, true);
  // Siamo dentro fn.callOn(): un errore inatteso di Deliver diventa
  // un'eccezione non gestita al prossimo giro dell'event loop, non
  // un'eccezione di callOn.
  if (std::optional<Napi::Error> error = Deliver(env, std::move(jobs)); error && !deferred_error_) {
    deferred_error_ = std::move(error);
    PostTurnMarker();
  }
}

std::optional<Napi::Error> Executor::Deliver(Napi::Env env, std::vector<ExecutorJob>&& jobs) {
  if (jobs.empty()) {
    return std::nullopt;
  }
  std::optional<Napi::Error> first_error;
  const bool delivering = delivering_;
  delivering_ = true;
  for (const ExecutorJob& job : jobs) {
    const std::unique_ptr<FFIFunction::PreparedCall> call(job.call);
    pending_--;
    completed_++;
    Learn(call->Function(), call->RunDuration());
    try {
      call->Complete(env);
    } catch (const Napi::Error& e) {
      if (!first_error) {
        first_error = e;
      }
    } catch (...) {
      // Complete non solleva altro; un errore nativo inatteso non deve
      // impedire di completare le altre chiamate.
    }
  }
  delivering_ = delivering;
  Settled(env);
  return first_error;
}

void Executor::Hold(Napi::Env env) {
  if (!held_) {
    held_ = true;
    channel_.Ref(env);
    Ref();
  }
}

void Executor::Settled(Napi::Env env) {
  if (pending_ != 0) {
    return;
  }
  if (held_) {
    held_ = false;
    // Durante la chiusura dell'environment Node-API può rifiutare l'unref:
    // non deve interrompere la consegna delle altre chiamate né la chiusura.
    try {
      channel_.Unref(env);
      Unref();
    } catch (const Napi::Error&) {
    }
  }
  if (closing_) {
    FinishClose(env);
  }
}

void Executor::FinishClose(Napi::Env env) {
  if (started_) {
    Stop(env);
  }
  if (closing_) {
    closing_->Resolve(env.Undefined());
    closing_.reset();
  }
}

// close(): rifiuta le nuove chiamate, completa quelle accettate, poi ferma il
// thread. Restituisce sempre la stessa Promise.
Napi::Value Executor::Close(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (close_promise_.IsEmpty()) {
    closed_ = true;
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    close_promise_ = Napi::Persistent(deferred.Promise().As<Napi::Object>());
    closing_.emplace(deferred);
    if (pending_ == 0) {
      FinishClose(env);
    }
  }
  return close_promise_.Value();
}

// _cancel(id, reason): toglie dalla coda una chiamata non ancora iniziata e ne
// rifiuta la Promise con `reason`. false se è già iniziata o conclusa.
Napi::Value Executor::Cancel(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    throw Napi::TypeError::New(env, "_cancel requires a job id");
  }
  const auto id = static_cast<uint64_t>(info[0].As<Napi::Number>().Int64Value());
  ExecutorJob job;
  {
    std::lock_guard lock(queue_->mutex);
    const auto found = std::find_if(queue_->waiting.begin(), queue_->waiting.end(),
                                    [id](const ExecutorJob& candidate) { return candidate.id == id; });
    if (found == queue_->waiting.end()) {
      return Napi::Boolean::New(env, false);
    }
    job = *found;
    queue_->waiting.erase(found);
  }
  const std::unique_ptr<FFIFunction::PreparedCall> call(job.call);
  pending_--;
  call->Reject(info.Length() > 1 ? info[1] : env.Undefined());
  Settled(env);
  return Napi::Boolean::New(env, true);
}

Napi::Value Executor::GetPending(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(pending_));
}

Napi::Value Executor::GetCompleted(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(completed_));
}

Napi::Value Executor::GetRunning(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), started_);
}

Napi::Value Executor::GetClosed(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), closed_);
}

Napi::Value Executor::GetInlineBudget(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    throw Napi::TypeError::New(env, "_inlineBudget requires a function address (BigInt)");
  }
  bool lossless = false;
  const uint64_t address = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
  const std::chrono::nanoseconds budget = InlineBudget(reinterpret_cast<const void*>(static_cast<uintptr_t>(address)));
  return Napi::Number::New(env, std::chrono::duration<double, std::micro>(budget).count());
}

Napi::Value Executor::GetInlineCompleted(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(inline_completed_));
}

Napi::Value Executor::GetLastJob(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(last_job_));
}

}  // namespace ctypes
