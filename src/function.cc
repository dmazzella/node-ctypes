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
          ffi_return_type_(nullptr)
    {

        Napi::Env env = info.Env();

        // Argomenti: fnPtr (External), name, returnType, argTypes, [options]
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

        // 3. Return type (string o TypeInfo)
        try
        {
            if (info[2].IsString())
            {
                std::string type_name = info[2].As<Napi::String>().Utf8Value();
                return_type_ = StringToCType(type_name);
            }
            else if (info[2].IsObject())
            {
                // Potrebbe essere un TypeInfo
                Napi::Object obj = info[2].As<Napi::Object>();
                if (obj.InstanceOf(TypeInfo::constructor.Value()))
                {
                    TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                    return_type_ = ti->GetCType();
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

        // 4. Argument types (array di stringhe o TypeInfo)
        if (info.Length() > 3 && info[3].IsArray())
        {
            Napi::Array arr = info[3].As<Napi::Array>();

            for (uint32_t i = 0; i < arr.Length(); i++)
            {
                Napi::Value elem = arr.Get(i);

                try
                {
                    if (elem.IsString())
                    {
                        std::string type_name = elem.As<Napi::String>().Utf8Value();
                        arg_types_.push_back(StringToCType(type_name));
                    }
                    else if (elem.IsObject())
                    {
                        Napi::Object obj = elem.As<Napi::Object>();
                        if (obj.InstanceOf(TypeInfo::constructor.Value()))
                        {
                            TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                            arg_types_.push_back(ti->GetCType());
                        }
                        else
                        {
                            throw std::runtime_error("Invalid argument type object");
                        }
                    }
                    else
                    {
                        throw std::runtime_error("Argument type must be string or CType");
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

        // 5. Options (opzionale)
        if (info.Length() > 4 && info[4].IsObject())
        {
            Napi::Object opts = info[4].As<Napi::Object>();

            if (opts.Has("abi"))
            {
                std::string abi_str = opts.Get("abi").As<Napi::String>().Utf8Value();
                abi_ = CallConvToFFI(StringToCallConv(abi_str));
            }
        }

        // Prepara la CIF
        if (!PrepareFFI(env))
        {
            return;
        }
    }

    FFIFunction::~FFIFunction()
    {
        // Cleanup se necessario
    }

    bool FFIFunction::PrepareFFI(Napi::Env env)
    {
        // Converti i tipi in ffi_type*
        ffi_return_type_ = CTypeToFFI(return_type_);

        ffi_arg_types_.clear();
        for (const auto &type : arg_types_)
        {
            ffi_arg_types_.push_back(CTypeToFFI(type));
        }

        // Prepara la call interface
        ffi_status status = ffi_prep_cif(
            &cif_,
            abi_,
            static_cast<unsigned int>(ffi_arg_types_.size()),
            ffi_return_type_,
            ffi_arg_types_.empty() ? nullptr : ffi_arg_types_.data());

        if (status != FFI_OK)
        {
            std::string msg = "Failed to prepare FFI call interface: ";
            switch (status)
            {
            case FFI_BAD_TYPEDEF:
                msg += "bad typedef";
                break;
            case FFI_BAD_ABI:
                msg += "bad ABI";
                break;
            default:
                msg += "unknown error";
                break;
            }
            Napi::Error::New(env, msg).ThrowAsJavaScriptException();
            return false;
        }

        cif_prepared_ = true;
        return true;
    }

    Napi::Value FFIFunction::Call(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (!cif_prepared_)
        {
            Napi::Error::New(env, "FFI call interface not prepared")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Verifica il numero di argomenti
        if (info.Length() < arg_types_.size())
        {
            Napi::TypeError::New(env,
                                 "Expected " + std::to_string(arg_types_.size()) +
                                     " arguments, got " + std::to_string(info.Length()))
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Buffer per gli argomenti
        // Ogni argomento può essere al massimo 8 bytes (per tipi base)
        // Per puntatori, allochiamo spazio separato
        std::vector<std::unique_ptr<uint8_t[]>> arg_storage;
        std::vector<void *> arg_values;

        // Buffer per stringhe temporanee (devono sopravvivere alla chiamata)
        std::vector<std::unique_ptr<char[]>> string_storage;

        for (size_t i = 0; i < arg_types_.size(); i++)
        {
            size_t type_size = CTypeSize(arg_types_[i]);
            if (type_size == 0)
                type_size = sizeof(void *); // Minimo

            auto buffer = std::make_unique<uint8_t[]>(type_size + 8); // Extra padding

            // Gestione speciale per stringhe
            if (arg_types_[i] == CType::STRING && info[i].IsString())
            {
                std::string s = info[i].As<Napi::String>().Utf8Value();
                auto str_buf = std::make_unique<char[]>(s.length() + 1);
                strcpy(str_buf.get(), s.c_str());

                char *str_ptr = str_buf.get();
                memcpy(buffer.get(), &str_ptr, sizeof(char *));

                string_storage.push_back(std::move(str_buf));
            }
            else
            {
                int written = JSToC(env, info[i], arg_types_[i], buffer.get(), type_size + 8);

                if (written < 0)
                {
                    Napi::TypeError::New(env,
                                         "Failed to convert argument " + std::to_string(i))
                        .ThrowAsJavaScriptException();
                    return env.Undefined();
                }
            }

            arg_values.push_back(buffer.get());
            arg_storage.push_back(std::move(buffer));
        }

        // Buffer per il valore di ritorno
        // Deve essere abbastanza grande per qualsiasi tipo + allineamento
        alignas(16) uint8_t return_buffer[32];
        memset(return_buffer, 0, sizeof(return_buffer));

        // Effettua la chiamata!
        ffi_call(
            &cif_,
            FFI_FN(fn_ptr_),
            return_buffer,
            arg_values.empty() ? nullptr : arg_values.data());

        // Converti il risultato
        return CToJS(env, return_buffer, return_type_);
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
