#ifndef CTYPES_TYPES_H
#define CTYPES_TYPES_H

#include <napi.h>
#include <ffi.h>
#include <string>
#include <memory>
#include <vector>
#include <unordered_map>

namespace ctypes
{

    // Enum per i tipi supportati
    enum class CType
    {
        VOID,
        INT8,
        UINT8,
        INT16,
        UINT16,
        INT32,
        UINT32,
        INT64,
        UINT64,
        FLOAT,
        DOUBLE,
        POINTER,
        STRING,  // char* null-terminated
        WSTRING, // wchar_t* null-terminated
        WCHAR,   // singolo wchar_t
        BOOL,
        SIZE_T,
        SSIZE_T,
        LONG, // platform-dependent: 32-bit su Windows, 32/64-bit su Unix
        ULONG // platform-dependent: 32-bit su Windows, 32/64-bit su Unix
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
        static Napi::Object Init(Napi::Env env, Napi::Object exports);
        static Napi::FunctionReference constructor;

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
    Napi::Object CreatePredefinedTypes(Napi::Env env);

} // namespace ctypes

#endif // CTYPES_TYPES_H
