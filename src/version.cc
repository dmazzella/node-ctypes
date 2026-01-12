#include "version.h"

namespace ctypes
{
    Napi::FunctionReference Version::constructor;

    Napi::Object Version::Init(Napi::Env env, Napi::Object exports)
    {
        Napi::Function func = DefineClass(
            env,
            "Version",
            {
                StaticValue("major", Napi::Number::New(env, CTYPES_MAJOR_VERSION), napi_enumerable),
                StaticValue("minor", Napi::Number::New(env, CTYPES_MINOR_VERSION), napi_enumerable),
                StaticValue("patch", Napi::Number::New(env, CTYPES_PATCH_VERSION), napi_enumerable),

                StaticMethod("toString", &Version::GetVersionString, napi_enumerable),
            });

        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();

        exports.Set("Version", func);

        return exports;
    }

    Version::Version(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<Version>(info)
    {
    }

    Napi::Value Version::GetVersionString(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();
        std::string version = std::to_string(CTYPES_MAJOR_VERSION) + "." +
                              std::to_string(CTYPES_MINOR_VERSION) + "." +
                              std::to_string(CTYPES_PATCH_VERSION);
        return Napi::String::New(env, version);
    }
}