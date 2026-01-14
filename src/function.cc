#include "function.h"

namespace ctypes
{

    CallConv StringToCallConv(const std::string &name)
    {
        spdlog::trace(__FUNCTION__);

        if (name == "cdecl" || name == "default")
            return CallConv::CTYPES_CDECL;
        if (name == "stdcall")
            return CallConv::CTYPES_STDCALL;
        if (name == "fastcall")
            return CallConv::CTYPES_FASTCALL;
        if (name == "thiscall")
            return CallConv::CTYPES_THISCALL;
        return CallConv::CTYPES_DEFAULT;
    }

    ffi_abi CallConvToFFI(CallConv conv)
    {
        spdlog::trace(__FUNCTION__);

        switch (conv)
        {
#if defined(_WIN32) && defined(__i386__)
        case CallConv::STDCALL:
            return FFI_STDCALL;
        case CallConv::CTYPES_FASTCALL:
            return FFI_FASTCALL;
        case CallConv::CTYPES_THISCALL:
            return FFI_THISCALL;
#endif
        case CallConv::CTYPES_CDECL:
        case CallConv::CTYPES_DEFAULT:
        default:
            return FFI_DEFAULT_ABI;
        }
    }

    Napi::Function FFIFunction::GetClass(Napi::Env env)
    {
        spdlog::trace(__FUNCTION__);

        return DefineClass(
            env,
            "FFIFunction",
            {
                InstanceMethod("call", &FFIFunction::Call),
                InstanceMethod("setErrcheck", &FFIFunction::SetErrcheck),
                InstanceAccessor("name", &FFIFunction::GetName, nullptr),
                InstanceAccessor("address", &FFIFunction::GetAddress, nullptr),
            });
    }

