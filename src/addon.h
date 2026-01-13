#pragma once

#include "shared.h"

namespace ctypes
{

    class CTypesAddon : public Napi::Addon<CTypesAddon>
    {
    public:
        // Constructors per le classi wrapper
        std::unique_ptr<Napi::FunctionReference> TypeInfoConstructor;
        std::unique_ptr<Napi::FunctionReference> LibraryConstructor;
        std::unique_ptr<Napi::FunctionReference> FFIFunctionConstructor;
        std::unique_ptr<Napi::FunctionReference> CallbackConstructor;
        std::unique_ptr<Napi::FunctionReference> ThreadSafeCallbackConstructor;
        std::unique_ptr<Napi::FunctionReference> StructTypeConstructor;
        std::unique_ptr<Napi::FunctionReference> ArrayTypeConstructor;

        CTypesAddon(Napi::Env env, Napi::Object exports);
        ~CTypesAddon();

    private:
        // Helper functions esportate (metodi membro per InstanceMethod)
        Napi::Value LoadLibrary(const Napi::CallbackInfo &info);
        Napi::Value Alloc(const Napi::CallbackInfo &info);
        Napi::Value ReadValue(const Napi::CallbackInfo &info);
        Napi::Value WriteValue(const Napi::CallbackInfo &info);
        Napi::Value SizeOf(const Napi::CallbackInfo &info);
        Napi::Value CreateCString(const Napi::CallbackInfo &info);
        Napi::Value ReadCString(const Napi::CallbackInfo &info);
        Napi::Value PtrToBuffer(const Napi::CallbackInfo &info);
    };

} // namespace ctypes
