#include "callback.h"

#include "function.h"  // For StringToCallConv, CallConvToFFI

namespace ctypes {
// ========================================================================
// Performance: Small Buffer Optimization per callback args
// Evita heap allocation per callback comuni (≤8 argomenti)
// ========================================================================
static constexpr size_t kMaxInlineCallbackArgs = 8;

namespace {

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
  } catch (const Napi::Error& e) {
    if (!e.Message().empty()) {
      error_msg = e.Message();
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
    arg_types.push_back(std::move(spec));
  }
}

[[nodiscard]] ffi_type* CallbackArgFFIType(const TypeSpec& type) {
  return type.struct_info ? type.struct_info->GetFFIType() : CTypeToFFI(type.type);
}

// Argomento di un callback: i primitivi con CToJS, le struct per valore come
// copia in un Buffer (la memoria di libffi vale solo durante la chiamata), che
// il layer JS avvolge in un'istanza della classe.
[[nodiscard]] Napi::Value CallbackArgToJS(Napi::Env env, void* arg, const TypeSpec& type) {
  if (type.struct_info) {
    return Napi::Buffer<uint8_t>::Copy(env, static_cast<const uint8_t*>(arg), type.struct_info->GetSize());
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
  } catch (const Napi::Error&) {
    // Il warning è best-effort: non deve propagare dentro il frame C del callback.
  }
}

}  // namespace

// ========================================================================
// Callback - Solo main thread, semplice e veloce
// ========================================================================

