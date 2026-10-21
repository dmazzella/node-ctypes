#include "function.h"

#include "addon.h"  // CTypesAddon per gli slot captured_last_error / captured_errno

namespace ctypes {

namespace {

// Data pointer of a Buffer argument, or nullptr.
// Python ctypes rifiuta i valori non convertibili in puntatore con
// ArgumentError "wrong type": mai NULL implicito per funzioni o oggetti.
[[noreturn]] inline void ThrowWrongType(const Napi::Value& val) {
  throw Napi::TypeError::New(val.Env(), "wrong type");
}

// Memoria di un oggetto passato a un parametro puntatore: Buffer e ogni
// TypedArray/DataView/ArrayBuffer (in place); altri oggetti sono un TypeError.
inline void* ObjectData(const Napi::Value& val) {
  if (val.IsBuffer()) [[likely]] {
    return val.As<Napi::Buffer<uint8_t>>().Data();
  }
  if (val.IsTypedArray()) {
    Napi::TypedArray ta = val.As<Napi::TypedArray>();
    return static_cast<uint8_t*>(ta.ArrayBuffer().Data()) + ta.ByteOffset();
  }
  if (val.IsDataView()) {
    Napi::DataView dv = val.As<Napi::DataView>();
    return static_cast<uint8_t*>(dv.ArrayBuffer().Data()) + dv.ByteOffset();
  }
  if (val.IsArrayBuffer()) {
    return val.As<Napi::ArrayBuffer>().Data();
  }
  ThrowWrongType(val);
}

// Address carried by a BigInt / Number pointer argument.
inline uintptr_t AddressFromBigInt(const Napi::Value& val) {
  bool lossless;
  return static_cast<uintptr_t>(val.As<Napi::BigInt>().Uint64Value(&lossless));
}

inline uintptr_t AddressFromNumber(const Napi::Value& val) {
  return static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value());
}

// Argomenti numerici, parity Python ctypes: accettano number, boolean
// (true → 1) e BigInt (troncato ai bit del tipo, come Python maschera gli int);
// stringhe, null e oggetti sono un TypeError (Python: ArgumentError).
[[noreturn]] inline void ThrowNotNumeric(const Napi::Value& val, const char* kind) {
  throw Napi::TypeError::New(val.Env(), std::format("Expected a number, boolean or BigInt for {} argument", kind));
}

inline int32_t Int32Arg(const Napi::Value& val) {
  switch (val.Type()) {
    case napi_number:
      return val.As<Napi::Number>().Int32Value();
    case napi_boolean:
      return val.As<Napi::Boolean>().Value() ? 1 : 0;
    case napi_bigint: {
      bool lossless;
      return static_cast<int32_t>(val.As<Napi::BigInt>().Uint64Value(&lossless));
    }
    default:
      ThrowNotNumeric(val, "an integer");
  }
}

inline uint32_t Uint32Arg(const Napi::Value& val) {
  if (val.Type() == napi_number) {
    return val.As<Napi::Number>().Uint32Value();
  }
  return static_cast<uint32_t>(Int32Arg(val));
}

inline int64_t Int64Arg(const Napi::Value& val) {
  switch (val.Type()) {
    case napi_number:
      return val.As<Napi::Number>().Int64Value();
    case napi_boolean:
      return val.As<Napi::Boolean>().Value() ? 1 : 0;
    case napi_bigint: {
      bool lossless;
      return static_cast<int64_t>(val.As<Napi::BigInt>().Uint64Value(&lossless));
    }
    default:
      ThrowNotNumeric(val, "an integer");
  }
}

// Python c_char: bytes di 1 byte o intero 0..255. In JS stringa di 1 carattere
// (codice 0..255), Buffer/Uint8Array di 1 byte, numero o boolean.
inline uint8_t CharArg(const Napi::Value& val) {
  switch (val.Type()) {
    case napi_string: {
      const std::u16string str = val.As<Napi::String>().Utf16Value();
      if (str.size() == 1 && str[0] <= 0xff) {
        return static_cast<uint8_t>(str[0]);
      }
      break;
    }
    case napi_number: {
      const double d = val.As<Napi::Number>().DoubleValue();
      if (d >= 0 && d <= 0xff && d == static_cast<double>(static_cast<int>(d))) {
        return static_cast<uint8_t>(d);
      }
      break;
    }
    case napi_boolean:
      return val.As<Napi::Boolean>().Value() ? 1 : 0;
    case napi_object:
      if (val.IsTypedArray()) {
        Napi::TypedArray ta = val.As<Napi::TypedArray>();
        if (ta.TypedArrayType() == napi_uint8_array && ta.ElementLength() == 1) {
          return static_cast<const uint8_t*>(ta.ArrayBuffer().Data())[ta.ByteOffset()];
        }
      }
      break;
    default:
      break;
  }
  throw Napi::TypeError::New(val.Env(), "one character bytes, bytearray or integer expected");
}

// Errore di conversione dell'argomento `index` come ctypes.ArgumentError di Python:
// "argument N: TypeError: <messaggio>". TypeError se la classe non è registrata.
Napi::Error ArgumentErrorFor(Napi::Env env, size_t index, const Napi::Error& cause) {
  std::string kind = "TypeError";
  Napi::Value name = cause.Value().Get("name");
  if (name.IsString()) {
    kind = name.As<Napi::String>().Utf8Value();
  }
  const std::string message = std::format("argument {}: {}: {}", index + 1, kind, cause.Message());
  CTypesAddon* addon = env.GetInstanceData<CTypesAddon>();
  if (addon != nullptr && !addon->argument_error_ctor.IsEmpty()) {
    return Napi::Error(env, addon->argument_error_ctor.New({Napi::String::New(env, message)}));
  }
  return Napi::TypeError::New(env, message);
}

inline double DoubleArg(const Napi::Value& val) {
  switch (val.Type()) {
    case napi_number:
      return val.As<Napi::Number>().DoubleValue();
    case napi_boolean:
      return val.As<Napi::Boolean>().Value() ? 1.0 : 0.0;
    case napi_bigint: {
      bool lossless;
      const int64_t v = val.As<Napi::BigInt>().Int64Value(&lossless);
      if (lossless) {
        return static_cast<double>(v);
      }
      const uint64_t u = val.As<Napi::BigInt>().Uint64Value(&lossless);
      if (lossless) {
        return static_cast<double>(u);
      }
      throw Napi::RangeError::New(val.Env(), "BigInt out of range for a floating point argument");
    }
    default:
      ThrowNotNumeric(val, "a floating point");
  }
}

}  // namespace

CallConv StringToCallConv(const std::string& name) {
  if (name == "cdecl" || name == "default") {
    return CallConv::CTYPES_CDECL;
  }
  if (name == "stdcall") {
    return CallConv::CTYPES_STDCALL;
  }
  if (name == "fastcall") {
    return CallConv::CTYPES_FASTCALL;
  }
  if (name == "thiscall") {
    return CallConv::CTYPES_THISCALL;
  }
  return CallConv::CTYPES_DEFAULT;
}

ffi_abi CallConvToFFI(CallConv conv) {
  switch (conv) {
#if defined(_WIN32) && defined(__i386__)
    case CallConv::CTYPES_STDCALL:
      return FFI_STDCALL;
    case CallConv::CTYPES_FASTCALL:
      return FFI_FASTCALL;
    case CallConv::CTYPES_THISCALL:
      return FFI_THISCALL;
#endif
    case CallConv::CTYPES_CDECL:
    case CallConv::CTYPES_DEFAULT:
    default:
      return FFI_DEFAULT_ABI;
  }
}

Napi::Function FFIFunction::GetClass(Napi::Env env) {
  return DefineClass(env, "FFIFunction",
                     {
                       InstanceMethod("call", &FFIFunction::Call),
                       InstanceMethod("callAsync", &FFIFunction::CallAsync),
                       InstanceMethod("setErrcheck", &FFIFunction::SetErrcheck),
                       InstanceMethod("getCapturedLastError", &FFIFunction::GetLastErrorCaptured),
                       InstanceMethod("getCapturedErrno", &FFIFunction::GetErrnoCaptured),
                       InstanceAccessor("name", &FFIFunction::GetName, nullptr),
                       InstanceAccessor("address", &FFIFunction::GetAddress, nullptr),
                     });
}

Napi::Value FFIFunction::GetLastErrorCaptured(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(last_error_));
}

Napi::Value FFIFunction::GetErrnoCaptured(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), last_errno_);
}

