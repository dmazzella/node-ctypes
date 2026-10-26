#include "types.h"

#include <charconv>

namespace ctypes {
CType CTypeFromJS(const Napi::Value& value) {
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(value.Env(), "Type must be a CType enum value (number)");
  }
  const int32_t raw = value.As<Napi::Number>().Int32Value();
  const std::optional<CType> type = ToCType(raw);
  if (!type) {
    throw Napi::TypeError::New(value.Env(), std::format("Invalid CType value: {}", raw));
  }
  return *type;
}

// ============================================================================
// JSToC - Converte valore JS in bytes C
// ============================================================================

namespace {

// Bit di un valore intero: BigInt troncato, number intero mascherato o boolean.
uint64_t IntegerBits(const Napi::Value& value) {
  if (value.IsBigInt()) {
    bool lossless;
    return value.As<Napi::BigInt>().Uint64Value(&lossless);
  }
  if (value.IsBoolean()) {
    return value.As<Napi::Boolean>().Value() ? 1 : 0;
  }
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(value.Env(),
                               std::format("'{}' object cannot be interpreted as an integer", JSTypeName(value)));
  }
  const double d = value.As<Napi::Number>().DoubleValue();
  if (d >= -9223372036854775808.0 && d < 9223372036854775808.0) {
    if (const auto v = static_cast<int64_t>(d); static_cast<double>(v) == d) {
      return static_cast<uint64_t>(v);
    }
  }
  return IntegerBitsFromDouble(value, d);
}

}  // namespace

uint64_t IntegerBitsFromDouble(const Napi::Value& value, double d) {
  if (!std::isfinite(d) || d != std::trunc(d)) {
    throw Napi::TypeError::New(value.Env(), "'float' object cannot be interpreted as an integer");
  }
  constexpr double kTwo64 = 18446744073709551616.0;
  // Sommare 2^64 ai negativi piccoli arrotonderebbe al limite non convertibile.
  const uint64_t magnitude = static_cast<uint64_t>(std::fmod(std::abs(d), kTwo64));
  return d < 0 ? uint64_t{0} - magnitude : magnitude;
}

std::string JSTypeName(const Napi::Value& value) {
  switch (value.Type()) {
    case napi_undefined:
      return "undefined";
    case napi_null:
      return "null";
    case napi_boolean:
      return "boolean";
    case napi_number:
      return "number";
    case napi_string:
      return "string";
    case napi_symbol:
      return "symbol";
    case napi_function:
      return "function";
    case napi_bigint:
      return "bigint";
    default:
      break;
  }
  if (value.IsBuffer()) {
    return "Buffer";
  }
  Napi::Value ctor = value.As<Napi::Object>().Get("constructor");
  if (ctor.IsFunction()) {
    Napi::Value name = ctor.As<Napi::Object>().Get("name");
    if (name.IsString() && !name.As<Napi::String>().Utf8Value().empty()) {
      return name.As<Napi::String>().Utf8Value();
    }
  }
  return "object";
}

double RealFromJS(const Napi::Value& value) {
  switch (value.Type()) {
    case napi_number:
      return value.As<Napi::Number>().DoubleValue();
    case napi_boolean:
      return value.As<Napi::Boolean>().Value() ? 1.0 : 0.0;
    case napi_bigint: {
      bool lossless;
      const int64_t signed_value = value.As<Napi::BigInt>().Int64Value(&lossless);
      if (lossless) {
        return static_cast<double>(signed_value);
      }
      const uint64_t unsigned_value = value.As<Napi::BigInt>().Uint64Value(&lossless);
      if (lossless) {
        return static_cast<double>(unsigned_value);
      }
      const std::string digits = value.ToString().Utf8Value();
      double result;
      const auto [end, error] = std::from_chars(digits.data(), digits.data() + digits.size(), result);
      if (error == std::errc::result_out_of_range) {
        throw Napi::RangeError::New(value.Env(), "int too large to convert to float");
      }
      if (error != std::errc{} || end != digits.data() + digits.size()) {
        throw Napi::TypeError::New(value.Env(), "cannot convert bigint to float");
      }
      return result;
    }
    default:
      throw Napi::TypeError::New(value.Env(), std::format("must be real number, not {}", JSTypeName(value)));
  }
}