namespace {

// Handler per Callback (main thread only)
void CallbackHandler(ffi_cif* cif, void* ret, void** args, void* user_data) {
  CallbackData* data = static_cast<CallbackData*>(user_data);

  if (data->released.load(std::memory_order_acquire)) {
    // Callback rilasciato, ritorna zero
    if (data->return_type != CType::CTYPES_VOID) {
      memset(ret, 0, CTypeSize(data->return_type));
    }
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
    if (data->return_type != CType::CTYPES_VOID) {
      memset(ret, 0, CTypeSize(data->return_type));
    }
    return;
  }

  // Converti argomenti C -> JS
  Napi::Env env = data->js_function_ref.Env();
  Napi::HandleScope scope(env);

  // SBO: usa stack buffer per callback comuni, heap solo se necessario
  napi_value inline_args[kMaxInlineCallbackArgs];
  std::vector<napi_value> heap_args;
  napi_value* js_args;

  if (cif->nargs <= kMaxInlineCallbackArgs) {
    js_args = inline_args;
  } else {
    heap_args.resize(cif->nargs);
    js_args = heap_args.data();
  }

  for (unsigned int i = 0; i < cif->nargs; i++) {
    js_args[i] = CallbackArgToJS(env, args[i], data->arg_types[i]);
  }

  Napi::Value result;
  std::string error_msg = "Unknown error in callback";
  if (!CallJSCallback(env, data->js_function_ref.Value(), cif->nargs, js_args, result, error_msg)) {
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
    if (data->return_type != CType::CTYPES_VOID) {
      memset(ret, 0, CTypeSize(data->return_type));
    }
    return;
  }

  // Converti risultato JS -> C direttamente nel buffer di ret, senza
  // heap-allocare un vettore temporaneo e memcpy in ogni invocazione.
  // `ret` è fornito da libffi ed è abbastanza grande per il tipo dichiarato.
  if (data->return_type != CType::CTYPES_VOID) {
    size_t ret_size = CTypeSize(data->return_type);
    try {
      if (JSToC(result, data->return_type, std::span(static_cast<uint8_t*>(ret), ret_size)) <= 0) {
        memset(ret, 0, ret_size);
      }
    } catch (const Napi::Error& e) {
      // Python: "Exception ignored on converting result of ctypes callback
      // function" e risultato zero; nessuna eccezione attraversa il frame C.
      {
        std::lock_guard<std::mutex> lock(data->error_mutex);
        data->last_error = e.Message();
      }
      EmitCallbackWarning(env, e.Message(), "CallbackError");
      memset(ret, 0, ret_size);
    }
  }
}

}  // namespace

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
  data_->js_function_ref = Napi::Persistent(info[0].As<Napi::Function>());

  ParseCallbackTypes(info, data_->return_type, data_->arg_types);

  // Parse optional 4th argument: calling convention string
  ffi_abi abi = FFI_DEFAULT_ABI;
  if (info.Length() > 3 && info[3].IsString()) {
    abi = CallConvToFFI(StringToCallConv(info[3].As<Napi::String>().Utf8Value()));
  }

  // Prepara FFI types
  data_->ffi_return_type = CTypeToFFI(data_->return_type);
  for (const auto& type : data_->arg_types) {
    data_->ffi_arg_types.push_back(CallbackArgFFIType(type));
  }

  // Prepara CIF
  ffi_status status =
    ffi_prep_cif(&data_->cif, abi, static_cast<unsigned int>(data_->ffi_arg_types.size()), data_->ffi_return_type,
                 data_->ffi_arg_types.empty() ? nullptr : data_->ffi_arg_types.data());

  if (status != FFI_OK) {
    Napi::Error::New(env, "Failed to prepare callback CIF").ThrowAsJavaScriptException();
    return;
  }

  // Alloca closure
  data_->closure = static_cast<ffi_closure*>(ffi_closure_alloc(sizeof(ffi_closure), &data_->code_ptr));

  if (!data_->closure) {
    Napi::Error::New(env, "Failed to allocate FFI closure").ThrowAsJavaScriptException();
    return;
  }

  // Prepara closure
  status = ffi_prep_closure_loc(data_->closure, &data_->cif, CallbackHandler, data_.get(), data_->code_ptr);

  if (status != FFI_OK) {
    ffi_closure_free(data_->closure);
    data_->closure = nullptr;
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
  // Cleanup - il flag atomico previene double-free
  if (data_ && !data_->released.exchange(true)) {
    if (data_->closure) {
      ffi_closure_free(data_->closure);
      data_->closure = nullptr;
    }
    // Reset() è sicuro qui perché N-API lo gestisce internamente
    // Se chiamato dal GC, N-API lo fa in modo thread-safe
    if (!data_->js_function_ref.IsEmpty()) {
      data_->js_function_ref.Reset();
    }
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
  if (data_ && !data_->released.exchange(true)) {
    if (data_->closure) {
      ffi_closure_free(data_->closure);
      data_->closure = nullptr;
    }
    data_->js_function_ref.Reset();
    if (!data_->error_handler_ref.IsEmpty()) {
      data_->error_handler_ref.Reset();
    }
  }
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
  if (return_type != CType::CTYPES_VOID) {
    memset(ret, 0, CTypeSize(return_type));
  }
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
                              const char* default_error) {
  Napi::HandleScope scope(env);

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
      js_args[i] = CallbackArgToJS(env, args[i], data->arg_types[i]);
    }

    Napi::Value result;
    std::string error_msg = default_error;
    if (!CallJSCallback(env, fn, nargs, js_args, result, error_msg)) {
      RecordThreadSafeError(data, error_msg);
      if (!data->error_handler_ref.IsEmpty()) {
        try {
          data->error_handler_ref.Value().Call({Napi::String::New(env, error_msg)});
        } catch (const Napi::Error&) {
          // Un errore dell'error handler non deve propagare nel frame C.
        }
      } else {
        EmitCallbackWarning(env, error_msg, "ThreadSafeCallbackError");
      }
      ZeroResult(data->return_type, ret);
      return;
    }

    if (data->return_type != CType::CTYPES_VOID) {
      const size_t ret_size = CTypeSize(data->return_type);
      if (JSToC(result, data->return_type, std::span(static_cast<uint8_t*>(ret), ret_size)) <= 0) {
        memset(ret, 0, ret_size);
      }
    }
  } catch (const Napi::Error& e) {
    // Conversione di argomenti o risultato fallita.
    RecordThreadSafeError(data, e.Message());
    ZeroResult(data->return_type, ret);
  }
}

}  // namespace

void CallThreadSafeCallback(Napi::Env env,
                            Napi::Function js_callback,
                            ThreadSafeCallbackData* data,
                            PendingCallbackCall* call) {
  if (call == nullptr) {
    return;
  }

  // Il thread chiamante è sbloccato in ogni caso, anche se la funzione JS non
  // può essere eseguita.
  struct Complete {
    PendingCallbackCall* call;
    ~Complete() {
      std::lock_guard<std::mutex> lock(call->mutex);
      call->done = true;
      call->cv.notify_one();
    }
  } complete{call};

  // Ambiente in chiusura, o callback rilasciato (anche dal GC) con chiamate
  // ancora in coda: nessun JS, risultato zero.
  if (static_cast<napi_env>(env) == nullptr || js_callback.IsEmpty() ||
      data->released.load(std::memory_order_acquire)) {
    ZeroResult(data->return_type, call->ret);
    return;
  }
  try {
    InvokeThreadSafeCallback(env, js_callback, data, call->args, call->ret,
                             "Unknown error in thread-safe callback (external thread)");
  } catch (...) {
    ZeroResult(data->return_type, call->ret);
  }
}