FFIFunction::FFIFunction(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<FFIFunction>(info),
    fn_ptr_(nullptr),
    cif_prepared_(false),
    abi_(FFI_DEFAULT_ABI),
    return_type_(CType::CTYPES_VOID),
    ffi_return_type_(nullptr),
    inline_string_offset_(0),
    use_inline_storage_(true),
    next_cache_slot_(0),
    capture_last_error_(false),
    capture_errno_(false),
    last_error_(0),
    last_errno_(0),
    addon_(nullptr) {
  Napi::Env env = info.Env();
  addon_ = env.GetInstanceData<CTypesAddon>();

  if (info.Length() < 3) {
    Napi::TypeError::New(env, "FFIFunction requires fnPtr, name, returnType, argTypes").ThrowAsJavaScriptException();
    return;
  }

  // 1. Function pointer (External from Library::GetFunction, or BigInt raw address)
  if (info[0].IsExternal()) {
    fn_ptr_ = info[0].As<Napi::External<void>>().Data();
  } else if (info[0].IsBigInt()) {
    bool lossless;
    uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    fn_ptr_ = reinterpret_cast<void*>(addr);
  } else {
    Napi::TypeError::New(env, "First argument must be a function pointer (External or BigInt address)")
      .ThrowAsJavaScriptException();
    return;
  }

  // CRITICAL: Valida che il puntatore non sia NULL
  if (fn_ptr_ == nullptr) {
    Napi::Error::New(env, "Function pointer is NULL - cannot call invalid function").ThrowAsJavaScriptException();
    return;
  }

  // 2. Name (string or null for raw function pointers)
  if (info[1].IsString()) {
    name_ = info[1].As<Napi::String>().Utf8Value();
  } else if (info[1].IsNull() || info[1].IsUndefined()) {
    // Raw function pointer — use hex address as name for error messages
    char buf[32];
    snprintf(buf, sizeof(buf), "0x%llx", reinterpret_cast<unsigned long long>(fn_ptr_));
    name_ = buf;
  } else {
    Napi::TypeError::New(env, "Second argument must be function name (string) or null").ThrowAsJavaScriptException();
    return;
  }

  // 3. Return type
  try {
    if (info[2].IsNumber()) {
      return_type_ = IntToCType(info[2].As<Napi::Number>().Int32Value());
    } else if (info[2].IsObject()) {
      Napi::Object obj = info[2].As<Napi::Object>();
      if (IsStructType(obj)) {
        // Return type è struct
        return_type_ = CType::CTYPES_STRUCT;
        return_struct_info_ = Napi::ObjectWrap<StructType>::Unwrap(obj)->GetStructInfo();
      } else if (IsArrayType(obj)) {
        // Return type è array
        return_type_ = CType::CTYPES_ARRAY;
        return_array_info_ = Napi::ObjectWrap<ArrayType>::Unwrap(obj)->GetArrayInfo();
      } else {
        throw std::runtime_error("Invalid return type object");
      }
    } else {
      throw std::runtime_error("Return type must be CType enum value (number) or CType object");
    }
  } catch (const std::exception& e) {
    Napi::Error::New(env, std::string("Invalid return type: ") + e.what()).ThrowAsJavaScriptException();
    return;
  }

  // 4. Argument types
  if (info.Length() > 3 && info[3].IsArray()) {
    Napi::Array arr = info[3].As<Napi::Array>();
    arg_types_.reserve(arr.Length());
    arg_struct_infos_.resize(arr.Length());  // Resize to match, null by default
    arg_array_infos_.resize(arr.Length());

    for (uint32_t i = 0; i < arr.Length(); i++) {
      Napi::Value elem = arr.Get(i);

      try {
        if (elem.IsNumber()) {
          arg_types_.push_back(IntToCType(elem.As<Napi::Number>().Int32Value()));
          arg_struct_infos_[i] = nullptr;
          arg_array_infos_[i] = nullptr;
        } else if (elem.IsObject()) {
          Napi::Object obj = elem.As<Napi::Object>();
          if (IsStructType(obj)) {
            // Argument type è struct
            arg_types_.push_back(CType::CTYPES_STRUCT);
            arg_struct_infos_[i] = Napi::ObjectWrap<StructType>::Unwrap(obj)->GetStructInfo();
            arg_array_infos_[i] = nullptr;
          } else if (IsArrayType(obj)) {
            // Argument type è array
            arg_types_.push_back(CType::CTYPES_ARRAY);
            arg_struct_infos_[i] = nullptr;
            arg_array_infos_[i] = Napi::ObjectWrap<ArrayType>::Unwrap(obj)->GetArrayInfo();
          } else {
            throw std::runtime_error("Invalid type object");
          }
        } else {
          throw std::runtime_error("Type must be CType enum value (number) or CType object");
        }
      } catch (const std::exception& e) {
        Napi::Error::New(env, std::format("Invalid argument type at index {}: {}", i, e.what()))
          .ThrowAsJavaScriptException();
        return;
      }
    }
  }

  // 5. Options
  if (info.Length() > 4 && info[4].IsObject()) {
    Napi::Object opts = info[4].As<Napi::Object>();
    if (opts.Has("abi")) {
      abi_ = CallConvToFFI(StringToCallConv(opts.Get("abi").As<Napi::String>().Utf8Value()));
    }
    if (opts.Has("use_last_error")) {
      capture_last_error_ = opts.Get("use_last_error").ToBoolean().Value();
    }
    if (opts.Has("use_errno")) {
      capture_errno_ = opts.Get("use_errno").ToBoolean().Value();
    }
  }

  // Determina se usare storage inline o heap
  use_inline_storage_ = (arg_types_.size() <= MAX_INLINE_ARGS);

  // Precalcola a construction time: la signature usa argomenti stringa
  // (STRING/WSTRING) o overflow (STRUCT/UNION/ARRAY oltre ARG_SLOT_SIZE)?
  // L'hot path di Call() usa questi flag per saltare il reset di
  // string_buffer_ e sync_large_arg_buffers_.clear() quando nessuno dei
  // due è stato toccato dalla call precedente.
  has_string_args_ = false;
  has_struct_array_args_ = false;
  for (const auto& t : arg_types_) {
    if (t == CType::CTYPES_STRING || t == CType::CTYPES_WSTRING) {
      has_string_args_ = true;
    } else if (t == CType::CTYPES_STRUCT || t == CType::CTYPES_UNION || t == CType::CTYPES_ARRAY) {
      has_struct_array_args_ = true;
    }
  }

  // Pre-alloca heap storage se necessario (come CPython - pool struct argument)
  if (!use_inline_storage_) {
    heap_arg_storage_.resize(arg_types_.size() * ARG_SLOT_SIZE);
    heap_arg_values_.resize(arg_types_.size());
  }
  // Per arg counts piccoli usiamo sempre inline_arg_values_ (stack allocation)

  // Pre-alloca string buffer (stima iniziale)
  size_t string_count = 0;
  for (const auto& type : arg_types_) {
    if (type == CType::CTYPES_STRING) {
      string_count++;
    }
  }
  if (string_count > 0) {
    string_buffer_.reserve(string_count * 128);  // 128 bytes per stringa media
  }

  if (!PrepareFFI(env)) {
    return;
  }

  InstallFastCall(env);
}

Napi::Value FFIFunction::FastCall(const Napi::CallbackInfo& info) {
  return static_cast<FFIFunction*>(info.Data())->Call(info);
}

// Shadows the prototype `call` (InstanceMethod) with an own-property function
// whose N-API data is `this`. InstanceMethod resolves the instance through
// napi_unwrap(info.This()), a full V8 property lookup that was ~1/3 of the
// cost of a simple call. The function keeps a strong reference to the wrapper
// object, so the native instance outlives any detached reference to `call`.
void FFIFunction::InstallFastCall(Napi::Env env) {
  Napi::Object self = Value();
  Napi::Function fast_call = Napi::Function::New<&FFIFunction::FastCall>(env, "call", this);
  fast_call.DefineProperty(Napi::PropertyDescriptor::Value("_ffiFunction", self, napi_default));
  self.DefineProperty(Napi::PropertyDescriptor::Value(
    "call", fast_call, static_cast<napi_property_attributes>(napi_writable | napi_configurable)));
}

FFIFunction::~FFIFunction() {
  // Release errcheck callback to prevent memory leak
  if (!errcheck_callback_.IsEmpty()) {
    errcheck_callback_.Reset();
  }

  // Free reusable call plans (signature fissa + entry variadiche in cache).
  if (call_plan_) {
    ffi_call_plan_free(call_plan_);
    call_plan_ = nullptr;
  }
  for (auto& entry : variadic_cache_) {
    if (entry.plan) {
      ffi_call_plan_free(entry.plan);
      entry.plan = nullptr;
    }
  }
}

bool FFIFunction::PrepareFFI(Napi::Env env) {
  // Return type FFI
  if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_) {
    ffi_return_type_ = return_struct_info_->GetFFIType();
  } else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_) {
    ffi_return_type_ = return_array_info_->GetFFIType();
  } else {
    ffi_return_type_ = CTypeToFFI(return_type_);
  }

  // Argument types FFI
  ffi_arg_types_.clear();
  ffi_arg_types_.reserve(arg_types_.size());
  for (size_t i = 0; i < arg_types_.size(); i++) {
    if (arg_types_[i] == CType::CTYPES_STRUCT && arg_struct_infos_[i]) {
      ffi_arg_types_.push_back(arg_struct_infos_[i]->GetFFIType());
    } else if (arg_types_[i] == CType::CTYPES_ARRAY && arg_array_infos_[i]) {
      ffi_arg_types_.push_back(arg_array_infos_[i]->GetFFIType());
    } else {
      ffi_arg_types_.push_back(CTypeToFFI(arg_types_[i]));
    }
  }

  ffi_status status = ffi_prep_cif(&cif_, abi_, static_cast<unsigned int>(ffi_arg_types_.size()), ffi_return_type_,
                                   ffi_arg_types_.empty() ? nullptr : ffi_arg_types_.data());

  if (status != FFI_OK) {
    const char* msg = "Failed to prepare FFI call interface";
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return false;
  }

  cif_prepared_ = true;

  // Reusable call plan (libffi 3.7+): cattura una volta il posizionamento degli
  // argomenti così le chiamate ripetute saltano la riclassificazione per-call che
  // ffi_call rifarebbe ogni volta. Su x86-64 attiva il fast path di libffi;
  // altrove ffi_call_plan_invoke ricade in sicurezza su ffi_call. Ricostruito
  // in modo difensivo se PrepareFFI venisse rieseguito.
  if (call_plan_) {
    ffi_call_plan_free(call_plan_);
    call_plan_ = nullptr;
  }
  call_plan_ = ffi_call_plan_alloc(&cif_);

  SetupDirectCall();

  return true;
}