namespace {

constexpr std::string_view kCharExpected = "one character bytes, bytearray, or an integer in range(256) expected";
constexpr std::string_view kWcharExpected = "a unicode character expected";
#ifdef _WIN32
constexpr uint32_t kWcharLimit = 0x10000;
#else
constexpr uint32_t kWcharLimit = 0x110000;
#endif

constexpr bool IsHighSurrogate(char16_t c) {
  return c >= 0xD800 && c <= 0xDBFF;
}

constexpr bool IsLowSurrogate(char16_t c) {
  return c >= 0xDC00 && c <= 0xDFFF;
}

}  // namespace

uint8_t CharFromJS(const Napi::Value& value) {
  const Napi::Env env = value.Env();
  switch (value.Type()) {
    case napi_string: {
      const std::u16string str = value.As<Napi::String>().Utf16Value();
      if (str.size() != 1) {
        throw Napi::TypeError::New(env, std::format("{}, not a string of length {}", kCharExpected, str.size()));
      }
      if (str[0] > 0xff) {
        throw Napi::TypeError::New(env, "character not in range(256)");
      }
      return static_cast<uint8_t>(str[0]);
    }
    case napi_number: {
      const double d = value.As<Napi::Number>().DoubleValue();
      if (!std::isfinite(d) || std::trunc(d) != d) {
        throw Napi::TypeError::New(env, std::format("{}, not number", kCharExpected));
      }
      if (d < 0 || d > 0xff) {
        throw Napi::TypeError::New(env, "integer not in range(256)");
      }
      return static_cast<uint8_t>(d);
    }
    case napi_boolean:
      return value.As<Napi::Boolean>().Value() ? 1 : 0;
    case napi_object:
      if (value.IsTypedArray()) {
        Napi::TypedArray ta = value.As<Napi::TypedArray>();
        if (ta.TypedArrayType() == napi_uint8_array) {
          if (ta.ElementLength() != 1) {
            throw Napi::TypeError::New(
              env, std::format("{}, not {} of length {}", kCharExpected, JSTypeName(value), ta.ElementLength()));
          }
          return static_cast<const uint8_t*>(ta.ArrayBuffer().Data())[ta.ByteOffset()];
        }
      }
      break;
    default:
      break;
  }
  throw Napi::TypeError::New(env, std::format("{}, not {}", kCharExpected, JSTypeName(value)));
}

wchar_t WcharFromJS(const Napi::Value& value) {
  const Napi::Env env = value.Env();
  if (value.IsString()) {
    const std::u16string str = value.As<Napi::String>().Utf16Value();
    uint32_t cp = 0;
    size_t length = str.size();
    if (str.size() == 1) {
      cp = str[0];
    } else if (str.size() == 2 && IsHighSurrogate(str[0]) && IsLowSurrogate(str[1])) {
      cp = 0x10000 + ((static_cast<uint32_t>(str[0]) - 0xD800) << 10) + (static_cast<uint32_t>(str[1]) - 0xDC00);
      length = cp < kWcharLimit ? 1 : 2;
    }
    if (length != 1) {
      throw Napi::TypeError::New(env, std::format("{}, not a string of length {}", kWcharExpected, length));
    }
    return static_cast<wchar_t>(cp);
  }
  if (value.IsNumber()) {
    const double d = value.As<Napi::Number>().DoubleValue();
    if (std::trunc(d) == d && d >= 0 && d < kWcharLimit) {
      return static_cast<wchar_t>(static_cast<uint32_t>(d));
    }
    throw Napi::TypeError::New(env, std::format("wchar_t code point not in range({:#x})", kWcharLimit));
  }
  throw Napi::TypeError::New(env, std::format("{}, not instance of {}", kWcharExpected, JSTypeName(value)));
}

