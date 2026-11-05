#pragma once

#include <ffi.h>

#include "layout.h"

namespace ctypes {

static_assert(sizeof(AbiWord) == sizeof(ffi_arg), "Shared ABI return storage must match libffi's return word");
static_assert(sizeof(SignedAbiWord) == sizeof(ffi_sarg), "Shared ABI sign extension must match libffi's signed word");

[[nodiscard]] ffi_type* GetLibffiType(StructInfo& info);
[[nodiscard]] ffi_type* GetLibffiType(ArrayInfo& info);

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

}  // namespace ctypes
