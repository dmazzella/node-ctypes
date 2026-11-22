#include "callback.h"

#include "addon.h"
#include "call_abi.h"
#include "napi_fast.h"
#include "types.h"

namespace ctypes {
namespace {

uintptr_t NativeContextAddress(Napi::Env env, const Napi::Value& value) {
  if (!value.IsBigInt()) {
    throw Napi::TypeError::New(env, "Native context addresses must be nonzero pointer-sized BigInts");
  }
  bool lossless = false;
  const uint64_t address = value.As<Napi::BigInt>().Uint64Value(&lossless);
  if (!lossless || address == 0 || address > UINTPTR_MAX) {
    throw Napi::RangeError::New(env, "Native context addresses must be nonzero pointer-sized BigInts");
  }
  return static_cast<uintptr_t>(address);
}

// Esegue la funzione JS sul thread host tracciando active_call per setNativeError.
void InvokeThreadSafeCallback(Napi::Env env,
                              const Napi::Function& fn,
                              ThreadSafeCallbackData* data,
                              void** args,
                              void* ret,
                              const char* default_error,
                              PendingCallbackCall* call = nullptr) {
  struct ActiveCall {
    ThreadSafeCallbackData* data;
    PendingCallbackCall* previous;
    ~ActiveCall() { data->active_call = previous; }
  } active{data, std::exchange(data->active_call, call)};

  InvokeCallbackOnJsThread(env, fn, data, args, ret, default_error, "ThreadSafeCallbackError", false);
}

bool DispatchThreadSafeCallback(Napi::Env env,
                                Napi::Function js_callback,
                                ThreadSafeCallbackData* data,
                                PendingCallbackCall* call) {
  if (call->claimed.exchange(true, std::memory_order_acq_rel)) {
    return false;
  }

  // Il thread chiamante è sbloccato in ogni caso, anche se la funzione JS non
  // può essere eseguita.
  struct Complete {
    ThreadSafeCallbackData* data;
    PendingCallbackCall* call;
    ~Complete() {
      {
        std::lock_guard<std::mutex> lock(data->pending_mutex);
        std::erase_if(data->pending, [this](const PendingCallback& pending) { return pending.get() == call; });
      }
      std::lock_guard<std::mutex> lock(call->mutex);
      call->done = true;
      call->cv.notify_one();
    }
  } complete{data, call};

  // Ambiente in chiusura, o callback rilasciato (anche dal GC) con chiamate
  // ancora in coda: nessun JS, risultato zero.
  if (static_cast<napi_env>(env) == nullptr || js_callback.IsEmpty() ||
      data->released.load(std::memory_order_acquire)) {
    ZeroReturnValue(data->return_type, call->ret);
    return true;
  }
  try {
    InvokeThreadSafeCallback(env, js_callback, data, call->args, call->ret,
                             "Unknown error in thread-safe callback (external thread)", call);
  } catch (...) {
    ZeroReturnValue(data->return_type, call->ret);
  }
  return true;
}

class NativeCallbackScope final {
 public:
  NativeCallbackScope(ThreadSafeCallbackData& data, PendingCallbackCall& call, bool foreign)
    : data_(data), call_(call) {
    data_.active_calls.fetch_add(1, std::memory_order_acq_rel);
    if (foreign && data_.native_context) {
      suspended_state_.emplace(data_.native_context->suspend());
    }
  }

  ~NativeCallbackScope() noexcept {
    // Anche uno stato sospeso nullo va ripristinato prima di impostare l'errore del chiamante.
    if (suspended_state_.has_value()) {
      data_.native_context->resume(*suspended_state_);
    }
    if (call_.native_error != nullptr && data_.native_context) {
      data_.native_context->on_error(call_.native_error);
    }
    data_.active_calls.fetch_sub(1, std::memory_order_acq_rel);
  }

  NativeCallbackScope(const NativeCallbackScope&) = delete;
  NativeCallbackScope& operator=(const NativeCallbackScope&) = delete;
  NativeCallbackScope(NativeCallbackScope&&) = delete;
  NativeCallbackScope& operator=(NativeCallbackScope&&) = delete;