size_t Utf16ToWide(std::u16string_view in, std::span<wchar_t> out) {
  if (out.empty()) {
    return 0;
  }
  // Al più out.size() - 1 wchar_t, più il terminatore.
  const size_t limit = out.size() - 1;
#ifdef _WIN32
  static_assert(sizeof(wchar_t) == sizeof(char16_t));
  const size_t n = std::min(in.size(), limit);
  std::memcpy(out.data(), in.data(), n * sizeof(wchar_t));
#else
  size_t n = 0;
  for (size_t i = 0; i < in.size() && n < limit; i++) {
    uint32_t cp = in[i];
    if (IsHighSurrogate(in[i]) && i + 1 < in.size() && IsLowSurrogate(in[i + 1])) {
      cp = 0x10000 + ((cp - 0xD800) << 10) + (static_cast<uint32_t>(in[i + 1]) - 0xDC00);
      i++;
    }
    out[n++] = static_cast<wchar_t>(cp);
  }
#endif
  out[n] = L'\0';
  return n;
}

Napi::String WideToJS(Napi::Env env, std::wstring_view str) {
#ifdef _WIN32
  return Napi::String::New(env, reinterpret_cast<const char16_t*>(str.data()), str.size());
#else
  std::u16string out;
  out.reserve(str.size());
  for (const wchar_t wc : str) {
    uint32_t cp = static_cast<uint32_t>(wc);
    if (cp > 0x10FFFF) {
      cp = 0xFFFD;
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      out.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
      out.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
    } else {
      out.push_back(static_cast<char16_t>(cp));
    }
  }
  return Napi::String::New(env, out);
#endif
}

namespace {

// Scrive `value` all'inizio di `out`: i byte scritti, -1 se non ci sta.
template <typename T>
  requires std::is_trivially_copyable_v<T>
int StoreInto(std::span<uint8_t> out, const T& value) {
  if (out.size() < sizeof(T)) {
    return -1;
  }
  std::memcpy(out.data(), &value, sizeof(T));
  return static_cast<int>(sizeof(T));
}

}  // namespace