void FFIFunction::SetupDirectCall() {
  direct_invoker_ = nullptr;
  direct_arg_widen_count_ = 0;
  direct_ret_widen_size_ = 0;
  direct_ret_signed_ = false;

  if constexpr (sizeof(void*) != 8 || std::endian::native != std::endian::little) {
    return;
  }
  if (abi_ != FFI_DEFAULT_ABI || arg_types_.size() > direct::kMaxDirectArgs) {
    return;
  }

  size_t code = 0;
  size_t weight = 1;
  for (size_t i = 0; i < arg_types_.size(); i++) {
    const CType t = arg_types_[i];
    direct::ArgClass cls;
    if ((t == CType::CTYPES_DOUBLE || t == CType::CTYPES_FLOAT) && !direct::kFloatArgsAllowed) {
      direct_arg_widen_count_ = 0;
      return;
    }
    if (t == CType::CTYPES_DOUBLE) {
      cls = direct::ArgClass::Double;
    } else if (t == CType::CTYPES_FLOAT) {
      cls = direct::ArgClass::Float;
    } else if (direct::IsIntClass(t)) {
      cls = direct::ArgClass::Int;
      const size_t size = CTypeSize(t);
      if (size < 8) {
        direct_arg_widen_[direct_arg_widen_count_++] = {static_cast<uint8_t>(i), static_cast<uint8_t>(size),
                                                        direct::IsSignedInt(t)};
      }
    } else {
      direct_arg_widen_count_ = 0;
      return;
    }
    code += static_cast<size_t>(cls) * weight;
    weight *= direct::kArgClassCount;
  }

  direct::RetClass ret;
  if (return_type_ == CType::CTYPES_VOID) {
    ret = direct::RetClass::Void;
  } else if (return_type_ == CType::CTYPES_DOUBLE) {
    ret = direct::RetClass::Double;
  } else if (return_type_ == CType::CTYPES_FLOAT) {
    ret = direct::RetClass::Float;
  } else if (direct::IsIntClass(return_type_)) {
    ret = direct::RetClass::Int;
    const size_t size = CTypeSize(return_type_);
    if (size < 8) {
      direct_ret_widen_size_ = static_cast<uint8_t>(size);
      direct_ret_signed_ = direct::IsSignedInt(return_type_);
    }
  } else {
    direct_arg_widen_count_ = 0;
    return;
  }

  direct_invoker_ = direct::Select(ret, arg_types_.size(), code);
}

// ============================================================================
// InferTypeFromJS - Shared by Call() and CallAsync() for variadic inference
// ============================================================================

CType FFIFunction::InferTypeFromJS(const Napi::Value& val) {
  if (val.IsString()) {
    return CType::CTYPES_STRING;
  }
  if (val.IsNumber()) {
    double d = val.As<Napi::Number>().DoubleValue();
    // Integer fits in int32 → INT32 (the common sprintf("%d", …) case).
    if (d == static_cast<double>(static_cast<int32_t>(d))) {
      return CType::CTYPES_INT32;
    }
    // Integer that overflows int32 but is still an exact integer (within
    // JS's 2^53 safe range) → INT64. Without this, values such as
    // 5_000_000_000 used with %lld would be silently passed as doubles and
    // observed as garbage on the C side. We intentionally keep non-integer
    // numbers as DOUBLE.
    if (d == std::trunc(d) && std::isfinite(d) && d >= -9007199254740992.0 && d <= 9007199254740992.0) {
      return CType::CTYPES_INT64;
    }
    return CType::CTYPES_DOUBLE;
  }
  if (val.IsBigInt()) {
    return CType::CTYPES_INT64;
  }
  if (val.IsBuffer()) {
    return CType::CTYPES_POINTER;
  }
  if (val.IsNull() || val.IsUndefined()) {
    return CType::CTYPES_POINTER;
  }
  return CType::CTYPES_INT32;  // fallback
}

// ============================================================================
// ConvertReturn - Static, shared by ConvertReturnValue() and CallWorker::OnOK()
// ============================================================================

Napi::Value FFIFunction::ConvertReturn(Napi::Env env,
                                       void* return_data,
                                       CType type,
                                       const std::shared_ptr<StructInfo>& struct_info,
                                       const std::shared_ptr<ArrayInfo>& array_info) {
  // For primitive types, interpret return_data as ReturnValue*
  ReturnValue* rv = static_cast<ReturnValue*>(return_data);

  switch (type) {
    case CType::CTYPES_VOID:
      return env.Undefined();

    case CType::CTYPES_INT32:
      return Napi::Number::New(env, rv->i32);

    case CType::CTYPES_UINT32:
      return Napi::Number::New(env, rv->u32);

    case CType::CTYPES_INT64:
      return Napi::BigInt::New(env, rv->i64);

    case CType::CTYPES_UINT64:
    case CType::CTYPES_SIZE_T:
      return Napi::BigInt::New(env, rv->u64);

    case CType::CTYPES_DOUBLE:
      return Napi::Number::New(env, rv->d);

    case CType::CTYPES_FLOAT:
      return Napi::Number::New(env, static_cast<double>(rv->f));

    case CType::CTYPES_BOOL:
      return Napi::Boolean::New(env, rv->u8 != 0);

    case CType::CTYPES_POINTER:
      if (rv->p == nullptr) {
        return env.Null();
      }
      return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(rv->p));

    case CType::CTYPES_STRING: {
      if (rv->str == nullptr) {
        return env.Null();
      }
      return Napi::String::New(env, rv->str);
    }

    case CType::CTYPES_WSTRING: {
      if (rv->wstr == nullptr) {
        return env.Null();
      }
#ifdef _WIN32
      // Windows: wchar_t è 16-bit (UTF-16)
      return Napi::String::New(env, reinterpret_cast<const char16_t*>(rv->wstr));
#else
      // Unix: wchar_t è 32-bit, converti a UTF-8
      std::wstring wstr(rv->wstr);
      std::string utf8;
      utf8.reserve(wstr.size() * 4);
      for (wchar_t wc : wstr) {
        if (wc < 0x80) {
          utf8.push_back(static_cast<char>(wc));
        } else if (wc < 0x800) {
          utf8.push_back(static_cast<char>(0xC0 | (wc >> 6)));
          utf8.push_back(static_cast<char>(0x80 | (wc & 0x3F)));
        } else if (wc < 0x10000) {
          utf8.push_back(static_cast<char>(0xE0 | (wc >> 12)));
          utf8.push_back(static_cast<char>(0x80 | ((wc >> 6) & 0x3F)));
          utf8.push_back(static_cast<char>(0x80 | (wc & 0x3F)));
        } else {
          utf8.push_back(static_cast<char>(0xF0 | (wc >> 18)));
          utf8.push_back(static_cast<char>(0x80 | ((wc >> 12) & 0x3F)));
          utf8.push_back(static_cast<char>(0x80 | ((wc >> 6) & 0x3F)));
          utf8.push_back(static_cast<char>(0x80 | (wc & 0x3F)));
        }
      }
      return Napi::String::New(env, utf8);
#endif
    }

    case CType::CTYPES_LONG:
      return Napi::BigInt::New(env, rv->i64);

    case CType::CTYPES_ULONG:
      return Napi::BigInt::New(env, rv->u64);

    case CType::CTYPES_INT8:
      return Napi::Number::New(env, rv->i8);

    case CType::CTYPES_UINT8:
      return Napi::Number::New(env, rv->u8);

    case CType::CTYPES_INT16:
      return Napi::Number::New(env, rv->i16);

    case CType::CTYPES_UINT16:
      return Napi::Number::New(env, rv->u16);

    case CType::CTYPES_STRUCT: {
      // return_data points to the actual struct buffer (may be larger than ReturnValue)
      if (struct_info) {
        return struct_info->StructToJS(env, return_data);
      }
      return env.Undefined();
    }

    case CType::CTYPES_ARRAY: {
      // return_data points to the actual array buffer (may be larger than ReturnValue)
      if (array_info) {
        return array_info->ArrayToJS(env, return_data);
      }
      return env.Undefined();
    }

    default:
      return CToJS(env, return_data, type);
  }
}

