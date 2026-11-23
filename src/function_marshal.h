#pragma once

// Helper inline di marshalling, scope di chiamata e gestione errori condivisi
// tra function.cc, function_marshal.cc, function_fast.cc e function_async.cc.

#include "function.h"

namespace ctypes {

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

// Memoria di un argomento staccata (transfer(), transfer list) mentre il codice
// nativo poteva usarla.
[[nodiscard]] bool IsDetachedView(const Napi::Value& value);

inline constexpr const char* kDetachedArgumentMessage =
  "memory was detached (transfer() or a transfer list) while the native call could use it; native code may have "
  "accessed memory no longer owned by this buffer";

inline uintptr_t AddressFromBigInt(const Napi::Value& val) {
  bool lossless;
  return static_cast<uintptr_t>(val.As<Napi::BigInt>().Uint64Value(&lossless));
}

inline uintptr_t AddressFromNumber(const Napi::Value& val) {
  return static_cast<uintptr_t>(IntegerBitsFromDouble(val, val.As<Napi::Number>().DoubleValue()));
}

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

// Un oggetto o una funzione: argomento che solo il JavaScript sa convertire
// (istanze CData, from_param, _as_parameter_, ...).
[[nodiscard]] inline bool IsObjectLike(const Napi::Value& val) {
  const napi_valuetype kind = val.Type();
  return kind == napi_object || kind == napi_function;
}

[[nodiscard]] inline bool HasObjectArgument(const Napi::CallbackInfo& info) {
  for (size_t i = 0; i < info.Length(); i++) {
    if (IsObjectLike(info[i])) {
      return true;
    }
  }
  return false;
}

enum class NumericKind { Integer, Real };

[[noreturn]] inline void ThrowNotNumeric(const Napi::Value& val, NumericKind kind) {
  throw Napi::TypeError::New(val.Env(),
                             kind == NumericKind::Integer
                               ? std::format("'{}' object cannot be interpreted as an integer", JSTypeName(val))
                               : std::format("must be real number, not {}", JSTypeName(val)));
}

// Valori non-number e costruzione ArgumentError: fuori dal percorso caldo (function_marshal.cc).
int64_t IntegerArgSlow(const Napi::Value& val);
double DoubleArgSlow(const Napi::Value& val);
Napi::Error ArgumentErrorFor(Napi::Env env, size_t index, const Napi::Error& cause);

CTYPES_ALWAYS_INLINE int32_t Int32FromNumber(const Napi::Value& val, double d) {
  if (int32_t v; TryExactInt(d, v)) [[likely]] {
    return v;
  }
  return static_cast<int32_t>(static_cast<uint32_t>(IntegerBitsFromDouble(val, d)));
}

CTYPES_ALWAYS_INLINE uint32_t Uint32FromNumber(const Napi::Value& val, double d) {
  if (uint32_t v; TryExactInt(d, v)) [[likely]] {
    return v;
  }
  return static_cast<uint32_t>(IntegerBitsFromDouble(val, d));
}

CTYPES_ALWAYS_INLINE int64_t Int64FromNumber(const Napi::Value& val, double d) {
  if (int64_t v; TryExactInt(d, v)) [[likely]] {
    return v;
  }
  return static_cast<int64_t>(IntegerBitsFromDouble(val, d));
}

CTYPES_ALWAYS_INLINE int32_t Int32Arg(const Napi::Value& val) {
  if (double d; napi_fast::TryDouble(val, d)) [[likely]] {
    return Int32FromNumber(val, d);
  }
  return static_cast<int32_t>(IntegerArgSlow(val));
}

CTYPES_ALWAYS_INLINE uint32_t Uint32Arg(const Napi::Value& val) {
  if (double d; napi_fast::TryDouble(val, d)) [[likely]] {
    return Uint32FromNumber(val, d);
  }
  return static_cast<uint32_t>(IntegerArgSlow(val));
}

CTYPES_ALWAYS_INLINE bool TryInt64Number(const Napi::Value& val, int64_t& out) {
  double d;
  if (!napi_fast::TryDouble(val, d)) {
    return false;
  }
  out = Int64FromNumber(val, d);
  return true;
}

CTYPES_ALWAYS_INLINE int64_t Int64Arg(const Napi::Value& val) {
  if (int64_t v; TryInt64Number(val, v)) [[likely]] {
    return v;
  }
  return IntegerArgSlow(val);
}

CTYPES_ALWAYS_INLINE double DoubleArg(const Napi::Value& val) {
  if (double v; napi_fast::TryDouble(val, v)) [[likely]] {
    return v;
  }
  return DoubleArgSlow(val);
}

CTYPES_ALWAYS_INLINE void StoreVariadicNumber(double number, CType type, uint8_t* slot) {
  if (type == CType::CTYPES_INT32) {
    const int64_t value = static_cast<int32_t>(number);
    memcpy(slot, &value, sizeof(value));
  } else if (type == CType::CTYPES_INT64) {
    const int64_t value = static_cast<int64_t>(number);
    memcpy(slot, &value, sizeof(value));
  } else {
    memcpy(slot, &number, sizeof(number));
  }
}

// Confine Node-API condiviso dagli ingressi nativi grezzi: converte ogni
// eccezione C++ in eccezione JS, come details::WrapCallback di node-addon-api.
template <typename Fn>
CTYPES_ALWAYS_INLINE napi_value GuardNapiCall(napi_env env, Fn&& fn) noexcept {
  try {
    return fn();
  } catch (const Napi::Error& e) {
    e.ThrowAsJavaScriptException();
  } catch (const std::exception& e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
  } catch (...) {
    Napi::Error::New(env, "A native exception was thrown").ThrowAsJavaScriptException();
  }
  return nullptr;
}

// Valore di un argomento nel suo slot (almeno 8 byte), sempre come parola
// intera: gli interi stretti estesi, un float nei 32 bit bassi con zero sopra.
template <typename T>
CTYPES_ALWAYS_INLINE void StoreArgument(uint8_t* slot, T value) noexcept {
  if constexpr (std::is_integral_v<T> && sizeof(T) < sizeof(uint64_t) && std::endian::native == std::endian::little) {
    const uint64_t word =
      std::is_signed_v<T> ? static_cast<uint64_t>(static_cast<int64_t>(value)) : static_cast<uint64_t>(value);
    memcpy(slot, &word, sizeof(word));
  } else if constexpr (std::same_as<T, float> && std::endian::native == std::endian::little) {
    const uint64_t word = std::bit_cast<uint32_t>(value);
    memcpy(slot, &word, sizeof(word));
  } else {
    memcpy(slot, &value, sizeof(value));
  }
}

// Argomento intero dai bit di un BigInt (troncati al tipo).
CTYPES_ALWAYS_INLINE void MarshalIntegerBits(uint64_t bits, CType type, uint8_t* slot) {
  switch (type) {
    case CType::CTYPES_INT8:
      StoreArgument(slot, static_cast<int8_t>(bits));
      break;
    case CType::CTYPES_UINT8:
      StoreArgument(slot, static_cast<uint8_t>(bits));
      break;
    case CType::CTYPES_INT16:
      StoreArgument(slot, static_cast<int16_t>(bits));
      break;
    case CType::CTYPES_UINT16:
      StoreArgument(slot, static_cast<uint16_t>(bits));
      break;
    case CType::CTYPES_INT32:
      StoreArgument(slot, static_cast<int32_t>(static_cast<uint32_t>(bits)));
      break;
    case CType::CTYPES_UINT32:
      StoreArgument(slot, static_cast<uint32_t>(bits));
      break;
    case CType::CTYPES_LONG:
      StoreArgument(slot, static_cast<long>(bits));
      break;
    case CType::CTYPES_ULONG:
      StoreArgument(slot, static_cast<unsigned long>(bits));
      break;
    default:
      memcpy(slot, &bits, sizeof(bits));
      break;
  }
}

CTYPES_ALWAYS_INLINE void MarshalNumber(const Napi::Value& val, double d, CType type, uint8_t* slot) {
  switch (type) {
    case CType::CTYPES_INT8:
      StoreArgument(slot, static_cast<int8_t>(Int32FromNumber(val, d)));
      break;
    case CType::CTYPES_UINT8:
      StoreArgument(slot, static_cast<uint8_t>(Uint32FromNumber(val, d)));
      break;
    case CType::CTYPES_INT16:
      StoreArgument(slot, static_cast<int16_t>(Int32FromNumber(val, d)));
      break;
    case CType::CTYPES_UINT16:
      StoreArgument(slot, static_cast<uint16_t>(Uint32FromNumber(val, d)));
      break;
    case CType::CTYPES_INT32:
      StoreArgument(slot, Int32FromNumber(val, d));
      break;
    case CType::CTYPES_UINT32:
      StoreArgument(slot, Uint32FromNumber(val, d));
      break;
    case CType::CTYPES_LONG:
      StoreArgument(slot, static_cast<long>(Int64FromNumber(val, d)));
      break;
    case CType::CTYPES_ULONG:
      StoreArgument(slot, static_cast<unsigned long>(Int64FromNumber(val, d)));
      break;
    case CType::CTYPES_FLOAT:
      StoreArgument(slot, static_cast<float>(d));
      break;
    case CType::CTYPES_DOUBLE:
      StoreArgument(slot, d);
      break;
    default: {
      const int64_t v = Int64FromNumber(val, d);
      memcpy(slot, &v, sizeof(v));
      break;
    }
  }
}

// Conversione diretta dei ritorni scalari/puntatore (stesse regole di CToJS).
[[nodiscard]] CTYPES_ALWAYS_INLINE Napi::Value ReturnScalar(Napi::Env env, CType type, const void* ret) {
  switch (type) {
    case CType::CTYPES_VOID:
      return env.Undefined();
    case CType::CTYPES_BOOL:
      return Napi::Boolean::New(env, LoadAs<uint8_t>(ret) != 0);
    case CType::CTYPES_INT8:
      return napi_fast::Int32(env, LoadAs<int8_t>(ret));
    case CType::CTYPES_UINT8:
      return napi_fast::Uint32(env, LoadAs<uint8_t>(ret));
    case CType::CTYPES_INT16:
      return napi_fast::Int32(env, LoadAs<int16_t>(ret));
    case CType::CTYPES_UINT16:
      return napi_fast::Uint32(env, LoadAs<uint16_t>(ret));
    case CType::CTYPES_INT32:
      return napi_fast::Int32(env, LoadAs<int32_t>(ret));
    case CType::CTYPES_UINT32:
      return napi_fast::Uint32(env, LoadAs<uint32_t>(ret));
    case CType::CTYPES_INT64:
      return Napi::BigInt::New(env, LoadAs<int64_t>(ret));
    case CType::CTYPES_UINT64:
      return Napi::BigInt::New(env, LoadAs<uint64_t>(ret));
    case CType::CTYPES_SIZE_T:
      return Napi::BigInt::New(env, static_cast<uint64_t>(LoadAs<size_t>(ret)));
    case CType::CTYPES_SSIZE_T:
      return Napi::BigInt::New(env, static_cast<int64_t>(LoadAs<ssize_t>(ret)));
    case CType::CTYPES_LONG:
      return Napi::BigInt::New(env, static_cast<int64_t>(LoadAs<long>(ret)));
    case CType::CTYPES_ULONG:
      return Napi::BigInt::New(env, static_cast<uint64_t>(LoadAs<unsigned long>(ret)));
    case CType::CTYPES_FLOAT:
      return Napi::Number::New(env, LoadAs<float>(ret));
    case CType::CTYPES_DOUBLE:
      return Napi::Number::New(env, LoadAs<double>(ret));
    case CType::CTYPES_POINTER: {
      void* const ptr = LoadAs<void*>(ret);
      return ptr == nullptr ? env.Null() : Napi::BigInt::New(env, reinterpret_cast<uint64_t>(ptr));
    }
    default:
      return CToJS(env, ret, type);
  }
}

// Chiamata diretta R(const void*) per funzioni a 1 argomento puntatore/stringa
// su ABI 64-bit predefinita (stesso registro intero di frame_call.h, senza frame).
CTYPES_ALWAYS_INLINE void InvokeUnaryPointer(void* fn, CType return_type, const void* ptr, void* ret) {
  switch (return_type) {
    case CType::CTYPES_VOID:
      reinterpret_cast<void (*)(const void*)>(fn)(ptr);
      break;
    case CType::CTYPES_BOOL:
      StoreReturnValue(ret, reinterpret_cast<bool (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_INT8:
      StoreReturnValue(ret, reinterpret_cast<int8_t (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_UINT8:
      StoreReturnValue(ret, reinterpret_cast<uint8_t (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_INT16:
      StoreReturnValue(ret, reinterpret_cast<int16_t (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_UINT16:
      StoreReturnValue(ret, reinterpret_cast<uint16_t (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_INT32:
      StoreReturnValue(ret, reinterpret_cast<int32_t (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_UINT32:
      StoreReturnValue(ret, reinterpret_cast<uint32_t (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_INT64:
    case CType::CTYPES_SSIZE_T:
      StoreReturnValue(ret, reinterpret_cast<int64_t (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_UINT64:
    case CType::CTYPES_SIZE_T:
    case CType::CTYPES_POINTER:
      StoreReturnValue(ret, reinterpret_cast<uint64_t (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_LONG:
      StoreReturnValue(ret, reinterpret_cast<long (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_ULONG:
      StoreReturnValue(ret, reinterpret_cast<unsigned long (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_FLOAT:
      StoreReturnValue(ret, reinterpret_cast<float (*)(const void*)>(fn)(ptr));
      break;
    case CType::CTYPES_DOUBLE:
      StoreReturnValue(ret, reinterpret_cast<double (*)(const void*)>(fn)(ptr));
      break;
    default:
      break;
  }
}

// Scambio errno / GetLastError() condiviso tra percorso sincrono e PreparedCall::Run().
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

template <ArgumentList Args>
inline void FFIFunction::ThrowIfArgumentDetached(const Args& info, uint32_t memory) {
  for (size_t i = 0; memory != 0; i++, memory >>= 1) {
    if ((memory & 1) != 0 && IsDetachedView(info[i])) {
      throw Napi::Error::New(info.Env(), std::format("argument {}: {}", i + 1, kDetachedArgumentMessage));
    }
  }
}

template <ArgumentList Args>
inline void FFIFunction::ThrowIfArgumentDetached(const Args& info) {
  for (size_t i = 0; i < info.Length(); i++) {
    if (IsDetachedView(info[i])) {
      throw Napi::Error::New(info.Env(), std::format("argument {}: {}", i + 1, kDetachedArgumentMessage));
    }
  }
}

// MarshalPrimitive condiviso da Call(), SimpleCall() e PrepareAsyncCall().
CTYPES_ALWAYS_INLINE bool FFIFunction::MarshalPrimitive(const Napi::Value& val,
                                                        CType type,
                                                        uint8_t* slot,
                                                        bool* memory) {
  switch (type) {
    case CType::CTYPES_INT32: {
      StoreArgument(slot, Int32Arg(val));
      return true;
    }
    case CType::CTYPES_UINT32: {
      StoreArgument(slot, Uint32Arg(val));
      return true;
    }
    case CType::CTYPES_INT64:
    case CType::CTYPES_UINT64:
    case CType::CTYPES_SIZE_T:
    case CType::CTYPES_SSIZE_T: {
      // number con una sola chiamata; poi una sola Value::Type() per gli altri.
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
        case napi_object:
          // Estensione node-ctypes: Buffer/ArrayBuffer passano il loro indirizzo.
          if (val.IsBuffer()) {
            v = static_cast<int64_t>(reinterpret_cast<intptr_t>(val.As<Napi::Buffer<uint8_t>>().Data()));
            if (memory != nullptr) {
              *memory = true;
            }
            break;
          }
          if (val.IsArrayBuffer()) {
            v = static_cast<int64_t>(reinterpret_cast<intptr_t>(val.As<Napi::ArrayBuffer>().Data()));
            if (memory != nullptr) {
              *memory = true;
            }
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
      StoreArgument(slot, static_cast<float>(DoubleArg(val)));
      return true;
    }
    case CType::CTYPES_BOOL: {
      bool b;
      if (!napi_fast::TryBool(val, b)) {
        b = val.ToBoolean().Value();
      }
      StoreArgument(slot, static_cast<uint8_t>(b ? 1 : 0));
      return true;
    }
    case CType::CTYPES_CHAR: {
      StoreArgument(slot, static_cast<char>(CharFromJS(val)));
      return true;
    }
    case CType::CTYPES_WCHAR: {
      StoreArgument(slot, WcharFromJS(val));
      return true;
    }
    case CType::CTYPES_INT8: {
      StoreArgument(slot, static_cast<int8_t>(Int32Arg(val)));
      return true;
    }
    case CType::CTYPES_UINT8: {
      StoreArgument(slot, static_cast<uint8_t>(Uint32Arg(val)));
      return true;
    }
    case CType::CTYPES_INT16: {
      StoreArgument(slot, static_cast<int16_t>(Int32Arg(val)));
      return true;
    }
    case CType::CTYPES_UINT16: {
      StoreArgument(slot, static_cast<uint16_t>(Uint32Arg(val)));
      return true;
    }
    case CType::CTYPES_LONG: {
      StoreArgument(slot, static_cast<long>(Int64Arg(val)));
      return true;
    }
    case CType::CTYPES_ULONG: {
      StoreArgument(slot, static_cast<unsigned long>(Int64Arg(val)));
      return true;
    }
    default:
      return false;
  }
}

}  // namespace ctypes
