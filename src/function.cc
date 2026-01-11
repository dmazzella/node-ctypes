#include "function.h"
#include <cstring>
#include <memory>
#include <stdexcept>

namespace ctypes
{

    Napi::FunctionReference FFIFunction::constructor;

    CallConv StringToCallConv(const std::string &name)
    {
        if (name == "cdecl" || name == "default")
            return CallConv::CDECL;
        if (name == "stdcall")
            return CallConv::STDCALL;
        if (name == "fastcall")
            return CallConv::FASTCALL;
        if (name == "thiscall")
            return CallConv::THISCALL;
        return CallConv::DEFAULT;
    }

    ffi_abi CallConvToFFI(CallConv conv)
    {
        switch (conv)
        {
#if defined(_WIN32) && defined(__i386__)
        case CallConv::STDCALL:
            return FFI_STDCALL;
        case CallConv::FASTCALL:
            return FFI_FASTCALL;
        case CallConv::THISCALL:
            return FFI_THISCALL;
#endif
        case CallConv::CDECL:
        case CallConv::DEFAULT:
        default:
            return FFI_DEFAULT_ABI;
        }
    }

    Napi::Object FFIFunction::Init(Napi::Env env, Napi::Object exports)
    {
        Napi::Function func = DefineClass(env, "FFIFunction", {
                                                                  InstanceMethod("call", &FFIFunction::Call),
                                                                  InstanceAccessor("name", &FFIFunction::GetName, nullptr),
                                                                  InstanceAccessor("address", &FFIFunction::GetAddress, nullptr),
                                                              });

        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();

        exports.Set("FFIFunction", func);
        return exports;
    }

    FFIFunction::FFIFunction(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<FFIFunction>(info),
          fn_ptr_(nullptr),
          cif_prepared_(false),
          abi_(FFI_DEFAULT_ABI),
          return_type_(CType::VOID),
          ffi_return_type_(nullptr),
          use_inline_storage_(true)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 3)
        {
            Napi::TypeError::New(env, "FFIFunction requires fnPtr, name, returnType, argTypes")
                .ThrowAsJavaScriptException();
            return;
        }

        // 1. Function pointer
        if (!info[0].IsExternal())
        {
            Napi::TypeError::New(env, "First argument must be a function pointer")
                .ThrowAsJavaScriptException();
            return;
        }
        fn_ptr_ = info[0].As<Napi::External<void>>().Data();

        // 2. Name
        if (!info[1].IsString())
        {
            Napi::TypeError::New(env, "Second argument must be function name")
                .ThrowAsJavaScriptException();
            return;
        }
        name_ = info[1].As<Napi::String>().Utf8Value();

        // 3. Return type
        try
        {
            if (info[2].IsString())
            {
                return_type_ = StringToCType(info[2].As<Napi::String>().Utf8Value());
            }
            else if (info[2].IsObject())
            {
                Napi::Object obj = info[2].As<Napi::Object>();
                if (obj.InstanceOf(TypeInfo::constructor.Value()))
                {
                    return_type_ = Napi::ObjectWrap<TypeInfo>::Unwrap(obj)->GetCType();
                }
                else
                {
                    throw std::runtime_error("Invalid return type object");
                }
            }
            else
            {
                throw std::runtime_error("Return type must be string or CType");
            }
        }
        catch (const std::exception &e)
        {
            Napi::Error::New(env, std::string("Invalid return type: ") + e.what())
                .ThrowAsJavaScriptException();
            return;
        }

        // 4. Argument types
        if (info.Length() > 3 && info[3].IsArray())
        {
            Napi::Array arr = info[3].As<Napi::Array>();
            arg_types_.reserve(arr.Length());

            for (uint32_t i = 0; i < arr.Length(); i++)
            {
                Napi::Value elem = arr.Get(i);

                try
                {
                    if (elem.IsString())
                    {
                        arg_types_.push_back(StringToCType(elem.As<Napi::String>().Utf8Value()));
                    }
                    else if (elem.IsObject())
                    {
                        Napi::Object obj = elem.As<Napi::Object>();
                        if (obj.InstanceOf(TypeInfo::constructor.Value()))
                        {
                            arg_types_.push_back(
                                Napi::ObjectWrap<TypeInfo>::Unwrap(obj)->GetCType());
                        }
                        else
                        {
                            throw std::runtime_error("Invalid type object");
                        }
                    }
                    else
                    {
                        throw std::runtime_error("Type must be string or CType");
                    }
                }
                catch (const std::exception &e)
                {
                    Napi::Error::New(env, std::string("Invalid argument type at index ") +
                                              std::to_string(i) + ": " + e.what())
                        .ThrowAsJavaScriptException();
                    return;
                }
            }
        }

