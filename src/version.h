#ifndef CTYPES_VERSION_H
#define CTYPES_VERSION_H

#include <napi.h>
#include <string>

#define CTYPES_MAJOR_VERSION 0
#define CTYPES_MINOR_VERSION 1
#define CTYPES_PATCH_VERSION 0

namespace ctypes
{
    class Version : public Napi::ObjectWrap<Version>
    {
    public:
        static Napi::Object Init(Napi::Env env, Napi::Object exports);
        static Napi::FunctionReference constructor;

        Version(const Napi::CallbackInfo &info);

        static Napi::Value GetVersionString(const Napi::CallbackInfo &info);
    };
}

#endif // CTYPES_VERSION_H