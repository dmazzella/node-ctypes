#include "types.h"
#include <cstring>
#include <cwchar>
#include <stdexcept>

// ssize_t non esiste su Windows MSVC
#ifdef _MSC_VER
#include <BaseTsd.h>
typedef SSIZE_T ssize_t;
#endif

namespace ctypes
{

    Napi::FunctionReference TypeInfo::constructor;

    // Mappa stringa -> CType
    static const std::unordered_map<std::string, CType> type_map = {
        {"void", CType::VOID},
        {"int8", CType::INT8},
        {"int8_t", CType::INT8},
        {"char", CType::INT8},
        {"uint8", CType::UINT8},
        {"uint8_t", CType::UINT8},
        {"uchar", CType::UINT8},
        {"unsigned char", CType::UINT8},
        {"int16", CType::INT16},
        {"int16_t", CType::INT16},
        {"short", CType::INT16},
        {"uint16", CType::UINT16},
        {"uint16_t", CType::UINT16},
        {"ushort", CType::UINT16},
        {"unsigned short", CType::UINT16},
        {"int32", CType::INT32},
        {"int32_t", CType::INT32},
        {"int", CType::INT32},
        {"uint32", CType::UINT32},
        {"uint32_t", CType::UINT32},
        {"uint", CType::UINT32},
        {"unsigned int", CType::UINT32},
        {"int64", CType::INT64},
        {"int64_t", CType::INT64},
        {"long long", CType::INT64},
        {"uint64", CType::UINT64},
        {"uint64_t", CType::UINT64},
        {"unsigned long long", CType::UINT64},
        {"float", CType::FLOAT},
        {"double", CType::DOUBLE},
        {"pointer", CType::POINTER},
        {"void*", CType::POINTER},
        {"ptr", CType::POINTER},
        {"string", CType::STRING},
        {"char*", CType::STRING},
        {"cstring", CType::STRING},
        {"wstring", CType::WSTRING},
        {"wchar_t*", CType::WSTRING},
        {"bool", CType::BOOL},
        {"_Bool", CType::BOOL},
        {"size_t", CType::SIZE_T},
        {"ssize_t", CType::SSIZE_T}};

    CType StringToCType(const std::string &name)
    {
        auto it = type_map.find(name);
        if (it != type_map.end())
        {
            return it->second;
        }
        throw std::runtime_error("Unknown type: " + name);
    }

    ffi_type *CTypeToFFI(CType type)
    {
        switch (type)
        {
        case CType::VOID:
            return &ffi_type_void;
        case CType::INT8:
            return &ffi_type_sint8;
        case CType::UINT8:
            return &ffi_type_uint8;
        case CType::INT16:
            return &ffi_type_sint16;
        case CType::UINT16:
            return &ffi_type_uint16;
        case CType::INT32:
            return &ffi_type_sint32;
        case CType::UINT32:
            return &ffi_type_uint32;
        case CType::INT64:
            return &ffi_type_sint64;
        case CType::UINT64:
            return &ffi_type_uint64;
        case CType::FLOAT:
            return &ffi_type_float;
        case CType::DOUBLE:
            return &ffi_type_double;
        case CType::POINTER:
            return &ffi_type_pointer;
        case CType::STRING:
            return &ffi_type_pointer;
        case CType::WSTRING:
            return &ffi_type_pointer;
        case CType::BOOL:
            return &ffi_type_uint8;
        case CType::SIZE_T:
            return &ffi_type_pointer; // size_t è tipicamente pointer-sized
        case CType::SSIZE_T:
            return &ffi_type_pointer;
        default:
            return &ffi_type_void;
        }
    }

    size_t CTypeSize(CType type)
    {
        switch (type)
        {
        case CType::VOID:
            return 0;
        case CType::INT8:
            return 1;
        case CType::UINT8:
            return 1;
        case CType::INT16:
            return 2;
        case CType::UINT16:
            return 2;
        case CType::INT32:
            return 4;
        case CType::UINT32:
            return 4;
        case CType::INT64:
            return 8;
        case CType::UINT64:
            return 8;
        case CType::FLOAT:
            return 4;
        case CType::DOUBLE:
            return 8;
        case CType::POINTER:
            return sizeof(void *);
        case CType::STRING:
            return sizeof(char *);
        case CType::WSTRING:
            return sizeof(wchar_t *);
        case CType::BOOL:
            return 1;
        case CType::SIZE_T:
            return sizeof(size_t);
        case CType::SSIZE_T:
            return sizeof(ssize_t);
        default:
            return 0;
        }
    }

