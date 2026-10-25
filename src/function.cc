#include "function.h"

#include "addon.h"  // CTypesAddon per gli slot captured_last_error / captured_errno
#include "array.h"  // TypeSpecFromJS

namespace ctypes {

namespace {

// Chiamata a una funzione di una libreria: rifiutata dopo close(), e contata
// finché è in corso così che close() non scarichi il codice in esecuzione.
class LibraryCallScope {
 public:
  LibraryCallScope(Library* library, Napi::Env env) : library_(library) {
    if (library_ == nullptr) {
      return;
    }
    if (!library_->IsLoaded()) [[unlikely]] {
      throw Napi::Error::New(env, "Library is closed");
    }
    library_->BeginCall();
  }
  ~LibraryCallScope() {
    if (library_ != nullptr) {
      library_->EndCall();
    }
  }
  LibraryCallScope(const LibraryCallScope&) = delete;
  LibraryCallScope& operator=(const LibraryCallScope&) = delete;

 private:
  Library* library_;
};

// Incrementa un contatore (se non nullo) per la durata dello scope: profondità
// di rientranza, uso di uno slot della cache variadica.
class CountScope {
 public:
  explicit CountScope(uint32_t* counter) noexcept : counter_(counter) {
    if (counter_ != nullptr) {
      ++*counter_;
    }
  }
  ~CountScope() {
    if (counter_ != nullptr) {
      --*counter_;
    }
  }
  CountScope(const CountScope&) = delete;
  CountScope& operator=(const CountScope&) = delete;