// ============================================================================
// MarshalPrimitive - Shared by Call() and CallAsync()
// Returns true if type was handled, false if not a primitive
// ============================================================================

inline bool FFIFunction::MarshalPrimitive(Napi::Env env, const Napi::Value& val, CType type, uint8_t* slot) {
  switch (type) {
    case CType::CTYPES_INT32: {
      int32_t v = Int32Arg(val);
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_UINT32: {
      uint32_t v = Uint32Arg(val);
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_INT64:
    case CType::CTYPES_UINT64:
    case CType::CTYPES_SIZE_T:
    case CType::CTYPES_SSIZE_T: {
      // Una sola Value::Type() invece di IsBigInt/IsNull/IsUndefined in cascata
      // (ognuna è una napi_typeof separata).
      int64_t v = 0;
      switch (val.Type()) {
        case napi_number:
          v = val.As<Napi::Number>().Int64Value();
          break;
        case napi_bigint: {
          bool lossless;
          v = val.As<Napi::BigInt>().Int64Value(&lossless);
          break;
        }
        case napi_boolean:
          v = val.As<Napi::Boolean>().Value() ? 1 : 0;
          break;
        case napi_object:
          if (val.IsBuffer()) {
            v = static_cast<int64_t>(reinterpret_cast<intptr_t>(val.As<Napi::Buffer<uint8_t>>().Data()));
          } else if (val.IsArrayBuffer()) {
            v = static_cast<int64_t>(reinterpret_cast<intptr_t>(val.As<Napi::ArrayBuffer>().Data()));
          }
          break;
        default:
          break;
      }
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_DOUBLE: {
      double v = DoubleArg(val);
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_FLOAT: {
      float v = static_cast<float>(DoubleArg(val));
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_BOOL: {
      uint8_t v = val.ToBoolean().Value() ? 1 : 0;
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_CHAR: {
      uint8_t v = CharArg(val);
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_INT8: {
      int8_t v = static_cast<int8_t>(Int32Arg(val));
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_UINT8: {
      uint8_t v = static_cast<uint8_t>(Uint32Arg(val));
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_INT16: {
      int16_t v = static_cast<int16_t>(Int32Arg(val));
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_UINT16: {
      uint16_t v = static_cast<uint16_t>(Uint32Arg(val));
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_LONG: {
      long v = static_cast<long>(Int64Arg(val));
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_ULONG: {
      unsigned long v = static_cast<unsigned long>(Int64Arg(val));
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    default:
      return false;
  }
}

// ============================================================================
// MarshalStructArg - Shared by Call() and CallAsync()
// Returns false on error (JS exception already thrown)
// ============================================================================

bool FFIFunction::MarshalStructArg(Napi::Env env,
                                   const Napi::Value& val,
                                   size_t arg_index,
                                   const std::shared_ptr<StructInfo>& struct_info,
                                   uint8_t* slot,
                                   void** arg_value_ptr,
                                   std::vector<std::vector<uint8_t>>& large_buffers,
                                   std::vector<size_t>* large_indices) {
  size_t struct_size = struct_info->GetSize();

  // Use overflow buffer if struct > slot size
  uint8_t* dest = slot;
  size_t dest_size = ARG_SLOT_SIZE;
  if (struct_size > ARG_SLOT_SIZE) {
    large_buffers.emplace_back(struct_size, 0);
    dest = large_buffers.back().data();
    dest_size = struct_size;
    *arg_value_ptr = dest;
    if (large_indices) {
      large_indices->push_back(arg_index);
    }
  }

  if (val.IsBuffer()) {
    Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
    if (buf.Length() >= struct_size) {
      memcpy(dest, buf.Data(), struct_size);
    } else {
      Napi::TypeError::New(env, std::format("Buffer too small for struct at argument {}", arg_index))
        .ThrowAsJavaScriptException();
      return false;
    }
  } else if (val.IsObject()) {
    Napi::Object obj = val.As<Napi::Object>();
    // Single Get() invece di Has()+Get() — se la chiave manca Get() ritorna
    // undefined, che non è un Buffer, quindi il check IsBuffer copre tutto.
    Napi::Value buf_prop = obj.Get("_buffer");
    if (buf_prop.IsBuffer()) {
      Napi::Buffer<uint8_t> buf = buf_prop.As<Napi::Buffer<uint8_t>>();
      if (buf.Length() >= struct_size) {
        memcpy(dest, buf.Data(), struct_size);
      } else {
        Napi::TypeError::New(env, std::format("Internal buffer too small for struct at argument {}", arg_index))
          .ThrowAsJavaScriptException();
        return false;
      }
    } else {
      if (!struct_info->JSToStruct(env, obj, dest, dest_size)) {
        Napi::Error::New(env, std::format("Failed to convert JS object to struct at argument {}", arg_index))
          .ThrowAsJavaScriptException();
        return false;
      }
    }
  } else {
    Napi::TypeError::New(env, std::format("Argument {} must be object or buffer for struct type", arg_index))
      .ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

// ============================================================================
// MarshalArrayArg - Shared by Call() and CallAsync()
// Returns false on error (JS exception already thrown)
// ============================================================================

bool FFIFunction::MarshalArrayArg(Napi::Env env,
                                  const Napi::Value& val,
                                  size_t arg_index,
                                  const std::shared_ptr<ArrayInfo>& array_info,
                                  uint8_t* slot,
                                  void** arg_value_ptr,
                                  std::vector<std::vector<uint8_t>>& large_buffers,
                                  std::vector<size_t>* large_indices) {
  size_t array_size = array_info->GetSize();

  // Use overflow buffer if array > slot size
  uint8_t* dest = slot;
  size_t dest_size = ARG_SLOT_SIZE;
  if (array_size > ARG_SLOT_SIZE) {
    large_buffers.emplace_back(array_size, 0);
    dest = large_buffers.back().data();
    dest_size = array_size;
    *arg_value_ptr = dest;
    if (large_indices) {
      large_indices->push_back(arg_index);
    }
  }

  if (val.IsBuffer()) {
    Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
    if (buf.Length() >= array_size) {
      memcpy(dest, buf.Data(), array_size);
    } else {
      Napi::TypeError::New(env, std::format("Buffer too small for array at argument {}", arg_index))
        .ThrowAsJavaScriptException();
      return false;
    }
  } else {
    if (!array_info->JSToArray(env, val, dest, dest_size)) {
      Napi::Error::New(env, std::format("Failed to convert JS value to array at argument {}", arg_index))
        .ThrowAsJavaScriptException();
      return false;
    }
  }
  return true;
}

// ============================================================================
// Call - Ottimizzato con fast paths
// ============================================================================

// ============================================================================
// Per-section helpers for Call() — vedi function.h::CallContext.
// ============================================================================

// Convalida argc e determina se la call è variadic.
// Shared tra Call() (sync) e CallAsync() (async).
CTYPES_ALWAYS_INLINE bool FFIFunction::ValidateAndResolveArgc(Napi::Env env,
                                                              const Napi::CallbackInfo& info,
                                                              size_t& out_argc,
                                                              bool& out_is_variadic) const {
  if (!cif_prepared_) [[unlikely]] {
    Napi::Error::New(env, "FFI call interface not prepared").ThrowAsJavaScriptException();
    return false;
  }
  const size_t info_argc = info.Length();
  const size_t expected_argc = arg_types_.size();
  if (info_argc == expected_argc) [[likely]] {
    out_argc = expected_argc;
    out_is_variadic = false;
    return true;
  }
  if (info_argc > expected_argc) {
    out_argc = info_argc;
    out_is_variadic = true;
    return true;
  }
  Napi::TypeError::New(env, std::format("Expected {} arguments, got {}", expected_argc, info_argc))
    .ThrowAsJavaScriptException();
  return false;
}

// Loop di marshalling per-argomento. Dispatch su CType con fast path
// primitivo. Ritorna false se un'eccezione JS è stata lanciata e il
// caller deve restituire env.Undefined().
CTYPES_ALWAYS_INLINE bool FFIFunction::MarshalArguments(CallContext& ctx) {
  Napi::Env env = ctx.env;
  const auto& info = ctx.info;
  const size_t argc = ctx.argc;
  const size_t expected_argc = ctx.expected_argc;
  uint8_t* const arg_storage = ctx.arg_storage;
  void** const arg_values = ctx.arg_values;
  string_fixups_.clear();

  for (size_t i = 0; i < argc; i++) {
    uint8_t* slot = arg_storage + (i * ARG_SLOT_SIZE);
    arg_values[i] = slot;
    const Napi::Value& val = info[i];

    CType type;
    if (i < expected_argc) [[likely]] {
      type = arg_types_[i];
    } else if (ctx.cache_entry) {
      type = ctx.cache_entry->extra_types[i - expected_argc];
    } else {
      type = ctx.extra_types_ptr[i - expected_argc];
    }

    // Fast path: primitivi.
    try {
      if (MarshalPrimitive(env, val, type, slot)) {
        continue;
      }
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }

    // Python c_void_p accetta anche bytes/str: la stringa passa come char* UTF-8.
    if (type == CType::CTYPES_POINTER && val.Type() == napi_string) {
      type = CType::CTYPES_STRING;
    }

    try {
      switch (type) {
        case CType::CTYPES_POINTER: {
          void* ptr = nullptr;
          switch (val.Type()) {
            case napi_object:
              ptr = ObjectData(val);
              break;
            case napi_bigint:
              ptr = reinterpret_cast<void*>(AddressFromBigInt(val));
              break;
            case napi_number:
              ptr = reinterpret_cast<void*>(AddressFromNumber(val));
              break;
            case napi_boolean:
              ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(val.As<Napi::Boolean>().Value()));
              break;
            case napi_null:
            case napi_undefined:
              break;
            default:
              ThrowWrongType(val);
          }
          memcpy(slot, &ptr, sizeof(ptr));
          break;
        }

        case CType::CTYPES_STRING: {
          const char* str_ptr = nullptr;
          switch (val.Type()) {
            case napi_string: {
              const Napi::String js_str = val.As<Napi::String>();
              // SBO: prova prima il buffer inline (una sola copia, vedi napi_fast.h)
              char* dest = inline_string_buffer_ + inline_string_offset_;
              if (auto copied =
                    napi_fast::TryCopyUtf8Into(js_str, dest, kInlineStringBufferSize - inline_string_offset_)) {
                str_ptr = dest;
                inline_string_offset_ += *copied + 1;
                break;
              }
              // Fallback: heap string_buffer_. Il puntatore viene scritto a fine
              // marshalling (string_fixups_) perché resize() successivi possono riallocare.
              const std::string str = js_str.Utf8Value();
              const size_t needed = str.size() + 1;
              size_t offset = string_buffer_.size();
              string_buffer_.resize(offset + needed);
              memcpy(string_buffer_.data() + offset, str.c_str(), needed);
              string_fixups_.emplace_back(i, offset);
              break;
            }
            case napi_object:
              str_ptr = static_cast<const char*>(ObjectData(val));
              break;
            case napi_bigint:
              str_ptr = reinterpret_cast<const char*>(AddressFromBigInt(val));
              break;
            case napi_number:
              str_ptr = reinterpret_cast<const char*>(AddressFromNumber(val));
              break;
            case napi_null:
            case napi_undefined:
              break;
            default:
              ThrowWrongType(val);
          }
          memcpy(slot, &str_ptr, sizeof(str_ptr));
          break;
        }

        case CType::CTYPES_WSTRING: {
          const wchar_t* str_ptr = nullptr;
          switch (val.Type()) {
            case napi_string: {
              const std::u16string u16str = val.As<Napi::String>().Utf16Value();
              constexpr size_t wchar_size = sizeof(wchar_t);
              constexpr size_t wchar_align = alignof(wchar_t);
              size_t byte_len = (u16str.length() + 1) * wchar_size;
              size_t offset = string_buffer_.size();
              offset = (offset + wchar_align - 1) & ~(wchar_align - 1);
              string_buffer_.resize(offset + byte_len);
              wchar_t* wptr = reinterpret_cast<wchar_t*>(string_buffer_.data() + offset);
#ifdef _WIN32
              // wchar_t è UTF-16 su Windows: copia diretta.
              memcpy(wptr, u16str.data(), u16str.length() * wchar_size);
#else
              for (size_t j = 0; j < u16str.length(); j++) {
                wptr[j] = static_cast<wchar_t>(u16str[j]);
              }
#endif
              wptr[u16str.length()] = L'\0';
              string_fixups_.emplace_back(i, offset);
              break;
            }
            case napi_object:
              str_ptr = static_cast<const wchar_t*>(ObjectData(val));
              break;
            case napi_bigint:
              str_ptr = reinterpret_cast<const wchar_t*>(AddressFromBigInt(val));
              break;
            case napi_number:
              str_ptr = reinterpret_cast<const wchar_t*>(AddressFromNumber(val));
              break;
            case napi_null:
            case napi_undefined:
              break;
            default:
              ThrowWrongType(val);
          }
          memcpy(slot, &str_ptr, sizeof(str_ptr));
          break;
        }

        case CType::CTYPES_STRUCT: {
          if (i < expected_argc && arg_struct_infos_[i]) {
            if (!MarshalStructArg(env, val, i, arg_struct_infos_[i], slot, &arg_values[i], sync_large_arg_buffers_,
                                  nullptr)) {
              return false;
            }
          } else {
            JSToC(env, val, type, slot, ARG_SLOT_SIZE);
          }
          break;
        }

        case CType::CTYPES_ARRAY: {
          if (i < expected_argc && arg_array_infos_[i]) {
            if (!MarshalArrayArg(env, val, i, arg_array_infos_[i], slot, &arg_values[i], sync_large_arg_buffers_,
                                 nullptr)) {
              return false;
            }
          } else {
            JSToC(env, val, type, slot, ARG_SLOT_SIZE);
          }
          break;
        }

        default:
          JSToC(env, val, type, slot, ARG_SLOT_SIZE);
          break;
      }
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }
  }

  // Puntatori alle stringhe nel heap string_buffer_: scritti solo ora, quando il
  // buffer non verrà più riallocato in questa call.
  for (const auto& [slot_index, offset] : string_fixups_) {
    const char* str_ptr = string_buffer_.data() + offset;
    memcpy(arg_storage + (slot_index * ARG_SLOT_SIZE), &str_ptr, sizeof(str_ptr));
  }
  return true;
}

// Seleziona il return buffer: inline ReturnValue per tipi primitivi,
// sync_return_buffer_ per struct/array > sizeof(ReturnValue).
CTYPES_ALWAYS_INLINE void FFIFunction::SelectReturnPtr(CallContext& ctx) {
  ctx.return_ptr = &return_value_;
  if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_) {
    size_t ret_size = return_struct_info_->GetSize();
    if (ret_size > sizeof(ReturnValue)) {
      sync_return_buffer_.resize(ret_size);
      ctx.return_ptr = sync_return_buffer_.data();
    }
  } else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_) {
    size_t ret_size = return_array_info_->GetSize();
    if (ret_size > sizeof(ReturnValue)) {
      sync_return_buffer_.resize(ret_size);
      ctx.return_ptr = sync_return_buffer_.data();
    }
  }
}

// Snapshot di errno / GetLastError subito dopo ffi_call.
// Parity Python ctypes use_last_error / use_errno.
CTYPES_ALWAYS_INLINE void FFIFunction::CaptureErrorState() {
  if (capture_last_error_ || capture_errno_) [[unlikely]] {
    CTypesAddon* addon = addon_;
    if (capture_last_error_) {
#ifdef _WIN32
      last_error_ = static_cast<uint32_t>(::GetLastError());
#else
      last_error_ = static_cast<uint32_t>(errno);
#endif
      if (addon) {
        addon->captured_last_error = last_error_;
      }
    }
    if (capture_errno_) {
      last_errno_ = errno;
      if (addon) {
        addon->captured_errno = last_errno_;
      }
    }
  }
}

// Convert return value e applica errcheck se presente.
CTYPES_ALWAYS_INLINE Napi::Value FFIFunction::FinalizeCall(CallContext& ctx) {
  Napi::Value result = ConvertReturn(ctx.env, ctx.return_ptr, return_type_, return_struct_info_, return_array_info_);
  if (errcheck_callback_.IsEmpty()) [[likely]] {
    return result;
  }
  return ApplyErrcheck(ctx.env, result, ctx.info);
}

Napi::Value FFIFunction::Call(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  size_t argc;
  bool need_reprep = false;
  if (!ValidateAndResolveArgc(env, info, argc, need_reprep)) {
    return env.Undefined();
  }
  const size_t expected_argc = arg_types_.size();
  // =====================================================================
  // Gestione variadic ottimizzata (ispirata a CPython ctypes)
  // =====================================================================
  ffi_cif* active_cif = &cif_;
  ffi_call_plan* active_plan = call_plan_;
  VariadicCifCache* cache_entry = nullptr;
  size_t num_extra = 0;  // Numero di argomenti extra variadic

  // Stack-allocated array per piccoli numeri di argomenti extra (come alloca in CPython)
  CType extra_types_stack[MAX_VARIADIC_EXTRA_ARGS];
  std::vector<CType> extra_types_heap;

  if (need_reprep) {
    size_t fixed_args = expected_argc;
    num_extra = argc - fixed_args;

    // Inferisci tipi degli argomenti extra
    CType* extra_types;
    if (num_extra <= MAX_VARIADIC_EXTRA_ARGS) {
      extra_types = extra_types_stack;
    } else {
      extra_types_heap.resize(num_extra);
      extra_types = extra_types_heap.data();
    }

    for (size_t i = 0; i < num_extra; i++) {
      extra_types[i] = InferTypeFromJS(info[fixed_args + i]);
    }

    // Cerca in cache
    for (size_t i = 0; i < MAX_CACHED_VARIADIC_CIFS; i++) {
      if (variadic_cache_[i].valid && variadic_cache_[i].total_args == argc &&
          variadic_cache_[i].extra_types.size() == num_extra) {
        // Verifica match dei tipi extra
        bool match = true;
        for (size_t j = 0; j < num_extra; j++) {
          if (variadic_cache_[i].extra_types[j] != extra_types[j]) {
            match = false;
            break;
          }
        }

        if (match) {
          cache_entry = &variadic_cache_[i];
          active_cif = &cache_entry->cif;
          active_plan = cache_entry->plan;
          break;
        }
      }
    }

    // Cache miss — prepara il nuovo CIF direttamente nello slot di cache
    // (così riutilizzabile per chiamate successive) invece di prepararlo
    // due volte.
    if (!cache_entry) {
      size_t slot = next_cache_slot_;
      next_cache_slot_ = (next_cache_slot_ + 1) % MAX_CACHED_VARIADIC_CIFS;

      VariadicCifCache& entry = variadic_cache_[slot];
      entry.valid = false;  // invalidate durante rebuild
      if (entry.plan) {
        ffi_call_plan_free(entry.plan);
        entry.plan = nullptr;
      }
      entry.total_args = argc;
      entry.extra_types.assign(extra_types, extra_types + num_extra);
      entry.ffi_types.resize(argc);

      // Copia tipi fissi
      for (size_t i = 0; i < fixed_args; i++) {
        entry.ffi_types[i] = ffi_arg_types_[i];
      }
      // Aggiungi tipi extra
      for (size_t i = 0; i < num_extra; i++) {
        entry.ffi_types[fixed_args + i] = CTypeToFFI(extra_types[i]);
      }

      // Python ctypes: senza argtypes gli argomenti sono fissi (ffi_prep_cif),
      // altrimenti quelli oltre gli argtypes sono variadici.
      ffi_status status =
        fixed_args == 0
          ? ffi_prep_cif(&entry.cif, abi_, static_cast<unsigned int>(argc), ffi_return_type_, entry.ffi_types.data())
          : ffi_prep_cif_var(&entry.cif, abi_, static_cast<unsigned int>(fixed_args), static_cast<unsigned int>(argc),
                             ffi_return_type_, entry.ffi_types.data());

      if (status != FFI_OK) {
        Napi::Error::New(env, "Failed to prepare variadic FFI call").ThrowAsJavaScriptException();
        return env.Undefined();
      }

      entry.plan = ffi_call_plan_alloc(&entry.cif);

      entry.valid = true;
      cache_entry = &entry;
      active_cif = &entry.cif;
      active_plan = entry.plan;
    }
  }

  // =====================================================================
  // Populate CallContext with argc + variadic state.
  // Le fasi successive operano esclusivamente via helper privati (vedi
  // function.h::CallContext e i 4 helper MarshalArguments /
  // SelectReturnPtr / CaptureErrorState / FinalizeCall).
  // =====================================================================
  CallContext ctx{env, info};
  ctx.argc = argc;
  ctx.expected_argc = expected_argc;
  ctx.active_cif = active_cif;
  ctx.active_plan = active_plan;
  ctx.cache_entry = cache_entry;
  ctx.num_extra = num_extra;
  // Punta al primo elemento dell'array di tipi inferiti (stack o heap).
  // Valido solo se need_reprep (altrimenti non c'è extra).
  ctx.extra_types_ptr =
    need_reprep ? (num_extra <= MAX_VARIADIC_EXTRA_ARGS ? extra_types_stack : extra_types_heap.data()) : nullptr;

  // ---- Select arg storage (inline vs heap) --------------------------
  const bool use_inline_for_call = (argc <= MAX_INLINE_ARGS);
  if (use_inline_for_call) {
    ctx.arg_storage = inline_arg_storage_;
    ctx.arg_values = inline_arg_values_;
  } else {
    const size_t required_size = argc * ARG_SLOT_SIZE;
    if (heap_arg_storage_.capacity() < required_size) {
      heap_arg_storage_.reserve(required_size * 2);
    }
    if (heap_arg_storage_.size() < required_size) {
      heap_arg_storage_.resize(required_size);
    }
    if (heap_arg_values_.capacity() < argc) {
      heap_arg_values_.reserve(argc * 2);
    }
    if (heap_arg_values_.size() < argc) {
      heap_arg_values_.resize(argc);
    }
    ctx.arg_storage = heap_arg_storage_.data();
    ctx.arg_values = heap_arg_values_.data();
  }

  // ---- Reset string buffers ----------------------------------------
  // Le stringhe che non stanno nel buffer inline finiscono in string_buffer_;
  // i loro puntatori sono scritti dopo il marshalling (string_fixups_), quindi
  // non serve pre-riservare la capacità con un passaggio extra sugli argomenti.
  const bool call_has_strings = has_string_args_ || (need_reprep && [&] {
                                  for (size_t i = 0; i < num_extra; i++) {
                                    CType t = ctx.extra_types_ptr[i];
                                    if (t == CType::CTYPES_STRING || t == CType::CTYPES_WSTRING) {
                                      return true;
                                    }
                                  }
                                  return false;
                                }());
  if (call_has_strings) {
    inline_string_offset_ = 0;
    string_buffer_.clear();
    if (string_buffer_.capacity() > 10 * 1024 * 1024) {
      string_buffer_.shrink_to_fit();
    }
  }

  // Overflow buffer per struct/array grandi viene ripulito solo se può
  // essere stato popolato da una call precedente (flag precalcolato).
  if (has_struct_array_args_) {
    sync_large_arg_buffers_.clear();
  }

  // ---- Marshal arguments -------------------------------------------
  if (!MarshalArguments(ctx)) {
    return env.Undefined();
  }

  // ---- Select return buffer ---------------------------------------
  SelectReturnPtr(ctx);

  // ---- ffi_call + capture errno/GetLastError -----------------------
  // Signature fisse semplici: chiamata diretta senza libffi (direct_call.h).
  // Altrimenti reusable call plan quando disponibile (fast path su x86-64;
  // fallback sicuro a ffi_call altrove e se l'allocazione del plan è fallita).
  if (direct_invoker_ && ctx.active_cif == &cif_) [[likely]] {
    for (uint8_t k = 0; k < direct_arg_widen_count_; k++) {
      const direct::Widen& w = direct_arg_widen_[k];
      direct::WidenInPlace(ctx.arg_values[w.index], w.size, w.is_signed);
    }
    direct_invoker_(fn_ptr_, ctx.arg_values, ctx.return_ptr);
    CaptureErrorState();
    if (direct_ret_widen_size_) {
      direct::WidenInPlace(ctx.return_ptr, direct_ret_widen_size_, direct_ret_signed_);
    }
  } else {
    if (ctx.active_plan) [[likely]] {
      ffi_call_plan_invoke(ctx.active_plan, FFI_FN(fn_ptr_), ctx.return_ptr, ctx.arg_values);
    } else {
      ffi_call(ctx.active_cif, FFI_FN(fn_ptr_), ctx.return_ptr, ctx.arg_values);
    }
    CaptureErrorState();
  }

  // ---- Convert return + apply errcheck -----------------------------
  return FinalizeCall(ctx);
}

Napi::Value FFIFunction::SetErrcheck(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1) {
    // Clear errcheck
    errcheck_callback_.Reset();
    return env.Undefined();
  }

  if (!info[0].IsFunction() && !info[0].IsNull()) {
    Napi::TypeError::New(env, "errcheck must be a function or null").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info[0].IsNull()) {
    errcheck_callback_.Reset();
  } else {
    errcheck_callback_ = Napi::Persistent(info[0].As<Napi::Function>());
  }

  return env.Undefined();
}

Napi::Value FFIFunction::ApplyErrcheck(Napi::Env env, Napi::Value result, const Napi::CallbackInfo& info) {
  // Se non c'è errcheck, restituisci il risultato direttamente
  if (errcheck_callback_.IsEmpty()) {
    return result;
  }

  // errcheck(result, this, args). Un'eccezione lanciata da errcheck diventa
  // Napi::Error (NAPI_CPP_EXCEPTIONS) e si propaga al caller JS.
  Napi::Array args_array = Napi::Array::New(env, info.Length());
  for (size_t i = 0; i < info.Length(); i++) {
    args_array.Set(i, info[i]);
  }
  return errcheck_callback_.Value().Call(env.Undefined(), {result, info.This(), args_array});
}

Napi::Value FFIFunction::GetName(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), name_);
}

Napi::Value FFIFunction::GetAddress(const Napi::CallbackInfo& info) {
  return Napi::BigInt::New(info.Env(), reinterpret_cast<uint64_t>(fn_ptr_));
}

// ============================================================================
// CallAsync - Esegue ffi_call su un worker thread, ritorna Promise
// Supporta variadic, buffer pinning, string fixup
// ============================================================================

Napi::Value FFIFunction::CallAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  size_t argc;
  bool is_variadic = false;
  if (!ValidateAndResolveArgc(env, info, argc, is_variadic)) {
    return env.Undefined();
  }
  const size_t expected_argc = arg_types_.size();

  // ---- Validate argc (shared with Call sync, done above) -----------
  //       fatto da ValidateAndResolveArgc sopra.

  // ---- Infer types for extra variadic args -------------------------
  // =====================================================================
  // Tipi per argomenti extra variadic (inferiti dai valori JS)
  // =====================================================================
  std::vector<CType> extra_types;
  if (is_variadic) {
    extra_types.reserve(argc - expected_argc);
    for (size_t i = expected_argc; i < argc; i++) {
      extra_types.push_back(InferTypeFromJS(info[i]));
    }
  }

  // =====================================================================
  // ---- Variadic CIF (owned by the worker thread) -------------------
  // Variadic CIF (owned dal worker)
  //
  // Per il path sincrono possiamo usare la cache perché CIF e ffi_types
  // vivono nell'istanza. Per async, il worker gira su un altro thread e
  // deve possedere tutto → allochiamo su heap con unique_ptr.
  // =====================================================================
  std::unique_ptr<ffi_cif> owned_cif;
  std::vector<ffi_type*> owned_ffi_types;
  ffi_cif* active_cif = &cif_;

  if (is_variadic) {
    owned_cif = std::make_unique<ffi_cif>();
    owned_ffi_types.resize(argc);

    // Copia tipi fissi
    for (size_t i = 0; i < expected_argc; i++) {
      owned_ffi_types[i] = ffi_arg_types_[i];
    }
    // Tipi extra (inferiti)
    for (size_t i = 0; i < extra_types.size(); i++) {
      owned_ffi_types[expected_argc + i] = CTypeToFFI(extra_types[i]);
    }

    // Python ctypes: senza argtypes gli argomenti sono fissi (vedi Call()).
    ffi_status status =
      expected_argc == 0
        ? ffi_prep_cif(owned_cif.get(), abi_, static_cast<unsigned int>(argc), ffi_return_type_, owned_ffi_types.data())
        : ffi_prep_cif_var(owned_cif.get(), abi_, static_cast<unsigned int>(expected_argc),
                           static_cast<unsigned int>(argc), ffi_return_type_, owned_ffi_types.data());

    if (status != FFI_OK) {
      Napi::Error::New(env, "Failed to prepare variadic FFI call for async").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    active_cif = owned_cif.get();
  }

  // =====================================================================
  // ---- Marshal JS → C (main thread), with Buffer pinning
  //              e fixup post-move per le stringhe --------------------
  //
  // Tutto va su heap. Tracciamo string offsets per fixup post-move
  // e pinniamo i Buffer JS.
  // =====================================================================

  std::vector<uint8_t> async_arg_storage(argc * ARG_SLOT_SIZE, 0);
  std::vector<void*> async_arg_values(argc);
  std::vector<char> async_string_buffer;
  std::vector<std::pair<size_t, size_t>> string_fixups;
  std::vector<std::pair<size_t, size_t>> wstring_fixups;
  std::vector<Napi::ObjectReference> buffer_refs;
  std::vector<std::vector<uint8_t>> large_arg_buffers;
  std::vector<size_t> large_arg_indices;  // tracks which arg slots use large_arg_buffers (in order)

  // Stima spazio stringhe
  {
    size_t str_count = 0;
    for (size_t i = 0; i < argc; i++) {
      CType t = (i < expected_argc) ? arg_types_[i] : extra_types[i - expected_argc];
      if (t == CType::CTYPES_STRING || t == CType::CTYPES_WSTRING) {
        str_count++;
      }
    }
    if (str_count > 0) {
      async_string_buffer.reserve(str_count * 128);
    }
  }

  uint8_t* arg_storage = async_arg_storage.data();

  for (size_t i = 0; i < argc; i++) {
    async_arg_values[i] = arg_storage + (i * ARG_SLOT_SIZE);
    uint8_t* slot = arg_storage + (i * ARG_SLOT_SIZE);

    CType type = (i < expected_argc) ? arg_types_[i] : extra_types[i - expected_argc];
    const Napi::Value& val = info[i];

    // Fast path: primitive types (shared implementation)
    try {
      if (MarshalPrimitive(env, val, type, slot)) {
        continue;
      }
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }

    if (type == CType::CTYPES_POINTER && val.IsString()) {
      type = CType::CTYPES_STRING;
    }

    try {
      switch (type) {
        case CType::CTYPES_POINTER: {
          void* ptr = nullptr;
          if (val.IsNull() || val.IsUndefined()) {
            ptr = nullptr;
          } else if (val.IsObject()) {
            ptr = ObjectData(val);
            // Pin: impedisci al GC di raccogliere la memoria durante la chiamata
            buffer_refs.push_back(Napi::Persistent(val.As<Napi::Object>()));
          } else if (val.IsBigInt()) {
            bool lossless;
            ptr = reinterpret_cast<void*>(val.As<Napi::BigInt>().Uint64Value(&lossless));
          } else if (val.IsNumber()) {
            ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value()));
          } else if (val.IsBoolean()) {
            ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(val.As<Napi::Boolean>().Value()));
          } else {
            ThrowWrongType(val);
          }
          memcpy(slot, &ptr, sizeof(ptr));
          break;
        }

        case CType::CTYPES_STRING: {
          if (val.IsString()) {
            std::string str = val.As<Napi::String>().Utf8Value();
            size_t offset = async_string_buffer.size();
            async_string_buffer.resize(offset + str.size() + 1);
            memcpy(async_string_buffer.data() + offset, str.c_str(), str.size() + 1);

            // Puntatore provvisorio (verrà fixato dal worker)
            const char* str_ptr = async_string_buffer.data() + offset;
            memcpy(slot, &str_ptr, sizeof(str_ptr));

            // Registra per fixup post-move
            string_fixups.emplace_back(i, offset);
          } else if (val.IsObject()) {
            const char* ptr = static_cast<const char*>(ObjectData(val));
            memcpy(slot, &ptr, sizeof(ptr));
            buffer_refs.push_back(Napi::Persistent(val.As<Napi::Object>()));
          } else if (val.IsBigInt()) {
            // Raw pointer address (parity CTYPES_POINTER)
            bool lossless;
            uint64_t addr = val.As<Napi::BigInt>().Uint64Value(&lossless);
            const char* ptr = reinterpret_cast<const char*>(addr);
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsNumber()) {
            const char* ptr =
              reinterpret_cast<const char*>(static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value()));
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsNull() || val.IsUndefined()) {
            const char* null_ptr = nullptr;
            memcpy(slot, &null_ptr, sizeof(null_ptr));
          } else {
            ThrowWrongType(val);
          }
          break;
        }

        case CType::CTYPES_WSTRING: {
          if (val.IsString()) {
            std::u16string u16str = val.As<Napi::String>().Utf16Value();
            size_t wchar_size = sizeof(wchar_t);
            size_t byte_len = (u16str.length() + 1) * wchar_size;

            // Align offset for wchar_t to avoid unaligned access
            // (critical on ARM, perf penalty on x86)
            size_t offset = async_string_buffer.size();
            constexpr size_t wchar_align = alignof(wchar_t);
            offset = (offset + wchar_align - 1) & ~(wchar_align - 1);
            async_string_buffer.resize(offset + byte_len);

#ifdef _WIN32
            memcpy(async_string_buffer.data() + offset, u16str.data(), byte_len);
#else
            wchar_t* wptr = reinterpret_cast<wchar_t*>(async_string_buffer.data() + offset);
            for (size_t j = 0; j < u16str.length(); j++) {
              wptr[j] = static_cast<wchar_t>(u16str[j]);
            }
            wptr[u16str.length()] = L'\0';
#endif

            const wchar_t* str_ptr = reinterpret_cast<const wchar_t*>(async_string_buffer.data() + offset);
            memcpy(slot, &str_ptr, sizeof(str_ptr));

            wstring_fixups.emplace_back(i, offset);
          } else if (val.IsObject()) {
            const wchar_t* ptr = static_cast<const wchar_t*>(ObjectData(val));
            memcpy(slot, &ptr, sizeof(ptr));
            buffer_refs.push_back(Napi::Persistent(val.As<Napi::Object>()));
          } else if (val.IsBigInt()) {
            // Raw pointer address (parity CTYPES_POINTER)
            bool lossless;
            uint64_t addr = val.As<Napi::BigInt>().Uint64Value(&lossless);
            const wchar_t* ptr = reinterpret_cast<const wchar_t*>(addr);
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsNumber()) {
            const wchar_t* ptr =
              reinterpret_cast<const wchar_t*>(static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value()));
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsNull() || val.IsUndefined()) {
            const wchar_t* null_ptr = nullptr;
            memcpy(slot, &null_ptr, sizeof(null_ptr));
          } else {
            ThrowWrongType(val);
          }
          break;
        }

        case CType::CTYPES_STRUCT: {
          if (i < expected_argc && arg_struct_infos_[i]) {
            if (!MarshalStructArg(env, val, i, arg_struct_infos_[i], slot, &async_arg_values[i], large_arg_buffers,
                                  &large_arg_indices)) {
              return env.Undefined();
            }
          } else {
            JSToC(env, val, type, slot, ARG_SLOT_SIZE);
          }
          break;
        }

        case CType::CTYPES_ARRAY: {
          if (i < expected_argc && arg_array_infos_[i]) {
            if (!MarshalArrayArg(env, val, i, arg_array_infos_[i], slot, &async_arg_values[i], large_arg_buffers,
                                 &large_arg_indices)) {
              return env.Undefined();
            }
          } else {
            JSToC(env, val, type, slot, ARG_SLOT_SIZE);
          }
          break;
        }

        default:
          JSToC(env, val, type, slot, ARG_SLOT_SIZE);
          break;
      }
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }
  }

  // =====================================================================
  // ---- Create worker, move buffers, return Promise ----------------
  // =====================================================================

  Napi::FunctionReference* errcheck_ptr = nullptr;
  if (!errcheck_callback_.IsEmpty()) {
    errcheck_ptr = &errcheck_callback_;
  }

  auto* worker = new CallWorker(env, this, &cif_, fn_ptr_, return_type_, return_struct_info_, return_array_info_,
                                std::move(async_arg_storage), std::move(async_arg_values),
                                std::move(async_string_buffer), std::move(string_fixups), std::move(wstring_fixups),
                                std::move(buffer_refs), std::move(owned_cif), std::move(owned_ffi_types),
                                std::move(large_arg_buffers), std::move(large_arg_indices), errcheck_ptr);

  Napi::Promise promise = worker->GetPromise();
  worker->Queue();

  return promise;
}

// ============================================================================
// CallWorker implementations (nested class)
// ============================================================================

FFIFunction::CallWorker::CallWorker(Napi::Env env,
                                    FFIFunction* parent,
                                    ffi_cif* cif,
                                    void* fn_ptr,
                                    CType return_type,
                                    std::shared_ptr<StructInfo> return_struct_info,
                                    std::shared_ptr<ArrayInfo> return_array_info,
                                    std::vector<uint8_t>&& arg_storage,
                                    std::vector<void*>&& arg_values,
                                    std::vector<char>&& string_buffer,
                                    std::vector<std::pair<size_t, size_t>>&& string_fixups,
                                    std::vector<std::pair<size_t, size_t>>&& wstring_fixups,
                                    std::vector<Napi::ObjectReference>&& buffer_refs,
                                    std::unique_ptr<ffi_cif>&& owned_cif,
                                    std::vector<ffi_type*>&& owned_ffi_types,
                                    std::vector<std::vector<uint8_t>>&& large_arg_buffers,
                                    std::vector<size_t>&& large_arg_indices,
                                    Napi::FunctionReference* errcheck_ref)
  : Napi::AsyncWorker(env),
    ffi_function_(parent),
    fn_ptr_(fn_ptr),
    return_type_(return_type),
    return_struct_info_(std::move(return_struct_info)),
    return_array_info_(std::move(return_array_info)),
    arg_storage_(std::move(arg_storage)),
    arg_values_(std::move(arg_values)),
    string_buffer_(std::move(string_buffer)),
    string_fixups_(std::move(string_fixups)),
    wstring_fixups_(std::move(wstring_fixups)),
    buffer_refs_(std::move(buffer_refs)),
    owned_cif_(std::move(owned_cif)),
    owned_ffi_types_(std::move(owned_ffi_types)),
    large_arg_buffers_(std::move(large_arg_buffers)),
    large_arg_indices_(std::move(large_arg_indices)),
    return_ptr_(nullptr),
    deferred_(Napi::Promise::Deferred::New(env)),
    errcheck_ref_(errcheck_ref) {
  ffi_function_->Ref();  // Pin the FFIFunction instance

  memset(&return_value_, 0, sizeof(return_value_));

  // Seleziona il CIF attivo: owned (variadic) o esterno (fisso)
  active_cif_ = owned_cif_ ? owned_cif_.get() : cif;

  // Allocate return buffer for large struct/array returns
  return_ptr_ = &return_value_;
  if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_) {
    size_t ret_size = return_struct_info_->GetSize();
    if (ret_size > sizeof(ReturnValue)) {
      return_buffer_.resize(ret_size, 0);
      return_ptr_ = return_buffer_.data();
    }
  } else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_) {
    size_t ret_size = return_array_info_->GetSize();
    if (ret_size > sizeof(ReturnValue)) {
      return_buffer_.resize(ret_size, 0);
      return_ptr_ = return_buffer_.data();
    }
  }

  // Ricalcola tutti i puntatori dopo il move
  FixupPointers();
}

void FFIFunction::CallWorker::FixupPointers() {
  uint8_t* base = arg_storage_.data();
  const size_t argc = arg_values_.size();

  // 1. Ricalcola arg_values_ come offsets dal nuovo base
  for (size_t i = 0; i < argc; i++) {
    arg_values_[i] = base + (i * ARG_SLOT_SIZE);
  }

  // 2. Fixup large struct/array args: point to their overflow buffers
  for (size_t k = 0; k < large_arg_indices_.size(); k++) {
    size_t arg_idx = large_arg_indices_[k];
    arg_values_[arg_idx] = large_arg_buffers_[k].data();
  }

  // 3. Fixup puntatori a stringhe (char*) dentro gli slot
  const char* str_base = string_buffer_.data();
  for (const auto& [slot_index, str_offset] : string_fixups_) {
    uint8_t* slot = base + (slot_index * ARG_SLOT_SIZE);
    const char* new_ptr = str_base + str_offset;
    memcpy(slot, &new_ptr, sizeof(new_ptr));
  }

  // 4. Fixup puntatori a wstring (wchar_t*) dentro gli slot
  for (const auto& [slot_index, str_offset] : wstring_fixups_) {
    uint8_t* slot = base + (slot_index * ARG_SLOT_SIZE);
    const wchar_t* new_ptr = reinterpret_cast<const wchar_t*>(str_base + str_offset);
    memcpy(slot, &new_ptr, sizeof(new_ptr));
  }
}

FFIFunction::CallWorker::~CallWorker() {
  ffi_function_->Unref();  // Unpin the FFIFunction instance
}

void FFIFunction::CallWorker::Execute() {
  // *** WORKER THREAD - Nessun accesso a V8! ***
  try {
    ffi_call(active_cif_, FFI_FN(fn_ptr_), return_ptr_, arg_values_.empty() ? nullptr : arg_values_.data());
  } catch (...) {
    SetError("Native function threw an exception");
  }
}

void FFIFunction::CallWorker::OnOK() {
  // *** MAIN THREAD ***
  Napi::Env env = Env();
  Napi::HandleScope scope(env);

  try {
    // Riusa ConvertReturn statico (shared con ConvertReturnValue sync)
    Napi::Value result =
      FFIFunction::ConvertReturn(env, return_ptr_, return_type_, return_struct_info_, return_array_info_);

    // Errcheck (se presente)
    if (errcheck_ref_ && !errcheck_ref_->IsEmpty()) {
      try {
        Napi::Array args_array = Napi::Array::New(env, 0);
        std::vector<napi_value> errcheck_args = {result, ffi_function_->Value(), args_array};
        result = errcheck_ref_->Call(errcheck_args);
      } catch (const Napi::Error& e) {
        deferred_.Reject(e.Value());
        return;
      }
    }

    deferred_.Resolve(result);
  } catch (const Napi::Error& e) {
    deferred_.Reject(e.Value());
  }
}

void FFIFunction::CallWorker::OnError(const Napi::Error& error) {
  deferred_.Reject(error.Value());
}

}  // namespace ctypes
