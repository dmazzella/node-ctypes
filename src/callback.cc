#include "callback.h"

#include "addon.h"
#include "call_abi.h"
#include "types.h"

namespace ctypes {
// ========================================================================
// Performance: Small Buffer Optimization per callback args
// Evita heap allocation per callback comuni (≤8 argomenti)
// ========================================================================
static constexpr size_t kMaxInlineCallbackArgs = 8;

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

bool StoreJSCallbackResult(const Napi::Value& result, CType type, void* destination) {
  const size_t size = CTypeSize(type);
  if (ReturnStorageSize(type) == size) {
    return JSToC(result, type, std::span(static_cast<uint8_t*>(destination), size)) > 0;
  }
  std::array<uint8_t, sizeof(AbiWord)> bytes{};
  if (JSToC(result, type, std::span(bytes).first(size)) <= 0) {
    return false;
  }
  StoreCallbackValue(type, bytes.data(), destination);
  return true;
}

// Chiama la funzione JS del callback. Se lancia, l'eccezione arriva come
// Napi::Error (NAPI_CPP_EXCEPTIONS), che la recupera e la rimuove dall'env:
// ritorna false e lascia il messaggio in error_msg.
bool CallJSCallback(Napi::Env env,
                    const Napi::Function& fn,
                    size_t nargs,
                    const napi_value* args,
                    Napi::Value& result,
                    std::string& error_msg) {
  try {
    result = fn.Call(env.Undefined(), nargs, args);
    return true;
  } catch (const std::exception& e) {
    // Anche un'eccezione C++ non Napi: non deve attraversare il frame C del callback.
    if (const std::string_view message = e.what(); !message.empty()) {
      error_msg = message;
    }
    return false;
  }
}

// Tipi di un callback (info[1] ritorno, info[2] argomenti): CType primitivi,
// convertiti con CToJS / JSToC, e argomenti struct/union per valore. Come in
// Python, il ritorno non può essere una struct e gli array non sono argomenti.
void ParseCallbackTypes(const Napi::CallbackInfo& info, CType& return_type, std::vector<TypeSpec>& arg_types) {
  Napi::Env env = info.Env();
  if (info[1].IsObject() && TypeSpecFromJS(info[1]).type != CType::CTYPES_VOID) {
    throw Napi::TypeError::New(env, "invalid result type for callback function");
  }
  try {
    return_type = CTypeFromJS(info[1]);
  } catch (const Napi::Error& e) {
    throw Napi::TypeError::New(env, std::format("Invalid return type: {}", e.Message()));
  }
  if (!info[2].IsArray()) {
    throw Napi::TypeError::New(env, "Third argument must be array of types");
  }
  const Napi::Array arr = info[2].As<Napi::Array>();
  const uint32_t count = arr.Length();
  if (info.Length() > 4 && (!info[4].IsArray() || info[4].As<Napi::Array>().Length() != count)) {
    throw Napi::TypeError::New(env, "scalar callback buffer flags must match the argument types");
  }
  arg_types.reserve(count);
  for (uint32_t i = 0; i < count; i++) {
    TypeSpec spec;
    try {
      spec = TypeSpecFromJS(arr.Get(i));
    } catch (const Napi::Error& e) {
      throw Napi::TypeError::New(env, std::format("Invalid argument type at index {}: {}", i, e.Message()));
    }
    if (spec.array_info) {
      throw Napi::TypeError::New(
        env,
        std::format("Invalid argument type at index {}: arrays are not supported in callbacks, use POINTER(T)", i));
    }
    if (info.Length() > 4 && info[4].IsArray()) {
      const Napi::Array buffers = info[4].As<Napi::Array>();
      const Napi::Value flag = buffers.Get(i);
      if (!flag.IsBoolean()) {
        throw Napi::TypeError::New(env, "scalar callback buffer flags must be boolean");
      }
      spec.scalar_buffer = flag.As<Napi::Boolean>().Value();
      if (spec.scalar_buffer && CTypeSize(spec.type) == 0) {
        throw Napi::TypeError::New(env, "scalar callback buffers require primitive argument types");
      }
    }
    arg_types.push_back(std::move(spec));
  }
}

Napi::FunctionReference CallbackBufferAllocator(const Napi::CallbackInfo& info) {
  if (info.Length() <= 6 || info[6].IsUndefined()) {
    return {};
  }
  if (!info[6].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "Callback buffer allocator must be a function");
  }
  return Napi::Persistent(info[6].As<Napi::Function>());
}

