#pragma once

#include "shared.h"

namespace ctypes {
// Enum per i tipi supportati - valori espliciti per esportazione a JS
enum class CType : int32_t {
  CTYPES_VOID = 0,
  CTYPES_INT8 = 1,
  CTYPES_UINT8 = 2,
  CTYPES_INT16 = 3,
  CTYPES_UINT16 = 4,
  CTYPES_INT32 = 5,
  CTYPES_UINT32 = 6,
  CTYPES_INT64 = 7,
  CTYPES_UINT64 = 8,
  CTYPES_FLOAT = 9,
  CTYPES_DOUBLE = 10,
  CTYPES_POINTER = 11,
  CTYPES_STRING = 12,   // char* null-terminated
  CTYPES_WSTRING = 13,  // wchar_t* null-terminated
  CTYPES_WCHAR = 14,    // singolo wchar_t
  CTYPES_BOOL = 15,
  CTYPES_SIZE_T = 16,
  CTYPES_SSIZE_T = 17,
  CTYPES_LONG = 18,    // platform-dependent: 32-bit su Windows, 32/64-bit su Unix
  CTYPES_ULONG = 19,   // platform-dependent: 32-bit su Windows, 32/64-bit su Unix
  CTYPES_STRUCT = 20,  // struttura composta (come CPython Structure)
  CTYPES_UNION = 21,   // union composta (come CPython Union)
  CTYPES_ARRAY = 22,   // array a dimensione fissa (come CPython c_int * 5)
  CTYPES_CHAR = 23,    // `char` come carattere (Python c_char → bytes di 1 byte)