    int JSToC(Napi::Env env, Napi::Value value, CType type, void *buffer, size_t bufsize)
    {
        switch (type)
        {
        case CType::VOID:
            return 0;

        case CType::INT8:
        {
            if (bufsize < 1)
                return -1;
            int8_t val = static_cast<int8_t>(value.ToNumber().Int32Value());
            memcpy(buffer, &val, 1);
            return 1;
        }

        case CType::UINT8:
        {
            if (bufsize < 1)
                return -1;
            uint8_t val = static_cast<uint8_t>(value.ToNumber().Uint32Value());
            memcpy(buffer, &val, 1);
            return 1;
        }

        case CType::INT16:
        {
            if (bufsize < 2)
                return -1;
            int16_t val = static_cast<int16_t>(value.ToNumber().Int32Value());
            memcpy(buffer, &val, 2);
            return 2;
        }

        case CType::UINT16:
        {
            if (bufsize < 2)
                return -1;
            uint16_t val = static_cast<uint16_t>(value.ToNumber().Uint32Value());
            memcpy(buffer, &val, 2);
            return 2;
        }

        case CType::INT32:
        {
            if (bufsize < 4)
                return -1;
            int32_t val = value.ToNumber().Int32Value();
            memcpy(buffer, &val, 4);
            return 4;
        }

        case CType::UINT32:
        {
            if (bufsize < 4)
                return -1;
            uint32_t val = value.ToNumber().Uint32Value();
            memcpy(buffer, &val, 4);
            return 4;
        }

        case CType::INT64:
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

        case CType::UINT64:
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

        case CType::FLOAT:
        {
            if (bufsize < 4)
                return -1;
            float val = static_cast<float>(value.ToNumber().FloatValue());
            memcpy(buffer, &val, 4);
            return 4;
        }

        case CType::DOUBLE:
        {
            if (bufsize < 8)
                return -1;
            double val = value.ToNumber().DoubleValue();
            memcpy(buffer, &val, 8);
            return 8;
        }

        case CType::BOOL:
        {
            if (bufsize < 1)
                return -1;
            uint8_t val = value.ToBoolean().Value() ? 1 : 0;
            memcpy(buffer, &val, 1);
            return 1;
        }

        case CType::POINTER:
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
                // Gestisci BigInt (preferito per puntatori)
                bool lossless;
                uint64_t addr = value.As<Napi::BigInt>().Uint64Value(&lossless);
                ptr = reinterpret_cast<void *>(addr);
            }
            else if (value.IsNumber())
            {
                // Permetti di passare un indirizzo come numero (per retrocompatibilità)
                ptr = reinterpret_cast<void *>(static_cast<uintptr_t>(
                    value.ToNumber().Int64Value()));
            }

            memcpy(buffer, &ptr, sizeof(void *));
            return sizeof(void *);
        }

        case CType::STRING:
        {
            if (bufsize < sizeof(char *))
                return -1;
            const char *str = nullptr;

            if (value.IsNull() || value.IsUndefined())
            {
                str = nullptr;
            }
            else if (value.IsString())
            {
                // NOTA: questa stringa deve rimanere valida durante la chiamata FFI
                // Per una soluzione robusta, dovremmo gestire la memoria separatamente
                std::string s = value.ToString().Utf8Value();
                char *copy = new char[s.length() + 1];
                strcpy(copy, s.c_str());
                str = copy;
            }
            else if (value.IsBuffer())
            {
                str = reinterpret_cast<const char *>(
                    value.As<Napi::Buffer<uint8_t>>().Data());
            }

            memcpy(buffer, &str, sizeof(char *));
            return sizeof(char *);
        }

        case CType::SIZE_T:
        {
            if (bufsize < sizeof(size_t))
                return -1;
            size_t val = static_cast<size_t>(value.ToNumber().Int64Value());
            memcpy(buffer, &val, sizeof(size_t));
            return sizeof(size_t);
        }

        case CType::SSIZE_T:
        {
            if (bufsize < sizeof(ssize_t))
                return -1;
            ssize_t val = static_cast<ssize_t>(value.ToNumber().Int64Value());
            memcpy(buffer, &val, sizeof(ssize_t));
            return sizeof(ssize_t);
        }

