#include "callback.h"
#include <cstring>
#include <stdexcept>

namespace ctypes
{

    Napi::FunctionReference Callback::constructor;

    // Handler che viene invocato da libffi quando il C chiama il callback
    static void CallbackHandler(ffi_cif *cif, void *ret, void **args, void *user_data)
    {
        CallbackData *data = static_cast<CallbackData *>(user_data);

        if (data->released)
        {
            // Callback già rilasciato, non fare nulla
            return;
        }

        // Controlla se siamo sul thread principale
        bool is_main_thread = (std::this_thread::get_id() == data->main_thread_id);

        if (is_main_thread)
        {
            // Percorso veloce: chiamata diretta dal thread principale usando FunctionReference
            // Converti gli argomenti C in valori JavaScript
            Napi::HandleScope scope(data->js_function_ref.Env());
            std::vector<napi_value> js_args;
            js_args.reserve(cif->nargs);

            for (unsigned int i = 0; i < cif->nargs; i++)
            {
                Napi::Value js_val = CToJS(data->js_function_ref.Env(), args[i], data->arg_types[i]);
                js_args.push_back(js_val);
            }

            // Invoca la funzione JavaScript direttamente
            Napi::Value result;
            try
            {
                result = data->js_function_ref.Call(js_args);
            }
            catch (const Napi::Error &e)
            {
                fprintf(stderr, "Callback error: %s\n", e.Message().c_str());
                if (data->return_type != CType::VOID)
                {
                    memset(ret, 0, CTypeSize(data->return_type));
                }
                return;
            }

            // Converti il risultato JavaScript in C
            if (data->return_type != CType::VOID)
            {
                size_t ret_size = CTypeSize(data->return_type);
                uint8_t buffer[32];
                int written = JSToC(data->js_function_ref.Env(), result, data->return_type, buffer, sizeof(buffer));
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
            // Percorso per thread esterni: usa sincronizzazione
            std::unique_lock<std::mutex> lock(data->result_mutex);
            data->result_ready = false;

            auto callback = [data, cif, args](Napi::Env env, Napi::Function js_callback)
            {
                // Converti gli argomenti C in valori JavaScript
                std::vector<napi_value> js_args;
                js_args.reserve(cif->nargs);

                for (unsigned int i = 0; i < cif->nargs; i++)
                {
                    Napi::Value js_val = CToJS(env, args[i], data->arg_types[i]);
                    js_args.push_back(js_val);
                }

                // Invoca la funzione JavaScript
                Napi::Value result;
                try
                {
                    result = js_callback.Call(js_args);
                }
                catch (const Napi::Error &e)
                {
                    fprintf(stderr, "Callback error from external thread: %s\n", e.Message().c_str());
                }

                // Salva il risultato nel buffer condiviso
                std::unique_lock<std::mutex> lock(data->result_mutex);
                if (data->return_type != CType::VOID)
                {
                    JSToC(env, result, data->return_type, data->result_buffer, sizeof(data->result_buffer));
                }
                data->result_ready = true;
                data->result_cv.notify_one();
            };

            // Chiamata asincrona da thread esterno
            napi_status status = data->tsfn.NonBlockingCall(callback);
            if (status != napi_ok)
            {
                fprintf(stderr, "Failed to queue callback from external thread\n");
                if (data->return_type != CType::VOID)
                {
                    memset(ret, 0, CTypeSize(data->return_type));
                }
                return;
            }

            // Aspetta il risultato
            data->result_cv.wait(lock, [data]
                                 { return data->result_ready; });

            // Copia il risultato
            if (data->return_type != CType::VOID)
            {
                size_t ret_size = CTypeSize(data->return_type);
                memcpy(ret, data->result_buffer, ret_size);
            }
        }
    }

    Napi::Object Callback::Init(Napi::Env env, Napi::Object exports)
    {
        Napi::Function func = DefineClass(env, "Callback", {
                                                               InstanceMethod("getPointer", &Callback::GetPointer),
                                                               InstanceMethod("release", &Callback::Release),
                                                               InstanceAccessor("pointer", &Callback::GetPointer, nullptr),
                                                           });

        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();

        exports.Set("Callback", func);
        return exports;
    }

    Callback::Callback(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<Callback>(info)
    {
        Napi::Env env = info.Env();

        // Argomenti: jsFunction, returnType, argTypes, [options]
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

        Napi::Function js_func = info[0].As<Napi::Function>();

        data_ = std::make_unique<CallbackData>();
        data_->released = false;
        data_->result_ready = false;
        data_->main_thread_id = std::this_thread::get_id();
        data_->js_function_ref = Napi::Persistent(js_func);

        // Parse return type
        try
        {
            if (info[1].IsString())
            {
                std::string type_name = info[1].As<Napi::String>().Utf8Value();
                data_->return_type = StringToCType(type_name);
            }
            else if (info[1].IsObject())
            {
                Napi::Object obj = info[1].As<Napi::Object>();
                if (obj.InstanceOf(TypeInfo::constructor.Value()))
                {
                    TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                    data_->return_type = ti->GetCType();
                }
                else
                {
                    throw std::runtime_error("Invalid return type");
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
                    data_->arg_types.push_back(StringToCType(
                        elem.As<Napi::String>().Utf8Value()));
                }
                else if (elem.IsObject())
                {
                    Napi::Object obj = elem.As<Napi::Object>();
                    if (obj.InstanceOf(TypeInfo::constructor.Value()))
                    {
                        TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                        data_->arg_types.push_back(ti->GetCType());
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

        // Prepara i tipi FFI
        data_->ffi_return_type = CTypeToFFI(data_->return_type);
        for (const auto &type : data_->arg_types)
        {
            data_->ffi_arg_types.push_back(CTypeToFFI(type));
        }

        // Prepara la CIF
        ffi_status status = ffi_prep_cif(
            &data_->cif,
            FFI_DEFAULT_ABI,
            static_cast<unsigned int>(data_->ffi_arg_types.size()),
            data_->ffi_return_type,
            data_->ffi_arg_types.empty() ? nullptr : data_->ffi_arg_types.data());

        if (status != FFI_OK)
        {
            Napi::Error::New(env, "Failed to prepare callback CIF")
                .ThrowAsJavaScriptException();
            return;
        }

        // Crea la ThreadSafeFunction per chiamare JS da qualsiasi thread
        data_->tsfn = Napi::ThreadSafeFunction::New(
            env,
            js_func,
            "FFICallback",
            0, // Unlimited queue
            1  // Una sola referenza
        );

        // Alloca la closure
        data_->closure = static_cast<ffi_closure *>(
            ffi_closure_alloc(sizeof(ffi_closure), &data_->code_ptr));

        if (!data_->closure)
        {
            data_->tsfn.Release();
            Napi::Error::New(env, "Failed to allocate FFI closure")
                .ThrowAsJavaScriptException();
            return;
        }

        // Prepara la closure
        status = ffi_prep_closure_loc(
            data_->closure,
            &data_->cif,
            CallbackHandler,
            data_.get(), // user_data passato al handler
            data_->code_ptr);

        if (status != FFI_OK)
        {
            ffi_closure_free(data_->closure);
            data_->tsfn.Release();
            Napi::Error::New(env, "Failed to prepare FFI closure")
                .ThrowAsJavaScriptException();
            return;
        }
    }

    Callback::~Callback()
    {
        if (data_ && !data_->released)
        {
            data_->released = true;

            if (data_->closure)
            {
                ffi_closure_free(data_->closure);
            }
            data_->js_function_ref.Reset();
            data_->tsfn.Release();
        }
    }

    Napi::Value Callback::GetPointer(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (!data_ || data_->released)
        {
            Napi::Error::New(env, "Callback has been released")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Ritorna il puntatore come BigInt
        return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(data_->code_ptr));
    }

    Napi::Value Callback::Release(const Napi::CallbackInfo &info)
    {
        if (data_ && !data_->released)
        {
            data_->released = true;

            if (data_->closure)
            {
                ffi_closure_free(data_->closure);
                data_->closure = nullptr;
            }
            data_->js_function_ref.Reset();
            data_->tsfn.Release();
        }

        return info.Env().Undefined();
    }

} // namespace ctypes