 private:
  uint32_t* counter_;
};

// Data pointer of a Buffer argument, or nullptr.
// Python ctypes rifiuta i valori non convertibili in puntatore con
// ArgumentError "wrong type": mai NULL implicito per funzioni o oggetti.
// Nome Python del tipo argomento nei messaggi: "... cannot be interpreted as ctypes.c_void_p".
constexpr std::string_view PointerTypeName(CType type) {
  switch (type) {
    case CType::CTYPES_STRING:
      return "c_char_p";
    case CType::CTYPES_WSTRING:
      return "c_wchar_p";
    default:
      return "c_void_p";
  }
}

[[noreturn]] inline void ThrowWrongType(const Napi::Value& val, CType type) {
  throw Napi::TypeError::New(
    val.Env(), std::format("'{}' object cannot be interpreted as ctypes.{}", JSTypeName(val), PointerTypeName(type)));
}

// Memoria di un oggetto passato a un parametro puntatore: Buffer e ogni
// TypedArray/DataView/ArrayBuffer (in place); altri oggetti sono un TypeError.
inline void* ObjectData(const Napi::Value& val, CType type) {
  if (void* data = napi_fast::TryViewData(val)) [[likely]] {
    return data;
  }
  if (val.IsBuffer()) {
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
  ThrowWrongType(val, type);
}

// Address carried by a BigInt / Number pointer argument.
inline uintptr_t AddressFromBigInt(const Napi::Value& val) {
  bool lossless;
  return static_cast<uintptr_t>(val.As<Napi::BigInt>().Uint64Value(&lossless));
}

inline uintptr_t AddressFromNumber(const Napi::Value& val) {
  return static_cast<uintptr_t>(IntegerBitsFromDouble(val, val.As<Napi::Number>().DoubleValue()));
}

// Tipi convertiti da JSToC (wchar e simili): un -1 significa che il tipo non
// è un argomento valido, e lo slot non deve restare non inizializzato.
inline void MarshalOther(const Napi::Value& val, CType type, uint8_t* slot) {
  if (JSToC(val, type, std::span(slot, ARG_SLOT_SIZE)) < 0) {
    throw Napi::TypeError::New(val.Env(), "unsupported argument type");
  }
}

// Puntatore da un valore che non è una stringa: memoria di Buffer / TypedArray
// / DataView / ArrayBuffer, indirizzo BigInt o number, NULL per null e
// undefined; true e false solo per c_void_p (Python: un int).
inline void* PointerArg(const Napi::Value& val, napi_valuetype kind, CType type) {
  switch (kind) {
    case napi_object:
      return ObjectData(val, type);
    case napi_bigint:
      return reinterpret_cast<void*>(AddressFromBigInt(val));
    case napi_number:
      return reinterpret_cast<void*>(AddressFromNumber(val));
    case napi_boolean:
      if (type == CType::CTYPES_POINTER) {
        return reinterpret_cast<void*>(static_cast<uintptr_t>(val.As<Napi::Boolean>().Value()));
      }
      break;
    case napi_null:
    case napi_undefined:
      return nullptr;
    default:
      break;
  }
  ThrowWrongType(val, type);
}

// Argomenti numerici, parity Python ctypes: accettano number, boolean
// (true → 1) e BigInt (troncato ai bit del tipo, come Python maschera gli int);
// stringhe, null e oggetti sono un TypeError (Python: ArgumentError).
enum class NumericKind { Integer, Real };

[[noreturn]] inline void ThrowNotNumeric(const Napi::Value& val, NumericKind kind) {
  throw Napi::TypeError::New(val.Env(),
                             kind == NumericKind::Integer
                               ? std::format("'{}' object cannot be interpreted as an integer", JSTypeName(val))
                               : std::format("must be real number, not {}", JSTypeName(val)));
}

// Valori che non sono number (boolean, BigInt, errori): fuori dal percorso caldo.
CTYPES_NOINLINE int64_t IntegerArgSlow(const Napi::Value& val) {
  switch (val.Type()) {
    case napi_boolean:
      return val.As<Napi::Boolean>().Value() ? 1 : 0;
    case napi_bigint: {
      bool lossless;
      return static_cast<int64_t>(val.As<Napi::BigInt>().Uint64Value(&lossless));
    }
    default:
      ThrowNotNumeric(val, NumericKind::Integer);
  }
}

CTYPES_ALWAYS_INLINE int32_t Int32Arg(const Napi::Value& val) {
  if (double d; napi_fast::TryDouble(val, d)) [[likely]] {
    if (d >= -2147483648.0 && d <= 2147483647.0) [[likely]] {
      if (const auto v = static_cast<int32_t>(d); static_cast<double>(v) == d) [[likely]] {
        return v;
      }
    }
    return static_cast<int32_t>(static_cast<uint32_t>(IntegerBitsFromDouble(val, d)));
  }
  return static_cast<int32_t>(IntegerArgSlow(val));
}

CTYPES_ALWAYS_INLINE uint32_t Uint32Arg(const Napi::Value& val) {
  if (double d; napi_fast::TryDouble(val, d)) [[likely]] {
    if (d >= 0.0 && d <= 4294967295.0) [[likely]] {
      if (const auto v = static_cast<uint32_t>(d); static_cast<double>(v) == d) [[likely]] {
        return v;
      }
    }
    return static_cast<uint32_t>(IntegerBitsFromDouble(val, d));
  }
  return static_cast<uint32_t>(IntegerArgSlow(val));
}

// Number intero a 64 bit: true se `val` è un number (gli altri tipi restano
// al chiamante).
CTYPES_ALWAYS_INLINE bool TryInt64Number(const Napi::Value& val, int64_t& out) {
  double d;
  if (!napi_fast::TryDouble(val, d)) {
    return false;
  }
  if (d >= -9223372036854775808.0 && d < 9223372036854775808.0) [[likely]] {
    if (const auto v = static_cast<int64_t>(d); static_cast<double>(v) == d) [[likely]] {
      out = v;
      return true;
    }
  }
  out = static_cast<int64_t>(IntegerBitsFromDouble(val, d));
  return true;
}

CTYPES_ALWAYS_INLINE int64_t Int64Arg(const Napi::Value& val) {
  if (int64_t v; TryInt64Number(val, v)) [[likely]] {
    return v;
  }
  return IntegerArgSlow(val);
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

// Valori che non sono number (boolean, BigInt, errori): fuori dal percorso caldo.
CTYPES_NOINLINE double DoubleArgSlow(const Napi::Value& val) {
  return RealFromJS(val);
}

CTYPES_ALWAYS_INLINE double DoubleArg(const Napi::Value& val) {
  if (double v; napi_fast::TryDouble(val, v)) [[likely]] {
    return v;
  }
  return DoubleArgSlow(val);
}

}  // namespace

CallConv StringToCallConv(std::string_view name) {
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
                       InstanceMethod("_callWithErrcheck", &FFIFunction::CallChecked),
                       InstanceMethod("_callAsyncWithErrcheck", &FFIFunction::CallAsyncChecked),
                       InstanceMethod("_makeCheckedCall", &FFIFunction::MakeCheckedCall),
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
    name_ = std::format("{}", fn_ptr_);
  } else {
    Napi::TypeError::New(env, "Second argument must be function name (string) or null").ThrowAsJavaScriptException();
    return;
  }

  // 3. Return type
  try {
    const TypeSpec spec = TypeSpecFromJS(info[2]);
    return_type_ = spec.type;
    return_struct_info_ = spec.struct_info;
    return_array_info_ = spec.array_info;
  } catch (const Napi::Error& e) {
    throw Napi::TypeError::New(env, std::format("Invalid return type: {}", e.Message()));
  }

  // 4. Argument types
  if (info.Length() > 3 && info[3].IsArray()) {
    const Napi::Array arr = info[3].As<Napi::Array>();
    const uint32_t count = arr.Length();
    arg_types_.reserve(count);
    arg_struct_infos_.reserve(count);
    arg_array_infos_.reserve(count);
    for (uint32_t i = 0; i < count; i++) {
      try {
        TypeSpec spec = TypeSpecFromJS(arr.Get(i));
        arg_types_.push_back(spec.type);
        arg_struct_infos_.push_back(std::move(spec.struct_info));
        arg_array_infos_.push_back(std::move(spec.array_info));
      } catch (const Napi::Error& e) {
        throw Napi::TypeError::New(env, std::format("Invalid argument type at index {}: {}", i, e.Message()));
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
    struct_as_buffer_ = opts.Get("struct_buffer").ToBoolean().Value();
    scalar_as_buffer_ = opts.Get("scalar_buffer").ToBoolean().Value();
    if (scalar_as_buffer_ && CTypeSize(return_type_) == 0) {
      throw Napi::TypeError::New(env, "scalar_buffer requires a non-void primitive return type");
    }
    // CFUNCTYPE((name, dll)): la libreria del simbolo, come Library::GetFunction.
    Napi::Value library = opts.Get("library");
    if (!library.IsUndefined() && !library.IsNull()) {
      if (UnwrapTagged<Library>(library) == nullptr) {
        throw Napi::TypeError::New(env, "library option must be a Library");
      }
      AttachLibrary(library.As<Napi::Object>());
    }
  }

  // Pre-alloca lo scratch dell'istanza (come CPython - pool struct argument)
  if (arg_types_.size() > MAX_INLINE_ARGS) {
    scratch_.arg_storage.resize(arg_types_.size() * ARG_SLOT_SIZE);
    scratch_.arg_values.resize(arg_types_.size());
  }

  if (!PrepareFFI(env)) {
    return;
  }

  InstallFastCall(env);
}

void FFIFunction::AttachLibrary(Napi::Object library) {
  library_ = Napi::ObjectWrap<Library>::Unwrap(library);
  library_ref_ = Napi::Persistent(library);
}

template <typename Args, bool HasErrcheck>
  requires(std::same_as<Args, Napi::CallbackInfo> || std::same_as<Args, FunctionArguments>)
CTYPES_ALWAYS_INLINE Napi::Value FFIFunction::InvokeCall(const Args& args, const Napi::Function* errcheck) {
  if (simple_call_ && args.Length() >= arg_types_.size()) [[likely]] {
    if (Napi::Value result; SimpleCall<Args, HasErrcheck>(args, result, errcheck)) [[likely]] {
      return result;
    }
  }
  return CallArguments(FunctionArguments{args}, errcheck);
}

Napi::Value FFIFunction::FastCall(const Napi::CallbackInfo& info) {
  FFIFunction* self = static_cast<FFIFunction*>(info.Data());
  if (self->errcheck_callback_.IsEmpty()) [[likely]] {
    return self->InvokeCall<Napi::CallbackInfo, false>(info, nullptr);
  }
  const Napi::Function errcheck = self->SnapshotErrcheck();
  return self->InvokeCall(info, errcheck.IsEmpty() ? nullptr : &errcheck);
}

Napi::Value FFIFunction::CallChecked(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "a result handler function is required");
  }
  const FunctionArguments args{info, 1};
  const Napi::Function errcheck = info[0].As<Napi::Function>();
  return InvokeCall(args, &errcheck);
}

Napi::Value FFIFunction::CallAsyncChecked(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "a result handler function is required");
  }
  const Napi::Function errcheck = info[0].As<Napi::Function>();
  return CallAsyncArguments(FunctionArguments{info, 1}, &errcheck);
}

Napi::Value FFIFunction::FastCheckedCall(const Napi::CallbackInfo& info) {
  return static_cast<FFIFunction*>(info.Data())->CallChecked(info);
}