        default:
            return -1;
        }
    }

    Napi::Value CToJS(Napi::Env env, const void *buffer, CType type)
    {
        switch (type)
        {
        case CType::VOID:
            return env.Undefined();

        case CType::INT8:
        {
            int8_t val;
            memcpy(&val, buffer, 1);
            return Napi::Number::New(env, val);
        }

        case CType::UINT8:
        {
            uint8_t val;
            memcpy(&val, buffer, 1);
            return Napi::Number::New(env, val);
        }

        case CType::INT16:
        {
            int16_t val;
            memcpy(&val, buffer, 2);
            return Napi::Number::New(env, val);
        }

        case CType::UINT16:
        {
            uint16_t val;
            memcpy(&val, buffer, 2);
            return Napi::Number::New(env, val);
        }

        case CType::INT32:
        {
            int32_t val;
            memcpy(&val, buffer, 4);
            return Napi::Number::New(env, val);
        }

        case CType::UINT32:
        {
            uint32_t val;
            memcpy(&val, buffer, 4);
            return Napi::Number::New(env, val);
        }

        case CType::INT64:
        {
            int64_t val;
            memcpy(&val, buffer, 8);
            return Napi::BigInt::New(env, val);
        }

        case CType::UINT64:
        {
            uint64_t val;
            memcpy(&val, buffer, 8);
            return Napi::BigInt::New(env, val);
        }

        case CType::FLOAT:
        {
            float val;
            memcpy(&val, buffer, 4);
            return Napi::Number::New(env, val);
        }

        case CType::DOUBLE:
        {
            double val;
            memcpy(&val, buffer, 8);
            return Napi::Number::New(env, val);
        }

        case CType::BOOL:
        {
            uint8_t val;
            memcpy(&val, buffer, 1);
            return Napi::Boolean::New(env, val != 0);
        }

        case CType::POINTER:
        {
            void *ptr;
            memcpy(&ptr, buffer, sizeof(void *));
            if (ptr == nullptr)
            {
                return env.Null();
            }
            // Ritorna come BigInt per preservare l'indirizzo completo
            return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(ptr));
        }

        case CType::STRING:
        {
            char *str;
            memcpy(&str, buffer, sizeof(char *));
            if (str == nullptr)
            {
                return env.Null();
            }
            return Napi::String::New(env, str);
        }

        case CType::SIZE_T:
        {
            size_t val;
            memcpy(&val, buffer, sizeof(size_t));
            return Napi::BigInt::New(env, static_cast<uint64_t>(val));
        }

        case CType::SSIZE_T:
        {
            ssize_t val;
            memcpy(&val, buffer, sizeof(ssize_t));
            return Napi::BigInt::New(env, static_cast<int64_t>(val));
        }

        default:
            return env.Undefined();
        }
    }

    // TypeInfo class implementation
    Napi::Object TypeInfo::Init(Napi::Env env, Napi::Object exports)
    {
        Napi::Function func = DefineClass(env, "CType", {
                                                            InstanceMethod("size", &TypeInfo::GetSize),
                                                            InstanceMethod("name", &TypeInfo::GetName),
                                                            InstanceAccessor("sizeof", &TypeInfo::GetSize, nullptr),
                                                        });

        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();

        exports.Set("CType", func);
        return exports;
    }

    TypeInfo::TypeInfo(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<TypeInfo>(info)
    {
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
        return Napi::Number::New(info.Env(), static_cast<double>(size_));
    }

    Napi::Value TypeInfo::GetName(const Napi::CallbackInfo &info)
    {
        return Napi::String::New(info.Env(), name_);
    }

    // Crea i tipi predefiniti
    Napi::Object CreatePredefinedTypes(Napi::Env env)
    {
        Napi::Object types = Napi::Object::New(env);

        auto createType = [&](const char *name)
        {
            Napi::Value arg = Napi::String::New(env, name);
            return TypeInfo::constructor.New({arg});
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
        types.Set("size_t", createType("size_t"));

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
        types.Set("c_void_p", createType("pointer"));
        types.Set("c_size_t", createType("size_t"));

        // Alias comuni
        types.Set("c_int", createType("int32"));
        types.Set("c_uint", createType("uint32"));
        types.Set("c_long", createType("int64"));
        types.Set("c_ulong", createType("uint64"));
        types.Set("c_char", createType("int8"));
        types.Set("c_uchar", createType("uint8"));
        types.Set("c_short", createType("int16"));
        types.Set("c_ushort", createType("uint16"));

        return types;
    }

} // namespace ctypes