// Argomento di un callback: i primitivi con CToJS, le struct per valore come
// copia in un Buffer (la memoria ABI vale solo durante la chiamata), che
// il layer JS avvolge in un'istanza della classe.
[[nodiscard]] Napi::Value CallbackArgToJS(Napi::Env env,
                                          void* arg,
                                          const TypeSpec& type,
                                          const Napi::FunctionReference& allocator) {
  if (type.struct_info || type.scalar_buffer) {
    const size_t size = type.struct_info ? type.struct_info->GetSize() : CTypeSize(type.type);
    // Il pool JS allinea a 8 byte; i layout sovra-allineati mantengono l'allocatore nativo.
    if (!allocator.IsEmpty() && (!type.struct_info || type.struct_info->GetAlignment() <= 8)) {
      const Napi::Value value = allocator.Call({Napi::Number::New(env, static_cast<double>(size))});
      if (!value.IsBuffer()) {
        throw Napi::TypeError::New(env, "Callback buffer allocator must return a Buffer");
      }
      const auto buffer = value.As<Napi::Buffer<uint8_t>>();
      if (buffer.Length() != size) {
        throw Napi::RangeError::New(env, "Callback buffer allocator returned a buffer of the wrong size");
      }
      std::memcpy(buffer.Data(), arg, size);
      return buffer;
    }
    return Napi::Buffer<uint8_t>::Copy(env, static_cast<const uint8_t*>(arg), size);
  }
  return CToJS(env, arg, type.type);
}

// Fallback senza error handler: process.emitWarning(message, type).
void EmitCallbackWarning(Napi::Env env, const std::string& message, const char* type) {
  try {
    Napi::Value process = env.Global().Get("process");
    if (!process.IsObject()) {
      return;
    }
    Napi::Value emit_warning = process.As<Napi::Object>().Get("emitWarning");
    if (emit_warning.IsFunction()) {
      emit_warning.As<Napi::Function>().Call(process, {Napi::String::New(env, message), Napi::String::New(env, type)});
    }
  } catch (const std::exception&) {
    // Il warning è best-effort: non deve propagare dentro il frame C del callback.
  }
}

}  // namespace

// ========================================================================
// Callback - Solo main thread, semplice e veloce
// ========================================================================