  // Sentinel per validazione
  CTYPES_COUNT = 24
};

// Verifica se un valore int32 è un CType valido
[[nodiscard]] constexpr bool IsValidCType(int32_t value) noexcept {
  return value >= 0 && value < static_cast<int32_t>(CType::CTYPES_COUNT);
}

// CType dal valore numerico dell'enum (esportato a JS come CType).
[[nodiscard]] constexpr std::optional<CType> ToCType(int32_t value) noexcept {
  if (!IsValidCType(value)) {
    return std::nullopt;
  }
  return static_cast<CType>(value);
}

// CType da un valore JS: un numero dell'enum CType, altrimenti TypeError.
[[nodiscard]] CType CTypeFromJS(const Napi::Value& value);

// Mappa CType -> ffi_type*
[[nodiscard]] inline ffi_type* CTypeToFFI(CType type) {
  switch (type) {
    case CType::CTYPES_VOID:
      return &ffi_type_void;
    case CType::CTYPES_INT8:
      return &ffi_type_sint8;
    case CType::CTYPES_UINT8:
      return &ffi_type_uint8;
    case CType::CTYPES_INT16:
      return &ffi_type_sint16;
    case CType::CTYPES_UINT16:
      return &ffi_type_uint16;
    case CType::CTYPES_INT32:
      return &ffi_type_sint32;
    case CType::CTYPES_UINT32:
      return &ffi_type_uint32;
    case CType::CTYPES_INT64:
      return &ffi_type_sint64;
    case CType::CTYPES_UINT64:
      return &ffi_type_uint64;
    case CType::CTYPES_FLOAT:
      return &ffi_type_float;
    case CType::CTYPES_DOUBLE:
      return &ffi_type_double;
    case CType::CTYPES_POINTER:
    case CType::CTYPES_STRING:
    case CType::CTYPES_WSTRING:
      return &ffi_type_pointer;
    case CType::CTYPES_CHAR:
      return std::is_signed_v<char> ? &ffi_type_sint8 : &ffi_type_uint8;
    case CType::CTYPES_WCHAR:
      if constexpr (sizeof(wchar_t) == 2) {
        return std::is_signed_v<wchar_t> ? &ffi_type_sint16 : &ffi_type_uint16;
      } else {
        return std::is_signed_v<wchar_t> ? &ffi_type_sint32 : &ffi_type_uint32;
      }
    case CType::CTYPES_BOOL:
      return &ffi_type_uint8;
    case CType::CTYPES_SIZE_T:
      return sizeof(size_t) == 8 ? &ffi_type_uint64 : &ffi_type_uint32;
    case CType::CTYPES_SSIZE_T:
      return sizeof(ssize_t) == 8 ? &ffi_type_sint64 : &ffi_type_sint32;
    case CType::CTYPES_LONG:
      return sizeof(long) == 8 ? &ffi_type_sint64 : &ffi_type_sint32;
    case CType::CTYPES_ULONG:
      return sizeof(unsigned long) == 8 ? &ffi_type_uint64 : &ffi_type_uint32;
    default:
      return &ffi_type_void;
  }
}

// Dimensione di un tipo primitivo (0 per void e per struct/union/array, la cui
// dimensione è quella di StructInfo / ArrayInfo).
[[nodiscard]] constexpr size_t CTypeSize(CType type) noexcept {
  switch (type) {
    case CType::CTYPES_INT8:
    case CType::CTYPES_UINT8:
    case CType::CTYPES_CHAR:
    case CType::CTYPES_BOOL:
      return 1;
    case CType::CTYPES_INT16:
    case CType::CTYPES_UINT16:
      return 2;
    case CType::CTYPES_INT32:
    case CType::CTYPES_UINT32:
    case CType::CTYPES_FLOAT:
      return 4;
    case CType::CTYPES_INT64:
    case CType::CTYPES_UINT64:
    case CType::CTYPES_DOUBLE:
      return 8;
    case CType::CTYPES_POINTER:
      return sizeof(void*);
    case CType::CTYPES_STRING:
      return sizeof(char*);
    case CType::CTYPES_WSTRING:
      return sizeof(wchar_t*);
    case CType::CTYPES_WCHAR:
      return sizeof(wchar_t);
    case CType::CTYPES_SIZE_T:
      return sizeof(size_t);
    case CType::CTYPES_SSIZE_T:
      return sizeof(ssize_t);
    case CType::CTYPES_LONG:
      return sizeof(long);
    case CType::CTYPES_ULONG:
      return sizeof(unsigned long);
    default:
      return 0;
  }
}

// I ritorni interi stretti di libffi occupano uno slot ffi_arg completo.
template <typename T>
  requires std::is_trivially_copyable_v<T>
inline void StoreReturnValue(void* destination, T value) noexcept {
  if constexpr (std::is_integral_v<T> && sizeof(T) < sizeof(ffi_arg)) {
    const ffi_arg widened =
      std::is_signed_v<T> ? static_cast<ffi_arg>(static_cast<ffi_sarg>(value)) : static_cast<ffi_arg>(value);
    std::memcpy(destination, &widened, sizeof(widened));
  } else {
    std::memcpy(destination, &value, sizeof(value));
  }
}

[[nodiscard]] constexpr bool IsIntegralReturn(CType type) noexcept {
  switch (type) {
    case CType::CTYPES_INT8:
    case CType::CTYPES_UINT8:
    case CType::CTYPES_INT16:
    case CType::CTYPES_UINT16:
    case CType::CTYPES_INT32:
    case CType::CTYPES_UINT32:
    case CType::CTYPES_INT64:
    case CType::CTYPES_UINT64:
    case CType::CTYPES_CHAR:
    case CType::CTYPES_WCHAR:
    case CType::CTYPES_BOOL:
    case CType::CTYPES_SIZE_T:
    case CType::CTYPES_SSIZE_T:
    case CType::CTYPES_LONG:
    case CType::CTYPES_ULONG:
      return true;
    default:
      return false;
  }
}

[[nodiscard]] constexpr size_t ReturnStorageSize(CType type) noexcept {
  const size_t size = CTypeSize(type);
  return IsIntegralReturn(type) ? std::max(size, sizeof(ffi_arg)) : size;
}

inline void ZeroReturnValue(CType type, void* destination) noexcept {
  if (const size_t size = ReturnStorageSize(type); size != 0) {
    std::memset(destination, 0, size);
  }
}

inline void StoreCallbackValue(CType type, const void* source, void* destination) noexcept {
  if (CTypeSize(type) >= sizeof(ffi_arg) || !IsIntegralReturn(type)) {
    std::memcpy(destination, source, CTypeSize(type));
    return;
  }
  switch (type) {
    case CType::CTYPES_INT8:
      StoreReturnValue(destination, LoadAs<int8_t>(source));
      break;
    case CType::CTYPES_UINT8:
      StoreReturnValue(destination, LoadAs<uint8_t>(source));
      break;
    case CType::CTYPES_INT16:
      StoreReturnValue(destination, LoadAs<int16_t>(source));
      break;
    case CType::CTYPES_UINT16:
      StoreReturnValue(destination, LoadAs<uint16_t>(source));
      break;
    case CType::CTYPES_INT32:
      StoreReturnValue(destination, LoadAs<int32_t>(source));
      break;
    case CType::CTYPES_UINT32:
      StoreReturnValue(destination, LoadAs<uint32_t>(source));
      break;
    case CType::CTYPES_CHAR:
      StoreReturnValue(destination, LoadAs<char>(source));
      break;
    case CType::CTYPES_WCHAR:
      StoreReturnValue(destination, LoadAs<wchar_t>(source));
      break;
    case CType::CTYPES_BOOL:
      StoreReturnValue(destination, LoadAs<uint8_t>(source));
      break;
    case CType::CTYPES_LONG:
      StoreReturnValue(destination, LoadAs<long>(source));
      break;
    case CType::CTYPES_ULONG:
      StoreReturnValue(destination, LoadAs<unsigned long>(source));
      break;
    case CType::CTYPES_SIZE_T:
      StoreReturnValue(destination, LoadAs<size_t>(source));
      break;
    case CType::CTYPES_SSIZE_T:
      StoreReturnValue(destination, LoadAs<ssize_t>(source));
      break;
    default:
      break;
  }
}

[[nodiscard]] constexpr bool IsSimpleArgumentType(CType type) noexcept {
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
    case CType::CTYPES_POINTER:
    case CType::CTYPES_STRING:
    case CType::CTYPES_WCHAR:
    case CType::CTYPES_BOOL:
    case CType::CTYPES_SIZE_T:
    case CType::CTYPES_SSIZE_T:
    case CType::CTYPES_LONG:
    case CType::CTYPES_ULONG:
    case CType::CTYPES_CHAR:
      return true;
    default:
      return false;
  }
}

