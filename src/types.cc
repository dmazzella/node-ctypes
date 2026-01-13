#include "types.h"

namespace ctypes
{

    // Mappa stringa -> CType
    static const std::unordered_map<std::string, CType> type_map = {
        {"void", CType::CTYPES_VOID},
        {"int8", CType::CTYPES_INT8},
        {"int8_t", CType::CTYPES_INT8},
        {"char", CType::CTYPES_INT8},
        {"uint8", CType::CTYPES_UINT8},
        {"uint8_t", CType::CTYPES_UINT8},
        {"uchar", CType::CTYPES_UINT8},
        {"unsigned char", CType::CTYPES_UINT8},
        {"int16", CType::CTYPES_INT16},
        {"int16_t", CType::CTYPES_INT16},
        {"short", CType::CTYPES_INT16},
        {"uint16", CType::CTYPES_UINT16},
        {"uint16_t", CType::CTYPES_UINT16},
        {"ushort", CType::CTYPES_UINT16},
        {"unsigned short", CType::CTYPES_UINT16},
        {"int32", CType::CTYPES_INT32},
        {"int32_t", CType::CTYPES_INT32},
        {"int", CType::CTYPES_INT32},
        {"uint32", CType::CTYPES_UINT32},
        {"uint32_t", CType::CTYPES_UINT32},
        {"uint", CType::CTYPES_UINT32},
        {"unsigned int", CType::CTYPES_UINT32},
        {"int64", CType::CTYPES_INT64},
        {"int64_t", CType::CTYPES_INT64},
        {"long long", CType::CTYPES_INT64},
        {"uint64", CType::CTYPES_UINT64},
        {"uint64_t", CType::CTYPES_UINT64},
        {"unsigned long long", CType::CTYPES_UINT64},
        {"float", CType::CTYPES_FLOAT},
        {"double", CType::CTYPES_DOUBLE},
        {"pointer", CType::CTYPES_POINTER},
        {"void*", CType::CTYPES_POINTER},
        {"ptr", CType::CTYPES_POINTER},
        {"string", CType::CTYPES_STRING},
        {"char*", CType::CTYPES_STRING},
        {"cstring", CType::CTYPES_STRING},
        {"wstring", CType::CTYPES_WSTRING},
        {"wchar_t*", CType::CTYPES_WSTRING},
        {"wchar", CType::CTYPES_WCHAR},
        {"wchar_t", CType::CTYPES_WCHAR},
        {"bool", CType::CTYPES_BOOL},
        {"_Bool", CType::CTYPES_BOOL},
        {"size_t", CType::CTYPES_SIZE_T},
        {"ssize_t", CType::CTYPES_SSIZE_T},
        {"long", CType::CTYPES_LONG},
        {"c_long", CType::CTYPES_LONG},
        {"ulong", CType::CTYPES_ULONG},
        {"unsigned long", CType::CTYPES_ULONG},
        {"c_ulong", CType::CTYPES_ULONG}};

    CType StringToCType(const std::string &name)
    {
        spdlog::trace(__FUNCTION__);

        auto it = type_map.find(name);
        if (it != type_map.end())
        {
            return it->second;
        }
        throw std::runtime_error("Unknown type: " + name);
    }