void DispatchCallback(CallbackData* data, void* ret, void** args) {
  if (data->released.load(std::memory_order_acquire)) {
    // Callback rilasciato, ritorna zero
    ZeroReturnValue(data->return_type, ret);
    return;
  }

  // Una Callback esegue JS solo sul thread che l'ha creata: chiamata da un
  // altro thread (es. una funzione C eseguita con callAsync che richiama il
  // puntatore) non può toccare V8. Per quei casi serve threadSafeCallback().
  if (std::this_thread::get_id() != data->thread_id) [[unlikely]] {
    {
      std::lock_guard<std::mutex> lock(data->error_mutex);
      data->last_error = "callback called from a thread other than the one that created it; use threadSafeCallback()";
    }
    ZeroReturnValue(data->return_type, ret);
    return;
  }

  if (data->addon != nullptr) {
    data->addon->callback_epoch++;
  }

  // Converti argomenti C -> JS
  Napi::Env env = data->js_function_ref.Env();
  Napi::HandleScope scope(env);
  const size_t nargs = data->arg_types.size();

  // SBO: usa stack buffer per callback comuni, heap solo se necessario
  napi_value inline_args[kMaxInlineCallbackArgs];
  std::vector<napi_value> heap_args;
  napi_value* js_args;

  if (nargs <= kMaxInlineCallbackArgs) {
    js_args = inline_args;
  } else {
    heap_args.resize(nargs);
    js_args = heap_args.data();
  }

  try {
    for (size_t i = 0; i < nargs; i++) {
      js_args[i] = CallbackArgToJS(env, args[i], data->arg_types[i], data->buffer_allocator_ref);
    }
  } catch (const std::exception& error) {
    // Anche std::bad_alloc dalla copia: nessuna eccezione attraversa il frame C.
    const std::string message = error.what();
    {
      std::lock_guard lock(data->error_mutex);
      data->last_error = message;
    }
    EmitCallbackWarning(env, message, "CallbackError");
    ZeroReturnValue(data->return_type, ret);
    return;
  }

  Napi::Value result;
  std::string error_msg;
  if (!CallJSCallback(env, data->js_function_ref.Value(), nargs, js_args, result, error_msg)) {
    if (error_msg.empty()) {
      error_msg = "Unknown error in callback";
    }
    // Salva l'ultimo errore
    {
      std::lock_guard<std::mutex> lock(data->error_mutex);
      data->last_error = error_msg;
    }

    // Chiama error handler se presente
    if (!data->error_handler_ref.IsEmpty()) {
      try {
        Napi::Function error_handler = data->error_handler_ref.Value();
        error_handler.Call({Napi::String::New(env, error_msg)});
      } catch (...) {
        // Ignora errori nell'error handler stesso
      }
    } else {
      // Fallback: emetti warning (visibile in Node.js)
      EmitCallbackWarning(env, error_msg, "CallbackError");
    }

    // Ritorna valore zero per evitare comportamenti indefiniti in C
    ZeroReturnValue(data->return_type, ret);
    return;
  }

  // Converti risultato JS -> C direttamente nel buffer di ret, senza
  // heap-allocare un vettore temporaneo e memcpy in ogni invocazione.
  // Libffi fornisce uno slot abbastanza grande per il tipo dichiarato.
  if (data->return_type != CType::CTYPES_VOID) {
    try {
      if (!StoreJSCallbackResult(result, data->return_type, ret)) {
        ZeroReturnValue(data->return_type, ret);
      }
    } catch (const std::exception& e) {
      // Python: "Exception ignored on converting result of ctypes callback
      // function" e risultato zero; nessuna eccezione attraversa il frame C.
      const std::string message = e.what();
      {
        std::lock_guard<std::mutex> lock(data->error_mutex);
        data->last_error = message;
      }
      EmitCallbackWarning(env, message, "CallbackError");
      ZeroReturnValue(data->return_type, ret);
    }
  }
}

Napi::Function Callback::GetClass(Napi::Env env) {
  return DefineClass(env, "Callback",
                     {
                       InstanceMethod("getPointer", &Callback::GetPointer),
                       InstanceMethod("release", &Callback::Release),
                       InstanceMethod("setErrorHandler", &Callback::SetErrorHandler),
                       InstanceMethod("getLastError", &Callback::GetLastError),
                     });
}

Callback::Callback(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Callback>(info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3) {
    Napi::TypeError::New(env, "Callback requires function, returnType, argTypes").ThrowAsJavaScriptException();
    return;
  }

  if (!info[0].IsFunction()) {
    Napi::TypeError::New(env, "First argument must be a function").ThrowAsJavaScriptException();
    return;
  }

  data_ = std::make_unique<CallbackData>();
  data_->thread_id = std::this_thread::get_id();
  data_->addon = env.GetInstanceData<CTypesAddon>();
  data_->js_function_ref = Napi::Persistent(info[0].As<Napi::Function>());

  ParseCallbackTypes(info, data_->return_type, data_->arg_types);
  data_->buffer_allocator_ref = CallbackBufferAllocator(info);

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
  if (!data_->AllocateClosure(data_->code_ptr)) {
    Napi::Error::New(env, "Failed to allocate FFI closure").ThrowAsJavaScriptException();
    return;
  }

  // Prepara closure
  if (!data_->PrepareClosure(LibffiCallbackHandler, data_.get(), data_->code_ptr)) {
    data_->closure.reset();
    Napi::Error::New(env, "Failed to prepare FFI closure").ThrowAsJavaScriptException();
    return;
  }

  // Il cleanup del FunctionReference verrà fatto in Release() o nel distruttore
  // N-API gestisce automaticamente il GC in modo thread-safe

  // Imposta la proprietà pointer come BigInt (ottimizzazione per accesso frequente)
  Napi::Object obj = info.This().As<Napi::Object>();
  obj.Set("pointer", Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr)));
}