int JSToC(Napi::Value value, CType type, std::span<uint8_t> out) {
  switch (type) {
    case CType::CTYPES_VOID:
      return 0;

    case CType::CTYPES_CHAR: {
      const uint8_t val = CharFromJS(value);
      return StoreInto(out, val);
    }

    case CType::CTYPES_INT8: {
      int8_t val = static_cast<int8_t>(IntegerBits(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_UINT8: {
      uint8_t val = static_cast<uint8_t>(IntegerBits(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_INT16: {
      int16_t val = static_cast<int16_t>(IntegerBits(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_UINT16: {
      uint16_t val = static_cast<uint16_t>(IntegerBits(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_INT32: {
      int32_t val = static_cast<int32_t>(static_cast<uint32_t>(IntegerBits(value)));
      return StoreInto(out, val);
    }

    case CType::CTYPES_UINT32: {
      uint32_t val = static_cast<uint32_t>(IntegerBits(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_INT64: {
      int64_t val = static_cast<int64_t>(IntegerBits(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_UINT64: {
      uint64_t val = IntegerBits(value);
      return StoreInto(out, val);
    }

    case CType::CTYPES_FLOAT: {
      float val = static_cast<float>(RealFromJS(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_DOUBLE: {
      double val = RealFromJS(value);
      return StoreInto(out, val);
    }

    case CType::CTYPES_POINTER: {
      void* ptr = nullptr;

      if (value.IsNull() || value.IsUndefined()) {
        ptr = nullptr;
      } else if (value.IsBuffer()) {
        ptr = value.As<Napi::Buffer<uint8_t>>().Data();
      } else if (value.IsArrayBuffer()) {
        ptr = value.As<Napi::ArrayBuffer>().Data();
      } else if (value.IsBigInt()) {
        bool lossless;
        uint64_t addr = value.As<Napi::BigInt>().Uint64Value(&lossless);
        ptr = reinterpret_cast<void*>(addr);
      } else if (value.IsBoolean()) {
        ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(value.As<Napi::Boolean>().Value()));
      } else if (value.IsNumber()) {
        ptr = reinterpret_cast<void*>(
          static_cast<uintptr_t>(IntegerBitsFromDouble(value, value.As<Napi::Number>().DoubleValue())));
      } else if (value.IsTypedArray()) {
        const auto view = value.As<Napi::TypedArray>();
        ptr = static_cast<uint8_t*>(view.ArrayBuffer().Data()) + view.ByteOffset();
      } else if (value.IsDataView()) {
        const auto view = value.As<Napi::DataView>();
        ptr = static_cast<uint8_t*>(view.ArrayBuffer().Data()) + view.ByteOffset();
      } else {
        throw Napi::TypeError::New(
          value.Env(), std::format("'{}' object cannot be interpreted as ctypes.c_void_p", JSTypeName(value)));
      }

      return StoreInto(out, ptr);
    }

    case CType::CTYPES_STRING: {
      const char* str = nullptr;

      if (value.IsNull() || value.IsUndefined()) {
        str = nullptr;
      } else if (value.IsBuffer()) {
        str = reinterpret_cast<const char*>(value.As<Napi::Buffer<uint8_t>>().Data());
      } else if (value.IsString()) {
        // NOTA: IsString NON è gestito qui per evitare memory leak.
        // Il chiamante (FFIFunction::Call) deve gestire le stringhe
        // separatamente usando string_storage.
        return -1;
      }

      return StoreInto(out, str);
    }

    case CType::CTYPES_WSTRING: {
      const wchar_t* str = nullptr;

      if (value.IsNull() || value.IsUndefined()) {
        str = nullptr;
      } else if (value.IsBuffer()) {
        str = reinterpret_cast<const wchar_t*>(value.As<Napi::Buffer<uint8_t>>().Data());
      }
      // IsString gestito in FFIFunction::Call

      return StoreInto(out, str);
    }

    case CType::CTYPES_WCHAR: {
      const wchar_t val = WcharFromJS(value);
      return StoreInto(out, val);
    }

    case CType::CTYPES_BOOL: {
      uint8_t val = value.ToBoolean().Value() ? 1 : 0;
      return StoreInto(out, val);
    }

    case CType::CTYPES_SIZE_T: {
      size_t val = static_cast<size_t>(IntegerBits(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_SSIZE_T: {
      ssize_t val = static_cast<ssize_t>(IntegerBits(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_LONG: {
      long val = static_cast<long>(IntegerBits(value));
      return StoreInto(out, val);
    }

    case CType::CTYPES_ULONG: {
      unsigned long val = static_cast<unsigned long>(IntegerBits(value));
      return StoreInto(out, val);
    }

    default:
      // STRUCT/UNION/ARRAY non supportati - usare StructInfo/ArrayInfo
      return -1;
  }
}

// ============================================================================
// CToJS - Converte bytes C in valore JS
// ============================================================================

Napi::Value CToJS(Napi::Env env, const void* buffer, CType type) {
  switch (type) {
    case CType::CTYPES_VOID:
      return env.Undefined();

    case CType::CTYPES_CHAR:
      return Napi::String::New(env, std::u16string(1, static_cast<char16_t>(LoadAs<uint8_t>(buffer))));

    case CType::CTYPES_INT8:
      return Napi::Number::New(env, LoadAs<int8_t>(buffer));

    case CType::CTYPES_UINT8:
      return Napi::Number::New(env, LoadAs<uint8_t>(buffer));

    case CType::CTYPES_INT16:
      return Napi::Number::New(env, LoadAs<int16_t>(buffer));

    case CType::CTYPES_UINT16:
      return Napi::Number::New(env, LoadAs<uint16_t>(buffer));

    case CType::CTYPES_INT32:
      return Napi::Number::New(env, LoadAs<int32_t>(buffer));

    case CType::CTYPES_UINT32:
      return Napi::Number::New(env, LoadAs<uint32_t>(buffer));

    case CType::CTYPES_INT64:
      return Napi::BigInt::New(env, LoadAs<int64_t>(buffer));

    case CType::CTYPES_UINT64:
      return Napi::BigInt::New(env, LoadAs<uint64_t>(buffer));

    case CType::CTYPES_FLOAT:
      return Napi::Number::New(env, LoadAs<float>(buffer));

    case CType::CTYPES_DOUBLE:
      return Napi::Number::New(env, LoadAs<double>(buffer));

    case CType::CTYPES_POINTER: {
      void* const ptr = LoadAs<void*>(buffer);
      if (ptr == nullptr) {
        return env.Null();
      }
      return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(ptr));
    }

    case CType::CTYPES_STRING: {
      const char* const str = LoadAs<const char*>(buffer);
      if (str == nullptr) {
        return env.Null();
      }
      return Napi::String::New(env, str);
    }

    case CType::CTYPES_WSTRING: {
      const wchar_t* const str = LoadAs<const wchar_t*>(buffer);
      if (str == nullptr) {
        return env.Null();
      }
      return WideToJS(env, std::wstring_view(str));
    }

    case CType::CTYPES_WCHAR: {
      // Python c_wchar → str di 1 carattere.
      const wchar_t val = LoadAs<wchar_t>(buffer);
      return WideToJS(env, std::wstring_view(&val, 1));
    }

    case CType::CTYPES_BOOL:
      return Napi::Boolean::New(env, LoadAs<uint8_t>(buffer) != 0);

    case CType::CTYPES_SIZE_T:
      return Napi::BigInt::New(env, static_cast<uint64_t>(LoadAs<size_t>(buffer)));

    case CType::CTYPES_SSIZE_T:
      return Napi::BigInt::New(env, static_cast<int64_t>(LoadAs<ssize_t>(buffer)));

    case CType::CTYPES_LONG:
      return Napi::BigInt::New(env, static_cast<int64_t>(LoadAs<long>(buffer)));

    case CType::CTYPES_ULONG:
      return Napi::BigInt::New(env, static_cast<uint64_t>(LoadAs<unsigned long>(buffer)));

    default:
      // STRUCT/UNION/ARRAY non supportati - usare StructInfo/ArrayInfo
      return env.Undefined();
  }
}

// Crea oggetto CType esportato a JS (enum con tutti i valori)
Napi::Object CreateCType(Napi::Env env) {
  Napi::Object obj = Napi::Object::New(env);

  // Tipi primitivi
  obj.Set("VOID", static_cast<int32_t>(CType::CTYPES_VOID));
  obj.Set("INT8", static_cast<int32_t>(CType::CTYPES_INT8));
  obj.Set("UINT8", static_cast<int32_t>(CType::CTYPES_UINT8));
  obj.Set("INT16", static_cast<int32_t>(CType::CTYPES_INT16));
  obj.Set("UINT16", static_cast<int32_t>(CType::CTYPES_UINT16));
  obj.Set("INT32", static_cast<int32_t>(CType::CTYPES_INT32));
  obj.Set("UINT32", static_cast<int32_t>(CType::CTYPES_UINT32));
  obj.Set("INT64", static_cast<int32_t>(CType::CTYPES_INT64));
  obj.Set("UINT64", static_cast<int32_t>(CType::CTYPES_UINT64));
  obj.Set("FLOAT", static_cast<int32_t>(CType::CTYPES_FLOAT));
  obj.Set("DOUBLE", static_cast<int32_t>(CType::CTYPES_DOUBLE));
  obj.Set("POINTER", static_cast<int32_t>(CType::CTYPES_POINTER));
  obj.Set("STRING", static_cast<int32_t>(CType::CTYPES_STRING));
  obj.Set("WSTRING", static_cast<int32_t>(CType::CTYPES_WSTRING));
  obj.Set("WCHAR", static_cast<int32_t>(CType::CTYPES_WCHAR));
  obj.Set("CHAR", static_cast<int32_t>(CType::CTYPES_CHAR));
  obj.Set("BOOL", static_cast<int32_t>(CType::CTYPES_BOOL));
  obj.Set("SIZE_T", static_cast<int32_t>(CType::CTYPES_SIZE_T));
  obj.Set("SSIZE_T", static_cast<int32_t>(CType::CTYPES_SSIZE_T));
  obj.Set("LONG", static_cast<int32_t>(CType::CTYPES_LONG));
  obj.Set("ULONG", static_cast<int32_t>(CType::CTYPES_ULONG));

  // Tipi composti
  obj.Set("STRUCT", static_cast<int32_t>(CType::CTYPES_STRUCT));
  obj.Set("UNION", static_cast<int32_t>(CType::CTYPES_UNION));
  obj.Set("ARRAY", static_cast<int32_t>(CType::CTYPES_ARRAY));

  // Sentinel per validazione
  obj.Set("COUNT", static_cast<int32_t>(CType::CTYPES_COUNT));

  return obj;
}

}  // namespace ctypes