Napi::Value FFIFunction::MakeCheckedCall(const Napi::CallbackInfo& info) {
  Napi::Function call = Napi::Function::New<&FFIFunction::FastCheckedCall>(info.Env(), "_callWithErrcheck", this);
  call.DefineProperty(Napi::PropertyDescriptor::Value("_ffiFunction", Value(), napi_default));
  return call;
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

  // Free reusable call plan della signature fissa (le entry variadiche
  // liberano il proprio nel distruttore).
  if (call_plan_) {
    ffi_call_plan_free(call_plan_);
    call_plan_ = nullptr;
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

  if (struct_as_buffer_ && return_type_ == CType::CTYPES_STRUCT && return_struct_info_) {
    Napi::Buffer<uint8_t> result = Napi::Buffer<uint8_t>::New(env, return_struct_info_->GetSize());
    struct_result_data_ = result.Data();
    struct_result_ = Napi::Persistent(result);
  }
  const bool simple_return =
    return_type_ == CType::CTYPES_STRUCT
      ? struct_result_data_ != nullptr && return_struct_info_->GetSize() <= kMaxSimpleStructReturn
      : return_type_ != CType::CTYPES_ARRAY && return_type_ != CType::CTYPES_UNION;
  simple_call_ =
    arg_types_.size() <= kMaxSimpleArgs && simple_return && std::ranges::all_of(arg_types_, IsSimpleArgumentType);

  return true;
}

void FFIFunction::SetupDirectCall() {
  direct_invoker_ = nullptr;

  if constexpr (sizeof(void*) != 8 || std::endian::native != std::endian::little) {
    return;
  }
  if (abi_ != FFI_DEFAULT_ABI || arg_types_.size() > direct::kMaxDirectArgs) {
    return;
  }

  direct_invoker_ = direct::Select(return_type_, arg_types_);
}

namespace {

// Istanza SimpleCData passata oltre gli argtypes (variadici, o senza
// argtypes): come in Python conta il suo tipo, non quello dedotto dal valore
// (printf("%f", c_double(2.0))). Tipo e valore seguono le promozioni degli
// argomenti variadici del C, che libffi richiede: float → double, interi più
// stretti di int → int, char e wchar_t → il loro codice.
std::optional<VariadicValue> SimpleCDataArgument(const Napi::Value& val) {
  const Napi::Object object = val.As<Napi::Object>();
  const Napi::Value ctor = object.Get("constructor");
  if (!ctor.IsFunction()) {
    return std::nullopt;
  }
  const Napi::Value code = ctor.As<Napi::Object>().Get("_type");
  if (!code.IsNumber() || !ctor.As<Napi::Object>().Get("_isSimpleCData").ToBoolean()) {
    return std::nullopt;
  }
  const std::optional<CType> type = ToCType(code.As<Napi::Number>().Int32Value());
  if (!type) {
    return std::nullopt;
  }
  const Napi::Env env = val.Env();
  const Napi::Value value = object.Get("value");
  switch (*type) {
    case CType::CTYPES_FLOAT:
      return VariadicValue{CType::CTYPES_DOUBLE, value};
    case CType::CTYPES_INT8:
    case CType::CTYPES_UINT8:
    case CType::CTYPES_INT16:
    case CType::CTYPES_UINT16:
    case CType::CTYPES_BOOL:
      return VariadicValue{CType::CTYPES_INT32, value};
    case CType::CTYPES_CHAR:
      return VariadicValue{CType::CTYPES_INT32, Napi::Number::New(env, CharFromJS(value))};
    case CType::CTYPES_WCHAR:
      return VariadicValue{CType::CTYPES_INT32,
                           Napi::Number::New(env, static_cast<int32_t>(static_cast<uint32_t>(WcharFromJS(value))))};
    case CType::CTYPES_VOID:
    case CType::CTYPES_STRUCT:
    case CType::CTYPES_UNION:
    case CType::CTYPES_ARRAY:
      return std::nullopt;
    default:
      return VariadicValue{*type, value};
  }
}

}  // namespace

VariadicValue FFIFunction::InferVariadic(const Napi::Value& val) {
  if (val.IsObject() && !val.IsBuffer()) {
    if (std::optional<VariadicValue> instance = SimpleCDataArgument(val)) {
      return *instance;
    }
  }
  return {InferTypeFromJS(val), val};
}

// ============================================================================
// InferTypeFromJS - Shared by Call() and CallAsync() for variadic inference
// ============================================================================

CType FFIFunction::InferTypeFromJS(const Napi::Value& val) {
  // Una sola napi_typeof (IsString/IsNumber/IsBigInt/... ne fanno una ciascuna).
  switch (val.Type()) {
    case napi_string:
      return CType::CTYPES_STRING;
    case napi_number: {
      const double d = val.As<Napi::Number>().DoubleValue();
      // Integer fits in int32 → INT32 (the common sprintf("%d", …) case).
      // Range checked before the cast (NaN or out of range is UB).
      if (d >= -2147483648.0 && d <= 2147483647.0 && d == std::trunc(d)) {
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
    case napi_bigint:
      return CType::CTYPES_INT64;
    case napi_object:
      // Memoria (Buffer, TypedArray, DataView, ArrayBuffer): il suo indirizzo.
      return val.IsTypedArray() || val.IsDataView() || val.IsArrayBuffer() ? CType::CTYPES_POINTER
                                                                           : CType::CTYPES_INT32;
    case napi_null:
    case napi_undefined:
      return CType::CTYPES_POINTER;
    default:
      return CType::CTYPES_INT32;  // fallback
  }
}

// ============================================================================
// ConvertReturn - Static, shared by ConvertReturnValue() and CallWorker::OnOK()
// ============================================================================

Napi::Value FFIFunction::ConvertReturn(Napi::Env env,
                                       void* return_data,
                                       CType type,
                                       const std::shared_ptr<StructInfo>& struct_info,
                                       const std::shared_ptr<ArrayInfo>& array_info,
                                       bool struct_as_buffer,
                                       bool scalar_as_buffer) {
  if (scalar_as_buffer) {
    return Napi::Buffer<uint8_t>::Copy(env, static_cast<const uint8_t*>(return_data), CTypeSize(type));
  }
  // Tipi primitivi: i byte del valore restituito (ReturnValue).
  const void* rv = return_data;

  switch (type) {
    case CType::CTYPES_VOID:
      return env.Undefined();

    case CType::CTYPES_INT32:
      return napi_fast::Int32(env, LoadAs<int32_t>(rv));

    case CType::CTYPES_UINT32:
      return napi_fast::Uint32(env, LoadAs<uint32_t>(rv));

    case CType::CTYPES_INT64:
      return Napi::BigInt::New(env, LoadAs<int64_t>(rv));

    case CType::CTYPES_UINT64:
    case CType::CTYPES_SIZE_T:
      return Napi::BigInt::New(env, LoadAs<uint64_t>(rv));

    case CType::CTYPES_DOUBLE:
      return Napi::Number::New(env, LoadAs<double>(rv));

    case CType::CTYPES_FLOAT:
      return Napi::Number::New(env, static_cast<double>(LoadAs<float>(rv)));

    case CType::CTYPES_BOOL:
      return Napi::Boolean::New(env, LoadAs<uint8_t>(rv) != 0);

    case CType::CTYPES_POINTER: {
      void* const ptr = LoadAs<void*>(rv);
      if (ptr == nullptr) {
        return env.Null();
      }
      return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(ptr));
    }

    case CType::CTYPES_STRING: {
      const char* const str = LoadAs<const char*>(rv);
      if (str == nullptr) {
        return env.Null();
      }
      return Napi::String::New(env, str);
    }

    case CType::CTYPES_WSTRING: {
      const wchar_t* const str = LoadAs<const wchar_t*>(rv);
      if (str == nullptr) {
        return env.Null();
      }
      return WideToJS(env, std::wstring_view(str));
    }

    case CType::CTYPES_LONG:
      return Napi::BigInt::New(env, LoadAs<int64_t>(rv));

    case CType::CTYPES_ULONG:
      return Napi::BigInt::New(env, LoadAs<uint64_t>(rv));

    case CType::CTYPES_INT8:
      return napi_fast::Int32(env, LoadAs<int8_t>(rv));

    case CType::CTYPES_UINT8:
      return napi_fast::Uint32(env, LoadAs<uint8_t>(rv));

    case CType::CTYPES_INT16:
      return napi_fast::Int32(env, LoadAs<int16_t>(rv));

    case CType::CTYPES_UINT16:
      return napi_fast::Uint32(env, LoadAs<uint16_t>(rv));

    case CType::CTYPES_STRUCT: {
      // return_data points to the actual struct buffer (may be larger than ReturnValue)
      if (struct_info && struct_as_buffer) {
        return Napi::Buffer<uint8_t>::Copy(env, static_cast<const uint8_t*>(return_data), struct_info->GetSize());
      }
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

CTYPES_ALWAYS_INLINE bool FFIFunction::MarshalPrimitive(const Napi::Value& val, CType type, uint8_t* slot) {
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
      // number con una sola chiamata; poi una sola Value::Type() invece di
      // IsBigInt/IsNull/IsUndefined in cascata (ognuna è una napi_typeof).
      int64_t v = 0;
      if (TryInt64Number(val, v)) [[likely]] {
        memcpy(slot, &v, sizeof(v));
        return true;
      }
      switch (val.Type()) {
        case napi_bigint: {
          bool lossless;
          v = val.As<Napi::BigInt>().Int64Value(&lossless);
          break;
        }
        case napi_boolean:
          v = val.As<Napi::Boolean>().Value() ? 1 : 0;
          break;
        // Estensioni node-ctypes per gli interi a 64 bit e pointer-sized:
        // null/undefined valgono 0, Buffer/ArrayBuffer il loro indirizzo.
        case napi_null:
        case napi_undefined:
          break;
        case napi_object:
          if (val.IsBuffer()) {
            v = static_cast<int64_t>(reinterpret_cast<intptr_t>(val.As<Napi::Buffer<uint8_t>>().Data()));
            break;
          }
          if (val.IsArrayBuffer()) {
            v = static_cast<int64_t>(reinterpret_cast<intptr_t>(val.As<Napi::ArrayBuffer>().Data()));
            break;
          }
          ThrowNotNumeric(val, NumericKind::Integer);
        default:
          ThrowNotNumeric(val, NumericKind::Integer);
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
      bool b;
      if (!napi_fast::TryBool(val, b)) {
        b = val.ToBoolean().Value();
      }
      const uint8_t v = b ? 1 : 0;
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_CHAR: {
      uint8_t v = CharFromJS(val);
      memcpy(slot, &v, sizeof(v));
      return true;
    }
    case CType::CTYPES_WCHAR: {
      const wchar_t v = WcharFromJS(val);
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
                                   std::vector<size_t>* large_indices,
                                   std::vector<Napi::ObjectReference>* owners) {
  size_t struct_size = struct_info->GetSize();

  // Use overflow buffer if struct > slot size
  uint8_t* dest = slot;
  size_t dest_size = ARG_SLOT_SIZE;
  if (struct_size > ARG_SLOT_SIZE) {
    large_buffers.emplace_back(struct_size, uint8_t{0});
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
      if (owners) {
        owners->push_back(Napi::Persistent(buf_prop.As<Napi::Object>()));
      }
      Napi::Buffer<uint8_t> buf = buf_prop.As<Napi::Buffer<uint8_t>>();
      if (buf.Length() >= struct_size) {
        memcpy(dest, buf.Data(), struct_size);
      } else {
        Napi::TypeError::New(env, std::format("Internal buffer too small for struct at argument {}", arg_index))
          .ThrowAsJavaScriptException();
        return false;
      }
    } else {
      if (!struct_info->JSToStruct(env, obj, std::span(dest, dest_size), owners)) {
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
                                  std::vector<size_t>* large_indices,
                                  std::vector<Napi::ObjectReference>* owners) {
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
    if (!array_info->JSToArray(env, val, std::span(dest, dest_size), owners)) {
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
                                                              const FunctionArguments& info,
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
  CallScratch& scratch = *ctx.scratch;

  for (size_t i = 0; i < argc; i++) {
    uint8_t* slot = arg_storage + (i * ARG_SLOT_SIZE);
    arg_values[i] = slot;
    const Napi::Value val = i < expected_argc ? info[i] : ctx.extra_values[i - expected_argc];

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
      if (MarshalPrimitive(val, type, slot)) {
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
          void* ptr = PointerArg(val, val.Type(), type);
          memcpy(slot, &ptr, sizeof(ptr));
          break;
        }

        case CType::CTYPES_STRING: {
          const char* str_ptr = nullptr;
          switch (val.Type()) {
            case napi_string: {
              const Napi::String js_str = val.As<Napi::String>();
              // SBO: prova prima il buffer inline (una sola copia, vedi napi_fast.h)
              char* dest = ctx.inline_strings + ctx.inline_string_offset;
              if (auto copied = napi_fast::TryCopyUtf8Into(
                    js_str, std::span(dest, kInlineStringBufferSize - ctx.inline_string_offset))) {
                str_ptr = dest;
                ctx.inline_string_offset += *copied + 1;
                break;
              }
              // Encode into reusable storage; fix pointers after any later growth.
              const size_t offset = ctx.heap_string_offset;
              if (auto copied = napi_fast::TryCopyUtf8Into(js_str, std::span(scratch.strings).subspan(offset))) {
                ctx.heap_string_offset = offset + *copied + 1;
              } else {
                const std::string str = js_str.Utf8Value();
                const size_t needed = str.size() + 1;
                const size_t capacity =
                  std::max(needed + napi_fast::kMaxUtf8CharBytes, napi_fast::kMaxUtf8CharBytes + 2);
                if (capacity > scratch.strings.max_size() - offset) {
                  throw Napi::RangeError::New(env, "String argument buffer is too large");
                }
                // resize alone can round capacity past the retention limit.
                scratch.strings.reserve(offset + capacity);
                scratch.strings.resize(offset + capacity);
                memcpy(scratch.strings.data() + offset, str.c_str(), needed);
                ctx.heap_string_offset = offset + needed;
              }
              scratch.string_fixups.emplace_back(i, offset);
              break;
            }
            case napi_object:
              str_ptr = static_cast<const char*>(ObjectData(val, type));
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
              ThrowWrongType(val, type);
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
              size_t offset = ctx.heap_string_offset;
              offset = (offset + wchar_align - 1) & ~(wchar_align - 1);
              ctx.heap_string_offset = offset + byte_len;
              if (scratch.strings.size() < ctx.heap_string_offset) {
                scratch.strings.reserve(ctx.heap_string_offset);
                scratch.strings.resize(ctx.heap_string_offset);
              }
              Utf16ToWide(u16str,
                          std::span(reinterpret_cast<wchar_t*>(scratch.strings.data() + offset), u16str.size() + 1));
              scratch.string_fixups.emplace_back(i, offset);
              break;
            }
            case napi_object:
              str_ptr = static_cast<const wchar_t*>(ObjectData(val, type));
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
              ThrowWrongType(val, type);
          }
          memcpy(slot, &str_ptr, sizeof(str_ptr));
          break;
        }

        case CType::CTYPES_STRUCT: {
          if (i < expected_argc && arg_struct_infos_[i]) {
            if (!MarshalStructArg(env, val, i, arg_struct_infos_[i], slot, &arg_values[i], scratch.large_args,
                                  nullptr)) {
              return false;
            }
          } else {
            MarshalOther(val, type, slot);
          }
          break;
        }

        case CType::CTYPES_ARRAY: {
          if (i < expected_argc && arg_array_infos_[i]) {
            if (!MarshalArrayArg(env, val, i, arg_array_infos_[i], slot, &arg_values[i], scratch.large_args, nullptr)) {
              return false;
            }
          } else {
            MarshalOther(val, type, slot);
          }
          break;
        }

        default:
          MarshalOther(val, type, slot);
          break;
      }
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }
  }

  // Puntatori alle stringhe nel heap scratch.strings: scritti solo ora, quando il
  // buffer non verrà più riallocato in questa call.
  for (const auto& [slot_index, offset] : scratch.string_fixups) {
    const char* str_ptr = scratch.strings.data() + offset;
    memcpy(arg_storage + (slot_index * ARG_SLOT_SIZE), &str_ptr, sizeof(str_ptr));
  }
  return true;
}

// Seleziona il return buffer: ReturnValue della chiamata per tipi primitivi,
// scratch.return_buffer per struct/array > sizeof(ReturnValue).
CTYPES_ALWAYS_INLINE void FFIFunction::SelectReturnPtr(CallContext& ctx) {
  ctx.return_ptr = ctx.return_value;
  size_t ret_size = 0;
  if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_) {
    ret_size = return_struct_info_->GetSize();
  } else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_) {
    ret_size = return_array_info_->GetSize();
  }
  if (ret_size > sizeof(ReturnValue)) {
    ctx.scratch->return_buffer.resize(ret_size);
    ctx.return_ptr = ctx.scratch->return_buffer.data();
  }
}

// Python use_errno / use_last_error: il valore privato (set_errno(),
// set_last_error()) è il valore di sistema durante la chiamata; dopo, il valore
// prodotto dalla chiamata diventa quello privato e quello di sistema torna
// com'era (lo scambio di _ctypes_callproc).
CTYPES_ALWAYS_INLINE SavedErrorState SwapErrorStateIn([[maybe_unused]] bool use_last_error,
                                                      bool use_errno,
                                                      [[maybe_unused]] uint32_t last_error,
                                                      int errno_value) {
  SavedErrorState saved;
#ifdef _WIN32
  if (use_last_error) {
    saved.last_error = static_cast<uint32_t>(::GetLastError());
    ::SetLastError(static_cast<DWORD>(last_error));
  }
#endif
  if (use_errno) {
    saved.errno_value = errno;
    errno = errno_value;
  }
  return saved;
}

CTYPES_ALWAYS_INLINE void SwapErrorStateOut(bool use_last_error,
                                            bool use_errno,
                                            const SavedErrorState& saved,
                                            uint32_t& last_error,
                                            int& errno_value) {
  if (use_last_error) {
#ifdef _WIN32
    last_error = static_cast<uint32_t>(::GetLastError());
    ::SetLastError(static_cast<DWORD>(saved.last_error));
#else
    // Fuori da Windows get_last_error() è l'errno della chiamata.
    last_error = static_cast<uint32_t>(errno);
#endif
  }
  if (use_errno) {
    errno_value = errno;
    errno = saved.errno_value;
  }
}

CTYPES_ALWAYS_INLINE SavedErrorState FFIFunction::SwapInErrorState() {
  if (!(capture_last_error_ || capture_errno_)) [[likely]] {
    return {};
  }
  return SwapErrorStateIn(capture_last_error_, capture_errno_, addon_ ? addon_->captured_last_error : 0,
                          addon_ ? addon_->captured_errno : 0);
}

// Snapshot di errno / GetLastError subito dopo la chiamata, pubblicato negli
// slot privati. Parity Python ctypes use_last_error / use_errno.
CTYPES_ALWAYS_INLINE void FFIFunction::CaptureErrorState(const SavedErrorState& saved) {
  if (capture_last_error_ || capture_errno_) [[unlikely]] {
    SwapErrorStateOut(capture_last_error_, capture_errno_, saved, last_error_, last_errno_);
    if (addon_) {
      if (capture_last_error_) {
        addon_->captured_last_error = last_error_;
      }
      if (capture_errno_) {
        addon_->captured_errno = last_errno_;
      }
    }
  }
}

// Pubblica uno snapshot preso su un altro thread (callAsync) negli slot
// letti da get_last_error() / get_errno(). Solo dal main thread.
void FFIFunction::PublishErrorState(uint32_t last_error, int last_errno) {
  if (capture_last_error_) {
    last_error_ = last_error;
    if (addon_) {
      addon_->captured_last_error = last_error;
    }
  }
  if (capture_errno_) {
    last_errno_ = last_errno;
    if (addon_) {
      addon_->captured_errno = last_errno;
    }
  }
}

Napi::Value FFIFunction::StructResult(const void* bytes) {
  memcpy(struct_result_data_, bytes, return_struct_info_->GetSize());
  return struct_result_.Value();
}

// Convert return value e applica errcheck se presente.
CTYPES_ALWAYS_INLINE Napi::Value FFIFunction::FinalizeCall(CallContext& ctx) {
  Napi::Value result = struct_result_data_ != nullptr
                         ? StructResult(ctx.return_ptr)
                         : ConvertReturn(ctx.env, ctx.return_ptr, return_type_, return_struct_info_, return_array_info_,
                                         struct_as_buffer_, scalar_as_buffer_);
  if (ctx.errcheck == nullptr) [[likely]] {
    return result;
  }
  return ApplyErrcheck(ctx.env, result, ctx.info, *ctx.errcheck);
}

VariadicCifCache* FFIFunction::AcquireVariadicCif(Napi::Env env,
                                                  size_t argc,
                                                  const CType* extra_types,
                                                  size_t num_extra,
                                                  std::optional<VariadicCifCache>& fallback) {
  for (VariadicCifCache& entry : variadic_cache_) {
    if (entry.valid && entry.total_args == argc && entry.extra_types.size() == num_extra &&
        std::equal(extra_types, extra_types + num_extra, entry.extra_types.begin())) {
      return &entry;
    }
  }

  // Cache miss: ricostruisce uno slot (round-robin) non usato da una chiamata
  // in corso; se sono tutti in uso (chiamate rientranti) il CIF è locale.
  VariadicCifCache* target = nullptr;
  for (size_t attempt = 0; attempt < MAX_CACHED_VARIADIC_CIFS && target == nullptr; attempt++) {
    VariadicCifCache& candidate = variadic_cache_[next_cache_slot_];
    next_cache_slot_ = (next_cache_slot_ + 1) % MAX_CACHED_VARIADIC_CIFS;
    if (candidate.in_use == 0) {
      target = &candidate;
    }
  }
  if (target == nullptr) [[unlikely]] {
    target = &fallback.emplace();
  }

  VariadicCifCache& entry = *target;
  const size_t fixed_args = arg_types_.size();
  entry.valid = false;
  entry.ResetPlan();
  entry.total_args = argc;
  entry.extra_types.assign(extra_types, extra_types + num_extra);
  entry.ffi_types.resize(argc);
  std::copy(ffi_arg_types_.begin(), ffi_arg_types_.end(), entry.ffi_types.begin());
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
    return nullptr;
  }

  entry.plan = ffi_call_plan_alloc(&entry.cif);
  entry.valid = true;
  return &entry;
}

// Firme semplici (simple_call_): slot e risultato sullo stack, senza
// CallContext, scratch e cache variadica. Le stringhe corte vanno nel buffer
// inline dell'istanza, come in Call(); una stringa che non ci sta e le chiamate
// rientranti passano a Call() prima di qualunque effetto.
template <typename Args, bool HasErrcheck>
  requires(std::same_as<Args, Napi::CallbackInfo> || std::same_as<Args, FunctionArguments>)
bool FFIFunction::SimpleCall(const Args& info, Napi::Value& result, const Napi::Function* errcheck) {
  // Chiamata rientrante: il buffer inline delle stringhe è della chiamata esterna.
  if (call_depth_ != 0) [[unlikely]] {
    return false;
  }
  const size_t argc = info.Length();
  const size_t expected_argc = arg_types_.size();
  if (argc > kMaxSimpleArgs) [[unlikely]] {
    return false;
  }
  Napi::Env env = info.Env();
  const LibraryCallScope library_scope(library_, env);
  alignas(16) std::array<uint64_t, kMaxSimpleArgs*(ARG_SLOT_SIZE / sizeof(uint64_t))> slots;
  std::array<void*, kMaxSimpleArgs> values;
  // Argomenti variadici (oltre argtypes): tipo dedotto dal valore, come Call().
  std::array<CType, kMaxSimpleArgs> extra_types;
  const size_t num_extra = argc - expected_argc;
  size_t string_offset = 0;

  for (size_t i = 0; i < argc; i++) {
    uint8_t* slot = reinterpret_cast<uint8_t*>(slots.data()) + i * ARG_SLOT_SIZE;
    values[i] = slot;
    Napi::Value val = info[i];
    CType type;
    if (i < expected_argc) [[likely]] {
      type = arg_types_[i];
    } else {
      const VariadicValue extra = InferVariadic(val);
      type = extra.type;
      val = extra.value;
      extra_types[i - expected_argc] = type;
      if (!IsSimpleArgumentType(type)) {
        return false;
      }
    }
    try {
      if (MarshalPrimitive(val, type, slot)) [[likely]] {
        continue;
      }
      // Puntatori e stringhe con il minimo di chiamate a V8 (napi_typeof è
      // una sequenza di test, e per gli oggetti tra i più lenti): per
      // c_char_p prima la copia della stringa, poi la memoria di una vista
      // (Buffer, TypedArray), poi il tipo.
      void* ptr = nullptr;
      char* dest = inline_strings_.data() + string_offset;
      const size_t capacity = kInlineStringBufferSize - string_offset;
      bool is_string = false;
      std::optional<size_t> copied;
      if (type == CType::CTYPES_STRING) {
        copied = napi_fast::TryCopyUtf8IfString(val, std::span(dest, capacity), is_string);
      }
      if (!is_string) {
        ptr = napi_fast::TryViewData(val);
        if (ptr == nullptr) {
          const napi_valuetype kind = val.Type();
          if (kind == napi_string) {
            // Python: c_void_p accetta anche bytes/str.
            is_string = true;
            copied = napi_fast::TryCopyUtf8Into(val.As<Napi::String>(), std::span(dest, capacity));
          } else {
            ptr = PointerArg(val, kind, type);
          }
        }
      }
      if (is_string) {
        if (!copied) {
          return false;
        }
        string_offset += *copied + 1;
        ptr = dest;
      }
      memcpy(slot, &ptr, sizeof(ptr));
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }
  }

  // CIF della chiamata variadica: dalla cache, con lo slot segnato in uso così
  // che una chiamata rientrante (da un callback) non lo ricostruisca.
  VariadicCifCache* cache_entry = nullptr;
  std::optional<VariadicCifCache> fallback_entry;
  if (num_extra != 0) {
    cache_entry = AcquireVariadicCif(env, argc, extra_types.data(), num_extra, fallback_entry);
    if (cache_entry == nullptr) {
      result = env.Undefined();
      return true;
    }
  }
  const CountScope cache_scope(cache_entry != nullptr ? &cache_entry->in_use : nullptr);

  const CountScope depth_scope(&call_depth_);
  // Valore restituito: primitivo, o i byte di una struct fino a kMaxSimpleStructReturn.
  alignas(16) std::array<std::byte, kMaxSimpleStructReturn> return_storage{};
  void* const return_value = return_storage.data();
  const SavedErrorState saved_errors = SwapInErrorState();
  if (cache_entry != nullptr) {
    if (cache_entry->plan) {
      ffi_call_plan_invoke(cache_entry->plan, FFI_FN(fn_ptr_), return_value, values.data());
    } else {
      ffi_call(&cache_entry->cif, FFI_FN(fn_ptr_), return_value, values.data());
    }
  } else if (direct_invoker_) [[likely]] {
    direct_invoker_(fn_ptr_, values.data(), return_value);
  } else if (call_plan_) {
    ffi_call_plan_invoke(call_plan_, FFI_FN(fn_ptr_), return_value, values.data());
  } else {
    ffi_call(&cif_, FFI_FN(fn_ptr_), return_value, values.data());
  }
  CaptureErrorState(saved_errors);

  if (scalar_as_buffer_) {
    result = ConvertReturn(env, return_value, return_type_, return_struct_info_, return_array_info_, false, true);
  } else {
    switch (return_type_) {
      case CType::CTYPES_VOID:
        result = env.Undefined();
        break;
      case CType::CTYPES_INT32:
        result = napi_fast::Int32(env, LoadAs<int32_t>(return_value));
        break;
      case CType::CTYPES_UINT32:
        result = napi_fast::Uint32(env, LoadAs<uint32_t>(return_value));
        break;
      case CType::CTYPES_DOUBLE:
        result = Napi::Number::New(env, LoadAs<double>(return_value));
        break;
      case CType::CTYPES_STRUCT:
        result = StructResult(return_value);
        break;
      default:
        result =
          ConvertReturn(env, return_value, return_type_, return_struct_info_, return_array_info_, struct_as_buffer_);
        break;
    }
  }
  if constexpr (HasErrcheck) {
    if (errcheck != nullptr) [[unlikely]] {
      result = ApplyErrcheck(env, result, FunctionArguments{info}, *errcheck);
    }
  }
  return true;
}

Napi::Value FFIFunction::Call(const Napi::CallbackInfo& info) {
  const Napi::Function errcheck = SnapshotErrcheck();
  return CallArguments(FunctionArguments{info}, errcheck.IsEmpty() ? nullptr : &errcheck);
}

Napi::Value FFIFunction::CallArguments(const FunctionArguments& info, const Napi::Function* errcheck) {
  Napi::Env env = info.Env();

  size_t argc;
  bool need_reprep = false;
  if (!ValidateAndResolveArgc(env, info, argc, need_reprep)) {
    return env.Undefined();
  }
  const LibraryCallScope library_scope(library_, env);
  const size_t expected_argc = arg_types_.size();

  // Una chiamata rientrante (da un callback durante la chiamata a questa
  // stessa funzione) non può toccare i buffer della chiamata esterna: usa
  // stringhe e scratch propri, sullo stack di questo frame.
  struct NestedCallState {
    CallScratch scratch;
    alignas(16) std::array<char, kInlineStringBufferSize> strings;
  };
  std::optional<NestedCallState> nested;
  CallScratch* scratch = &scratch_;
  char* inline_strings = inline_strings_.data();
  if (call_depth_ != 0) [[unlikely]] {
    NestedCallState& state = nested.emplace();
    scratch = &state.scratch;
    inline_strings = state.strings.data();
  }
  const CountScope depth_scope(&call_depth_);
  scratch->Reset();

  // =====================================================================
  // Gestione variadic ottimizzata (ispirata a CPython ctypes)
  // =====================================================================
  ffi_cif* active_cif = &cif_;
  ffi_call_plan* active_plan = call_plan_;
  VariadicCifCache* cache_entry = nullptr;
  std::optional<VariadicCifCache> fallback_entry;
  size_t num_extra = 0;  // Numero di argomenti extra variadic

  // Stack-allocated array per piccoli numeri di argomenti extra (come alloca in CPython)
  std::array<CType, MAX_VARIADIC_EXTRA_ARGS> extra_types_stack;
  std::vector<CType> extra_types_heap;
  CType* extra_types = nullptr;
  // Valori degli argomenti extra (un'istanza SimpleCData passa il suo valore).
  std::array<Napi::Value, MAX_VARIADIC_EXTRA_ARGS> extra_values_stack;
  std::vector<Napi::Value> extra_values_heap;
  Napi::Value* extra_values = nullptr;

  if (need_reprep) {
    num_extra = argc - expected_argc;
    if (num_extra <= MAX_VARIADIC_EXTRA_ARGS) {
      extra_types = extra_types_stack.data();
      extra_values = extra_values_stack.data();
    } else {
      extra_types_heap.resize(num_extra);
      extra_values_heap.resize(num_extra);
      extra_types = extra_types_heap.data();
      extra_values = extra_values_heap.data();
    }
    for (size_t i = 0; i < num_extra; i++) {
      const VariadicValue extra = InferVariadic(info[expected_argc + i]);
      extra_types[i] = extra.type;
      extra_values[i] = extra.value;
    }

    cache_entry = AcquireVariadicCif(env, argc, extra_types, num_extra, fallback_entry);
    if (cache_entry == nullptr) {
      return env.Undefined();
    }
    active_cif = &cache_entry->cif;
    active_plan = cache_entry->plan;
  }
  const CountScope cache_scope(cache_entry != nullptr ? &cache_entry->in_use : nullptr);

  // =====================================================================
  // Stato della chiamata: slot e return value sullo stack.
  // =====================================================================
  alignas(16) std::array<uint8_t, MAX_INLINE_ARGS * ARG_SLOT_SIZE> inline_arg_storage;
  std::array<void*, MAX_INLINE_ARGS> inline_arg_values;
  alignas(16) ReturnValue return_value{};

  CallContext ctx{env, info};
  ctx.errcheck = errcheck;
  ctx.argc = argc;
  ctx.expected_argc = expected_argc;
  ctx.active_cif = active_cif;
  ctx.active_plan = active_plan;
  ctx.cache_entry = cache_entry;
  ctx.num_extra = num_extra;
  ctx.extra_types_ptr = extra_types;
  ctx.extra_values = extra_values;
  ctx.scratch = scratch;
  ctx.inline_strings = inline_strings;
  ctx.return_value = &return_value;

  // ---- Select arg storage (inline vs heap) --------------------------
  if (argc <= MAX_INLINE_ARGS) [[likely]] {
    ctx.arg_storage = inline_arg_storage.data();
    ctx.arg_values = inline_arg_values.data();
  } else {
    const size_t required_size = argc * ARG_SLOT_SIZE;
    if (scratch->arg_storage.size() < required_size) {
      scratch->arg_storage.resize(required_size);
    }
    if (scratch->arg_values.size() < argc) {
      scratch->arg_values.resize(argc);
    }
    ctx.arg_storage = scratch->arg_storage.data();
    ctx.arg_values = scratch->arg_values.data();
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
    const SavedErrorState saved_errors = SwapInErrorState();
    direct_invoker_(fn_ptr_, ctx.arg_values, ctx.return_ptr);
    CaptureErrorState(saved_errors);
  } else {
    const SavedErrorState saved_errors = SwapInErrorState();
    if (ctx.active_plan) [[likely]] {
      ffi_call_plan_invoke(ctx.active_plan, FFI_FN(fn_ptr_), ctx.return_ptr, ctx.arg_values);
    } else {
      ffi_call(ctx.active_cif, FFI_FN(fn_ptr_), ctx.return_ptr, ctx.arg_values);
    }
    CaptureErrorState(saved_errors);
  }

  // ---- Convert return + apply errcheck -----------------------------
  return FinalizeCall(ctx);
}

Napi::Value FFIFunction::SetErrcheck(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const Napi::Value callback = info.Length() == 0 ? env.Null() : info[0];
  if (!callback.IsFunction() && !callback.IsNull()) {
    Napi::TypeError::New(env, "errcheck must be a function or null").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (callback.IsNull() && errcheck_callback_.IsEmpty()) {
    return env.Undefined();
  }
  if (addon_ == nullptr) {
    throw Napi::Error::New(env, "Addon not properly initialized");
  }
  Napi::FunctionReference next =
    callback.IsNull() ? Napi::FunctionReference() : Napi::Weak(callback.As<Napi::Function>());
  if (callback.IsNull()) {
    addon_->errcheck_owner_delete.Call(addon_->errcheck_owners.Value(), {Value()});
  } else {
    addon_->errcheck_owner_set.Call(addon_->errcheck_owners.Value(), {Value(), callback});
  }
  errcheck_callback_ = std::move(next);

  return env.Undefined();
}

Napi::Value FFIFunction::ApplyErrcheck(Napi::Env env,
                                       Napi::Value result,
                                       const FunctionArguments& info,
                                       const Napi::Function& errcheck) {
  if (info.HasResultHandler()) {
    return errcheck.Call(env.Undefined(), {result});
  }

  // errcheck(result, this, args). Un'eccezione lanciata da errcheck diventa
  // Napi::Error (NAPI_CPP_EXCEPTIONS) e si propaga al caller JS.
  Napi::Array args_array = Napi::Array::New(env, info.Length());
  for (size_t i = 0; i < info.Length(); i++) {
    args_array.Set(static_cast<uint32_t>(i), info[i]);
  }
  return errcheck.Call(env.Undefined(), {result, Value(), args_array});
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
  const Napi::Function errcheck = SnapshotErrcheck();
  return CallAsyncArguments(FunctionArguments{info}, errcheck.IsEmpty() ? nullptr : &errcheck);
}

Napi::Value FFIFunction::CallAsyncArguments(const FunctionArguments& info, const Napi::Function* errcheck) {
  Napi::Env env = info.Env();

  size_t argc;
  bool is_variadic = false;
  if (!ValidateAndResolveArgc(env, info, argc, is_variadic)) {
    return env.Undefined();
  }
  const LibraryCallScope library_scope(library_, env);
  const size_t expected_argc = arg_types_.size();

  // ---- Validate argc (shared with Call sync, done above) -----------
  //       fatto da ValidateAndResolveArgc sopra.

  // ---- Infer types for extra variadic args -------------------------
  // =====================================================================
  // Tipi per argomenti extra variadic (inferiti dai valori JS)
  // =====================================================================
  std::vector<CType> extra_types;
  std::vector<Napi::Value> extra_values;
  if (is_variadic) {
    extra_types.reserve(argc - expected_argc);
    extra_values.reserve(argc - expected_argc);
    for (size_t i = expected_argc; i < argc; i++) {
      const VariadicValue extra = InferVariadic(info[i]);
      extra_types.push_back(extra.type);
      extra_values.push_back(extra.value);
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
    const Napi::Value val = (i < expected_argc) ? info[i] : extra_values[i - expected_argc];
    if (i >= expected_argc && info[i].IsObject()) {
      buffer_refs.push_back(Napi::Persistent(info[i].As<Napi::Object>()));
    }
    if (val.IsObject()) {
      buffer_refs.push_back(Napi::Persistent(val.As<Napi::Object>()));
    }

    // Fast path: primitive types (shared implementation)
    try {
      if (MarshalPrimitive(val, type, slot)) {
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
            ptr = ObjectData(val, type);
          } else if (val.IsBigInt()) {
            bool lossless;
            ptr = reinterpret_cast<void*>(val.As<Napi::BigInt>().Uint64Value(&lossless));
          } else if (val.IsNumber()) {
            ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value()));
          } else if (val.IsBoolean()) {
            ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(val.As<Napi::Boolean>().Value()));
          } else {
            ThrowWrongType(val, type);
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
            const char* ptr = static_cast<const char*>(ObjectData(val, type));
            memcpy(slot, &ptr, sizeof(ptr));
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
            ThrowWrongType(val, type);
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

            Utf16ToWide(u16str,
                        std::span(reinterpret_cast<wchar_t*>(async_string_buffer.data() + offset), u16str.size() + 1));

            const wchar_t* str_ptr = reinterpret_cast<const wchar_t*>(async_string_buffer.data() + offset);
            memcpy(slot, &str_ptr, sizeof(str_ptr));

            wstring_fixups.emplace_back(i, offset);
          } else if (val.IsObject()) {
            const wchar_t* ptr = static_cast<const wchar_t*>(ObjectData(val, type));
            memcpy(slot, &ptr, sizeof(ptr));
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
            ThrowWrongType(val, type);
          }
          break;
        }

        case CType::CTYPES_STRUCT: {
          if (i < expected_argc && arg_struct_infos_[i]) {
            if (!MarshalStructArg(env, val, i, arg_struct_infos_[i], slot, &async_arg_values[i], large_arg_buffers,
                                  &large_arg_indices, &buffer_refs)) {
              return env.Undefined();
            }
          } else {
            MarshalOther(val, type, slot);
          }
          break;
        }

        case CType::CTYPES_ARRAY: {
          if (i < expected_argc && arg_array_infos_[i]) {
            if (!MarshalArrayArg(env, val, i, arg_array_infos_[i], slot, &async_arg_values[i], large_arg_buffers,
                                 &large_arg_indices, &buffer_refs)) {
              return env.Undefined();
            }
          } else {
            MarshalOther(val, type, slot);
          }
          break;
        }

        default:
          MarshalOther(val, type, slot);
          break;
      }
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }
  }

  // =====================================================================
  // ---- Create worker, move buffers, return Promise ----------------
  // =====================================================================

  auto worker = std::make_unique<CallWorker>(
    env, this, &cif_, fn_ptr_, return_type_, return_struct_info_, return_array_info_, std::move(async_arg_storage),
    std::move(async_arg_values), std::move(async_string_buffer), std::move(string_fixups), std::move(wstring_fixups),
    std::move(buffer_refs), std::move(owned_cif), std::move(owned_ffi_types), std::move(large_arg_buffers),
    std::move(large_arg_indices), errcheck, info.HasResultHandler());

  if (errcheck != nullptr && !info.HasResultHandler()) {
    worker->KeepArguments(info);
  }

  Napi::Promise promise = worker->GetPromise();
  worker->Queue();
  worker.release();

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
                                    const Napi::Function* errcheck,
                                    bool result_handler)
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
    errcheck_ref_(errcheck == nullptr ? Napi::FunctionReference() : Napi::Persistent(*errcheck)),
    result_handler_(result_handler),
    capture_last_error_(parent->capture_last_error_),
    capture_errno_(parent->capture_errno_),
    struct_as_buffer_(parent->struct_as_buffer_),
    scalar_as_buffer_(parent->scalar_as_buffer_) {
  if (parent->addon_ != nullptr) {
    last_error_in_ = parent->addon_->captured_last_error;
    errno_in_ = parent->addon_->captured_errno;
  }

  return_value_ = {};

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
  ffi_function_->Ref();
  if (ffi_function_->library_ != nullptr) {
    ffi_function_->library_->BeginCall();
  }
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

void FFIFunction::CallWorker::KeepArguments(const FunctionArguments& info) {
  Napi::Array args = Napi::Array::New(info.Env(), info.Length());
  for (size_t i = 0; i < info.Length(); i++) {
    args.Set(static_cast<uint32_t>(i), info[i]);
  }
  args_ref_ = Napi::Persistent(args.As<Napi::Object>());
}

FFIFunction::CallWorker::~CallWorker() {
  if (ffi_function_->library_ != nullptr) {
    ffi_function_->library_->EndCall();
  }
  ffi_function_->Unref();  // Unpin the FFIFunction instance
}

void FFIFunction::CallWorker::Execute() {
  // *** WORKER THREAD - Nessun accesso a V8! ***
  try {
    const SavedErrorState saved = SwapErrorStateIn(capture_last_error_, capture_errno_, last_error_in_, errno_in_);
    ffi_call(active_cif_, FFI_FN(fn_ptr_), return_ptr_, arg_values_.empty() ? nullptr : arg_values_.data());
    // Snapshot su questo thread, subito dopo la chiamata (come CaptureErrorState).
    SwapErrorStateOut(capture_last_error_, capture_errno_, saved, last_error_, last_errno_);
  } catch (...) {
    SetError("Native function threw an exception");
  }
}

void FFIFunction::CallWorker::OnOK() {
  // *** MAIN THREAD ***
  Napi::Env env = Env();
  Napi::HandleScope scope(env);

  // get_last_error() / get_errno() see this call, also inside errcheck.
  if (capture_last_error_ || capture_errno_) {
    ffi_function_->PublishErrorState(last_error_, last_errno_);
  }

  try {
    // Riusa ConvertReturn statico (shared con ConvertReturnValue sync)
    Napi::Value result = FFIFunction::ConvertReturn(env, return_ptr_, return_type_, return_struct_info_,
                                                    return_array_info_, struct_as_buffer_, scalar_as_buffer_);

    // Errcheck (se presente)
    if (!errcheck_ref_.IsEmpty()) {
      try {
        if (result_handler_) {
          result = errcheck_ref_.Call({result});
        } else {
          Napi::Value args_array = args_ref_.IsEmpty() ? Napi::Array::New(env, 0) : args_ref_.Value();
          result = errcheck_ref_.Call({result, ffi_function_->Value(), args_array});
        }
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