        // 5. Options
        if (info.Length() > 4 && info[4].IsObject())
        {
            Napi::Object opts = info[4].As<Napi::Object>();
            if (opts.Has("abi"))
            {
                abi_ = CallConvToFFI(StringToCallConv(
                    opts.Get("abi").As<Napi::String>().Utf8Value()));
            }
        }

        // Determina se usare storage inline o heap
        use_inline_storage_ = (arg_types_.size() <= MAX_INLINE_ARGS);

        // Pre-alloca heap storage se necessario
        if (!use_inline_storage_)
        {
            heap_arg_storage_.resize(arg_types_.size() * ARG_SLOT_SIZE);
            heap_arg_values_.resize(arg_types_.size());
        }

        // Pre-alloca string buffer (stima iniziale)
        size_t string_count = 0;
        for (const auto &type : arg_types_)
        {
            if (type == CType::STRING)
                string_count++;
        }
        if (string_count > 0)
        {
            string_buffer_.reserve(string_count * 128); // 128 bytes per stringa media
        }

        if (!PrepareFFI(env))
        {
            return;
        }
    }

    FFIFunction::~FFIFunction() = default;

    bool FFIFunction::PrepareFFI(Napi::Env env)
    {
        ffi_return_type_ = CTypeToFFI(return_type_);

        ffi_arg_types_.clear();
        ffi_arg_types_.reserve(arg_types_.size());
        for (const auto &type : arg_types_)
        {
            ffi_arg_types_.push_back(CTypeToFFI(type));
        }

        ffi_status status = ffi_prep_cif(
            &cif_,
            abi_,
            static_cast<unsigned int>(ffi_arg_types_.size()),
            ffi_return_type_,
            ffi_arg_types_.empty() ? nullptr : ffi_arg_types_.data());

        if (status != FFI_OK)
        {
            const char *msg = "Failed to prepare FFI call interface";
            Napi::Error::New(env, msg).ThrowAsJavaScriptException();
            return false;
        }

        cif_prepared_ = true;
        return true;
    }

    // ============================================================================
    // Inline conversion per return value - evita duplicazione
    // ============================================================================

    inline Napi::Value FFIFunction::ConvertReturnValue(Napi::Env env)
    {
        napi_value result;

        switch (return_type_)
        {
        case CType::VOID:
            return env.Undefined();

        case CType::INT32:
        {
            int32_t val;
            memcpy(&val, inline_return_buffer_, 4);
            napi_create_int32(env, val, &result);
            return Napi::Value(env, result);
        }

        case CType::UINT32:
        {
            uint32_t val;
            memcpy(&val, inline_return_buffer_, 4);
            napi_create_uint32(env, val, &result);
            return Napi::Value(env, result);
        }

        case CType::INT64:
        {
            int64_t val;
            memcpy(&val, inline_return_buffer_, 8);
            napi_create_bigint_int64(env, val, &result);
            return Napi::Value(env, result);
        }

        case CType::UINT64:
        case CType::SIZE_T:
        {
            uint64_t val;
            memcpy(&val, inline_return_buffer_, 8);
            napi_create_bigint_uint64(env, val, &result);
            return Napi::Value(env, result);
        }

        case CType::DOUBLE:
        {
            double val;
            memcpy(&val, inline_return_buffer_, 8);
            napi_create_double(env, val, &result);
            return Napi::Value(env, result);
        }

        case CType::FLOAT:
        {
            float val;
            memcpy(&val, inline_return_buffer_, 4);
            napi_create_double(env, static_cast<double>(val), &result);
            return Napi::Value(env, result);
        }

        case CType::BOOL:
        {
            uint8_t val;
            memcpy(&val, inline_return_buffer_, 1);
            napi_get_boolean(env, val != 0, &result);
            return Napi::Value(env, result);
        }

        case CType::POINTER:
        {
            void *ptr;
            memcpy(&ptr, inline_return_buffer_, sizeof(void *));
            if (ptr == nullptr)
            {
                return env.Null();
            }
            napi_create_bigint_uint64(env, reinterpret_cast<uint64_t>(ptr), &result);
            return Napi::Value(env, result);
        }

        case CType::STRING:
        {
            char *str;
            memcpy(&str, inline_return_buffer_, sizeof(char *));
            if (str == nullptr)
            {
                return env.Null();
            }
            napi_create_string_utf8(env, str, NAPI_AUTO_LENGTH, &result);
            return Napi::Value(env, result);
        }

        case CType::WSTRING:
        {
            wchar_t *str;
            memcpy(&str, inline_return_buffer_, sizeof(wchar_t *));
            if (str == nullptr)
            {
                return env.Null();
            }
#ifdef _WIN32
            // Windows: wchar_t è 16-bit (UTF-16)
            napi_create_string_utf16(env, reinterpret_cast<const char16_t *>(str),
                                     NAPI_AUTO_LENGTH, &result);
            return Napi::Value(env, result);
#else
            // Unix: wchar_t è 32-bit, converti a UTF-8
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
            napi_create_string_utf8(env, utf8.c_str(), utf8.size(), &result);
            return Napi::Value(env, result);
#endif
        }

        case CType::LONG:
        {
            long val;
            memcpy(&val, inline_return_buffer_, sizeof(long));
            if (sizeof(long) <= 4)
            {
                napi_create_int32(env, static_cast<int32_t>(val), &result);
            }
            else
            {
                napi_create_bigint_int64(env, static_cast<int64_t>(val), &result);
            }
            return Napi::Value(env, result);
        }

        case CType::ULONG:
        {
            unsigned long val;
            memcpy(&val, inline_return_buffer_, sizeof(unsigned long));
            if (sizeof(unsigned long) <= 4)
            {
                napi_create_uint32(env, static_cast<uint32_t>(val), &result);
            }
            else
            {
                napi_create_bigint_uint64(env, static_cast<uint64_t>(val), &result);
            }
            return Napi::Value(env, result);
        }

        default:
            return CToJS(env, inline_return_buffer_, return_type_);
        }
    }

    // ============================================================================
    // Call - Ottimizzato con fast paths
    // ============================================================================

    Napi::Value FFIFunction::Call(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (!cif_prepared_) [[unlikely]]
        {
            Napi::Error::New(env, "FFI call interface not prepared")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        const size_t argc = arg_types_.size();

        // =====================================================================
        // Fast path: funzioni senza argomenti (es. GetTickCount)
        // =====================================================================
        if (argc == 0)
        {
            ffi_call(&cif_, FFI_FN(fn_ptr_), inline_return_buffer_, nullptr);
            return ConvertReturnValue(env);
        }

        // =====================================================================
        // Fast path: un solo argomento int32 (es. abs)
        // =====================================================================
        if (argc == 1 && arg_types_[0] == CType::INT32)
        {
            int32_t arg;
            napi_get_value_int32(env, info[0], &arg);
            void *arg_ptr = &arg;
            ffi_call(&cif_, FFI_FN(fn_ptr_), inline_return_buffer_, &arg_ptr);
            return ConvertReturnValue(env);
        }

        // =====================================================================
        // Fast path: un solo argomento double (es. sqrt)
        // =====================================================================
        if (argc == 1 && arg_types_[0] == CType::DOUBLE)
        {
            double arg;
            napi_get_value_double(env, info[0], &arg);
            void *arg_ptr = &arg;
            ffi_call(&cif_, FFI_FN(fn_ptr_), inline_return_buffer_, &arg_ptr);
            return ConvertReturnValue(env);
        }

        // =====================================================================
        // Fast path: un solo argomento stringa (es. strlen)
        // =====================================================================
        if (argc == 1 && arg_types_[0] == CType::STRING && info[0].IsString())
        {
            napi_value nval = info[0];
            size_t len;
            napi_get_value_string_utf8(env, nval, nullptr, 0, &len);

            // Usa buffer inline se la stringa è piccola
            char small_buf[256];
            char *str_ptr;

            if (len < sizeof(small_buf))
            {
                napi_get_value_string_utf8(env, nval, small_buf, sizeof(small_buf), &len);
                str_ptr = small_buf;
            }
            else
            {
                string_buffer_.resize(len + 1);
                napi_get_value_string_utf8(env, nval, string_buffer_.data(), len + 1, &len);
                str_ptr = string_buffer_.data();
            }

            void *arg_ptr = &str_ptr;
            ffi_call(&cif_, FFI_FN(fn_ptr_), inline_return_buffer_, &arg_ptr);
            return ConvertReturnValue(env);
        }

        // =====================================================================
        // Path generale
        // =====================================================================

        if (info.Length() < argc) [[unlikely]]
        {
            Napi::TypeError::New(env,
                                 "Expected " + std::to_string(argc) +
                                     " arguments, got " + std::to_string(info.Length()))
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Seleziona buffer (inline o heap)
        uint8_t *arg_storage;
        void **arg_values;

        if (use_inline_storage_)
        {
            arg_storage = inline_arg_storage_;
            arg_values = inline_arg_values_;
        }
        else
        {
            arg_storage = heap_arg_storage_.data();
            arg_values = heap_arg_values_.data();
        }

        // Reset string buffer (mantieni capacità)
        string_buffer_.clear();

        // Converti argomenti
        for (size_t i = 0; i < argc; i++)
        {
            uint8_t *slot = arg_storage + (i * ARG_SLOT_SIZE);
            arg_values[i] = slot;

            const CType type = arg_types_[i];
            const Napi::Value &val = info[i];

            switch (type)
            {
            case CType::INT32:
            {
                int32_t v = val.As<Napi::Number>().Int32Value();
                memcpy(slot, &v, 4);
                break;
            }

            case CType::UINT32:
            {
                uint32_t v = val.As<Napi::Number>().Uint32Value();
                memcpy(slot, &v, 4);
                break;
            }

            case CType::INT64:
            case CType::UINT64:
            case CType::SIZE_T:
            case CType::SSIZE_T:
            {
                int64_t v;
                if (val.IsBigInt())
                {
                    bool lossless;
                    v = val.As<Napi::BigInt>().Int64Value(&lossless);
                }
                else
                {
                    v = val.As<Napi::Number>().Int64Value();
                }
                memcpy(slot, &v, 8);
                break;
            }

            case CType::DOUBLE:
            {
                double v = val.As<Napi::Number>().DoubleValue();
                memcpy(slot, &v, 8);
                break;
            }

            case CType::FLOAT:
            {
                float v = static_cast<float>(val.As<Napi::Number>().FloatValue());
                memcpy(slot, &v, 4);
                break;
            }

            case CType::POINTER:
            {
                void *ptr = nullptr;
                if (val.IsNull() || val.IsUndefined())
                {
                    ptr = nullptr;
                }
                else if (val.IsBuffer())
                {
                    ptr = val.As<Napi::Buffer<uint8_t>>().Data();
                }
                else if (val.IsBigInt())
                {
                    bool lossless;
                    ptr = reinterpret_cast<void *>(val.As<Napi::BigInt>().Uint64Value(&lossless));
                }
                else if (val.IsNumber())
                {
                    ptr = reinterpret_cast<void *>(static_cast<uintptr_t>(
                        val.As<Napi::Number>().Int64Value()));
                }
                memcpy(slot, &ptr, sizeof(void *));
                break;
            }

            case CType::STRING:
            {
                if (val.IsString())
                {
                    // Usa N-API direttamente per evitare std::string temporanea
                    napi_value nval = val;

                    // Prima chiamata: ottieni lunghezza
                    size_t len;
                    napi_get_value_string_utf8(env, nval, nullptr, 0, &len);

                    // Alloca spazio nel buffer
                    size_t offset = string_buffer_.size();
                    string_buffer_.resize(offset + len + 1);

                    // Seconda chiamata: copia stringa
                    napi_get_value_string_utf8(env, nval,
                                               string_buffer_.data() + offset, len + 1, &len);

                    const char *str_ptr = string_buffer_.data() + offset;
                    memcpy(slot, &str_ptr, sizeof(char *));
                }
                else if (val.IsBuffer())
                {
                    const char *ptr = reinterpret_cast<const char *>(
                        val.As<Napi::Buffer<uint8_t>>().Data());
                    memcpy(slot, &ptr, sizeof(char *));
                }
                else
                {
                    const char *null_ptr = nullptr;
                    memcpy(slot, &null_ptr, sizeof(char *));
                }
                break;
            }

            case CType::WSTRING:
            {
                if (val.IsString())
                {
                    // Ottieni stringa UTF-16
                    std::u16string u16str = val.As<Napi::String>().Utf16Value();

                    // Alloca spazio per wchar_t*
                    size_t wchar_size = sizeof(wchar_t);
                    size_t byte_len = (u16str.length() + 1) * wchar_size;

                    size_t offset = string_buffer_.size();
                    string_buffer_.resize(offset + byte_len);

#ifdef _WIN32
                    // Windows: wchar_t è 16-bit, copia direttamente
                    memcpy(string_buffer_.data() + offset, u16str.data(), byte_len);
#else
                    // Unix: wchar_t è 32-bit, converti da UTF-16
                    wchar_t *wptr = reinterpret_cast<wchar_t *>(string_buffer_.data() + offset);
                    for (size_t j = 0; j < u16str.length(); j++)
                    {
                        wptr[j] = static_cast<wchar_t>(u16str[j]);
                    }
                    wptr[u16str.length()] = L'\0';
#endif

                    const wchar_t *str_ptr = reinterpret_cast<const wchar_t *>(
                        string_buffer_.data() + offset);
                    memcpy(slot, &str_ptr, sizeof(wchar_t *));
                }
                else if (val.IsBuffer())
                {
                    const wchar_t *ptr = reinterpret_cast<const wchar_t *>(
                        val.As<Napi::Buffer<uint8_t>>().Data());
                    memcpy(slot, &ptr, sizeof(wchar_t *));
                }
                else
                {
                    const wchar_t *null_ptr = nullptr;
                    memcpy(slot, &null_ptr, sizeof(wchar_t *));
                }
                break;
            }

            case CType::LONG:
            {
                long v;
                if (val.IsBigInt())
                {
                    bool lossless;
                    v = static_cast<long>(val.As<Napi::BigInt>().Int64Value(&lossless));
                }
                else
                {
                    v = static_cast<long>(val.As<Napi::Number>().Int64Value());
                }
                memcpy(slot, &v, sizeof(long));
                break;
            }

            case CType::ULONG:
            {
                unsigned long v;
                if (val.IsBigInt())
                {
                    bool lossless;
                    v = static_cast<unsigned long>(val.As<Napi::BigInt>().Uint64Value(&lossless));
                }
                else
                {
                    v = static_cast<unsigned long>(val.As<Napi::Number>().Int64Value());
                }
                memcpy(slot, &v, sizeof(unsigned long));
                break;
            }

            case CType::BOOL:
            {
                uint8_t v = val.ToBoolean().Value() ? 1 : 0;
                memcpy(slot, &v, 1);
                break;
            }

            case CType::INT8:
            {
                int8_t v = static_cast<int8_t>(val.As<Napi::Number>().Int32Value());
                memcpy(slot, &v, 1);
                break;
            }

            case CType::UINT8:
            {
                uint8_t v = static_cast<uint8_t>(val.As<Napi::Number>().Uint32Value());
                memcpy(slot, &v, 1);
                break;
            }

            case CType::INT16:
            {
                int16_t v = static_cast<int16_t>(val.As<Napi::Number>().Int32Value());
                memcpy(slot, &v, 2);
                break;
            }

            case CType::UINT16:
            {
                uint16_t v = static_cast<uint16_t>(val.As<Napi::Number>().Uint32Value());
                memcpy(slot, &v, 2);
                break;
            }

            default:
                // Fallback generico
                JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                break;
            }
        }

        // Effettua la chiamata
        ffi_call(&cif_, FFI_FN(fn_ptr_), inline_return_buffer_, arg_values);

        return ConvertReturnValue(env);
    }

    Napi::Value FFIFunction::GetName(const Napi::CallbackInfo &info)
    {
        return Napi::String::New(info.Env(), name_);
    }

    Napi::Value FFIFunction::GetAddress(const Napi::CallbackInfo &info)
    {
        return Napi::BigInt::New(info.Env(), reinterpret_cast<uint64_t>(fn_ptr_));
    }

} // namespace ctypes
