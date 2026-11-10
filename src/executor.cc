#include "executor.h"

#ifndef _WIN32
#include <pthread.h>
#endif

namespace ctypes {

namespace {

constexpr const char* kDefaultThreadName = "node-ctypes";

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
// e notifica il thread JS di ognuna attraverso la TSFN.
void ExecutorLoop(std::shared_ptr<ExecutorQueue> queue, std::string name, std::u16string wide_name) {
  NameCurrentThread(name, wide_name);
  std::unique_lock lock(queue->mutex);
  while (true) {
    queue->wake.wait(lock, [&queue] { return queue->stopping || !queue->waiting.empty(); });
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
    // Sotto lock: dopo abandoned la TSFN non viene più usata da questo thread.
    napi_call_threadsafe_function(queue->channel, nullptr, napi_tsfn_nonblocking);
  }
}

}  // namespace

void DeliverExecutorCompletions(Napi::Env env, Napi::Function, ExecutorQueue* queue, void*) {
  if (env == nullptr) {
    return;
  }
  std::vector<ExecutorJob> jobs;
  std::function<void(Napi::Env, std::vector<ExecutorJob>&&)> deliver;
  {
    std::lock_guard lock(queue->mutex);
    jobs.swap(queue->done);
    deliver = queue->deliver;
  }
  if (jobs.empty()) {
    return;
  }
  if (!deliver) {
    for (const ExecutorJob& job : jobs) {
      delete job.call;
    }
    return;
  }
  deliver(env, std::move(jobs));
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
}

Executor::~Executor() {
  // Raccolto dal GC: nessuna chiamata in sospeso (l'oggetto è referenziato
  // finché ce ne sono), il thread è inattivo.
  if (started_ && !abandoned_) {
    Stop(Napi::Env(env_));
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
      Deliver(deliver_env, std::move(jobs));
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
  napi_add_env_cleanup_hook(env, &Executor::EnvCleanup, this);
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
  napi_remove_env_cleanup_hook(env, &Executor::EnvCleanup, this);
  started_ = false;
}

void Executor::EnvCleanup(void* data) {
  static_cast<Executor*>(data)->Abandon();
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
  {
    std::lock_guard lock(queue_->mutex);
    queue_->waiting.push_back({id, call.release()});
  }
  queue_->wake.notify_one();
}

void Executor::Deliver(Napi::Env env, std::vector<ExecutorJob>&& jobs) {
  std::optional<Napi::Error> first_error;
  for (const ExecutorJob& job : jobs) {
    const std::unique_ptr<FFIFunction::PreparedCall> call(job.call);
    pending_--;
    completed_++;
    try {
      call->Complete(env);
    } catch (const Napi::Error& e) {
      if (!first_error) {
        first_error = e;
      }
    }
  }
  Settled(env);
  if (first_error) {
    // Callback della TSFN: l'errore diventa un'eccezione JS non gestita.
    first_error->ThrowAsJavaScriptException();
  }
}

void Executor::Hold(Napi::Env env) {
  if (!held_) {
    channel_.Ref(env);
    Ref();
    held_ = true;
  }
}

void Executor::Settled(Napi::Env env) {
  if (pending_ != 0) {
    return;
  }
  if (held_) {
    channel_.Unref(env);
    Unref();
    held_ = false;
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

Napi::Value Executor::GetLastJob(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(last_job_));
}

}  // namespace ctypes