 private:
  ThreadSafeCallbackData& data_;
  PendingCallbackCall& call_;
  std::optional<NativeCallbackContext::State> suspended_state_;
};
static_assert(!std::copyable<NativeCallbackScope> && !std::movable<NativeCallbackScope>);

}  // namespace

void CallThreadSafeCallback(Napi::Env env,
                            Napi::Function js_callback,
                            ThreadSafeCallbackData* data,
                            PendingCallback* payload) {
  std::unique_ptr<PendingCallback> owner(payload);
  if (owner) {
    DispatchThreadSafeCallback(env, js_callback, data, owner->get());
  }
}

// Handler per ThreadSafeCallback
void DispatchThreadSafeNative(ThreadSafeCallbackState* data, void* ret, void** args) {
  if (data->released.load(std::memory_order_acquire)) {
    ZeroReturnValue(data->return_type, ret);
    return;
  }

  const bool host_thread = CurrentThreadId() == data->thread_id;
  if (host_thread && !data->native_context) {
    // Percorso veloce: chiamata diretta sul thread host senza nativeContext.
    InvokeCallbackOnJsThread(data->js_function_ref.Env(), data->js_function_ref.Value(), data, args, ret,
                             "Unknown error in thread-safe callback", "ThreadSafeCallbackError", false);
    return;
  }

  // Thread esterno (o host con nativeContext): ogni invocazione ha il proprio
  // stato, così chiamate concorrenti o rientranti ricevono ciascuna il proprio risultato.
  auto call = std::make_shared<PendingCallbackCall>(args, ret);
  NativeCallbackScope context(*data, *call, !host_thread);

  if (host_thread) {
    InvokeThreadSafeCallback(data->js_function_ref.Env(), data->js_function_ref.Value(), data, args, ret,
                             "Unknown error in thread-safe callback", call.get());
    return;
  }
  {
    std::lock_guard<std::mutex> lock(data->pending_mutex);
    data->pending.push_back(call);
  }
  // Fino alla risposta: un'attesa in linea del thread JS si interrompe.
  const AwaitingJsThread awaiting;
  auto payload = std::make_unique<PendingCallback>(call);
  const napi_status status = data->tsfn.BlockingCall(payload.get());
  if (status != napi_ok) {
    RecordCallbackError(data, std::format("Failed to queue callback (napi_status: {})", static_cast<int>(status)));
    DispatchThreadSafeCallback(nullptr, Napi::Function(), data, call.get());
  } else {
    payload.release();
    if (data->native_context && data->native_context->notify != nullptr) {
      data->native_context->notify();
    }
  }

  std::unique_lock<std::mutex> lock(call->mutex);
  call->cv.wait(lock, [&call] { return call->done; });
}

Napi::Function ThreadSafeCallback::GetClass(Napi::Env env) {
  return DefineClass(env, "ThreadSafeCallback",
                     {
                       InstanceMethod("getPointer", &ThreadSafeCallback::GetPointer),
                       InstanceMethod("release", &ThreadSafeCallback::Release),
                       InstanceMethod("setErrorHandler", &ThreadSafeCallback::SetErrorHandler),
                       InstanceMethod("getLastError", &ThreadSafeCallback::GetLastError),
                       InstanceMethod("ref", &ThreadSafeCallback::Ref),
                       InstanceMethod("unref", &ThreadSafeCallback::Unref),
                       InstanceMethod("setNativeError", &ThreadSafeCallback::SetNativeError),
                       InstanceMethod("drain", &ThreadSafeCallback::Drain),
                     });
}

ThreadSafeCallback::ThreadSafeCallback(const Napi::CallbackInfo& info) : Napi::ObjectWrap<ThreadSafeCallback>(info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3) {
    Napi::TypeError::New(env, "ThreadSafeCallback requires function, returnType, argTypes")
      .ThrowAsJavaScriptException();
    return;
  }

  if (!info[0].IsFunction()) {
    Napi::TypeError::New(env, "First argument must be a function").ThrowAsJavaScriptException();
    return;
  }

  Napi::Function js_func = info[0].As<Napi::Function>();

  data_ = std::make_shared<ThreadSafeCallbackState>();
  data_->thread_id = std::this_thread::get_id();
  data_->addon = env.GetInstanceData<CTypesAddon>();
  data_->js_function_ref = Napi::Persistent(js_func);

  ParseCallbackTypes(info, *data_);
  data_->buffer_allocator_ref = CallbackBufferAllocator(info, data_->use_native_snapshot_pool);

  if (info.Length() > 5 && !info[5].IsUndefined()) {
    if (!info[5].IsObject() || info[5].IsNull()) {
      throw Napi::TypeError::New(env, "nativeContext must contain suspend, resume and onError addresses");
    }
    const auto context = info[5].As<Napi::Object>();
    NativeCallbackContext native_context{
      .suspend = reinterpret_cast<NativeCallbackContext::Suspend>(NativeContextAddress(env, context.Get("suspend"))),
      .resume = reinterpret_cast<NativeCallbackContext::Resume>(NativeContextAddress(env, context.Get("resume"))),
      .on_error =
        reinterpret_cast<NativeCallbackContext::ErrorHandler>(NativeContextAddress(env, context.Get("onError"))),
    };
    const auto notify = context.Get("notify");
    if (!notify.IsUndefined()) {
      native_context.notify = reinterpret_cast<NativeCallbackContext::Notify>(NativeContextAddress(env, notify));
    }
    data_->native_context = native_context;
  }

  // Legge il quarto argomento opzionale: la stringa della convenzione di chiamata.
  CallConv conv = CallConv::CTYPES_DEFAULT;
  if (info.Length() > 3 && info[3].IsString()) {
    conv = StringToCallConv(info[3].As<Napi::String>().Utf8Value());
  }
  for (const auto& type : data_->arg_types) {
    if (type.struct_info) {
      type.struct_info->Finalize();
    }
  }

  if (!data_->PrepareCIF(env, data_->return_type, data_->arg_types, conv)) {
    return;
  }

