#ifndef CTYPES_TYPES_H
#define CTYPES_TYPES_H

#include "shared.h"

namespace ctypes
{
    // Enum per i tipi supportati
    enum class CType
    {
        CTYPES_VOID,
        CTYPES_INT8,
        CTYPES_UINT8,
        CTYPES_INT16,
        CTYPES_UINT16,
        CTYPES_INT32,
        CTYPES_UINT32,
        CTYPES_INT64,
        CTYPES_UINT64,
        CTYPES_FLOAT,
        CTYPES_DOUBLE,
        CTYPES_POINTER,
        CTYPES_STRING,  // char* null-terminated
        CTYPES_WSTRING, // wchar_t* null-terminated
        CTYPES_WCHAR,   // singolo wchar_t
        CTYPES_BOOL,
        CTYPES_SIZE_T,
        CTYPES_SSIZE_T,
        CTYPES_LONG,   // platform-dependent: 32-bit su Windows, 32/64-bit su Unix
        CTYPES_ULONG,  // platform-dependent: 32-bit su Windows, 32/64-bit su Unix
        CTYPES_STRUCT, // struttura composta (come CPython Structure)
        CTYPES_UNION,  // union composta (come CPython Union)
        CTYPES_ARRAY   // array a dimensione fissa (come CPython c_int * 5)
    };

    // Mappa nome stringa -> CType
    CType StringToCType(const std::string &name);

    // Mappa CType -> ffi_type*
    ffi_type *CTypeToFFI(CType type);

    // Dimensione di un tipo
    size_t CTypeSize(CType type);

    // Converte un valore JS in bytes C
    // Ritorna il numero di bytes scritti, o -1 per errore
    int JSToC(Napi::Env env, Napi::Value value, CType type, void *buffer, size_t bufsize);

    // Converte bytes C in valore JS
    Napi::Value CToJS(Napi::Env env, const void *buffer, CType type);

    // Classe wrapper per gestire i tipi da JS
    class TypeInfo : public Napi::ObjectWrap<TypeInfo>
    {
    public:
        static Napi::Function GetClass(Napi::Env env);

        TypeInfo(const Napi::CallbackInfo &info);

        CType GetCType() const { return ctype_; }
        ffi_type *GetFFIType() const { return ffi_type_; }
        size_t GetSize() const { return size_; }

        Napi::Value GetSize(const Napi::CallbackInfo &info);
        Napi::Value GetName(const Napi::CallbackInfo &info);

    private:
        CType ctype_;
        ffi_type *ffi_type_;
        size_t size_;
        std::string name_;
    };

    // Helper per creare tipi predefiniti
    Napi::Object CreatePredefinedTypes(Napi::Env env, Napi::FunctionReference &typeInfoConstructor);

} // namespace ctypes

#endif // CTYPES_TYPES_H