// Converte un valore JS in bytes C
// Ritorna il numero di bytes scritti, o -1 per errore
// NOTA: Solo per tipi primitivi. STRUCT/UNION/ARRAY usano StructInfo/ArrayInfo
[[nodiscard]] int JSToC(Napi::Value value, CType type, std::span<uint8_t> out);

// Converte bytes C in valore JS
// NOTA: Solo per tipi primitivi. STRUCT/UNION/ARRAY usano StructInfo/ArrayInfo
[[nodiscard]] Napi::Value CToJS(Napi::Env env, const void* buffer, CType type);

// Nome del tipo di un valore JS nei messaggi d'errore ("string", "null",
// "Buffer", nome del costruttore per gli altri oggetti).
[[nodiscard]] std::string JSTypeName(const Napi::Value& value);

// Number usato come intero C: i suoi 64 bit bassi (Python maschera gli int ai
// bit del tipo). Un number non intero o non finito è un float, che Python
// rifiuta per i tipi interi: TypeError.
[[nodiscard]] uint64_t IntegerBitsFromDouble(const Napi::Value& value, double d);

// Number, boolean o BigInt nel range int64/uint64; nessuna coercizione di oggetti.
[[nodiscard]] double RealFromJS(const Napi::Value& value);

// Python c_char: stringa di 1 carattere (codice 0..255), Buffer/Uint8Array di
// 1 byte, intero 0..255 o boolean. Altrimenti TypeError con i messaggi di Python.
[[nodiscard]] uint8_t CharFromJS(const Napi::Value& value);

// Python c_wchar: stringa di un solo carattere (anche fuori dal BMP dove
// wchar_t è a 32 bit). node-ctypes accetta anche il code point come intero.
[[nodiscard]] wchar_t WcharFromJS(const Napi::Value& value);

// Stringa UTF-16 → wchar_t con terminatore in `out`. Dove wchar_t è UTF-32 le
// coppie surrogate diventano un code point; i surrogati isolati sono
// conservati (come Python). Scrive al più out.size() - 1 wchar_t: con
// out.size() > in.size() la stringa entra sempre per intero.
// Ritorna il numero di wchar_t scritti, terminatore escluso.
size_t Utf16ToWide(std::u16string_view in, std::span<wchar_t> out);

// wchar_t → stringa JS. Code point oltre U+10FFFF diventano U+FFFD.
[[nodiscard]] Napi::String WideToJS(Napi::Env env, std::wstring_view str);

// Crea oggetto CType esportato a JS (enum con tutti i valori)
Napi::Object CreateCType(Napi::Env env);

}  // namespace ctypes