    FFIFunction::FFIFunction(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<FFIFunction>(info),
          fn_ptr_(nullptr),
          cif_prepared_(false),
          abi_(FFI_DEFAULT_ABI),
          return_type_(CType::CTYPES_VOID),
          ffi_return_type_(nullptr),
          use_inline_storage_(true),
          next_cache_slot_(0)
    {
        spdlog::trace(__FUNCTION__);

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

        // CRITICAL: Valida che il puntatore non sia NULL
        if (fn_ptr_ == nullptr)
        {
            Napi::Error::New(env, "Function pointer is NULL - cannot call invalid function")
                .ThrowAsJavaScriptException();
            return;
        }

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
                if (IsStructType(obj))
                {
                    // Return type è struct
                    return_type_ = CType::CTYPES_STRUCT;
                    return_struct_info_ = Napi::ObjectWrap<StructType>::Unwrap(obj)->GetStructInfo();
                }
                else if (IsArrayType(obj))
                {
                    // Return type è array
                    return_type_ = CType::CTYPES_ARRAY;
                    return_array_info_ = Napi::ObjectWrap<ArrayType>::Unwrap(obj)->GetArrayInfo();
                }
                else if (IsTypeInfo(obj))
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
            arg_struct_infos_.resize(arr.Length()); // Resize to match, null by default
            arg_array_infos_.resize(arr.Length());

            for (uint32_t i = 0; i < arr.Length(); i++)
            {
                Napi::Value elem = arr.Get(i);

                try
                {
                    if (elem.IsString())
                    {
                        arg_types_.push_back(StringToCType(elem.As<Napi::String>().Utf8Value()));
                        arg_struct_infos_[i] = nullptr;
                        arg_array_infos_[i] = nullptr;
                    }
                    else if (elem.IsObject())
                    {
                        Napi::Object obj = elem.As<Napi::Object>();
                        if (IsStructType(obj))
                        {
                            // Argument type è struct
                            arg_types_.push_back(CType::CTYPES_STRUCT);
                            arg_struct_infos_[i] = Napi::ObjectWrap<StructType>::Unwrap(obj)->GetStructInfo();
                            arg_array_infos_[i] = nullptr;
                        }
                        else if (IsArrayType(obj))
                        {
                            // Argument type è array
                            arg_types_.push_back(CType::CTYPES_ARRAY);
                            arg_struct_infos_[i] = nullptr;
                            arg_array_infos_[i] = Napi::ObjectWrap<ArrayType>::Unwrap(obj)->GetArrayInfo();
                        }
                        else if (IsTypeInfo(obj))
                        {
                            arg_types_.push_back(
                                Napi::ObjectWrap<TypeInfo>::Unwrap(obj)->GetCType());
                            arg_struct_infos_[i] = nullptr;
                            arg_array_infos_[i] = nullptr;
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

        // Pre-alloca heap storage se necessario (come CPython - pool struct argument)
        if (!use_inline_storage_)
        {
            heap_arg_storage_.resize(arg_types_.size() * ARG_SLOT_SIZE);
            heap_arg_values_.resize(arg_types_.size());
        }
        // Per arg counts piccoli usiamo sempre inline_arg_values_ (stack allocation)

        // Pre-alloca string buffer (stima iniziale)
        size_t string_count = 0;
        for (const auto &type : arg_types_)
        {
            if (type == CType::CTYPES_STRING)
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
        spdlog::trace(__FUNCTION__);

        // Return type FFI
        if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_)
        {
            ffi_return_type_ = return_struct_info_->GetFFIType();
        }
        else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_)
        {
            ffi_return_type_ = return_array_info_->GetFFIType();
        }
        else
        {
            ffi_return_type_ = CTypeToFFI(return_type_);
        }

        // Argument types FFI
        ffi_arg_types_.clear();
        ffi_arg_types_.reserve(arg_types_.size());
        for (size_t i = 0; i < arg_types_.size(); i++)
        {
            if (arg_types_[i] == CType::CTYPES_STRUCT && arg_struct_infos_[i])
            {
                ffi_arg_types_.push_back(arg_struct_infos_[i]->GetFFIType());
            }
            else if (arg_types_[i] == CType::CTYPES_ARRAY && arg_array_infos_[i])
            {
                ffi_arg_types_.push_back(arg_array_infos_[i]->GetFFIType());
            }
            else
            {
                ffi_arg_types_.push_back(CTypeToFFI(arg_types_[i]));
            }
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
    // Inline conversion per return value - usa union (consistente con CToJS)
    // ============================================================================

    inline Napi::Value FFIFunction::ConvertReturnValue(Napi::Env env)
    {
        spdlog::trace(__FUNCTION__);

        switch (return_type_)
        {
        case CType::CTYPES_VOID:
            return env.Undefined();

        case CType::CTYPES_INT32:
        {
            napi_value result;
            napi_create_int32(env, return_value_.i32, &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_UINT32:
        {
            napi_value result;
            napi_create_uint32(env, return_value_.u32, &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_INT64:
            return Napi::BigInt::New(env, return_value_.i64);

        case CType::CTYPES_UINT64:
        case CType::CTYPES_SIZE_T:
            return Napi::BigInt::New(env, return_value_.u64);

        case CType::CTYPES_DOUBLE:
        {
            napi_value result;
            napi_create_double(env, return_value_.d, &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_FLOAT:
        {
            napi_value result;
            napi_create_double(env, static_cast<double>(return_value_.f), &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_BOOL:
            return Napi::Boolean::New(env, return_value_.u8 != 0);

        case CType::CTYPES_POINTER:
            if (return_value_.p == nullptr)
            {
                return env.Null();
            }
            return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(return_value_.p));

        case CType::CTYPES_STRING:
        {
            if (return_value_.str == nullptr)
            {
                return env.Null();
            }
            napi_value result;
            napi_create_string_utf8(env, return_value_.str, NAPI_AUTO_LENGTH, &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_WSTRING:
        {
            if (return_value_.wstr == nullptr)
            {
                return env.Null();
            }
#ifdef _WIN32
            // Windows: wchar_t è 16-bit (UTF-16)
            return Napi::String::New(env, reinterpret_cast<const char16_t *>(return_value_.wstr));
#else
            // Unix: wchar_t è 32-bit, converti a UTF-8
            std::wstring wstr(return_value_.wstr);
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

        case CType::CTYPES_LONG:
            if (sizeof(long) <= 4)
            {
                return Napi::Number::New(env, static_cast<int32_t>(return_value_.i64));
            }
            return Napi::BigInt::New(env, return_value_.i64);

        case CType::CTYPES_ULONG:
            if (sizeof(unsigned long) <= 4)
            {
                return Napi::Number::New(env, static_cast<uint32_t>(return_value_.u64));
            }
            return Napi::BigInt::New(env, return_value_.u64);

        case CType::CTYPES_INT8:
            return Napi::Number::New(env, return_value_.i8);

        case CType::CTYPES_UINT8:
            return Napi::Number::New(env, return_value_.u8);

        case CType::CTYPES_INT16:
            return Napi::Number::New(env, return_value_.i16);

        case CType::CTYPES_UINT16:
            return Napi::Number::New(env, return_value_.u16);

        case CType::CTYPES_STRUCT:
        {
            // Struct by-value: converti buffer struct → JS object
            if (return_struct_info_)
            {
                return return_struct_info_->StructToJS(env, &return_value_);
            }
            // Fallback se non c'è struct info (non dovrebbe accadere)
            return env.Undefined();
        }

        case CType::CTYPES_ARRAY:
        {
            // Array by-value: converti buffer array → JS array
            if (return_array_info_)
            {
                return return_array_info_->ArrayToJS(env, &return_value_);
            }
            // Fallback se non c'è array info (non dovrebbe accadere)
            return env.Undefined();
        }

        default:
            // Fallback generico per tipi non comuni
            return CToJS(env, &return_value_, return_type_);
        }
    }

    // ============================================================================
    // Call - Ottimizzato con fast paths
    // ============================================================================

    Napi::Value FFIFunction::Call(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!cif_prepared_) [[unlikely]]
        {
            Napi::Error::New(env, "FFI call interface not prepared")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        const size_t info_argc = info.Length();
        const size_t expected_argc = arg_types_.size();
        size_t argc;
        bool need_reprep = false;

        // Fast path: numero esatto di argomenti (caso più comune)
        if (info_argc == expected_argc) [[likely]]
        {
            argc = expected_argc;
            // Continua con i fast paths sotto
        }
        else if (info_argc > expected_argc)
        {
            // Auto-variadic: più argomenti del previsto (come Python ctypes)
            argc = info_argc;
            need_reprep = true;
        }
        else [[unlikely]]
        {
            // Troppo pochi argomenti
            Napi::TypeError::New(env,
                                 "Expected " + std::to_string(expected_argc) +
                                     " arguments, got " + std::to_string(info_argc))
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // =====================================================================
        // Fast path: funzioni senza argomenti (es. GetTickCount)
        // =====================================================================
        if (argc == 0)
        {
            ffi_call(&cif_, FFI_FN(fn_ptr_), &return_value_, nullptr);
            if (return_type_ == CType::CTYPES_VOID)
            {
                if (errcheck_callback_.IsEmpty())
                    return env.Undefined();
                return ApplyErrcheck(env, env.Undefined(), info);
            }
            else
            {
                Napi::Value result = ConvertReturnValue(env);
                if (errcheck_callback_.IsEmpty())
                    return result;
                return ApplyErrcheck(env, result, info);
            }
        }

        // =====================================================================
        // Gestione variadic ottimizzata (ispirata a CPython ctypes)
        // =====================================================================
        ffi_cif *active_cif = &cif_;
        ffi_cif variadic_cif;
        VariadicCifCache *cache_entry = nullptr;
        size_t num_extra = 0; // Numero di argomenti extra variadic

        // Stack-allocated arrays per piccoli numeri di argomenti extra (come alloca in CPython)
        CType extra_types_stack[MAX_VARIADIC_EXTRA_ARGS];
        ffi_type *variadic_ffi_types_stack[MAX_INLINE_ARGS];

        std::vector<CType> extra_types_heap;
        std::vector<ffi_type *> variadic_ffi_types_heap;

        if (need_reprep)
        {
            size_t fixed_args = expected_argc;
            num_extra = argc - fixed_args;

            // Inferisci tipi degli argomenti extra
            CType *extra_types;
            if (num_extra <= MAX_VARIADIC_EXTRA_ARGS)
            {
                extra_types = extra_types_stack;
            }
            else
            {
                extra_types_heap.resize(num_extra);
                extra_types = extra_types_heap.data();
            }

            for (size_t i = 0; i < num_extra; i++)
            {
                const Napi::Value &val = info[fixed_args + i];

                // Inferisci il tipo dal valore JavaScript
                if (val.IsString())
                {
                    extra_types[i] = CType::CTYPES_STRING;
                }
                else if (val.IsNumber())
                {
                    double d = val.As<Napi::Number>().DoubleValue();
                    extra_types[i] = (d == static_cast<int32_t>(d)) ? CType::CTYPES_INT32 : CType::CTYPES_DOUBLE;
                }
                else if (val.IsBigInt())
                {
                    extra_types[i] = CType::CTYPES_INT64;
                }
                else if (val.IsBuffer())
                {
                    extra_types[i] = CType::CTYPES_POINTER;
                }
                else if (val.IsNull() || val.IsUndefined())
                {
                    extra_types[i] = CType::CTYPES_POINTER;
                }
                else
                {
                    extra_types[i] = CType::CTYPES_INT32; // fallback
                }
            }

            // Cerca in cache
            for (size_t i = 0; i < MAX_CACHED_VARIADIC_CIFS; i++)
            {
                if (variadic_cache_[i].valid &&
                    variadic_cache_[i].total_args == argc &&
                    variadic_cache_[i].extra_types.size() == num_extra)
                {

                    // Verifica match dei tipi extra
                    bool match = true;
                    for (size_t j = 0; j < num_extra; j++)
                    {
                        if (variadic_cache_[i].extra_types[j] != extra_types[j])
                        {
                            match = false;
                            break;
                        }
                    }

                    if (match)
                    {
                        cache_entry = &variadic_cache_[i];
                        active_cif = &cache_entry->cif;
                        break;
                    }
                }
            }

            // Cache miss - prepara nuovo CIF
            if (!cache_entry)
            {
                // Usa stack o heap per array temporaneo
                ffi_type **variadic_ffi_types;
                if (argc <= MAX_INLINE_ARGS)
                {
                    variadic_ffi_types = variadic_ffi_types_stack;
                }
                else
                {
                    variadic_ffi_types_heap.resize(argc);
                    variadic_ffi_types = variadic_ffi_types_heap.data();
                }

                // Copia tipi fissi
                for (size_t i = 0; i < fixed_args; i++)
                {
                    variadic_ffi_types[i] = ffi_arg_types_[i];
                }

                // Aggiungi tipi extra
                for (size_t i = 0; i < num_extra; i++)
                {
                    variadic_ffi_types[fixed_args + i] = CTypeToFFI(extra_types[i]);
                }

                // Prepara CIF variadico
                ffi_status status = ffi_prep_cif_var(
                    &variadic_cif,
                    abi_,
                    static_cast<unsigned int>(fixed_args),
                    static_cast<unsigned int>(argc),
                    ffi_return_type_,
                    variadic_ffi_types);

                if (status != FFI_OK)
                {
                    Napi::Error::New(env, "Failed to prepare variadic FFI call")
                        .ThrowAsJavaScriptException();
                    return env.Undefined();
                }

                active_cif = &variadic_cif;

                // Salva in cache per riutilizzo
                if (num_extra <= 4)
                { // Cache solo pattern comuni
                    size_t slot = next_cache_slot_;
                    next_cache_slot_ = (next_cache_slot_ + 1) % MAX_CACHED_VARIADIC_CIFS;

                    variadic_cache_[slot].total_args = argc;
                    variadic_cache_[slot].extra_types.assign(extra_types, extra_types + num_extra);
                    variadic_cache_[slot].ffi_types.resize(argc);

                    for (size_t i = 0; i < argc; i++)
                    {
                        variadic_cache_[slot].ffi_types[i] = variadic_ffi_types[i];
                    }

                    ffi_status cache_status = ffi_prep_cif_var(
                        &variadic_cache_[slot].cif,
                        abi_,
                        static_cast<unsigned int>(fixed_args),
                        static_cast<unsigned int>(argc),
                        ffi_return_type_,
                        variadic_cache_[slot].ffi_types.data());

                    variadic_cache_[slot].valid = (cache_status == FFI_OK);
                }
            }
        }

        // =====================================================================
        // Fast path: un solo argomento int32 (es. abs)
        // =====================================================================
        if (argc == 1 && arg_types_[0] == CType::CTYPES_INT32)
        {
            // Safety check: verifica che il puntatore sia ancora valido
            if (fn_ptr_ == nullptr)
            {
                Napi::Error::New(env, "Function pointer is NULL").ThrowAsJavaScriptException();
                return env.Undefined();
            }

            int32_t arg;
            napi_get_value_int32(env, info[0], &arg);
            void *arg_ptr = &arg;
            ffi_call(&cif_, FFI_FN(fn_ptr_), &return_value_, &arg_ptr);
            if (return_type_ == CType::CTYPES_VOID)
            {
                if (errcheck_callback_.IsEmpty())
                    return env.Undefined();
                return ApplyErrcheck(env, env.Undefined(), info);
            }
            else
            {
                Napi::Value result = ConvertReturnValue(env);
                if (errcheck_callback_.IsEmpty())
                    return result;
                return ApplyErrcheck(env, result, info);
            }
        }

        // =====================================================================
        // Fast path: un solo argomento double (es. sqrt)
        // =====================================================================
        if (argc == 1 && arg_types_[0] == CType::CTYPES_DOUBLE)
        {
            // Safety check
            if (fn_ptr_ == nullptr)
            {
                Napi::Error::New(env, "Function pointer is NULL").ThrowAsJavaScriptException();
                return env.Undefined();
            }

            double arg;
            napi_get_value_double(env, info[0], &arg);
            void *arg_ptr = &arg;
            ffi_call(&cif_, FFI_FN(fn_ptr_), &return_value_, &arg_ptr);
            Napi::Value result = ConvertReturnValue(env);
            if (errcheck_callback_.IsEmpty())
                return result;
            return ApplyErrcheck(env, result, info);
        }

        // =====================================================================
        // Fast path: un solo argomento stringa (es. strlen)
        // =====================================================================
        if (argc == 1 && arg_types_[0] == CType::CTYPES_STRING && info[0].IsString())
        {
            napi_value nval = info[0];
            size_t len;
            napi_get_value_string_utf8(env, nval, nullptr, 0, &len);

            // Stack buffer per stringhe piccole (come CPython)
            char stack_buf[SMALL_STRING_BUFFER];
            char *str_ptr;

            if (len < SMALL_STRING_BUFFER)
            {
                napi_get_value_string_utf8(env, nval, stack_buf, sizeof(stack_buf), &len);
                str_ptr = stack_buf;
            }
            else
            {
                string_buffer_.resize(len + 1);
                napi_get_value_string_utf8(env, nval, string_buffer_.data(), len + 1, &len);
                str_ptr = string_buffer_.data();
            }

            void *arg_ptr = &str_ptr;
            ffi_call(&cif_, FFI_FN(fn_ptr_), &return_value_, &arg_ptr);
            Napi::Value result = ConvertReturnValue(env);
            if (errcheck_callback_.IsEmpty())
                return result;
            return ApplyErrcheck(env, result, info);
        }

        // =====================================================================
        // Fast path: 2 argomenti int32 (es. add, sub)
        // =====================================================================
        if (argc == 2 && arg_types_[0] == CType::CTYPES_INT32 && arg_types_[1] == CType::CTYPES_INT32)
        {
            int32_t arg0, arg1;
            napi_get_value_int32(env, info[0], &arg0);
            napi_get_value_int32(env, info[1], &arg1);
            void *arg_ptrs[2] = {&arg0, &arg1};
            ffi_call(&cif_, FFI_FN(fn_ptr_), &return_value_, arg_ptrs);
            Napi::Value result = ConvertReturnValue(env);
            if (errcheck_callback_.IsEmpty())
                return result;
            return ApplyErrcheck(env, result, info);
        }

        // =====================================================================
        // Fast path: 2 argomenti double (es. pow)
        // =====================================================================
        if (argc == 2 && arg_types_[0] == CType::CTYPES_DOUBLE && arg_types_[1] == CType::CTYPES_DOUBLE)
        {
            double arg0, arg1;
            napi_get_value_double(env, info[0], &arg0);
            napi_get_value_double(env, info[1], &arg1);
            void *arg_ptrs[2] = {&arg0, &arg1};
            ffi_call(&cif_, FFI_FN(fn_ptr_), &return_value_, arg_ptrs);
            Napi::Value result = ConvertReturnValue(env);
            if (errcheck_callback_.IsEmpty())
                return result;
            return ApplyErrcheck(env, result, info);
        }

        // =====================================================================
        // Path generale
        // =====================================================================

        // Determina se usare storage inline o heap in base ad argc effettivo
        bool use_inline_for_call = (argc <= MAX_INLINE_ARGS);

        // Seleziona buffer (inline o heap)
        uint8_t *arg_storage;
        void **arg_values;

        if (use_inline_for_call)
        {
            arg_storage = inline_arg_storage_;
            arg_values = inline_arg_values_;
        }
        else
        {
            // Per funzioni variadiche con molti argomenti, potrebbe essere necessario rialloca
            if (argc > heap_arg_values_.size())
            {
                heap_arg_storage_.resize(argc * ARG_SLOT_SIZE);
                heap_arg_values_.resize(argc);
            }
            arg_storage = heap_arg_storage_.data();
            arg_values = heap_arg_values_.data();
        }

        // Reset string buffer (mantieni capacità)
        string_buffer_.clear();

        // Converti argomenti (usa tipi inferiti per argomenti extra variadic)
        for (size_t i = 0; i < argc; i++)
        {
            uint8_t *slot = arg_storage + (i * ARG_SLOT_SIZE);
            arg_values[i] = slot;

            // Ottieni il tipo: fisso se i < expected_argc, altrimenti inferito
            CType type;
            if (i < expected_argc)
            {
                type = arg_types_[i];
            }
            else if (cache_entry)
            {
                type = cache_entry->extra_types[i - expected_argc];
            }
            else
            {
                // Usa i tipi inferiti dagli array stack/heap
                size_t extra_idx = i - expected_argc;
                if (num_extra <= MAX_VARIADIC_EXTRA_ARGS)
                {
                    type = extra_types_stack[extra_idx];
                }
                else
                {
                    type = extra_types_heap[extra_idx];
                }
            }

            const Napi::Value &val = info[i];

            switch (type)
            {
            case CType::CTYPES_INT32:
            {
                napi_value nv = val;
                int32_t v;
                napi_get_value_int32(env, nv, &v);
                memcpy(slot, &v, 4);
                break;
            }

            case CType::CTYPES_UINT32:
            {
                napi_value nv = val;
                uint32_t v;
                napi_get_value_uint32(env, nv, &v);
                memcpy(slot, &v, 4);
                break;
            }

            case CType::CTYPES_INT64:
            case CType::CTYPES_UINT64:
            case CType::CTYPES_SIZE_T:
            case CType::CTYPES_SSIZE_T:
            {
                int64_t v;
                if (val.IsBigInt())
                {
                    bool lossless;
                    v = val.As<Napi::BigInt>().Int64Value(&lossless);
                }
                else
                {
                    napi_value nv = val;
                    napi_get_value_int64(env, nv, &v);
                }
                memcpy(slot, &v, 8);
                break;
            }

            case CType::CTYPES_DOUBLE:
            {
                napi_value nv = val;
                double v;
                napi_get_value_double(env, nv, &v);
                memcpy(slot, &v, 8);
                break;
            }

            case CType::CTYPES_FLOAT:
            {
                napi_value nv = val;
                double dv;
                napi_get_value_double(env, nv, &dv);
                float v = static_cast<float>(dv);
                memcpy(slot, &v, 4);
                break;
            }

            case CType::CTYPES_POINTER:
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
                    napi_value nv = val;
                    int64_t v;
                    napi_get_value_int64(env, nv, &v);
                    ptr = reinterpret_cast<void *>(static_cast<uintptr_t>(v));
                }
                memcpy(slot, &ptr, sizeof(void *));
                break;
            }

            case CType::CTYPES_STRING:
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

            case CType::CTYPES_WSTRING:
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

            case CType::CTYPES_LONG:
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

            case CType::CTYPES_ULONG:
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

            case CType::CTYPES_BOOL:
            {
                uint8_t v = val.ToBoolean().Value() ? 1 : 0;
                memcpy(slot, &v, 1);
                break;
            }

            case CType::CTYPES_INT8:
            {
                int8_t v = static_cast<int8_t>(val.As<Napi::Number>().Int32Value());
                memcpy(slot, &v, 1);
                break;
            }

            case CType::CTYPES_UINT8:
            {
                uint8_t v = static_cast<uint8_t>(val.As<Napi::Number>().Uint32Value());
                memcpy(slot, &v, 1);
                break;
            }

            case CType::CTYPES_INT16:
            {
                int16_t v = static_cast<int16_t>(val.As<Napi::Number>().Int32Value());
                memcpy(slot, &v, 2);
                break;
            }

            case CType::CTYPES_UINT16:
            {
                uint16_t v = static_cast<uint16_t>(val.As<Napi::Number>().Uint32Value());
                memcpy(slot, &v, 2);
                break;
            }

            case CType::CTYPES_STRUCT:
            {
                // Struct by-value: converti JS object → buffer struct
                if (i < expected_argc && arg_struct_infos_[i])
                {
                    std::shared_ptr<StructInfo> struct_info = arg_struct_infos_[i];
                    size_t struct_size = struct_info->GetSize();

                    if (val.IsBuffer())
                    {
                        // Buffer già pronto (es. da StructType.create())
                        Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
                        if (buf.Length() >= struct_size)
                        {
                            memcpy(slot, buf.Data(), struct_size);
                        }
                        else
                        {
                            Napi::TypeError::New(env, "Buffer too small for struct at argument " + std::to_string(i))
                                .ThrowAsJavaScriptException();
                            return env.Undefined();
                        }
                    }
                    else if (val.IsObject())
                    {
                        Napi::Object obj = val.As<Napi::Object>();
                        if (obj.Has("_buffer") && obj.Get("_buffer").IsBuffer())
                        {
                            // Struct instance creato con create(): usa il buffer interno
                            Napi::Buffer<uint8_t> buf = obj.Get("_buffer").As<Napi::Buffer<uint8_t>>();
                            if (buf.Length() >= struct_size)
                            {
                                memcpy(slot, buf.Data(), struct_size);
                            }
                            else
                            {
                                Napi::TypeError::New(env, "Internal buffer too small for struct at argument " + std::to_string(i))
                                    .ThrowAsJavaScriptException();
                                return env.Undefined();
                            }
                        }
                        else
                        {
                            // JS object plain: converti usando JSToStruct
                            if (!struct_info->JSToStruct(env, obj, slot, ARG_SLOT_SIZE))
                            {
                                Napi::Error::New(env, "Failed to convert JS object to struct at argument " + std::to_string(i))
                                    .ThrowAsJavaScriptException();
                                return env.Undefined();
                            }
                        }
                    }
                    else
                    {
                        Napi::TypeError::New(env, "Argument " + std::to_string(i) + " must be object or buffer for struct type")
                            .ThrowAsJavaScriptException();
                        return env.Undefined();
                    }
                }
                else
                {
                    // Fallback generico (non dovrebbe accadere)
                    JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                }
                break;
            }

            case CType::CTYPES_ARRAY:
            {
                // Array: converti JS array/buffer → buffer array
                if (i < expected_argc && arg_array_infos_[i])
                {
                    std::shared_ptr<ArrayInfo> array_info = arg_array_infos_[i];
                    size_t array_size = array_info->GetSize();

                    if (val.IsBuffer())
                    {
                        // Buffer già pronto (es. da ArrayType.create())
                        Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
                        if (buf.Length() >= array_size)
                        {
                            memcpy(slot, buf.Data(), array_size);
                        }
                        else
                        {
                            Napi::TypeError::New(env, "Buffer too small for array at argument " + std::to_string(i))
                                .ThrowAsJavaScriptException();
                            return env.Undefined();
                        }
                    }
                    else
                    {
                        // JS array/value: converti usando JSToArray
                        if (!array_info->JSToArray(env, val, slot, ARG_SLOT_SIZE))
                        {
                            Napi::Error::New(env, "Failed to convert JS value to array at argument " + std::to_string(i))
                                .ThrowAsJavaScriptException();
                            return env.Undefined();
                        }
                    }
                }
                else
                {
                    // Fallback generico (non dovrebbe accadere)
                    JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                }
                break;
            }

            default:
                // Fallback generico
                JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                break;
            }
        }

        // Effettua la chiamata con il CIF appropriato (cached o appena creato)
        ffi_call(active_cif, FFI_FN(fn_ptr_), &return_value_, arg_values);

        // Converti il return value e applica errcheck se presente
        Napi::Value result = ConvertReturnValue(env);
        if (errcheck_callback_.IsEmpty())
            return result;
        return ApplyErrcheck(env, result, info);
    }

    Napi::Value FFIFunction::SetErrcheck(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 1)
        {
            // Clear errcheck
            errcheck_callback_.Reset();
            return env.Undefined();
        }

        if (!info[0].IsFunction() && !info[0].IsNull())
        {
            Napi::TypeError::New(env, "errcheck must be a function or null").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (info[0].IsNull())
        {
            errcheck_callback_.Reset();
        }
        else
        {
            errcheck_callback_ = Napi::Persistent(info[0].As<Napi::Function>());
        }

        return env.Undefined();
    }

    Napi::Value FFIFunction::ApplyErrcheck(Napi::Env env, Napi::Value result, const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        // Se non c'è errcheck, restituisci il risultato direttamente
        if (errcheck_callback_.IsEmpty())
        {
            return result;
        }

        try
        {
            // Crea array di argomenti passati alla funzione originale
            Napi::Array args_array = Napi::Array::New(env, info.Length());
            for (size_t i = 0; i < info.Length(); i++)
            {
                args_array.Set(i, info[i]);
            }

            // Chiama errcheck(result, this, args)
            std::vector<napi_value> errcheck_args = {
                result,      // result value
                info.This(), // function object
                args_array   // arguments array
            };

            return errcheck_callback_.Call(errcheck_args);
        }
        catch (const Napi::Error &e)
        {
            // Rilancia l'eccezione
            throw;
        }
    }

    Napi::Value FFIFunction::GetName(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        return Napi::String::New(info.Env(), name_);
    }

    Napi::Value FFIFunction::GetAddress(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        return Napi::BigInt::New(info.Env(), reinterpret_cast<uint64_t>(fn_ptr_));
    }

} // namespace ctypes