    ffi_type *CTypeToFFI(CType type)
    {
        spdlog::trace(__FUNCTION__);

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
        spdlog::trace(__FUNCTION__);

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

    int JSToC(Napi::Env env, Napi::Value value, CType type, void *buffer, size_t bufsize)
    {
        spdlog::trace(__FUNCTION__);

        switch (type)
        {
        case CType::CTYPES_VOID:
            return 0;

        case CType::CTYPES_INT8:
        {
            if (bufsize < 1)
                return -1;
            int8_t val = static_cast<int8_t>(value.ToNumber().Int32Value());
            memcpy(buffer, &val, 1);
            return 1;
        }

        case CType::CTYPES_UINT8:
        {
            if (bufsize < 1)
                return -1;
            uint8_t val = static_cast<uint8_t>(value.ToNumber().Uint32Value());
            memcpy(buffer, &val, 1);
            return 1;
        }

        case CType::CTYPES_INT16:
        {
            if (bufsize < 2)
                return -1;
            int16_t val = static_cast<int16_t>(value.ToNumber().Int32Value());
            memcpy(buffer, &val, 2);
            return 2;
        }

        case CType::CTYPES_UINT16:
        {
            if (bufsize < 2)
                return -1;
            uint16_t val = static_cast<uint16_t>(value.ToNumber().Uint32Value());
            memcpy(buffer, &val, 2);
            return 2;
        }

        case CType::CTYPES_INT32:
        {
            if (bufsize < 4)
                return -1;
            int32_t val = value.ToNumber().Int32Value();
            memcpy(buffer, &val, 4);
            return 4;
        }

        case CType::CTYPES_UINT32:
        {
            if (bufsize < 4)
                return -1;
            uint32_t val = value.ToNumber().Uint32Value();
            memcpy(buffer, &val, 4);
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
            memcpy(buffer, &val, 8);
            return 8;
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
            memcpy(buffer, &val, 8);
            return 8;
        }

        case CType::CTYPES_FLOAT:
        {
            if (bufsize < 4)
                return -1;
            float val = static_cast<float>(value.ToNumber().FloatValue());
            memcpy(buffer, &val, 4);
            return 4;
        }

        case CType::CTYPES_DOUBLE:
        {
            if (bufsize < 8)
                return -1;
            double val = value.ToNumber().DoubleValue();
            memcpy(buffer, &val, 8);
            return 8;
        }

        case CType::CTYPES_BOOL:
        {
            if (bufsize < 1)
                return -1;
            uint8_t val = value.ToBoolean().Value() ? 1 : 0;
            memcpy(buffer, &val, 1);
            return 1;
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
            return -1;
        }
    }

    Napi::Value CToJS(Napi::Env env, const void *buffer, CType type)
    {
        spdlog::trace(__FUNCTION__);

        switch (type)
        {
        case CType::CTYPES_VOID:
            return env.Undefined();

        case CType::CTYPES_INT8:
        {
            int8_t val;
            memcpy(&val, buffer, 1);
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_UINT8:
        {
            uint8_t val;
            memcpy(&val, buffer, 1);
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_INT16:
        {
            int16_t val;
            memcpy(&val, buffer, 2);
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_UINT16:
        {
            uint16_t val;
            memcpy(&val, buffer, 2);
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_INT32:
        {
            int32_t val;
            memcpy(&val, buffer, 4);
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_UINT32:
        {
            uint32_t val;
            memcpy(&val, buffer, 4);
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_INT64:
        {
            int64_t val;
            memcpy(&val, buffer, 8);
            return Napi::BigInt::New(env, val);
        }

        case CType::CTYPES_UINT64:
        {
            uint64_t val;
            memcpy(&val, buffer, 8);
            return Napi::BigInt::New(env, val);
        }

        case CType::CTYPES_FLOAT:
        {
            float val;
            memcpy(&val, buffer, 4);
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_DOUBLE:
        {
            double val;
            memcpy(&val, buffer, 8);
            return Napi::Number::New(env, val);
        }

        case CType::CTYPES_BOOL:
        {
            uint8_t val;
            memcpy(&val, buffer, 1);
            return Napi::Boolean::New(env, val != 0);
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
            // Converti wchar_t* a stringa JS
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
            // Restituisci come numero (code point)
            return Napi::Number::New(env, static_cast<uint32_t>(val));
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
            // Su Windows long è 32-bit, su Unix 64-bit potrebbe essere 64-bit
            if (sizeof(long) <= 4)
            {
                return Napi::Number::New(env, static_cast<int32_t>(val));
            }
            else
            {
                return Napi::BigInt::New(env, static_cast<int64_t>(val));
            }
        }

        case CType::CTYPES_ULONG:
        {
            unsigned long val;
            memcpy(&val, buffer, sizeof(unsigned long));
            if (sizeof(unsigned long) <= 4)
            {
                return Napi::Number::New(env, static_cast<uint32_t>(val));
            }
            else
            {
                return Napi::BigInt::New(env, static_cast<uint64_t>(val));
            }
        }

        default:
            return env.Undefined();
        }
    }

    // TypeInfo class implementation
    Napi::Function TypeInfo::GetClass(Napi::Env env)
    {
        spdlog::trace(__FUNCTION__);

        return DefineClass(
            env,
            "CType",
            {
                InstanceMethod("size", &TypeInfo::GetSize),
                InstanceMethod("name", &TypeInfo::GetName),
                InstanceAccessor("sizeof", &TypeInfo::GetSize, nullptr),
            });
    }

    TypeInfo::TypeInfo(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<TypeInfo>(info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString())
        {
            Napi::TypeError::New(env, "Type name string expected")
                .ThrowAsJavaScriptException();
            return;
        }

        name_ = info[0].As<Napi::String>().Utf8Value();

        try
        {
            ctype_ = StringToCType(name_);
            ffi_type_ = CTypeToFFI(ctype_);
            size_ = CTypeSize(ctype_);
        }
        catch (const std::exception &e)
        {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        }
    }

    Napi::Value TypeInfo::GetSize(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        return Napi::Number::New(info.Env(), static_cast<double>(size_));
    }

    Napi::Value TypeInfo::GetName(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        return Napi::String::New(info.Env(), name_);
    }

    // Crea i tipi predefiniti
    Napi::Object CreatePredefinedTypes(Napi::Env env, Napi::FunctionReference &typeInfoConstructor)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Object types = Napi::Object::New(env);

        auto createType = [&](const char *name)
        {
            Napi::Value arg = Napi::String::New(env, name);
            return typeInfoConstructor.New({arg});
        };

        // Tipi base
        types.Set("void", createType("void"));
        types.Set("int8", createType("int8"));
        types.Set("uint8", createType("uint8"));
        types.Set("int16", createType("int16"));
        types.Set("uint16", createType("uint16"));
        types.Set("int32", createType("int32"));
        types.Set("uint32", createType("uint32"));
        types.Set("int64", createType("int64"));
        types.Set("uint64", createType("uint64"));
        types.Set("float", createType("float"));
        types.Set("double", createType("double"));
        types.Set("bool", createType("bool"));
        types.Set("pointer", createType("pointer"));
        types.Set("string", createType("string"));
        types.Set("wstring", createType("wstring"));
        types.Set("wchar", createType("wchar"));
        types.Set("size_t", createType("size_t"));
        types.Set("long", createType("long"));
        types.Set("ulong", createType("ulong"));

        // Alias stile ctypes Python
        types.Set("c_int8", createType("int8"));
        types.Set("c_uint8", createType("uint8"));
        types.Set("c_int16", createType("int16"));
        types.Set("c_uint16", createType("uint16"));
        types.Set("c_int32", createType("int32"));
        types.Set("c_uint32", createType("uint32"));
        types.Set("c_int64", createType("int64"));
        types.Set("c_uint64", createType("uint64"));
        types.Set("c_float", createType("float"));
        types.Set("c_double", createType("double"));
        types.Set("c_bool", createType("bool"));
        types.Set("c_char_p", createType("string"));
        types.Set("c_wchar_p", createType("wstring"));
        types.Set("c_wchar", createType("wchar"));
        types.Set("c_void_p", createType("pointer"));
        types.Set("c_size_t", createType("size_t"));
        types.Set("c_long", createType("long"));
        types.Set("c_ulong", createType("ulong"));

        // Alias comuni
        types.Set("c_int", createType("int32"));
        types.Set("c_uint", createType("uint32"));
        types.Set("c_char", createType("int8"));
        types.Set("c_uchar", createType("uint8"));
        types.Set("c_short", createType("int16"));
        types.Set("c_ushort", createType("uint16"));

        return types;
    }

} // namespace ctypes