namespace {

// Handler per ThreadSafeCallback
void ThreadSafeCallbackHandler(ffi_cif* /*cif*/, void* ret, void** args, void* user_data) {
  auto* data = static_cast<ThreadSafeCallbackState*>(user_data);

  if (data->released.load(std::memory_order_acquire)) {
    ZeroResult(data->return_type, ret);
    return;
  }

  if (std::this_thread::get_id() == data->main_thread_id) {
    // Percorso veloce: chiamata diretta
    InvokeThreadSafeCallback(data->js_function_ref.Env(), data->js_function_ref.Value(), data, args, ret,
                             "Unknown error in thread-safe callback");
    return;
  }

  // Thread esterno: ogni invocazione ha il proprio stato, quindi chiamate
  // concorrenti dello stesso callback ricevono ciascuna il proprio risultato.
  PendingCallbackCall call(args, ret);
  const napi_status status = data->tsfn.BlockingCall(&call);
  if (status != napi_ok) {
    RecordThreadSafeError(data, std::format("Failed to queue callback (napi_status: {})", static_cast<int>(status)));
    ZeroResult(data->return_type, ret);
    return;
  }

  std::unique_lock<std::mutex> lock(call.mutex);
  call.cv.wait(lock, [&call] { return call.done; });
}

}  // namespace

Napi::Function ThreadSafeCallback::GetClass(Napi::Env env) {
  return DefineClass(env, "ThreadSafeCallback",
                     {
                       InstanceMethod("getPointer", &ThreadSafeCallback::GetPointer),
                       InstanceMethod("release", &ThreadSafeCallback::Release),
                       InstanceMethod("setErrorHandler", &ThreadSafeCallback::SetErrorHandler),
                       InstanceMethod("getLastError", &ThreadSafeCallback::GetLastError),
                       InstanceMethod("ref", &ThreadSafeCallback::Ref),
                       InstanceMethod("unref", &ThreadSafeCallback::Unref),
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
  data_->js_function_ref = Napi::Persistent(js_func);

  ParseCallbackTypes(info, data_->return_type, data_->arg_types);

  // Parse optional 4th argument: calling convention string
  ffi_abi abi = FFI_DEFAULT_ABI;
  if (info.Length() > 3 && info[3].IsString()) {
    abi = CallConvToFFI(StringToCallConv(info[3].As<Napi::String>().Utf8Value()));
  }

  // Prepara FFI types
  data_->ffi_return_type = CTypeToFFI(data_->return_type);
  for (const auto& type : data_->arg_types) {
    data_->ffi_arg_types.push_back(CallbackArgFFIType(type));
  }

  // Prepara CIF
  ffi_status status =
    ffi_prep_cif(&data_->cif, abi, static_cast<unsigned int>(data_->ffi_arg_types.size()), data_->ffi_return_type,
                 data_->ffi_arg_types.empty() ? nullptr : data_->ffi_arg_types.data());

  if (status != FFI_OK) {
    Napi::Error::New(env, "Failed to prepare callback CIF").ThrowAsJavaScriptException();
    return;
  }

  // Crea ThreadSafeFunction
  // Il finalizzatore tiene vivi i dati finché la TSFN non è finalizzata
  // (coda svuotata), anche se il wrapper è già stato raccolto dal GC.
  using Owner = std::shared_ptr<ThreadSafeCallbackState>;
  data_->tsfn = ThreadSafeCallbackFunction::New(
    env, js_func, "ThreadSafeCallback",
    0,  // Unlimited queue
    1,  // Initial thread count
    static_cast<ThreadSafeCallbackData*>(data_.get()),
    [](Napi::Env, Owner* owner, ThreadSafeCallbackData*) {
      (*owner)->tsfn_finalized = true;
      delete owner;
    },
    new Owner(data_));

  // Alloca closure
  data_->closure = static_cast<ffi_closure*>(ffi_closure_alloc(sizeof(ffi_closure), &data_->code_ptr));

  if (!data_->closure) {
    ReleaseResources();
    Napi::Error::New(env, "Failed to allocate FFI closure").ThrowAsJavaScriptException();
    return;
  }

  // Prepara closure
  status = ffi_prep_closure_loc(data_->closure, &data_->cif, ThreadSafeCallbackHandler, data_.get(), data_->code_ptr);

  if (status != FFI_OK) {
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
  if (data_->closure) {
    ffi_closure_free(data_->closure);
    data_->closure = nullptr;
  }
  data_->js_function_ref.Reset();
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
  ReleaseResources();
  return info.Env().Undefined();
}

}  // namespace ctypes
