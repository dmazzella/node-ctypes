#include "types.h"

namespace ctypes
{
    // Converte int32 -> CType con validazione
    CType IntToCType(int32_t value)
    {
        if (!IsValidCType(value))
        {
            throw std::runtime_error("Invalid CType value: " + std::to_string(value));
        }
        return static_cast<CType>(value);
    }

    // Nomi dei tipi per CType -> stringa (usato solo per debug/display)
    static const char *CTypeNames[] = {
        "void",    // CTYPES_VOID = 0
        "int8",    // CTYPES_INT8 = 1
        "uint8",   // CTYPES_UINT8 = 2
        "int16",   // CTYPES_INT16 = 3
        "uint16",  // CTYPES_UINT16 = 4
        "int32",   // CTYPES_INT32 = 5
        "uint32",  // CTYPES_UINT32 = 6
        "int64",   // CTYPES_INT64 = 7
        "uint64",  // CTYPES_UINT64 = 8
        "float",   // CTYPES_FLOAT = 9
        "double",  // CTYPES_DOUBLE = 10
        "pointer", // CTYPES_POINTER = 11
        "string",  // CTYPES_STRING = 12
        "wstring", // CTYPES_WSTRING = 13
        "wchar",   // CTYPES_WCHAR = 14
        "bool",    // CTYPES_BOOL = 15
        "size_t",  // CTYPES_SIZE_T = 16
        "ssize_t", // CTYPES_SSIZE_T = 17
        "long",    // CTYPES_LONG = 18
        "ulong",   // CTYPES_ULONG = 19
        "struct",  // CTYPES_STRUCT = 20
        "union",   // CTYPES_UNION = 21
        "array"    // CTYPES_ARRAY = 22
    };

    const char *CTypeToName(CType type)
    {
        int32_t idx = static_cast<int32_t>(type);
        if (idx >= 0 && idx < static_cast<int32_t>(CType::CTYPES_COUNT))
        {
            return CTypeNames[idx];
        }
        return "unknown";
    }

    ffi_type *CTypeToFFI(CType type)
    {
        switch (type)
        {
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
            return &ffi_type_pointer;
        case CType::CTYPES_STRING:
            return &ffi_type_pointer;
        case CType::CTYPES_WSTRING:
            return &ffi_type_pointer;
        case CType::CTYPES_WCHAR:
            // wchar_t è 16-bit su Windows, 32-bit su Unix
#ifdef _WIN32
            return &ffi_type_uint16;
#else
            return &ffi_type_uint32;
#endif
        case CType::CTYPES_BOOL:
            return &ffi_type_uint8;
        case CType::CTYPES_SIZE_T:
            return &ffi_type_pointer; // size_t è tipicamente pointer-sized
        case CType::CTYPES_SSIZE_T:
            return &ffi_type_pointer;
        case CType::CTYPES_LONG:
            // long è 32-bit su Windows (LLP64), 64-bit su Unix 64-bit (LP64)
#ifdef _WIN32
            return &ffi_type_sint32;
#else
            return sizeof(long) == 8 ? &ffi_type_sint64 : &ffi_type_sint32;
#endif
        case CType::CTYPES_ULONG:
#ifdef _WIN32
            return &ffi_type_uint32;
#else
            return sizeof(unsigned long) == 8 ? &ffi_type_uint64 : &ffi_type_uint32;
#endif
        default:
            return &ffi_type_void;
        }
    }