  // Crea ThreadSafeFunction: il finalizzatore tiene vivi i dati finché la coda
  // non è svuotata, anche se il wrapper è già stato raccolto dal GC.
  using Owner = std::shared_ptr<ThreadSafeCallbackState>;
  auto owner = std::make_unique<Owner>(data_);
  data_->tsfn = ThreadSafeCallbackFunction::New(
    env, js_func, "ThreadSafeCallback",
    0,  // Unlimited queue
    1,  // Initial thread count
    static_cast<ThreadSafeCallbackData*>(data_.get()),
    [](Napi::Env, Owner* owner, ThreadSafeCallbackData*) {
      (*owner)->tsfn_finalized = true;
      delete owner;
    },
    owner.get());
  owner.release();
  data_->tsfn_finalized = false;

  if (!data_->AllocateClosure(data_->code_ptr)) {
    ReleaseResources();
    Napi::Error::New(env, "Failed to allocate FFI closure").ThrowAsJavaScriptException();
    return;
  }

  if (!data_->PrepareClosure(LibffiThreadSafeCallbackHandler, data_.get(), data_->code_ptr)) {
    ReleaseResources();
    Napi::Error::New(env, "Failed to prepare FFI closure").ThrowAsJavaScriptException();
    return;
  }

  Napi::Object obj = info.This().As<Napi::Object>();
  obj.Set("pointer", Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr)));
}

ThreadSafeCallback::~ThreadSafeCallback() {
  ReleaseResources();
}

void ThreadSafeCallback::ReleaseResources() {
  if (data_ && !data_->released.exchange(true)) {
    data_->closure.reset();
    if (!data_->tsfn_finalized) {
      data_->tsfn.Release();
      data_->tsfn_finalized = true;
    }
    if (!data_->js_function_ref.IsEmpty()) {
      data_->js_function_ref.Reset();
    }
    if (!data_->error_handler_ref.IsEmpty()) {
      data_->error_handler_ref.Reset();
    }
    data_->buffer_allocator_ref.Reset();
  }
}

Napi::Value ThreadSafeCallback::SetErrorHandler(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!data_ || data_->released.load()) {
    Napi::Error::New(env, "ThreadSafeCallback has been released").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Error handler must be a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  data_->error_handler_ref = Napi::Persistent(info[0].As<Napi::Function>());
  return env.Undefined();
}

Napi::Value ThreadSafeCallback::GetLastError(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!data_) {
    return env.Null();
  }

  std::lock_guard<std::mutex> lock(data_->error_mutex);
  if (data_->last_error.empty()) {
    return env.Null();
  }

  return Napi::String::New(env, data_->last_error);
}

Napi::Value ThreadSafeCallback::GetPointer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!data_ || data_->released.load()) {
    Napi::Error::New(env, "ThreadSafeCallback has been released").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr));
}

// ref() / unref(): come i timer di Node, una callback referenziata (default)
// tiene vivo l'event loop; unref() lascia terminare il processo quando non
// resta altro da fare, mentre le chiamate dai thread continuano ad arrivare
// finché il loop è vivo. Solo dal main thread.
Napi::Value ThreadSafeCallback::Ref(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!data_ || data_->released.load()) {
    Napi::Error::New(env, "ThreadSafeCallback has been released").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  data_->tsfn.Ref(env);
  return info.This();
}

Napi::Value ThreadSafeCallback::Unref(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!data_ || data_->released.load()) {
    Napi::Error::New(env, "ThreadSafeCallback has been released").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  data_->tsfn.Unref(env);
  return info.This();
}

Napi::Value ThreadSafeCallback::Release(const Napi::CallbackInfo& info) {
  if (data_ && data_->native_context && data_->active_calls.load(std::memory_order_acquire) != 0) {
    throw Napi::Error::New(info.Env(), "Cannot release a native-context callback while calls are active");
  }
  ReleaseResources();
  return info.Env().Undefined();
}

Napi::Value ThreadSafeCallback::SetNativeError(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (!data_ || data_->released.load()) {
    throw Napi::Error::New(env, "ThreadSafeCallback has been released");
  }
  if (!data_->native_context || data_->active_call == nullptr) {
    throw Napi::Error::New(env, "setNativeError requires an active native-context callback");
  }
  if (data_->active_call->native_error != nullptr) {
    throw Napi::Error::New(env, "A native error is already set for this callback invocation");
  }
  data_->active_call->native_error =
    reinterpret_cast<void*>(NativeContextAddress(env, info.Length() > 0 ? info[0] : env.Undefined()));
  return env.Undefined();
}

Napi::Value ThreadSafeCallback::Drain(const Napi::CallbackInfo& info) {
  if (!data_ || data_->released.load()) {
    throw Napi::Error::New(info.Env(), "ThreadSafeCallback has been released");
  }
  std::vector<PendingCallback> pending;
  {
    std::lock_guard<std::mutex> lock(data_->pending_mutex);
    pending = data_->pending;
  }
  size_t count = 0;
  const auto fn = data_->js_function_ref.Value();
  for (const auto& call : pending) {
    if (DispatchThreadSafeCallback(info.Env(), fn, data_.get(), call.get())) {
      ++count;
    }
  }
  return Napi::Number::New(info.Env(), static_cast<double>(count));
}

}  // namespace ctypes
