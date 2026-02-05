#pragma once

#include "shared.h"

namespace ctypes
{
    // Enum per i tipi supportati - valori espliciti per esportazione a JS
    enum class CType : int32_t
    {
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
        CTYPES_STRING = 12,  // char* null-terminated
        CTYPES_WSTRING = 13, // wchar_t* null-terminated
        CTYPES_WCHAR = 14,   // singolo wchar_t
        CTYPES_BOOL = 15,
        CTYPES_SIZE_T = 16,
        CTYPES_SSIZE_T = 17,
        CTYPES_LONG = 18,   // platform-dependent: 32-bit su Windows, 32/64-bit su Unix
        CTYPES_ULONG = 19,  // platform-dependent: 32-bit su Windows, 32/64-bit su Unix
        CTYPES_STRUCT = 20, // struttura composta (come CPython Structure)
        CTYPES_UNION = 21,  // union composta (come CPython Union)
        CTYPES_ARRAY = 22,  // array a dimensione fissa (come CPython c_int * 5)

        // Sentinel per validazione
        CTYPES_COUNT = 23
    };

    // Converte int32 -> CType con validazione
    // Lancia std::runtime_error se il valore è fuori range
    CType IntToCType(int32_t value);

    // Verifica se un valore int32 è un CType valido
    inline bool IsValidCType(int32_t value)
    {
        return value >= 0 && value < static_cast<int32_t>(CType::CTYPES_COUNT);
    }

    // Mappa CType -> ffi_type*
    ffi_type *CTypeToFFI(CType type);

    // Dimensione di un tipo
    size_t CTypeSize(CType type);

    // Converte un valore JS in bytes C
    // Ritorna il numero di bytes scritti, o -1 per errore
    // NOTA: Solo per tipi primitivi. STRUCT/UNION/ARRAY usano StructInfo/ArrayInfo
    int JSToC(Napi::Env env, Napi::Value value, CType type, void *buffer, size_t bufsize);

    // Converte bytes C in valore JS
    // NOTA: Solo per tipi primitivi. STRUCT/UNION/ARRAY usano StructInfo/ArrayInfo
    Napi::Value CToJS(Napi::Env env, const void *buffer, CType type);

    // Crea oggetto CType esportato a JS (enum con tutti i valori)
    Napi::Object CreateCType(Napi::Env env);

} // namespace ctypes
