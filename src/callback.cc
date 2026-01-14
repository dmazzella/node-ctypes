#include "callback.h"

namespace ctypes
{
    // ========================================================================
    // Callback - Solo main thread, semplice e veloce
    // ========================================================================

    // Handler per Callback (main thread only)
    static void CallbackHandler(ffi_cif *cif, void *ret, void **args, void *user_data)
    {
        spdlog::trace(__FUNCTION__);

        CallbackData *data = static_cast<CallbackData *>(user_data);

        if (data->released.load(std::memory_order_acquire))
        {
            // Callback rilasciato, ritorna zero
            if (data->return_type != CType::CTYPES_VOID)
            {
                memset(ret, 0, CTypeSize(data->return_type));
            }
            return;
        }

        // Converti argomenti C -> JS
        Napi::Env env = data->js_function_ref.Env();
        Napi::HandleScope scope(env);

        std::vector<napi_value> js_args;
        js_args.reserve(cif->nargs);

        for (unsigned int i = 0; i < cif->nargs; i++)
        {
            js_args.push_back(CToJS(env, args[i], data->arg_types[i]));
        }

        // Chiama la funzione JS
        Napi::Value result;
        try
        {
            result = data->js_function_ref.Call(js_args);
        }
        catch (const Napi::Error &e)
        {
            std::string error_msg = e.Message();

            // Salva l'ultimo errore
            {
                std::lock_guard<std::mutex> lock(data->error_mutex);
                data->last_error = error_msg;
            }

            // Chiama error handler se presente
            if (!data->error_handler_ref.IsEmpty())
            {
                try
                {
                    Napi::Function error_handler = data->error_handler_ref.Value();
                    error_handler.Call({Napi::String::New(env, error_msg)});
                }
                catch (...)
                {
                    // Ignora errori nell'error handler stesso
                }
            }
            else
            {
                // Fallback: emetti warning (visibile in Node.js)
                napi_value process, emit_warning;
                if (napi_get_global(env, &process) == napi_ok &&
                    napi_get_named_property(env, process, "emitWarning", &emit_warning) == napi_ok)
                {
                    napi_value warning_msg;
                    napi_create_string_utf8(env, error_msg.c_str(), NAPI_AUTO_LENGTH, &warning_msg);
                    napi_value warning_type;
                    napi_create_string_utf8(env, "CallbackError", NAPI_AUTO_LENGTH, &warning_type);
                    napi_value args[2] = {warning_msg, warning_type};
                    napi_value result_val;
                    napi_call_function(env, process, emit_warning, 2, args, &result_val);
                }
            }

            // Ritorna valore zero per evitare comportamenti indefiniti in C
            if (data->return_type != CType::CTYPES_VOID)
            {
                memset(ret, 0, CTypeSize(data->return_type));
            }
            return;
        }
        catch (...)
        {
            std::string error_msg = "Unknown exception in callback";

            {
                std::lock_guard<std::mutex> lock(data->error_mutex);
                data->last_error = error_msg;
            }

            if (!data->error_handler_ref.IsEmpty())
            {
                try
                {
                    Napi::Function error_handler = data->error_handler_ref.Value();
                    error_handler.Call({Napi::String::New(env, error_msg)});
                }
                catch (...)
                {
                }
            }

            if (data->return_type != CType::CTYPES_VOID)
            {
                memset(ret, 0, CTypeSize(data->return_type));
            }
            return;
        }

        // Converti risultato JS -> C
        if (data->return_type != CType::CTYPES_VOID)
        {
            size_t ret_size = CTypeSize(data->return_type);
            uint8_t buffer[64];

            int written = JSToC(env, result, data->return_type, buffer, sizeof(buffer));
            if (written > 0)
            {
                memcpy(ret, buffer, ret_size);
            }
            else
            {
                memset(ret, 0, ret_size);
            }
        }
    }

