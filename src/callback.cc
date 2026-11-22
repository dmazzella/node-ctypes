#include "callback.h"

#include "addon.h"
#include "call_abi.h"
#include "napi_fast.h"
#include "types.h"

namespace ctypes {
// ========================================================================
// Performance: Small Buffer Optimization per callback args
// Evita heap allocation per callback comuni (≤8 argomenti)
// ========================================================================
static constexpr size_t kMaxInlineCallbackArgs = 8;

namespace {

// Risultato numerico (interi, float, double) di un callback con una sola
// lettura del number, come JSToC; false se non è un number o il tipo non è
// numerico (allora JSToC).
bool StoreNumberResult(const Napi::Value& result, CType type, void* destination) {
  switch (type) {
    case CType::CTYPES_INT8:
    case CType::CTYPES_UINT8:
    case CType::CTYPES_INT16:
    case CType::CTYPES_UINT16:
    case CType::CTYPES_INT32:
    case CType::CTYPES_UINT32:
    case CType::CTYPES_INT64:
    case CType::CTYPES_UINT64:
    case CType::CTYPES_FLOAT:
    case CType::CTYPES_DOUBLE:
      break;
    default:
      return false;
  }
  double d;
  if (!napi_fast::TryDouble(result, d)) {
    return false;
  }
  if (type == CType::CTYPES_DOUBLE) {
    StoreReturnValue(destination, d);
    return true;
  }
  if (type == CType::CTYPES_FLOAT) {
    StoreReturnValue(destination, static_cast<float>(d));
    return true;
  }
  if (type == CType::CTYPES_INT32 && d >= -2147483648.0 && d <= 2147483647.0) [[likely]] {
    const auto v = static_cast<int32_t>(d);
    if (static_cast<double>(v) == d) [[likely]] {
      StoreReturnValue(destination, v);
      return true;
    }
  } else if (type == CType::CTYPES_UINT32 && d >= 0.0 && d <= 4294967295.0) {
    const auto v = static_cast<uint32_t>(d);
    if (static_cast<double>(v) == d) {
      StoreReturnValue(destination, v);
      return true;
    }
  }
  const uint64_t bits = IntegerBitsFromNumber(result, d);
  switch (type) {
    case CType::CTYPES_INT8:
      StoreReturnValue(destination, static_cast<int8_t>(bits));
      break;
    case CType::CTYPES_UINT8:
      StoreReturnValue(destination, static_cast<uint8_t>(bits));
      break;
    case CType::CTYPES_INT16:
      StoreReturnValue(destination, static_cast<int16_t>(bits));
      break;
    case CType::CTYPES_UINT16:
      StoreReturnValue(destination, static_cast<uint16_t>(bits));
      break;
    case CType::CTYPES_INT32:
      StoreReturnValue(destination, static_cast<int32_t>(static_cast<uint32_t>(bits)));
      break;
    case CType::CTYPES_UINT32:
      StoreReturnValue(destination, static_cast<uint32_t>(bits));
      break;
    case CType::CTYPES_INT64:
      StoreReturnValue(destination, static_cast<int64_t>(bits));
      break;
    default:
      StoreReturnValue(destination, bits);
      break;
  }
  return true;
}

bool StoreJSCallbackResult(const Napi::Value& result, CType type, void* destination) {
  if (StoreNumberResult(result, type, destination)) [[likely]] {
    return true;
  }
  const size_t size = CTypeSize(type);
  if (ReturnStorageSize(type) == size) {
    return JSToC(result, type, std::span(static_cast<uint8_t*>(destination), size)) > 0;
  }
  std::array<uint8_t, sizeof(AbiWord)> bytes{};
  if (JSToC(result, type, std::span(bytes).first(size)) <= 0) {
    return false;
  }
  StoreNarrowIntegerValue(type, bytes.data(), destination);
  return true;
}

// Conversione inline degli argomenti scalari/puntatori comuni (evita CToJS cross-TU).
[[nodiscard]] CTYPES_ALWAYS_INLINE napi_value SimpleCallbackArgToJS(Napi::Env env, void* arg, CType type) {
  switch (type) {
    case CType::CTYPES_POINTER: {
      void* const ptr = LoadAs<void*>(arg);
      if (ptr == nullptr) [[unlikely]] {
        return env.Null();
      }
      return napi_fast::PointerBigInt(env, reinterpret_cast<uintptr_t>(ptr));
    }
    case CType::CTYPES_INT32:
      return napi_fast::Int32(env, LoadAs<int32_t>(arg));
    case CType::CTYPES_UINT32:
      return napi_fast::Uint32(env, LoadAs<uint32_t>(arg));
    case CType::CTYPES_INT64:
      return napi_fast::Int64BigInt(env, LoadAs<int64_t>(arg));
    case CType::CTYPES_UINT64:
      return napi_fast::PointerBigInt(env, LoadAs<uint64_t>(arg));
    case CType::CTYPES_DOUBLE:
      return napi_fast::Double(env, LoadAs<double>(arg));
    case CType::CTYPES_FLOAT:
      return napi_fast::Double(env, static_cast<double>(LoadAs<float>(arg)));
    default:
      return CToJS(env, arg, type);
  }
}

// Argomento di un callback: i primitivi con CToJS, le struct per valore come
// copia in un Buffer o Uint8Array dal pool nativo (la memoria ABI vale solo
// durante la chiamata), che il layer JS avvolge in un'istanza della classe.
[[nodiscard]] Napi::Value CallbackArgToJS(Napi::Env env,
                                          void* arg,
                                          const TypeSpec& type,
                                          const Napi::FunctionReference& allocator,
                                          bool use_native_pool,
                                          CTypesAddon* addon) {
  if (type.struct_info || type.scalar_buffer) {
    const size_t size = type.struct_info ? type.struct_info->GetSize() : CTypeSize(type.type);
    // Pool nativo C++ per struct funzionali non sovra-allineate: evita il round-trip C++ -> JS.
    if (use_native_pool && addon != nullptr && type.struct_info && type.struct_info->GetAlignment() <= 8 &&
        size <= CTypesAddon::kCallbackSnapshotPoolSize / 4) {
      Napi::ArrayBuffer pool;
      bool need_fresh = addon->callback_snapshot_pool.IsEmpty() ||
                        addon->callback_snapshot_offset + size > CTypesAddon::kCallbackSnapshotPoolSize;
      if (!need_fresh) {
        pool = addon->callback_snapshot_pool.Value();
        need_fresh = pool.IsEmpty() || napi_fast::IsArrayBufferDetached(env, pool);
      }
      if (need_fresh) {
        pool = Napi::ArrayBuffer::New(env, CTypesAddon::kCallbackSnapshotPoolSize);
        addon->callback_snapshot_pool = Napi::Persistent(pool);
        addon->callback_snapshot_data = static_cast<uint8_t*>(pool.Data());
        addon->callback_snapshot_offset = 0;
      }
      const size_t offset = addon->callback_snapshot_offset;
      if (size > 0) {
        std::memcpy(addon->callback_snapshot_data + offset, arg, size);
      }
      addon->callback_snapshot_offset = (offset + size + 7) & ~size_t{7};
      return napi_fast::CreateUint8Array(env, pool, offset, size);
    }
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

// Recupera l'eccezione JS pendente dopo una napi_call_function fallita.
CTYPES_NOINLINE void HandleCallbackCallFailure(Napi::Env env,
                                               CallbackBaseData* data,
                                               void* ret,
                                               const char* default_error,
                                               const char* warning_type) {
  std::string error_msg;
  if (env.IsExceptionPending()) {
    const Napi::Error err = env.GetAndClearPendingException();
    error_msg = err.Message();
  }
  if (error_msg.empty()) {
    error_msg = default_error;
  }
  RecordCallbackError(data, error_msg);
  if (!data->error_handler_ref.IsEmpty()) {
    try {
      data->error_handler_ref.Value().Call({Napi::String::New(env, error_msg)});
    } catch (...) {
      // Un errore dell'error handler non deve propagare nel frame C.
    }
  } else {
    EmitCallbackWarning(env, error_msg, warning_type);
  }
  ZeroReturnValue(data->return_type, ret);
}

}  // namespace

// Tipi di un callback (info[1] ritorno, info[2] argomenti): CType primitivi,
// convertiti con CToJS / JSToC, e argomenti struct/union per valore. Come in
// Python, il ritorno non può essere una struct e gli array non sono argomenti.
void ParseCallbackTypes(const Napi::CallbackInfo& info, CallbackBaseData& data) {
  CType& return_type = data.return_type;
  std::vector<TypeSpec>& arg_types = data.arg_types;
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
  data.simple_args =
    arg_types.size() <= kMaxInlineCallbackArgs &&
    std::ranges::all_of(arg_types, [](const TypeSpec& s) { return !s.struct_info && !s.scalar_buffer; });
}

Napi::FunctionReference CallbackBufferAllocator(const Napi::CallbackInfo& info, bool& use_native_pool) {
  use_native_pool = false;
  if (info.Length() <= 6 || info[6].IsUndefined()) {
    return {};
  }
  if (info[6].IsBoolean() && info[6].As<Napi::Boolean>().Value()) {
    use_native_pool = true;
    return {};
  }
  if (!info[6].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "Callback buffer allocator must be a function");
  }
  return Napi::Persistent(info[6].As<Napi::Function>());
}

void RecordCallbackError(CallbackBaseData* data, std::string message) {
  std::lock_guard<std::mutex> lock(data->error_mutex);
  data->last_error = std::move(message);
}

// Nucleo condiviso di esecuzione sul thread JS per Callback e ThreadSafeCallback:
// converte gli argomenti C -> JS, invoca la funzione JS, gestisce gli errori e
// converte il ritorno JS -> C nello slot ABI.
void InvokeCallbackOnJsThread(Napi::Env env,
                              const Napi::Function& fn,
                              CallbackBaseData* data,
                              void** args,
                              void* ret,
                              const char* default_error,
                              const char* warning_type,
                              bool warn_on_conversion_error) {
  if (data->addon != nullptr) {
    data->addon->callback_epoch++;
  }
  // Dentro una chiamata nativa sincrona lo scope della chiamata esterna basta
  // (ScopelessCallbacks); altrimenti, o finito il budget, uno scope proprio.
  std::optional<Napi::HandleScope> scope;
  if (!CTypesAddon::ScopelessCallbacks::Take(data->addon)) {
    scope.emplace(env);
  }
  const size_t nargs = data->arg_types.size();

  // SBO: usa stack buffer per callback comuni, heap solo se necessario
  std::array<napi_value, kMaxInlineCallbackArgs> inline_args;
  std::vector<napi_value> heap_args;
  napi_value* js_args = inline_args.data();
  if (nargs > kMaxInlineCallbackArgs) [[unlikely]] {
    heap_args.resize(nargs);
    js_args = heap_args.data();
  }

  try {
    if (data->simple_args) [[likely]] {
      for (size_t i = 0; i < nargs; i++) {
        js_args[i] = SimpleCallbackArgToJS(env, args[i], data->arg_types[i].type);
      }
    } else {
      for (size_t i = 0; i < nargs; i++) {
        js_args[i] = CallbackArgToJS(env, args[i], data->arg_types[i], data->buffer_allocator_ref,
                                     data->use_native_snapshot_pool, data->addon);
      }
    }

    napi_value raw_result = nullptr;
    if (!napi_fast::CallFunction(env, napi_fast::Undefined(env), fn, nargs, js_args, raw_result)) [[unlikely]] {
      HandleCallbackCallFailure(env, data, ret, default_error, warning_type);
      return;
    }

    // Converti risultato JS -> C direttamente nel buffer di ret, senza
    // heap-allocare un vettore temporaneo e memcpy in ogni invocazione.
    if (data->return_type != CType::CTYPES_VOID) {
      if (!StoreJSCallbackResult(Napi::Value(env, raw_result), data->return_type, ret)) [[unlikely]] {
        ZeroReturnValue(data->return_type, ret);
      }
    }
  } catch (const std::exception& e) {
    // Conversione di argomenti o risultato fallita (anche std::bad_alloc):
    // nessuna eccezione attraversa il frame C.
    const std::string message = e.what();
    RecordCallbackError(data, message);
    if (warn_on_conversion_error) {
      EmitCallbackWarning(env, message, warning_type);
    }
    ZeroReturnValue(data->return_type, ret);
  }
}

// ========================================================================
// Callback - Solo main thread, semplice e veloce
// ========================================================================

void DispatchCallback(CallbackData* data, void* ret, void** args) {
  if (data->released.load(std::memory_order_acquire)) {
    ZeroReturnValue(data->return_type, ret);
    return;
  }

  // Una Callback esegue JS solo sul thread che l'ha creata: chiamata da un
  // altro thread (es. una funzione C eseguita con callAsync che richiama il
  // puntatore) non può toccare V8. Per quei casi serve threadSafeCallback().
  if (CurrentThreadId() != data->thread_id) [[unlikely]] {
    RecordCallbackError(data,
                        "callback called from a thread other than the one that created it; use threadSafeCallback()");
    ZeroReturnValue(data->return_type, ret);
    return;
  }

  InvokeCallbackOnJsThread(data->js_function_ref.Env(), data->js_function_ref.Value(), data, args, ret,
                           "Unknown error in callback", "CallbackError", true);
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

  ParseCallbackTypes(info, *data_);
  data_->buffer_allocator_ref = CallbackBufferAllocator(info, data_->use_native_snapshot_pool);

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

}  // namespace ctypes