Callback::~Callback() {
  ReleaseResources();
}

void Callback::ReleaseResources() {
  if (data_ && !data_->released.exchange(true)) {
    data_->closure.reset();
    if (!data_->js_function_ref.IsEmpty()) {
      data_->js_function_ref.Reset();
    }
    if (!data_->error_handler_ref.IsEmpty()) {
      data_->error_handler_ref.Reset();
    }
    data_->buffer_allocator_ref.Reset();
  }
}

Napi::Value Callback::GetPointer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!data_ || data_->released.load()) {
    Napi::Error::New(env, "Callback has been released").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr));
}

Napi::Value Callback::Release(const Napi::CallbackInfo& info) {
  ReleaseResources();
  return info.Env().Undefined();
}

Napi::Value Callback::SetErrorHandler(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!data_ || data_->released.load()) {
    Napi::Error::New(env, "Callback has been released").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Error handler must be a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  data_->error_handler_ref = Napi::Persistent(info[0].As<Napi::Function>());
  return env.Undefined();
}

Napi::Value Callback::GetLastError(const Napi::CallbackInfo& info) {
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

// ========================================================================
// ThreadSafeCallback - Supporta chiamate da qualsiasi thread
// ========================================================================

namespace {

void ZeroResult(CType return_type, void* ret) {
  ZeroReturnValue(return_type, ret);
}

void RecordThreadSafeError(ThreadSafeCallbackData* data, std::string message) {
  std::lock_guard<std::mutex> lock(data->error_mutex);
  data->last_error = std::move(message);
}

// Esegue la funzione JS (main thread) con gli argomenti di libffi e scrive il
// risultato in `ret`; se la funzione lancia, il risultato è zero.
void InvokeThreadSafeCallback(Napi::Env env,
                              const Napi::Function& fn,
                              ThreadSafeCallbackData* data,
                              void** args,
                              void* ret,
                              const char* default_error,
                              PendingCallbackCall* call = nullptr) {
  Napi::HandleScope scope(env);
  if (data->addon != nullptr) {
    data->addon->callback_epoch++;
  }
  struct ActiveCall {
    ThreadSafeCallbackData* data;
    PendingCallbackCall* previous;
    ~ActiveCall() { data->active_call = previous; }
  } active{data, std::exchange(data->active_call, call)};

  // SBO: usa stack buffer per callback comuni, heap solo se necessario
  const size_t nargs = data->arg_types.size();
  std::array<napi_value, kMaxInlineCallbackArgs> inline_args;
  std::vector<napi_value> heap_args;
  napi_value* js_args = inline_args.data();
  if (nargs > kMaxInlineCallbackArgs) {
    heap_args.resize(nargs);
    js_args = heap_args.data();
  }

  try {
    for (size_t i = 0; i < nargs; i++) {
      js_args[i] = CallbackArgToJS(env, args[i], data->arg_types[i], data->buffer_allocator_ref);
    }

    Napi::Value result;
    std::string error_msg;
    if (!CallJSCallback(env, fn, nargs, js_args, result, error_msg)) {
      if (error_msg.empty()) {
        error_msg = default_error;
      }
      RecordThreadSafeError(data, error_msg);
      if (!data->error_handler_ref.IsEmpty()) {
        try {
          data->error_handler_ref.Value().Call({Napi::String::New(env, error_msg)});
        } catch (const std::exception&) {
          // Un errore dell'error handler non deve propagare nel frame C.
        }
      } else {
        EmitCallbackWarning(env, error_msg, "ThreadSafeCallbackError");
      }
      ZeroResult(data->return_type, ret);
      return;
    }

    if (data->return_type != CType::CTYPES_VOID) {
      if (!StoreJSCallbackResult(result, data->return_type, ret)) {
        ZeroResult(data->return_type, ret);
      }
    }
  } catch (const std::exception& e) {
    // Conversione di argomenti o risultato fallita (anche std::bad_alloc).
    RecordThreadSafeError(data, e.what());
    ZeroResult(data->return_type, ret);
  }
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
    ZeroResult(data->return_type, call->ret);
    return true;
  }
  try {
    InvokeThreadSafeCallback(env, js_callback, data, call->args, call->ret,
                             "Unknown error in thread-safe callback (external thread)", call);
  } catch (...) {
    ZeroResult(data->return_type, call->ret);
  }
  return true;
}

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

namespace {

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
    if (call_.native_error != nullptr) {
      data_.native_context->on_error(call_.native_error);
    }
    data_.active_calls.fetch_sub(1, std::memory_order_release);
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

// Handler per ThreadSafeCallback
void DispatchThreadSafeNative(ThreadSafeCallbackState* data, void* ret, void** args) {
  if (data->released.load(std::memory_order_acquire)) {
    ZeroResult(data->return_type, ret);
    return;
  }

  const bool host_thread = std::this_thread::get_id() == data->main_thread_id;
  if (host_thread && !data->native_context) {
    // Percorso veloce: chiamata diretta
    InvokeThreadSafeCallback(data->js_function_ref.Env(), data->js_function_ref.Value(), data, args, ret,
                             "Unknown error in thread-safe callback");
    return;
  }

  // Thread esterno: ogni invocazione ha il proprio stato, quindi chiamate
  // concorrenti dello stesso callback ricevono ciascuna il proprio risultato.
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
  auto payload = std::make_unique<PendingCallback>(call);
  const napi_status status = data->tsfn.BlockingCall(payload.get());
  if (status != napi_ok) {
    RecordThreadSafeError(data, std::format("Failed to queue callback (napi_status: {})", static_cast<int>(status)));
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
  data_->main_thread_id = std::this_thread::get_id();
  data_->addon = env.GetInstanceData<CTypesAddon>();
  data_->js_function_ref = Napi::Persistent(js_func);

  ParseCallbackTypes(info, data_->return_type, data_->arg_types);
  data_->buffer_allocator_ref = CallbackBufferAllocator(info);

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

  // Crea ThreadSafeFunction
  // Il finalizzatore tiene vivi i dati finché la TSFN non è finalizzata
  // (coda svuotata), anche se il wrapper è già stato raccolto dal GC.
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

  // Prepara closure
  if (!data_->PrepareClosure(LibffiThreadSafeCallbackHandler, data_.get(), data_->code_ptr)) {
    ReleaseResources();
    Napi::Error::New(env, "Failed to prepare FFI closure").ThrowAsJavaScriptException();
    return;
  }

  // Il cleanup verrà fatto in Release() o nel distruttore

  // Imposta la proprietà pointer come BigInt (ottimizzazione per accesso frequente)
  Napi::Object obj = info.This().As<Napi::Object>();
  obj.Set("pointer", Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr)));
}

ThreadSafeCallback::~ThreadSafeCallback() {
  // Raccolto dal GC senza release(): stessa pulizia, come Callback.
  ReleaseResources();
}

void ThreadSafeCallback::ReleaseResources() {
  if (!data_ || data_->released.exchange(true)) {
    return;
  }
  data_->closure.reset();
  data_->js_function_ref.Reset();
  data_->buffer_allocator_ref.Reset();
  if (!data_->error_handler_ref.IsEmpty()) {
    data_->error_handler_ref.Reset();
  }
  if (!data_->tsfn_finalized) {
    data_->tsfn.Release();
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