    size_t CTypeSize(CType type)
    {
        switch (type)
        {
        case CType::CTYPES_VOID:
            return 0;
        case CType::CTYPES_INT8:
            return 1;
        case CType::CTYPES_UINT8:
            return 1;
        case CType::CTYPES_INT16:
            return 2;
        case CType::CTYPES_UINT16:
            return 2;
        case CType::CTYPES_INT32:
            return 4;
        case CType::CTYPES_UINT32:
            return 4;
        case CType::CTYPES_INT64:
            return 8;
        case CType::CTYPES_UINT64:
            return 8;
        case CType::CTYPES_FLOAT:
            return 4;
        case CType::CTYPES_DOUBLE:
            return 8;
        case CType::CTYPES_POINTER:
            return sizeof(void *);
        case CType::CTYPES_STRING:
            return sizeof(char *);
        case CType::CTYPES_WSTRING:
            return sizeof(wchar_t *);
        case CType::CTYPES_WCHAR:
            return sizeof(wchar_t);
        case CType::CTYPES_BOOL:
            return 1;
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

    // ============================================================================
    // JSToC - Converte valore JS in bytes C
    // ============================================================================

    int JSToC(Napi::Env env, Napi::Value value, CType type, void *buffer, size_t bufsize)
    {
        switch (type)
        {
        case CType::CTYPES_VOID:
            return 0;

        case CType::CTYPES_INT8:
        {
            if (bufsize < 1)
                return -1;
            int8_t val = static_cast<int8_t>(value.ToNumber().Int32Value());
            memcpy(buffer, &val, sizeof(val));
            return 1;
        }

        case CType::CTYPES_UINT8:
        {
            if (bufsize < 1)
                return -1;
            uint8_t val = static_cast<uint8_t>(value.ToNumber().Uint32Value());
            memcpy(buffer, &val, sizeof(val));
            return 1;
        }

        case CType::CTYPES_INT16:
        {
            if (bufsize < 2)
                return -1;
            int16_t val = static_cast<int16_t>(value.ToNumber().Int32Value());
            memcpy(buffer, &val, sizeof(val));
            return 2;
        }

        case CType::CTYPES_UINT16:
        {
            if (bufsize < 2)
                return -1;
            uint16_t val = static_cast<uint16_t>(value.ToNumber().Uint32Value());
            memcpy(buffer, &val, sizeof(val));
            return 2;
        }

        case CType::CTYPES_INT32:
        {
            if (bufsize < 4)
                return -1;
            int32_t val = value.ToNumber().Int32Value();
            memcpy(buffer, &val, sizeof(val));
            return 4;
        }

        case CType::CTYPES_UINT32:
        {
            if (bufsize < 4)
                return -1;
            uint32_t val = value.ToNumber().Uint32Value();
            memcpy(buffer, &val, sizeof(val));
            return 4;
        }

        case CType::CTYPES_INT64:
        {
            if (bufsize < 8)
                return -1;
            int64_t val;
            if (value.IsBigInt())
            {
                bool lossless;
                val = value.As<Napi::BigInt>().Int64Value(&lossless);
            }
            else
            {
                val = value.ToNumber().Int64Value();
            }
            memcpy(buffer, &val, sizeof(val));
            return sizeof(val);
        }

        case CType::CTYPES_UINT64:
        {
            if (bufsize < 8)
                return -1;
            uint64_t val;
            if (value.IsBigInt())
            {
                bool lossless;
                val = value.As<Napi::BigInt>().Uint64Value(&lossless);
            }
            else
            {
                val = static_cast<uint64_t>(value.ToNumber().Int64Value());
            }
            memcpy(buffer, &val, sizeof(val));
            return sizeof(val);
        }

        case CType::CTYPES_FLOAT:
        {
            if (bufsize < 4)
                return -1;
            float val = static_cast<float>(value.ToNumber().FloatValue());
            memcpy(buffer, &val, sizeof(val));
            return sizeof(val);
        }

        case CType::CTYPES_DOUBLE:
        {
            if (bufsize < 8)
                return -1;
            double val = value.ToNumber().DoubleValue();
            memcpy(buffer, &val, sizeof(val));
            return sizeof(val);
        }

        case CType::CTYPES_POINTER:
        {
            if (bufsize < sizeof(void *))
                return -1;
            void *ptr = nullptr;

            if (value.IsNull() || value.IsUndefined())
            {
                ptr = nullptr;
            }
            else if (value.IsBuffer())
            {
                ptr = value.As<Napi::Buffer<uint8_t>>().Data();
            }
            else if (value.IsArrayBuffer())
            {
                ptr = value.As<Napi::ArrayBuffer>().Data();
            }
            else if (value.IsBigInt())
            {
                bool lossless;
                uint64_t addr = value.As<Napi::BigInt>().Uint64Value(&lossless);
                ptr = reinterpret_cast<void *>(addr);
            }
            else if (value.IsNumber())
            {
                ptr = reinterpret_cast<void *>(static_cast<uintptr_t>(
                    value.ToNumber().Int64Value()));
            }

            memcpy(buffer, &ptr, sizeof(void *));
            return sizeof(void *);
        }

        case CType::CTYPES_STRING:
        {
            if (bufsize < sizeof(char *))
                return -1;
            const char *str = nullptr;

            if (value.IsNull() || value.IsUndefined())
            {
                str = nullptr;
            }
            else if (value.IsBuffer())
            {
                str = reinterpret_cast<const char *>(
                    value.As<Napi::Buffer<uint8_t>>().Data());
            }
            else if (value.IsString())
            {
                // NOTA: IsString NON è gestito qui per evitare memory leak.
                // Il chiamante (FFIFunction::Call) deve gestire le stringhe
                // separatamente usando string_storage.
                return -1;
            }

            memcpy(buffer, &str, sizeof(char *));
            return sizeof(char *);
        }

        case CType::CTYPES_WSTRING:
        {
            if (bufsize < sizeof(wchar_t *))
                return -1;
            const wchar_t *str = nullptr;

            if (value.IsNull() || value.IsUndefined())
            {
                str = nullptr;
            }
            else if (value.IsBuffer())
            {
                str = reinterpret_cast<const wchar_t *>(
                    value.As<Napi::Buffer<uint8_t>>().Data());
            }
            // IsString gestito in FFIFunction::Call

            memcpy(buffer, &str, sizeof(wchar_t *));
            return sizeof(wchar_t *);
        }

        case CType::CTYPES_WCHAR:
        {
            if (bufsize < sizeof(wchar_t))
                return -1;
            wchar_t val = 0;

            if (value.IsNumber())
            {
                val = static_cast<wchar_t>(value.ToNumber().Uint32Value());
            }
            else if (value.IsString())
            {
                std::u16string str = value.As<Napi::String>().Utf16Value();
                if (!str.empty())
                {
                    val = static_cast<wchar_t>(str[0]);
                }
            }

            memcpy(buffer, &val, sizeof(wchar_t));
            return sizeof(wchar_t);
        }

        case CType::CTYPES_BOOL:
        {
            if (bufsize < 1)
                return -1;
            uint8_t val = value.ToBoolean().Value() ? 1 : 0;
            memcpy(buffer, &val, sizeof(val));
            return sizeof(val);
        }

        case CType::CTYPES_SIZE_T:
        {
            if (bufsize < sizeof(size_t))
                return -1;
            size_t val;
            if (value.IsBigInt())
            {
                bool lossless;
                val = static_cast<size_t>(value.As<Napi::BigInt>().Uint64Value(&lossless));
            }
            else
            {
                val = static_cast<size_t>(value.ToNumber().Int64Value());
            }
            memcpy(buffer, &val, sizeof(size_t));
            return sizeof(size_t);
        }

        case CType::CTYPES_SSIZE_T:
        {
            if (bufsize < sizeof(ssize_t))
                return -1;
            ssize_t val;
            if (value.IsBigInt())
            {
                bool lossless;
                val = static_cast<ssize_t>(value.As<Napi::BigInt>().Int64Value(&lossless));
            }
            else
            {
                val = static_cast<ssize_t>(value.ToNumber().Int64Value());
            }
            memcpy(buffer, &val, sizeof(ssize_t));
            return sizeof(ssize_t);
        }

        case CType::CTYPES_LONG:
        {
            if (bufsize < sizeof(long))
                return -1;
            long val;
            if (value.IsBigInt())
            {
                bool lossless;
                val = static_cast<long>(value.As<Napi::BigInt>().Int64Value(&lossless));
            }
            else
            {
                val = static_cast<long>(value.ToNumber().Int64Value());
            }
            memcpy(buffer, &val, sizeof(long));
            return sizeof(long);
        }

        case CType::CTYPES_ULONG:
        {
            if (bufsize < sizeof(unsigned long))
                return -1;
            unsigned long val;
            if (value.IsBigInt())
            {
                bool lossless;
                val = static_cast<unsigned long>(value.As<Napi::BigInt>().Uint64Value(&lossless));
            }
            else
            {
                val = static_cast<unsigned long>(value.ToNumber().Int64Value());
            }
            memcpy(buffer, &val, sizeof(unsigned long));
            return sizeof(unsigned long);
        }

        default:
            // STRUCT/UNION/ARRAY non supportati - usare StructInfo/ArrayInfo
            return -1;
        }
    }

    // ============================================================================
    // CToJS - Converte bytes C in valore JS
    // ============================================================================

    Napi::Value CToJS(Napi::Env env, const void *buffer, CType type)
    {
        switch (type)
        {
        case CType::CTYPES_VOID:
            return env.Undefined();

        case CType::CTYPES_INT8:
        {
            int8_t val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_UINT8:
        {
            uint8_t val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_INT16:
        {
            int16_t val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_UINT16:
        {
            uint16_t val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_INT32:
        {
            int32_t val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_UINT32:
        {
            uint32_t val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_INT64:
        {
            int64_t val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::BigInt::New(env, val);
        }

        case CType::CTYPES_UINT64:
        {
            uint64_t val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::BigInt::New(env, val);
        }

        case CType::CTYPES_FLOAT:
        {
            float val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_DOUBLE:
        {
            double val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_POINTER:
        {
            void *ptr;
            memcpy(&ptr, buffer, sizeof(void *));
            if (ptr == nullptr)
            {
                return env.Null();
            }
            return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(ptr));
        }

        case CType::CTYPES_STRING:
        {
            char *str;
            memcpy(&str, buffer, sizeof(char *));
            if (str == nullptr)
            {
                return env.Null();
            }
            return Napi::String::New(env, str);
        }

        case CType::CTYPES_WSTRING:
        {
            wchar_t *str;
            memcpy(&str, buffer, sizeof(wchar_t *));
            if (str == nullptr)
            {
                return env.Null();
            }
#ifdef _WIN32
            // Windows: wchar_t è 16-bit (UTF-16)
            return Napi::String::New(env, reinterpret_cast<const char16_t *>(str));
#else
            // Unix: wchar_t è 32-bit, dobbiamo convertire
            std::wstring wstr(str);
            std::string utf8;
            utf8.reserve(wstr.size() * 4);
            for (wchar_t wc : wstr)
            {
                if (wc < 0x80)
                {
                    utf8.push_back(static_cast<char>(wc));
                }
                else if (wc < 0x800)
                {
                    utf8.push_back(static_cast<char>(0xC0 | (wc >> 6)));
                    utf8.push_back(static_cast<char>(0x80 | (wc & 0x3F)));
                }
                else if (wc < 0x10000)
                {
                    utf8.push_back(static_cast<char>(0xE0 | (wc >> 12)));
                    utf8.push_back(static_cast<char>(0x80 | ((wc >> 6) & 0x3F)));
                    utf8.push_back(static_cast<char>(0x80 | (wc & 0x3F)));
                }
                else
                {
                    utf8.push_back(static_cast<char>(0xF0 | (wc >> 18)));
                    utf8.push_back(static_cast<char>(0x80 | ((wc >> 12) & 0x3F)));
                    utf8.push_back(static_cast<char>(0x80 | ((wc >> 6) & 0x3F)));
                    utf8.push_back(static_cast<char>(0x80 | (wc & 0x3F)));
                }
            }
            return Napi::String::New(env, utf8);
#endif
        }

        case CType::CTYPES_WCHAR:
        {
            wchar_t val;
            memcpy(&val, buffer, sizeof(wchar_t));
            return Napi::Number::New(env, static_cast<uint32_t>(val));
        }

        case CType::CTYPES_BOOL:
        {
            uint8_t val;
            memcpy(&val, buffer, sizeof(val));
            return Napi::Boolean::New(env, val != 0);
        }

        case CType::CTYPES_SIZE_T:
        {
            size_t val;
            memcpy(&val, buffer, sizeof(size_t));
            return Napi::BigInt::New(env, static_cast<uint64_t>(val));
        }

        case CType::CTYPES_SSIZE_T:
        {
            ssize_t val;
            memcpy(&val, buffer, sizeof(ssize_t));
            return Napi::BigInt::New(env, static_cast<int64_t>(val));
        }

        case CType::CTYPES_LONG:
        {
            long val;
            memcpy(&val, buffer, sizeof(long));
            return Napi::BigInt::New(env, static_cast<int64_t>(val));
        }

        case CType::CTYPES_ULONG:
        {
            unsigned long val;
            memcpy(&val, buffer, sizeof(unsigned long));
            return Napi::BigInt::New(env, static_cast<uint64_t>(val));
        }

        default:
            // STRUCT/UNION/ARRAY non supportati - usare StructInfo/ArrayInfo
            return env.Undefined();
        }
    }

    // Crea oggetto CType esportato a JS (enum con tutti i valori)
    Napi::Object CreateCType(Napi::Env env)
    {
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

} // namespace ctypes
