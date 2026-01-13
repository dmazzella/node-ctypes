#include "addon.h"
#include "version.h"
#include "types.h"
#include "library.h"
#include "function.h"
#include "callback.h"
#include "struct.h"
#include "array.h"

namespace ctypes
{
    // Helper per creare l'oggetto Version (dichiarato prima dell'uso)
    Napi::Object CreateVersionObject(Napi::Env env)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Object version = Napi::Object::New(env);
        version.Set("major", Napi::Number::New(env, CTYPES_MAJOR_VERSION));
        version.Set("minor", Napi::Number::New(env, CTYPES_MINOR_VERSION));
        version.Set("patch", Napi::Number::New(env, CTYPES_PATCH_VERSION));
        version.Set("toString",
                    Napi::Function::New(
                        env,
                        [](const Napi::CallbackInfo &info) -> Napi::Value
                        {
                            return Napi::String::New(info.Env(), fmt::format("{}.{}.{}", CTYPES_MAJOR_VERSION, CTYPES_MINOR_VERSION, CTYPES_PATCH_VERSION));
                        }));
        return version;
    }

    template <typename Func>
    auto SafeInvoke(Napi::Env env, Func &&func) -> decltype(func())
    {
        try
        {
            return func();
        }
        catch (const std::bad_alloc &e)
        {
            spdlog::error("Memory allocation failed: {}", e.what());
            Napi::Error::New(env, fmt::format("Memory allocation failed: {}", e.what())).ThrowAsJavaScriptException();
            if constexpr (std::is_void_v<decltype(func())>)
            {
                return;
            }
            else
            {
                return {};
            }
        }
        catch (const std::runtime_error &e)
        {
            spdlog::error("Runtime error: {}", e.what());
            Napi::Error::New(env, fmt::format("Runtime error: {}", e.what())).ThrowAsJavaScriptException();
            if constexpr (std::is_void_v<decltype(func())>)
            {
                return;
            }
            else
            {
                return {};
            }
        }
        catch (const std::exception &e)
        {
            spdlog::error("Exception: {}", e.what());
            Napi::Error::New(env, fmt::format("Exception: {}", e.what())).ThrowAsJavaScriptException();
            if constexpr (std::is_void_v<decltype(func())>)
            {
                return;
            }
            else
            {
                return {};
            }
        }
        catch (...)
        {
            spdlog::error("Unknown exception occurred");
            Napi::Error::New(env, "Unknown exception occurred").ThrowAsJavaScriptException();
            if constexpr (std::is_void_v<decltype(func())>)
            {
                return;
            }
            else
            {
                return {};
            }
        }
    }

    template <typename WrapperType>
    std::unique_ptr<Napi::FunctionReference> SafeInitializeWrapper(Napi::Env env, const std::string &wrapperName)
    {
        spdlog::trace("{}: {}", __FUNCTION__, wrapperName);

        return SafeInvoke(
            env,
            [&]() -> std::unique_ptr<Napi::FunctionReference>
            {
                Napi::Function func = WrapperType::GetClass(env);
                auto result = std::make_unique<Napi::FunctionReference>();
                *result = Napi::Persistent(func);
                if (!result)
                {
                    throw std::runtime_error(fmt::format("Failed to initialize {} wrapper constructor", wrapperName));
                }
                return result;
            });
    }

    CTypesAddon::CTypesAddon(Napi::Env env, Napi::Object exports)
    {
        spdlog::trace(__FUNCTION__);

        // Inizializza tutti i constructor come membri di istanza
        TypeInfoConstructor = SafeInitializeWrapper<TypeInfo>(env, "CType");
        LibraryConstructor = SafeInitializeWrapper<Library>(env, "Library");
        FFIFunctionConstructor = SafeInitializeWrapper<FFIFunction>(env, "FFIFunction");
        CallbackConstructor = SafeInitializeWrapper<Callback>(env, "Callback");
        ThreadSafeCallbackConstructor = SafeInitializeWrapper<ThreadSafeCallback>(env, "ThreadSafeCallback");
        StructTypeConstructor = SafeInitializeWrapper<StructType>(env, "StructType");
        ArrayTypeConstructor = SafeInitializeWrapper<ArrayType>(env, "ArrayType");

        // Definisci l'addon con tutte le esportazioni
        DefineAddon(
            exports,
            {
                // Version info (semplice oggetto, non classe)
                InstanceValue("Version", CreateVersionObject(env), napi_enumerable),

                // Classi wrapper
                InstanceValue("CType", TypeInfoConstructor->Value(), napi_enumerable),
                InstanceValue("Library", LibraryConstructor->Value(), napi_enumerable),
                InstanceValue("FFIFunction", FFIFunctionConstructor->Value(), napi_enumerable),
                InstanceValue("Callback", CallbackConstructor->Value(), napi_enumerable),
                InstanceValue("ThreadSafeCallback", ThreadSafeCallbackConstructor->Value(), napi_enumerable),
                InstanceValue("StructType", StructTypeConstructor->Value(), napi_enumerable),
                InstanceValue("ArrayType", ArrayTypeConstructor->Value(), napi_enumerable),

                // Funzioni helper
                InstanceMethod("load", &CTypesAddon::LoadLibrary),
                InstanceMethod("alloc", &CTypesAddon::Alloc),
                InstanceMethod("readValue", &CTypesAddon::ReadValue),
                InstanceMethod("writeValue", &CTypesAddon::WriteValue),
                InstanceMethod("sizeof", &CTypesAddon::SizeOf),
                InstanceMethod("cstring", &CTypesAddon::CreateCString),
                InstanceMethod("readCString", &CTypesAddon::ReadCString),
                InstanceMethod("ptrToBuffer", &CTypesAddon::PtrToBuffer),

                // Tipi predefiniti
                InstanceValue("types", CreatePredefinedTypes(env, *TypeInfoConstructor), napi_enumerable),

                // Costanti
                InstanceValue("POINTER_SIZE", Napi::Number::New(env, sizeof(void *)), napi_enumerable),
                InstanceValue("WCHAR_SIZE", Napi::Number::New(env, sizeof(wchar_t)), napi_enumerable),
                InstanceValue("NULL", env.Null(), napi_enumerable),
            });
    }

    CTypesAddon::~CTypesAddon()
    {
        spdlog::trace(__FUNCTION__);
    }

    // ========== Helper functions ==========

    Napi::Value CTypesAddon::LoadLibrary(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!LibraryConstructor)
        {
            Napi::Error::New(env, "Addon not properly initialized").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        return LibraryConstructor->New({info[0]});
    }

    Napi::Value CTypesAddon::Alloc(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsNumber())
        {
            Napi::TypeError::New(env, "Size (number) expected")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        size_t size = static_cast<size_t>(info[0].ToNumber().Int64Value());

        if (size == 0)
        {
            return env.Null();
        }

        return Napi::Buffer<uint8_t>::New(env, size);
    }

    Napi::Value CTypesAddon::ReadValue(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 2)
        {
            Napi::TypeError::New(env, "Pointer and type required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        void *ptr = nullptr;
        size_t offset = 0;

        // Parse pointer
        if (info[0].IsBuffer())
        {
            ptr = info[0].As<Napi::Buffer<uint8_t>>().Data();
        }
        else if (info[0].IsBigInt())
        {
            bool lossless;
            uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
            ptr = reinterpret_cast<void *>(addr);
        }
        else if (info[0].IsNumber())
        {
            ptr = reinterpret_cast<void *>(
                static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
        }
        else
        {
            Napi::TypeError::New(env, "Invalid pointer type")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Parse type
        CType ctype;
        try
        {
            if (info[1].IsString())
            {
                ctype = StringToCType(info[1].As<Napi::String>().Utf8Value());
            }
            else if (info[1].IsObject())
            {
                Napi::Object obj = info[1].As<Napi::Object>();
                if (TypeInfoConstructor && obj.InstanceOf(TypeInfoConstructor->Value()))
                {
                    TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                    ctype = ti->GetCType();
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
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Parse offset
        if (info.Length() > 2 && info[2].IsNumber())
        {
            offset = static_cast<size_t>(info[2].ToNumber().Int64Value());
        }

        if (!ptr)
        {
            return env.Null();
        }

        void *read_ptr = static_cast<uint8_t *>(ptr) + offset;
        return CToJS(env, read_ptr, ctype);
    }

    Napi::Value CTypesAddon::WriteValue(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 3)
        {
            Napi::TypeError::New(env, "Pointer, type and value required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        void *ptr = nullptr;
        size_t offset = 0;

        // Parse pointer
        if (info[0].IsBuffer())
        {
            ptr = info[0].As<Napi::Buffer<uint8_t>>().Data();
        }
        else if (info[0].IsBigInt())
        {
            bool lossless;
            uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
            ptr = reinterpret_cast<void *>(addr);
        }
        else if (info[0].IsNumber())
        {
            ptr = reinterpret_cast<void *>(
                static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
        }
        else
        {
            Napi::TypeError::New(env, "Invalid pointer type")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Parse type
        CType ctype;
        try
        {
            if (info[1].IsString())
            {
                ctype = StringToCType(info[1].As<Napi::String>().Utf8Value());
            }
            else if (info[1].IsObject())
            {
                Napi::Object obj = info[1].As<Napi::Object>();
                if (TypeInfoConstructor && obj.InstanceOf(TypeInfoConstructor->Value()))
                {
                    TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                    ctype = ti->GetCType();
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
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Parse offset
        if (info.Length() > 3 && info[3].IsNumber())
        {
            offset = static_cast<size_t>(info[3].ToNumber().Int64Value());
        }

        if (!ptr)
        {
            Napi::Error::New(env, "Cannot write to null pointer")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        void *write_ptr = static_cast<uint8_t *>(ptr) + offset;
        size_t type_size = CTypeSize(ctype);

        int written = JSToC(env, info[2], ctype, write_ptr, type_size);
        if (written < 0)
        {
            Napi::Error::New(env, "Failed to write value")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        return Napi::Number::New(env, written);
    }

    Napi::Value CTypesAddon::SizeOf(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 1)
        {
            Napi::TypeError::New(env, "Type required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        CType ctype;
        try
        {
            if (info[0].IsString())
            {
                ctype = StringToCType(info[0].As<Napi::String>().Utf8Value());
            }
            else if (info[0].IsObject())
            {
                Napi::Object obj = info[0].As<Napi::Object>();
                if (TypeInfoConstructor && obj.InstanceOf(TypeInfoConstructor->Value()))
                {
                    TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                    ctype = ti->GetCType();
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
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        return Napi::Number::New(env, static_cast<double>(CTypeSize(ctype)));
    }

    Napi::Value CTypesAddon::CreateCString(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString())
        {
            Napi::TypeError::New(env, "String expected")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        std::string str = info[0].As<Napi::String>().Utf8Value();

        auto buffer = Napi::Buffer<char>::New(env, str.length() + 1);
        memcpy(buffer.Data(), str.c_str(), str.length() + 1);

        return buffer;
    }

    Napi::Value CTypesAddon::ReadCString(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 1)
        {
            Napi::TypeError::New(env, "Pointer required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        const char *ptr = nullptr;

        if (info[0].IsBuffer())
        {
            ptr = reinterpret_cast<const char *>(
                info[0].As<Napi::Buffer<uint8_t>>().Data());
        }
        else if (info[0].IsBigInt())
        {
            bool lossless;
            uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
            ptr = reinterpret_cast<const char *>(addr);
        }
        else if (info[0].IsNumber())
        {
            ptr = reinterpret_cast<const char *>(
                static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
        }

        if (!ptr)
        {
            return env.Null();
        }

        size_t max_len = SIZE_MAX;
        if (info.Length() > 1 && info[1].IsNumber())
        {
            max_len = static_cast<size_t>(info[1].ToNumber().Int64Value());
        }

        size_t len = 0;
        while (len < max_len && ptr[len] != '\0')
        {
            len++;
        }

        return Napi::String::New(env, ptr, len);
    }

    Napi::Value CTypesAddon::PtrToBuffer(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 2)
        {
            Napi::TypeError::New(env, "Address and size required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        void *ptr = nullptr;

        if (info[0].IsBigInt())
        {
            bool lossless;
            uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
            ptr = reinterpret_cast<void *>(addr);
        }
        else if (info[0].IsNumber())
        {
            ptr = reinterpret_cast<void *>(
                static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
        }
        else
        {
            Napi::TypeError::New(env, "Address must be BigInt or Number")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (!ptr)
        {
            return env.Null();
        }

        size_t size = static_cast<size_t>(info[1].ToNumber().Int64Value());

        return Napi::Buffer<uint8_t>::New(
            env,
            static_cast<uint8_t *>(ptr),
            size,
            [](Napi::Env, void *)
            {
                // No-op finalizer
            });
    }

} // namespace ctypes
