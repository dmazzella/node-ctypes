#include "function.h"

namespace ctypes
{

    CallConv StringToCallConv(const std::string &name)
    {
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
        return DefineClass(
            env,
            "FFIFunction",
            {
                InstanceMethod("call", &FFIFunction::Call),
                InstanceMethod("callAsync", &FFIFunction::CallAsync),
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
          inline_string_offset_(0),
          use_inline_storage_(true),
          next_cache_slot_(0)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 3)
        {
            Napi::TypeError::New(env, "FFIFunction requires fnPtr, name, returnType, argTypes")
                .ThrowAsJavaScriptException();
            return;
        }

        // 1. Function pointer (External from Library::GetFunction, or BigInt raw address)
        if (info[0].IsExternal())
        {
            fn_ptr_ = info[0].As<Napi::External<void>>().Data();
        }
        else if (info[0].IsBigInt())
        {
            bool lossless;
            uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
            fn_ptr_ = reinterpret_cast<void *>(addr);
        }
        else
        {
            Napi::TypeError::New(env, "First argument must be a function pointer (External or BigInt address)")
                .ThrowAsJavaScriptException();
            return;
        }

        // CRITICAL: Valida che il puntatore non sia NULL
        if (fn_ptr_ == nullptr)
        {
            Napi::Error::New(env, "Function pointer is NULL - cannot call invalid function")
                .ThrowAsJavaScriptException();
            return;
        }

        // 2. Name (string or null for raw function pointers)
        if (info[1].IsString())
        {
            name_ = info[1].As<Napi::String>().Utf8Value();
        }
        else if (info[1].IsNull() || info[1].IsUndefined())
        {
            // Raw function pointer — use hex address as name for error messages
            char buf[32];
            snprintf(buf, sizeof(buf), "0x%llx", reinterpret_cast<unsigned long long>(fn_ptr_));
            name_ = buf;
        }
        else
        {
            Napi::TypeError::New(env, "Second argument must be function name (string) or null")
                .ThrowAsJavaScriptException();
            return;
        }

        // 3. Return type
        try
        {
            if (info[2].IsNumber())
            {
                return_type_ = IntToCType(info[2].As<Napi::Number>().Int32Value());
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
                else
                {
                    throw std::runtime_error("Invalid return type object");
                }
            }
            else
            {
                throw std::runtime_error("Return type must be CType enum value (number) or CType object");
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
                    if (elem.IsNumber())
                    {
                        arg_types_.push_back(IntToCType(elem.As<Napi::Number>().Int32Value()));
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
                        else
                        {
                            throw std::runtime_error("Invalid type object");
                        }
                    }
                    else
                    {
                        throw std::runtime_error("Type must be CType enum value (number) or CType object");
                    }
                }
                catch (const std::exception &e)
                {
                    Napi::Error::New(env, std::format("Invalid argument type at index {}: {}", i, e.what()))
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

    FFIFunction::~FFIFunction()
    {
        // Release errcheck callback to prevent memory leak
        if (!errcheck_callback_.IsEmpty())
        {
            errcheck_callback_.Reset();
        }
    }

    bool FFIFunction::PrepareFFI(Napi::Env env)
    {
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
    // InferTypeFromJS - Shared by Call() and CallAsync() for variadic inference
    // ============================================================================

    CType FFIFunction::InferTypeFromJS(const Napi::Value &val)
    {
        if (val.IsString())
            return CType::CTYPES_STRING;
        if (val.IsNumber())
        {
            double d = val.As<Napi::Number>().DoubleValue();
            return (d == static_cast<int32_t>(d)) ? CType::CTYPES_INT32 : CType::CTYPES_DOUBLE;
        }
        if (val.IsBigInt())
            return CType::CTYPES_INT64;
        if (val.IsBuffer())
            return CType::CTYPES_POINTER;
        if (val.IsNull() || val.IsUndefined())
            return CType::CTYPES_POINTER;
        return CType::CTYPES_INT32; // fallback
    }

    // ============================================================================
    // ConvertReturn - Static, shared by ConvertReturnValue() and CallWorker::OnOK()
    // ============================================================================

    Napi::Value FFIFunction::ConvertReturn(Napi::Env env,
                                           void *return_data,
                                           CType type,
                                           const std::shared_ptr<StructInfo> &struct_info,
                                           const std::shared_ptr<ArrayInfo> &array_info)
    {
        // For primitive types, interpret return_data as ReturnValue*
        ReturnValue *rv = static_cast<ReturnValue *>(return_data);

        switch (type)
        {
        case CType::CTYPES_VOID:
            return env.Undefined();

        case CType::CTYPES_INT32:
        {
            napi_value result;
            napi_create_int32(env, rv->i32, &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_UINT32:
        {
            napi_value result;
            napi_create_uint32(env, rv->u32, &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_INT64:
            return Napi::BigInt::New(env, rv->i64);

        case CType::CTYPES_UINT64:
        case CType::CTYPES_SIZE_T:
            return Napi::BigInt::New(env, rv->u64);

        case CType::CTYPES_DOUBLE:
        {
            napi_value result;
            napi_create_double(env, rv->d, &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_FLOAT:
        {
            napi_value result;
            napi_create_double(env, static_cast<double>(rv->f), &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_BOOL:
            return Napi::Boolean::New(env, rv->u8 != 0);

        case CType::CTYPES_POINTER:
            if (rv->p == nullptr)
            {
                return env.Null();
            }
            return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(rv->p));

        case CType::CTYPES_STRING:
        {
            if (rv->str == nullptr)
            {
                return env.Null();
            }
            napi_value result;
            napi_create_string_utf8(env, rv->str, NAPI_AUTO_LENGTH, &result);
            return Napi::Value(env, result);
        }

        case CType::CTYPES_WSTRING:
        {
            if (rv->wstr == nullptr)
            {
                return env.Null();
            }
#ifdef _WIN32
            // Windows: wchar_t è 16-bit (UTF-16)
            return Napi::String::New(env, reinterpret_cast<const char16_t *>(rv->wstr));
#else
            // Unix: wchar_t è 32-bit, converti a UTF-8
            std::wstring wstr(rv->wstr);
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
            return Napi::BigInt::New(env, rv->i64);

        case CType::CTYPES_ULONG:
            return Napi::BigInt::New(env, rv->u64);

        case CType::CTYPES_INT8:
            return Napi::Number::New(env, rv->i8);

        case CType::CTYPES_UINT8:
            return Napi::Number::New(env, rv->u8);

        case CType::CTYPES_INT16:
            return Napi::Number::New(env, rv->i16);

        case CType::CTYPES_UINT16:
            return Napi::Number::New(env, rv->u16);

        case CType::CTYPES_STRUCT:
        {
            // return_data points to the actual struct buffer (may be larger than ReturnValue)
            if (struct_info)
            {
                return struct_info->StructToJS(env, return_data);
            }
            return env.Undefined();
        }

        case CType::CTYPES_ARRAY:
        {
            // return_data points to the actual array buffer (may be larger than ReturnValue)
            if (array_info)
            {
                return array_info->ArrayToJS(env, return_data);
            }
            return env.Undefined();
        }

        default:
            return CToJS(env, return_data, type);
        }
    }

    // ============================================================================
    // MarshalPrimitive - Shared by Call() and CallAsync()
    // Returns true if type was handled, false if not a primitive
    // ============================================================================

    inline bool FFIFunction::MarshalPrimitive(Napi::Env env,
                                              const Napi::Value &val,
                                              CType type, uint8_t *slot)
    {
        switch (type)
        {
        case CType::CTYPES_INT32:
        {
            napi_value nv = val;
            int32_t v;
            napi_get_value_int32(env, nv, &v);
            memcpy(slot, &v, sizeof(v));
            return true;
        }
        case CType::CTYPES_UINT32:
        {
            napi_value nv = val;
            uint32_t v;
            napi_get_value_uint32(env, nv, &v);
            memcpy(slot, &v, sizeof(v));
            return true;
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
            memcpy(slot, &v, sizeof(v));
            return true;
        }
        case CType::CTYPES_DOUBLE:
        {
            napi_value nv = val;
            double v;
            napi_get_value_double(env, nv, &v);
            memcpy(slot, &v, sizeof(v));
            return true;
        }
        case CType::CTYPES_FLOAT:
        {
            napi_value nv = val;
            double dv;
            napi_get_value_double(env, nv, &dv);
            float v = static_cast<float>(dv);
            memcpy(slot, &v, sizeof(v));
            return true;
        }
        case CType::CTYPES_BOOL:
        {
            uint8_t v = val.ToBoolean().Value() ? 1 : 0;
            memcpy(slot, &v, sizeof(v));
            return true;
        }
        case CType::CTYPES_INT8:
        {
            int8_t v = static_cast<int8_t>(val.As<Napi::Number>().Int32Value());
            memcpy(slot, &v, sizeof(v));
            return true;
        }
        case CType::CTYPES_UINT8:
        {
            uint8_t v = static_cast<uint8_t>(val.As<Napi::Number>().Uint32Value());
            memcpy(slot, &v, sizeof(v));
            return true;
        }
        case CType::CTYPES_INT16:
        {
            int16_t v = static_cast<int16_t>(val.As<Napi::Number>().Int32Value());
            memcpy(slot, &v, sizeof(v));
            return true;
        }
        case CType::CTYPES_UINT16:
        {
            uint16_t v = static_cast<uint16_t>(val.As<Napi::Number>().Uint32Value());
            memcpy(slot, &v, sizeof(v));
            return true;
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
            memcpy(slot, &v, sizeof(v));
            return true;
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
            memcpy(slot, &v, sizeof(v));
            return true;
        }
        default:
            return false;
        }
    }

    // ============================================================================
    // MarshalStructArg - Shared by Call() and CallAsync()
    // Returns false on error (JS exception already thrown)
    // ============================================================================

    bool FFIFunction::MarshalStructArg(Napi::Env env,
                                       const Napi::Value &val,
                                       size_t arg_index,
                                       const std::shared_ptr<StructInfo> &struct_info,
                                       uint8_t *slot,
                                       void **arg_value_ptr,
                                       std::vector<std::vector<uint8_t>> &large_buffers,
                                       std::vector<size_t> *large_indices)
    {
        size_t struct_size = struct_info->GetSize();

        // Use overflow buffer if struct > slot size
        uint8_t *dest = slot;
        size_t dest_size = ARG_SLOT_SIZE;
        if (struct_size > ARG_SLOT_SIZE)
        {
            large_buffers.emplace_back(struct_size, 0);
            dest = large_buffers.back().data();
            dest_size = struct_size;
            *arg_value_ptr = dest;
            if (large_indices)
                large_indices->push_back(arg_index);
        }

        if (val.IsBuffer())
        {
            Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
            if (buf.Length() >= struct_size)
            {
                memcpy(dest, buf.Data(), struct_size);
            }
            else
            {
                Napi::TypeError::New(env, std::format("Buffer too small for struct at argument {}", arg_index))
                    .ThrowAsJavaScriptException();
                return false;
            }
        }
        else if (val.IsObject())
        {
            Napi::Object obj = val.As<Napi::Object>();
            if (obj.Has("_buffer") && obj.Get("_buffer").IsBuffer())
            {
                Napi::Buffer<uint8_t> buf = obj.Get("_buffer").As<Napi::Buffer<uint8_t>>();
                if (buf.Length() >= struct_size)
                {
                    memcpy(dest, buf.Data(), struct_size);
                }
                else
                {
                    Napi::TypeError::New(env, std::format("Internal buffer too small for struct at argument {}", arg_index))
                        .ThrowAsJavaScriptException();
                    return false;
                }
            }
            else
            {
                if (!struct_info->JSToStruct(env, obj, dest, dest_size))
                {
                    Napi::Error::New(env, std::format("Failed to convert JS object to struct at argument {}", arg_index))
                        .ThrowAsJavaScriptException();
                    return false;
                }
            }
        }
        else
        {
            Napi::TypeError::New(env, std::format("Argument {} must be object or buffer for struct type", arg_index))
                .ThrowAsJavaScriptException();
            return false;
        }
        return true;
    }

    // ============================================================================
    // MarshalArrayArg - Shared by Call() and CallAsync()
    // Returns false on error (JS exception already thrown)
    // ============================================================================

    bool FFIFunction::MarshalArrayArg(Napi::Env env,
                                      const Napi::Value &val,
                                      size_t arg_index,
                                      const std::shared_ptr<ArrayInfo> &array_info,
                                      uint8_t *slot,
                                      void **arg_value_ptr,
                                      std::vector<std::vector<uint8_t>> &large_buffers,
                                      std::vector<size_t> *large_indices)
    {
        size_t array_size = array_info->GetSize();

        // Use overflow buffer if array > slot size
        uint8_t *dest = slot;
        size_t dest_size = ARG_SLOT_SIZE;
        if (array_size > ARG_SLOT_SIZE)
        {
            large_buffers.emplace_back(array_size, 0);
            dest = large_buffers.back().data();
            dest_size = array_size;
            *arg_value_ptr = dest;
            if (large_indices)
                large_indices->push_back(arg_index);
        }

        if (val.IsBuffer())
        {
            Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
            if (buf.Length() >= array_size)
            {
                memcpy(dest, buf.Data(), array_size);
            }
            else
            {
                Napi::TypeError::New(env, std::format("Buffer too small for array at argument {}", arg_index))
                    .ThrowAsJavaScriptException();
                return false;
            }
        }
        else
        {
            if (!array_info->JSToArray(env, val, dest, dest_size))
            {
                Napi::Error::New(env, std::format("Failed to convert JS value to array at argument {}", arg_index))
                    .ThrowAsJavaScriptException();
                return false;
            }
        }
        return true;
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
            Napi::TypeError::New(env, std::format("Expected {} arguments, got {}", expected_argc, info_argc))
                .ThrowAsJavaScriptException();
            return env.Undefined();
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
                extra_types[i] = InferTypeFromJS(info[fixed_args + i]);
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
            // Pre-allocate with reasonable capacity to reduce reallocations
            size_t required_size = argc * ARG_SLOT_SIZE;
            if (heap_arg_storage_.capacity() < required_size)
            {
                // Reserve more than needed to amortize future allocations
                heap_arg_storage_.reserve(required_size * 2);
            }
            if (heap_arg_storage_.size() < required_size)
            {
                heap_arg_storage_.resize(required_size);
            }

            if (heap_arg_values_.capacity() < argc)
            {
                heap_arg_values_.reserve(argc * 2);
            }
            if (heap_arg_values_.size() < argc)
            {
                heap_arg_values_.resize(argc);
            }

            arg_storage = heap_arg_storage_.data();
            arg_values = heap_arg_values_.data();
        }

        // Reset string buffers and large arg overflow
        inline_string_offset_ = 0;
        string_buffer_.clear();
        sync_large_arg_buffers_.clear();
        // Periodically shrink if too large (over 10MB)
        if (string_buffer_.capacity() > 10 * 1024 * 1024)
        {
            string_buffer_.shrink_to_fit();
        }

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

            // Fast path: primitive types (shared implementation)
            if (MarshalPrimitive(env, val, type, slot))
                continue;

            switch (type)
            {
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
                memcpy(slot, &ptr, sizeof(ptr));
                break;
            }

            case CType::CTYPES_STRING:
            {
                if (val.IsString())
                {
                    napi_value nval = val;

                    // SBO: prova prima il buffer inline
                    size_t remaining = kInlineStringBufferSize - inline_string_offset_;
                    if (remaining > 1) // Serve almeno 1 byte per \0
                    {
                        size_t copied;
                        char *dest = inline_string_buffer_ + inline_string_offset_;
                        napi_status status = napi_get_value_string_utf8(env, nval, dest, remaining, &copied);

                        if (status == napi_ok && copied < remaining - 1)
                        {
                            // Stringa entra nel buffer inline!
                            const char *str_ptr = dest;
                            memcpy(slot, &str_ptr, sizeof(str_ptr));
                            inline_string_offset_ += copied + 1;
                            break;
                        }
                    }

                    // Fallback: stringa troppo lunga, usa vector con 2 chiamate
                    size_t len;
                    napi_get_value_string_utf8(env, nval, nullptr, 0, &len);

                    size_t offset = string_buffer_.size();
                    string_buffer_.resize(offset + len + 1);

                    napi_get_value_string_utf8(env, nval, string_buffer_.data() + offset, len + 1, &len);
                    const char *str_ptr = string_buffer_.data() + offset;
                    memcpy(slot, &str_ptr, sizeof(str_ptr));
                }
                else if (val.IsBuffer())
                {
                    const char *ptr = reinterpret_cast<const char *>(val.As<Napi::Buffer<uint8_t>>().Data());
                    memcpy(slot, &ptr, sizeof(ptr));
                }
                else
                {
                    const char *null_ptr = nullptr;
                    memcpy(slot, &null_ptr, sizeof(null_ptr));
                }
                break;
            }

            case CType::CTYPES_WSTRING:
            {
                if (val.IsString())
                {
                    // Ottieni stringa UTF-16
                    std::u16string u16str = val.As<Napi::String>().Utf16Value();

                    // Alloca spazio per wchar_t* con allineamento corretto
                    // (critico su ARM, penalità su x86 senza align)
                    size_t wchar_size = sizeof(wchar_t);
                    size_t byte_len = (u16str.length() + 1) * wchar_size;

                    size_t offset = string_buffer_.size();
                    constexpr size_t wchar_align = alignof(wchar_t);
                    offset = (offset + wchar_align - 1) & ~(wchar_align - 1);
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
                    memcpy(slot, &str_ptr, sizeof(str_ptr));
                }
                else if (val.IsBuffer())
                {
                    const wchar_t *ptr = reinterpret_cast<const wchar_t *>(
                        val.As<Napi::Buffer<uint8_t>>().Data());
                    memcpy(slot, &ptr, sizeof(ptr));
                }
                else
                {
                    const wchar_t *null_ptr = nullptr;
                    memcpy(slot, &null_ptr, sizeof(null_ptr));
                }
                break;
            }

            case CType::CTYPES_STRUCT:
            {
                if (i < expected_argc && arg_struct_infos_[i])
                {
                    if (!MarshalStructArg(env, val, i, arg_struct_infos_[i], slot, &arg_values[i],
                                          sync_large_arg_buffers_, nullptr))
                        return env.Undefined();
                }
                else
                {
                    JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                }
                break;
            }

            case CType::CTYPES_ARRAY:
            {
                if (i < expected_argc && arg_array_infos_[i])
                {
                    if (!MarshalArrayArg(env, val, i, arg_array_infos_[i], slot, &arg_values[i],
                                         sync_large_arg_buffers_, nullptr))
                        return env.Undefined();
                }
                else
                {
                    JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                }
                break;
            }

            default:
                JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                break;
            }
        }

        // Determine return pointer: use overflow buffer for large struct/array returns
        void *return_ptr = &return_value_;
        if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_)
        {
            size_t ret_size = return_struct_info_->GetSize();
            if (ret_size > sizeof(ReturnValue))
            {
                sync_return_buffer_.resize(ret_size);
                return_ptr = sync_return_buffer_.data();
            }
        }
        else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_)
        {
            size_t ret_size = return_array_info_->GetSize();
            if (ret_size > sizeof(ReturnValue))
            {
                sync_return_buffer_.resize(ret_size);
                return_ptr = sync_return_buffer_.data();
            }
        }

        // Effettua la chiamata con il CIF appropriato (cached o appena creato)
        ffi_call(active_cif, FFI_FN(fn_ptr_), return_ptr, arg_values);

        // Converti il return value e applica errcheck se presente
        Napi::Value result = ConvertReturn(env, return_ptr, return_type_,
                                           return_struct_info_, return_array_info_);
        if (errcheck_callback_.IsEmpty())
            return result;
        return ApplyErrcheck(env, result, info);
    }

    Napi::Value FFIFunction::SetErrcheck(const Napi::CallbackInfo &info)
    {
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
        return Napi::String::New(info.Env(), name_);
    }

    Napi::Value FFIFunction::GetAddress(const Napi::CallbackInfo &info)
    {
        return Napi::BigInt::New(info.Env(), reinterpret_cast<uint64_t>(fn_ptr_));
    }

    // ============================================================================
    // CallAsync - Esegue ffi_call su un worker thread, ritorna Promise
    // Supporta variadic, buffer pinning, string fixup
    // ============================================================================

    Napi::Value FFIFunction::CallAsync(const Napi::CallbackInfo &info)
    {
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
        bool is_variadic = false;

        if (info_argc == expected_argc) [[likely]]
        {
            argc = expected_argc;
        }
        else if (info_argc > expected_argc)
        {
            argc = info_argc;
            is_variadic = true;
        }
        else [[unlikely]]
        {
            Napi::TypeError::New(env, std::format("Expected at least {} arguments, got {}", expected_argc, info_argc))
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // =====================================================================
        // Tipi per argomenti extra variadic (inferiti dai valori JS)
        // =====================================================================
        std::vector<CType> extra_types;
        if (is_variadic)
        {
            extra_types.reserve(argc - expected_argc);
            for (size_t i = expected_argc; i < argc; i++)
            {
                extra_types.push_back(InferTypeFromJS(info[i]));
            }
        }

        // =====================================================================
        // Variadic CIF (owned dal worker)
        //
        // Per il path sincrono possiamo usare la cache perché CIF e ffi_types
        // vivono nell'istanza. Per async, il worker gira su un altro thread e
        // deve possedere tutto → allochiamo su heap con unique_ptr.
        // =====================================================================
        std::unique_ptr<ffi_cif> owned_cif;
        std::vector<ffi_type *> owned_ffi_types;
        ffi_cif *active_cif = &cif_;

        if (is_variadic)
        {
            owned_cif = std::make_unique<ffi_cif>();
            owned_ffi_types.resize(argc);

            // Copia tipi fissi
            for (size_t i = 0; i < expected_argc; i++)
            {
                owned_ffi_types[i] = ffi_arg_types_[i];
            }
            // Tipi extra (inferiti)
            for (size_t i = 0; i < extra_types.size(); i++)
            {
                owned_ffi_types[expected_argc + i] = CTypeToFFI(extra_types[i]);
            }

            ffi_status status = ffi_prep_cif_var(
                owned_cif.get(),
                abi_,
                static_cast<unsigned int>(expected_argc),
                static_cast<unsigned int>(argc),
                ffi_return_type_,
                owned_ffi_types.data());

            if (status != FFI_OK)
            {
                Napi::Error::New(env, "Failed to prepare variadic FFI call for async")
                    .ThrowAsJavaScriptException();
                return env.Undefined();
            }

            active_cif = owned_cif.get();
        }

        // =====================================================================
        // FASE 1: Marshalling JS → C  (MAIN THREAD)
        //
        // Tutto va su heap. Tracciamo string offsets per fixup post-move
        // e pinniamo i Buffer JS.
        // =====================================================================

        std::vector<uint8_t> async_arg_storage(argc * ARG_SLOT_SIZE, 0);
        std::vector<void *> async_arg_values(argc);
        std::vector<char> async_string_buffer;
        std::vector<std::pair<size_t, size_t>> string_fixups;
        std::vector<std::pair<size_t, size_t>> wstring_fixups;
        std::vector<Napi::ObjectReference> buffer_refs;
        std::vector<std::vector<uint8_t>> large_arg_buffers;
        std::vector<size_t> large_arg_indices; // tracks which arg slots use large_arg_buffers (in order)

        // Stima spazio stringhe
        {
            size_t str_count = 0;
            for (size_t i = 0; i < argc; i++)
            {
                CType t = (i < expected_argc) ? arg_types_[i] : extra_types[i - expected_argc];
                if (t == CType::CTYPES_STRING || t == CType::CTYPES_WSTRING)
                    str_count++;
            }
            if (str_count > 0)
                async_string_buffer.reserve(str_count * 128);
        }

        uint8_t *arg_storage = async_arg_storage.data();

        for (size_t i = 0; i < argc; i++)
        {
            async_arg_values[i] = arg_storage + (i * ARG_SLOT_SIZE);
            uint8_t *slot = arg_storage + (i * ARG_SLOT_SIZE);

            CType type = (i < expected_argc) ? arg_types_[i] : extra_types[i - expected_argc];
            const Napi::Value &val = info[i];

            // Fast path: primitive types (shared implementation)
            if (MarshalPrimitive(env, val, type, slot))
                continue;

            switch (type)
            {
            case CType::CTYPES_POINTER:
            {
                void *ptr = nullptr;
                if (val.IsNull() || val.IsUndefined())
                {
                    ptr = nullptr;
                }
                else if (val.IsBuffer())
                {
                    auto buf = val.As<Napi::Buffer<uint8_t>>();
                    ptr = buf.Data();
                    // Pin: impedisci al GC di raccogliere il Buffer
                    buffer_refs.push_back(Napi::Persistent(val.As<Napi::Object>()));
                }
                else if (val.IsBigInt())
                {
                    bool lossless;
                    ptr = reinterpret_cast<void *>(val.As<Napi::BigInt>().Uint64Value(&lossless));
                }
                else if (val.IsNumber())
                {
                    ptr = reinterpret_cast<void *>(
                        static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value()));
                }
                memcpy(slot, &ptr, sizeof(ptr));
                break;
            }

            case CType::CTYPES_STRING:
            {
                if (val.IsString())
                {
                    std::string str = val.As<Napi::String>().Utf8Value();
                    size_t offset = async_string_buffer.size();
                    async_string_buffer.resize(offset + str.size() + 1);
                    memcpy(async_string_buffer.data() + offset, str.c_str(), str.size() + 1);

                    // Puntatore provvisorio (verrà fixato dal worker)
                    const char *str_ptr = async_string_buffer.data() + offset;
                    memcpy(slot, &str_ptr, sizeof(str_ptr));

                    // Registra per fixup post-move
                    string_fixups.emplace_back(i, offset);
                }
                else if (val.IsBuffer())
                {
                    auto buf = val.As<Napi::Buffer<uint8_t>>();
                    const char *ptr = reinterpret_cast<const char *>(buf.Data());
                    memcpy(slot, &ptr, sizeof(ptr));
                    buffer_refs.push_back(Napi::Persistent(val.As<Napi::Object>()));
                }
                else
                {
                    const char *null_ptr = nullptr;
                    memcpy(slot, &null_ptr, sizeof(null_ptr));
                }
                break;
            }

            case CType::CTYPES_WSTRING:
            {
                if (val.IsString())
                {
                    std::u16string u16str = val.As<Napi::String>().Utf16Value();
                    size_t wchar_size = sizeof(wchar_t);
                    size_t byte_len = (u16str.length() + 1) * wchar_size;

                    // Align offset for wchar_t to avoid unaligned access
                    // (critical on ARM, perf penalty on x86)
                    size_t offset = async_string_buffer.size();
                    constexpr size_t wchar_align = alignof(wchar_t);
                    offset = (offset + wchar_align - 1) & ~(wchar_align - 1);
                    async_string_buffer.resize(offset + byte_len);

#ifdef _WIN32
                    memcpy(async_string_buffer.data() + offset, u16str.data(), byte_len);
#else
                    wchar_t *wptr = reinterpret_cast<wchar_t *>(async_string_buffer.data() + offset);
                    for (size_t j = 0; j < u16str.length(); j++)
                        wptr[j] = static_cast<wchar_t>(u16str[j]);
                    wptr[u16str.length()] = L'\0';
#endif

                    const wchar_t *str_ptr = reinterpret_cast<const wchar_t *>(
                        async_string_buffer.data() + offset);
                    memcpy(slot, &str_ptr, sizeof(str_ptr));

                    wstring_fixups.emplace_back(i, offset);
                }
                else if (val.IsBuffer())
                {
                    auto buf = val.As<Napi::Buffer<uint8_t>>();
                    const wchar_t *ptr = reinterpret_cast<const wchar_t *>(buf.Data());
                    memcpy(slot, &ptr, sizeof(ptr));
                    buffer_refs.push_back(Napi::Persistent(val.As<Napi::Object>()));
                }
                else
                {
                    const wchar_t *null_ptr = nullptr;
                    memcpy(slot, &null_ptr, sizeof(null_ptr));
                }
                break;
            }

            case CType::CTYPES_STRUCT:
            {
                if (i < expected_argc && arg_struct_infos_[i])
                {
                    if (!MarshalStructArg(env, val, i, arg_struct_infos_[i], slot, &async_arg_values[i],
                                          large_arg_buffers, &large_arg_indices))
                        return env.Undefined();
                }
                else
                {
                    JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                }
                break;
            }

            case CType::CTYPES_ARRAY:
            {
                if (i < expected_argc && arg_array_infos_[i])
                {
                    if (!MarshalArrayArg(env, val, i, arg_array_infos_[i], slot, &async_arg_values[i],
                                         large_arg_buffers, &large_arg_indices))
                        return env.Undefined();
                }
                else
                {
                    JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                }
                break;
            }

            default:
                JSToC(env, val, type, slot, ARG_SLOT_SIZE);
                break;
            }
        }

        // =====================================================================
        // FASE 2: Crea il worker e restituisci la Promise
        // =====================================================================

        Napi::FunctionReference *errcheck_ptr = nullptr;
        if (!errcheck_callback_.IsEmpty())
        {
            errcheck_ptr = &errcheck_callback_;
        }

        auto *worker = new CallWorker(
            env,
            this,
            &cif_,
            fn_ptr_,
            return_type_,
            return_struct_info_,
            return_array_info_,
            std::move(async_arg_storage),
            std::move(async_arg_values),
            std::move(async_string_buffer),
            std::move(string_fixups),
            std::move(wstring_fixups),
            std::move(buffer_refs),
            std::move(owned_cif),
            std::move(owned_ffi_types),
            std::move(large_arg_buffers),
            std::move(large_arg_indices),
            errcheck_ptr);

        Napi::Promise promise = worker->GetPromise();
        worker->Queue();

        return promise;
    }

    // ============================================================================
    // CallWorker implementations (nested class)
    // ============================================================================

    FFIFunction::CallWorker::CallWorker(
        Napi::Env env,
        FFIFunction *parent,
        ffi_cif *cif,
        void *fn_ptr,
        CType return_type,
        std::shared_ptr<StructInfo> return_struct_info,
        std::shared_ptr<ArrayInfo> return_array_info,
        std::vector<uint8_t> &&arg_storage,
        std::vector<void *> &&arg_values,
        std::vector<char> &&string_buffer,
        std::vector<std::pair<size_t, size_t>> &&string_fixups,
        std::vector<std::pair<size_t, size_t>> &&wstring_fixups,
        std::vector<Napi::ObjectReference> &&buffer_refs,
        std::unique_ptr<ffi_cif> &&owned_cif,
        std::vector<ffi_type *> &&owned_ffi_types,
        std::vector<std::vector<uint8_t>> &&large_arg_buffers,
        std::vector<size_t> &&large_arg_indices,
        Napi::FunctionReference *errcheck_ref)
        : Napi::AsyncWorker(env),
          ffi_function_(parent),
          fn_ptr_(fn_ptr),
          return_type_(return_type),
          return_struct_info_(std::move(return_struct_info)),
          return_array_info_(std::move(return_array_info)),
          arg_storage_(std::move(arg_storage)),
          arg_values_(std::move(arg_values)),
          string_buffer_(std::move(string_buffer)),
          string_fixups_(std::move(string_fixups)),
          wstring_fixups_(std::move(wstring_fixups)),
          buffer_refs_(std::move(buffer_refs)),
          owned_cif_(std::move(owned_cif)),
          owned_ffi_types_(std::move(owned_ffi_types)),
          large_arg_buffers_(std::move(large_arg_buffers)),
          large_arg_indices_(std::move(large_arg_indices)),
          return_ptr_(nullptr),
          deferred_(Napi::Promise::Deferred::New(env)),
          errcheck_ref_(errcheck_ref)
    {
        ffi_function_->Ref(); // Pin the FFIFunction instance

        memset(&return_value_, 0, sizeof(return_value_));

        // Seleziona il CIF attivo: owned (variadic) o esterno (fisso)
        active_cif_ = owned_cif_ ? owned_cif_.get() : cif;

        // Allocate return buffer for large struct/array returns
        return_ptr_ = &return_value_;
        if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_)
        {
            size_t ret_size = return_struct_info_->GetSize();
            if (ret_size > sizeof(ReturnValue))
            {
                return_buffer_.resize(ret_size, 0);
                return_ptr_ = return_buffer_.data();
            }
        }
        else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_)
        {
            size_t ret_size = return_array_info_->GetSize();
            if (ret_size > sizeof(ReturnValue))
            {
                return_buffer_.resize(ret_size, 0);
                return_ptr_ = return_buffer_.data();
            }
        }

        // Ricalcola tutti i puntatori dopo il move
        FixupPointers();
    }

    void FFIFunction::CallWorker::FixupPointers()
    {
        uint8_t *base = arg_storage_.data();
        const size_t argc = arg_values_.size();

        // 1. Ricalcola arg_values_ come offsets dal nuovo base
        for (size_t i = 0; i < argc; i++)
        {
            arg_values_[i] = base + (i * ARG_SLOT_SIZE);
        }

        // 2. Fixup large struct/array args: point to their overflow buffers
        for (size_t k = 0; k < large_arg_indices_.size(); k++)
        {
            size_t arg_idx = large_arg_indices_[k];
            arg_values_[arg_idx] = large_arg_buffers_[k].data();
        }

        // 3. Fixup puntatori a stringhe (char*) dentro gli slot
        const char *str_base = string_buffer_.data();
        for (const auto &[slot_index, str_offset] : string_fixups_)
        {
            uint8_t *slot = base + (slot_index * ARG_SLOT_SIZE);
            const char *new_ptr = str_base + str_offset;
            memcpy(slot, &new_ptr, sizeof(new_ptr));
        }

        // 4. Fixup puntatori a wstring (wchar_t*) dentro gli slot
        for (const auto &[slot_index, str_offset] : wstring_fixups_)
        {
            uint8_t *slot = base + (slot_index * ARG_SLOT_SIZE);
            const wchar_t *new_ptr = reinterpret_cast<const wchar_t *>(str_base + str_offset);
            memcpy(slot, &new_ptr, sizeof(new_ptr));
        }
    }

    FFIFunction::CallWorker::~CallWorker()
    {
        ffi_function_->Unref(); // Unpin the FFIFunction instance
    }

    void FFIFunction::CallWorker::Execute()
    {
        // *** WORKER THREAD - Nessun accesso a V8! ***
        try
        {
            ffi_call(
                active_cif_,
                FFI_FN(fn_ptr_),
                return_ptr_,
                arg_values_.empty() ? nullptr : arg_values_.data());
        }
        catch (...)
        {
            SetError("Native function threw an exception");
        }
    }

    void FFIFunction::CallWorker::OnOK()
    {
        // *** MAIN THREAD ***
        Napi::Env env = Env();
        Napi::HandleScope scope(env);

        try
        {
            // Riusa ConvertReturn statico (shared con ConvertReturnValue sync)
            Napi::Value result = FFIFunction::ConvertReturn(
                env, return_ptr_, return_type_, return_struct_info_, return_array_info_);

            // Errcheck (se presente)
            if (errcheck_ref_ && !errcheck_ref_->IsEmpty())
            {
                try
                {
                    Napi::Array args_array = Napi::Array::New(env, 0);
                    std::vector<napi_value> errcheck_args = {
                        result,
                        ffi_function_->Value(),
                        args_array};
                    result = errcheck_ref_->Call(errcheck_args);
                }
                catch (const Napi::Error &e)
                {
                    deferred_.Reject(e.Value());
                    return;
                }
            }

            deferred_.Resolve(result);
        }
        catch (const Napi::Error &e)
        {
            deferred_.Reject(e.Value());
        }
    }

    void FFIFunction::CallWorker::OnError(const Napi::Error &error)
    {
        deferred_.Reject(error.Value());
    }

} // namespace ctypes