    Napi::Function Callback::GetClass(Napi::Env env)
    {
        spdlog::trace(__FUNCTION__);

        return DefineClass(
            env,
            "Callback",
            {
                InstanceMethod("getPointer", &Callback::GetPointer),
                InstanceMethod("release", &Callback::Release),
                InstanceMethod("setErrorHandler", &Callback::SetErrorHandler),
                InstanceMethod("getLastError", &Callback::GetLastError),
            });
    }

    Callback::Callback(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<Callback>(info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 3)
        {
            Napi::TypeError::New(env, "Callback requires function, returnType, argTypes")
                .ThrowAsJavaScriptException();
            return;
        }

        if (!info[0].IsFunction())
        {
            Napi::TypeError::New(env, "First argument must be a function")
                .ThrowAsJavaScriptException();
            return;
        }

        data_ = std::make_unique<CallbackData>();
        data_->js_function_ref = Napi::Persistent(info[0].As<Napi::Function>());

        // Parse return type
        try
        {
            if (info[1].IsString())
            {
                data_->return_type = StringToCType(info[1].As<Napi::String>().Utf8Value());
            }
            else if (info[1].IsObject() && IsTypeInfo(info[1].As<Napi::Object>()))
            {
                data_->return_type = Napi::ObjectWrap<TypeInfo>::Unwrap(info[1].As<Napi::Object>())->GetCType();
            }
            else
            {
                throw std::runtime_error("Invalid return type");
            }
        }
        catch (const std::exception &e)
        {
            Napi::Error::New(env, std::string("Invalid return type: ") + e.what())
                .ThrowAsJavaScriptException();
            return;
        }

        // Parse argument types
        if (!info[2].IsArray())
        {
            Napi::TypeError::New(env, "Third argument must be array of types")
                .ThrowAsJavaScriptException();
            return;
        }

        Napi::Array arr = info[2].As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); i++)
        {
            Napi::Value elem = arr.Get(i);
            try
            {
                if (elem.IsString())
                {
                    data_->arg_types.push_back(StringToCType(elem.As<Napi::String>().Utf8Value()));
                }
                else if (elem.IsObject() && IsTypeInfo(elem.As<Napi::Object>()))
                {
                    data_->arg_types.push_back(
                        Napi::ObjectWrap<TypeInfo>::Unwrap(elem.As<Napi::Object>())->GetCType());
                }
                else
                {
                    throw std::runtime_error("Invalid type");
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

        // Prepara FFI types
        data_->ffi_return_type = CTypeToFFI(data_->return_type);
        for (const auto &type : data_->arg_types)
        {
            data_->ffi_arg_types.push_back(CTypeToFFI(type));
        }

        // Prepara CIF
        ffi_status status = ffi_prep_cif(
            &data_->cif,
            FFI_DEFAULT_ABI,
            static_cast<unsigned int>(data_->ffi_arg_types.size()),
            data_->ffi_return_type,
            data_->ffi_arg_types.empty() ? nullptr : data_->ffi_arg_types.data());

        if (status != FFI_OK)
        {
            Napi::Error::New(env, "Failed to prepare callback CIF").ThrowAsJavaScriptException();
            return;
        }

        // Alloca closure
        data_->closure = static_cast<ffi_closure *>(
            ffi_closure_alloc(sizeof(ffi_closure), &data_->code_ptr));

        if (!data_->closure)
        {
            Napi::Error::New(env, "Failed to allocate FFI closure").ThrowAsJavaScriptException();
            return;
        }

        // Prepara closure
        status = ffi_prep_closure_loc(
            data_->closure,
            &data_->cif,
            CallbackHandler,
            data_.get(),
            data_->code_ptr);

        if (status != FFI_OK)
        {
            ffi_closure_free(data_->closure);
            data_->closure = nullptr;
            Napi::Error::New(env, "Failed to prepare FFI closure").ThrowAsJavaScriptException();
            return;
        }

        // Il cleanup del FunctionReference verrà fatto in Release() o nel distruttore
        // N-API gestisce automaticamente il GC in modo thread-safe

        // Imposta la proprietà pointer come BigInt (ottimizzazione per accesso frequente)
        Napi::Object obj = info.This().As<Napi::Object>();
        obj.Set("pointer", Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr)));
    }

    Callback::~Callback()
    {
        spdlog::trace(__FUNCTION__);

        // Cleanup - il flag atomico previene double-free
        if (data_ && !data_->released.exchange(true))
        {
            if (data_->closure)
            {
                ffi_closure_free(data_->closure);
                data_->closure = nullptr;
            }
            // Reset() è sicuro qui perché N-API lo gestisce internamente
            // Se chiamato dal GC, N-API lo fa in modo thread-safe
            if (!data_->js_function_ref.IsEmpty())
            {
                data_->js_function_ref.Reset();
            }
        }
    }

    Napi::Value Callback::GetPointer(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!data_ || data_->released.load())
        {
            Napi::Error::New(env, "Callback has been released").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr));
    }

    Napi::Value Callback::Release(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        if (data_ && !data_->released.exchange(true))
        {
            if (data_->closure)
            {
                ffi_closure_free(data_->closure);
                data_->closure = nullptr;
            }
            data_->js_function_ref.Reset();
            if (!data_->error_handler_ref.IsEmpty())
            {
                data_->error_handler_ref.Reset();
            }
        }
        return info.Env().Undefined();
    }

    Napi::Value Callback::SetErrorHandler(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!data_ || data_->released.load())
        {
            Napi::Error::New(env, "Callback has been released").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (info.Length() < 1 || !info[0].IsFunction())
        {
            Napi::TypeError::New(env, "Error handler must be a function").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        data_->error_handler_ref = Napi::Persistent(info[0].As<Napi::Function>());
        return env.Undefined();
    }

    Napi::Value Callback::GetLastError(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!data_)
        {
            return env.Null();
        }

        std::lock_guard<std::mutex> lock(data_->error_mutex);
        if (data_->last_error.empty())
        {
            return env.Null();
        }

        return Napi::String::New(env, data_->last_error);
    }

    // ========================================================================
    // ThreadSafeCallback - Supporta chiamate da qualsiasi thread
    // ========================================================================

    // Handler per ThreadSafeCallback
    static void ThreadSafeCallbackHandler(ffi_cif *cif, void *ret, void **args, void *user_data)
    {
        spdlog::trace(__FUNCTION__);

        ThreadSafeCallbackData *data = static_cast<ThreadSafeCallbackData *>(user_data);

        if (data->released.load(std::memory_order_acquire))
        {
            if (data->return_type != CType::CTYPES_VOID)
            {
                memset(ret, 0, CTypeSize(data->return_type));
            }
            return;
        }

        bool is_main_thread = (std::this_thread::get_id() == data->main_thread_id);

        if (is_main_thread)
        {
            // Percorso veloce: chiamata diretta
            Napi::Env env = data->js_function_ref.Env();
            Napi::HandleScope scope(env);

            std::vector<napi_value> js_args;
            js_args.reserve(cif->nargs);

            for (unsigned int i = 0; i < cif->nargs; i++)
            {
                js_args.push_back(CToJS(env, args[i], data->arg_types[i]));
            }

            Napi::Value result;
            try
            {
                result = data->js_function_ref.Call(js_args);
            }
            catch (const Napi::Error &e)
            {
                std::string error_msg = e.Message();

                {
                    std::lock_guard<std::mutex> lock(data->result_mutex);
                    data->last_error = error_msg;
                }

                if (!data->error_handler_ref.IsEmpty())
                {
                    try
                    {
                        Napi::Function error_handler = data->error_handler_ref.Value();
                        error_handler.Call({Napi::String::New(env, error_msg)});
                    }
                    catch (...)
                    {
                    }
                }
                else
                {
                    // Emetti warning
                    napi_value process, emit_warning;
                    if (napi_get_global(env, &process) == napi_ok &&
                        napi_get_named_property(env, process, "emitWarning", &emit_warning) == napi_ok)
                    {
                        napi_value warning_msg;
                        napi_create_string_utf8(env, error_msg.c_str(), NAPI_AUTO_LENGTH, &warning_msg);
                        napi_value warning_type;
                        napi_create_string_utf8(env, "ThreadSafeCallbackError", NAPI_AUTO_LENGTH, &warning_type);
                        napi_value args[2] = {warning_msg, warning_type};
                        napi_value result_val;
                        napi_call_function(env, process, emit_warning, 2, args, &result_val);
                    }
                }

                if (data->return_type != CType::CTYPES_VOID)
                {
                    memset(ret, 0, CTypeSize(data->return_type));
                }
                return;
            }
            catch (...)
            {
                std::string error_msg = "Unknown exception in thread-safe callback";

                {
                    std::lock_guard<std::mutex> lock(data->result_mutex);
                    data->last_error = error_msg;
                }

                if (!data->error_handler_ref.IsEmpty())
                {
                    try
                    {
                        Napi::Function error_handler = data->error_handler_ref.Value();
                        error_handler.Call({Napi::String::New(env, error_msg)});
                    }
                    catch (...)
                    {
                    }
                }

                if (data->return_type != CType::CTYPES_VOID)
                {
                    memset(ret, 0, CTypeSize(data->return_type));
                }
                return;
            }

            if (data->return_type != CType::CTYPES_VOID)
            {
                size_t ret_size = CTypeSize(data->return_type);
                uint8_t buffer[64];
                int written = JSToC(env, result, data->return_type, buffer, sizeof(buffer));
                if (written > 0)
                {
                    memcpy(ret, buffer, ret_size);
                }
                else
                {
                    memset(ret, 0, ret_size);
                }
            }
        }
        else
        {
            // Percorso thread esterno: usa TSFN + sincronizzazione
            data->result_ready.store(false, std::memory_order_release);

            // Cattura args per la lambda
            std::vector<std::vector<uint8_t>> args_copy;
            args_copy.reserve(cif->nargs);
            for (unsigned int i = 0; i < cif->nargs; i++)
            {
                size_t size = CTypeSize(data->arg_types[i]);
                std::vector<uint8_t> arg_data(size);
                memcpy(arg_data.data(), args[i], size);
                args_copy.push_back(std::move(arg_data));
            }

            auto invoke = [data, args_copy = std::move(args_copy)](Napi::Env env, Napi::Function js_callback)
            {
                std::vector<napi_value> js_args;
                js_args.reserve(args_copy.size());

                for (size_t i = 0; i < args_copy.size(); i++)
                {
                    js_args.push_back(CToJS(env, args_copy[i].data(), data->arg_types[i]));
                }

                Napi::Value result;
                try
                {
                    result = js_callback.Call(js_args);
                }
                catch (const Napi::Error &e)
                {
                    std::string error_msg = e.Message();

                    {
                        std::lock_guard<std::mutex> lock(data->result_mutex);
                        data->last_error = error_msg;
                    }

                    if (!data->error_handler_ref.IsEmpty())
                    {
                        try
                        {
                            Napi::Function error_handler = data->error_handler_ref.Value();
                            error_handler.Call({Napi::String::New(env, error_msg)});
                        }
                        catch (...)
                        {
                        }
                    }
                    else
                    {
                        // Emetti warning
                        napi_value process, emit_warning;
                        if (napi_get_global(env, &process) == napi_ok &&
                            napi_get_named_property(env, process, "emitWarning", &emit_warning) == napi_ok)
                        {
                            napi_value warning_msg;
                            napi_create_string_utf8(env, error_msg.c_str(), NAPI_AUTO_LENGTH, &warning_msg);
                            napi_value warning_type;
                            napi_create_string_utf8(env, "ThreadSafeCallbackError", NAPI_AUTO_LENGTH, &warning_type);
                            napi_value args[2] = {warning_msg, warning_type};
                            napi_value result_val;
                            napi_call_function(env, process, emit_warning, 2, args, &result_val);
                        }
                    }
                }
                catch (...)
                {
                    std::string error_msg = "Unknown exception in thread-safe callback (external thread)";

                    {
                        std::lock_guard<std::mutex> lock(data->result_mutex);
                        data->last_error = error_msg;
                    }

                    if (!data->error_handler_ref.IsEmpty())
                    {
                        try
                        {
                            Napi::Function error_handler = data->error_handler_ref.Value();
                            error_handler.Call({Napi::String::New(env, error_msg)});
                        }
                        catch (...)
                        {
                        }
                    }
                }

                // Salva risultato
                {
                    std::lock_guard<std::mutex> lock(data->result_mutex);
                    if (data->return_type != CType::CTYPES_VOID && !result.IsEmpty())
                    {
                        JSToC(env, result, data->return_type, data->result_buffer, sizeof(data->result_buffer));
                    }
                    data->result_ready.store(true, std::memory_order_release);
                }
                data->result_cv.notify_one();
            };

            // Verifica nuovamente se rilasciato (race condition check)
            if (data->released.load(std::memory_order_acquire))
            {
                if (data->return_type != CType::CTYPES_VOID)
                {
                    memset(ret, 0, CTypeSize(data->return_type));
                }
                return;
            }

            napi_status status = data->tsfn.BlockingCall(invoke);
            if (status != napi_ok)
            {
                // Salva errore senza logging - l'utente può controllare last_error
                {
                    std::lock_guard<std::mutex> lock(data->result_mutex);
                    data->last_error = "Failed to queue callback (napi_status: " + std::to_string(status) + ")";
                }

                if (data->return_type != CType::CTYPES_VOID)
                {
                    memset(ret, 0, CTypeSize(data->return_type));
                }
                return;
            }

            // Aspetta risultato
            {
                std::unique_lock<std::mutex> lock(data->result_mutex);
                data->result_cv.wait(lock, [data]
                                     { return data->result_ready.load(std::memory_order_acquire); });
            }

            // Copia risultato
            if (data->return_type != CType::CTYPES_VOID)
            {
                memcpy(ret, data->result_buffer, CTypeSize(data->return_type));
            }
        }
    }

    Napi::Function ThreadSafeCallback::GetClass(Napi::Env env)
    {
        spdlog::trace(__FUNCTION__);

        return DefineClass(
            env,
            "ThreadSafeCallback",
            {
                InstanceMethod("getPointer", &ThreadSafeCallback::GetPointer),
                InstanceMethod("release", &ThreadSafeCallback::Release),
                InstanceMethod("setErrorHandler", &ThreadSafeCallback::SetErrorHandler),
                InstanceMethod("getLastError", &ThreadSafeCallback::GetLastError),
            });
    }

    ThreadSafeCallback::ThreadSafeCallback(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<ThreadSafeCallback>(info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 3)
        {
            Napi::TypeError::New(env, "ThreadSafeCallback requires function, returnType, argTypes")
                .ThrowAsJavaScriptException();
            return;
        }

        if (!info[0].IsFunction())
        {
            Napi::TypeError::New(env, "First argument must be a function")
                .ThrowAsJavaScriptException();
            return;
        }

        Napi::Function js_func = info[0].As<Napi::Function>();

        data_ = std::make_unique<ThreadSafeCallbackData>();
        data_->main_thread_id = std::this_thread::get_id();
        data_->js_function_ref = Napi::Persistent(js_func);

        // Parse return type
        try
        {
            if (info[1].IsString())
            {
                data_->return_type = StringToCType(info[1].As<Napi::String>().Utf8Value());
            }
            else if (info[1].IsObject() && IsTypeInfo(info[1].As<Napi::Object>()))
            {
                data_->return_type = Napi::ObjectWrap<TypeInfo>::Unwrap(info[1].As<Napi::Object>())->GetCType();
            }
            else
            {
                throw std::runtime_error("Invalid return type");
            }
        }
        catch (const std::exception &e)
        {
            Napi::Error::New(env, std::string("Invalid return type: ") + e.what())
                .ThrowAsJavaScriptException();
            return;
        }

        // Parse argument types
        if (!info[2].IsArray())
        {
            Napi::TypeError::New(env, "Third argument must be array of types")
                .ThrowAsJavaScriptException();
            return;
        }

        Napi::Array arr = info[2].As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); i++)
        {
            Napi::Value elem = arr.Get(i);
            try
            {
                if (elem.IsString())
                {
                    data_->arg_types.push_back(StringToCType(elem.As<Napi::String>().Utf8Value()));
                }
                else if (elem.IsObject() && IsTypeInfo(elem.As<Napi::Object>()))
                {
                    data_->arg_types.push_back(
                        Napi::ObjectWrap<TypeInfo>::Unwrap(elem.As<Napi::Object>())->GetCType());
                }
                else
                {
                    throw std::runtime_error("Invalid type");
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

        // Prepara FFI types
        data_->ffi_return_type = CTypeToFFI(data_->return_type);
        for (const auto &type : data_->arg_types)
        {
            data_->ffi_arg_types.push_back(CTypeToFFI(type));
        }

        // Prepara CIF
        ffi_status status = ffi_prep_cif(
            &data_->cif,
            FFI_DEFAULT_ABI,
            static_cast<unsigned int>(data_->ffi_arg_types.size()),
            data_->ffi_return_type,
            data_->ffi_arg_types.empty() ? nullptr : data_->ffi_arg_types.data());

        if (status != FFI_OK)
        {
            Napi::Error::New(env, "Failed to prepare callback CIF").ThrowAsJavaScriptException();
            return;
        }

        // Crea ThreadSafeFunction
        data_->tsfn = Napi::ThreadSafeFunction::New(
            env,
            js_func,
            "ThreadSafeCallback",
            0, // Unlimited queue
            1  // Initial thread count
        );

        // Alloca closure
        data_->closure = static_cast<ffi_closure *>(
            ffi_closure_alloc(sizeof(ffi_closure), &data_->code_ptr));

        if (!data_->closure)
        {
            data_->tsfn.Release();
            Napi::Error::New(env, "Failed to allocate FFI closure").ThrowAsJavaScriptException();
            return;
        }

        // Prepara closure
        status = ffi_prep_closure_loc(
            data_->closure,
            &data_->cif,
            ThreadSafeCallbackHandler,
            data_.get(),
            data_->code_ptr);

        if (status != FFI_OK)
        {
            ffi_closure_free(data_->closure);
            data_->closure = nullptr;
            data_->tsfn.Release();
            Napi::Error::New(env, "Failed to prepare FFI closure").ThrowAsJavaScriptException();
            return;
        }

        // Il cleanup verrà fatto in Release() o nel distruttore

        // Imposta la proprietà pointer come BigInt (ottimizzazione per accesso frequente)
        Napi::Object obj = info.This().As<Napi::Object>();
        obj.Set("pointer", Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr)));
    }

    ThreadSafeCallback::~ThreadSafeCallback()
    {
        spdlog::trace(__FUNCTION__);

        // Il cleanup verrà fatto in Release()
    }

    Napi::Value ThreadSafeCallback::SetErrorHandler(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!data_ || data_->released.load())
        {
            Napi::Error::New(env, "ThreadSafeCallback has been released").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (info.Length() < 1 || !info[0].IsFunction())
        {
            Napi::TypeError::New(env, "Error handler must be a function").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        data_->error_handler_ref = Napi::Persistent(info[0].As<Napi::Function>());
        return env.Undefined();
    }

    Napi::Value ThreadSafeCallback::GetLastError(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!data_)
        {
            return env.Null();
        }

        std::lock_guard<std::mutex> lock(data_->result_mutex);
        if (data_->last_error.empty())
        {
            return env.Null();
        }

        return Napi::String::New(env, data_->last_error);
    }

    Napi::Value ThreadSafeCallback::GetPointer(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!data_ || data_->released.load())
        {
            Napi::Error::New(env, "ThreadSafeCallback has been released").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr));
    }

    Napi::Value ThreadSafeCallback::Release(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        if (data_ && !data_->released.exchange(true))
        {
            if (data_->closure)
            {
                ffi_closure_free(data_->closure);
                data_->closure = nullptr;
            }
            data_->js_function_ref.Reset();
            if (!data_->error_handler_ref.IsEmpty())
            {
                data_->error_handler_ref.Reset();
            }
            data_->tsfn.Release();
        }
        return info.Env().Undefined();
    }

} // namespace ctypes
