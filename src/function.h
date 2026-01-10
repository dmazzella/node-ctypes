#ifndef CTYPES_FUNCTION_H
#define CTYPES_FUNCTION_H

#include <napi.h>
#include <ffi.h>
#include <vector>
#include <string>
#include "types.h"

namespace ctypes
{

    // Calling conventions supportate
    enum class CallConv
    {
        DEFAULT, // cdecl su x86, default ABI su x64
        CDECL,
        STDCALL,  // Solo Windows x86
        FASTCALL, // Solo Windows x86
        THISCALL  // Solo Windows x86
    };

    CallConv StringToCallConv(const std::string &name);
    ffi_abi CallConvToFFI(CallConv conv);

    // Wrapper per una funzione C chiamabile da JavaScript
    class FFIFunction : public Napi::ObjectWrap<FFIFunction>
    {
    public:
        static Napi::Object Init(Napi::Env env, Napi::Object exports);
        static Napi::FunctionReference constructor;

        FFIFunction(const Napi::CallbackInfo &info);
        ~FFIFunction();

        // Chiama la funzione C con gli argomenti JS
        Napi::Value Call(const Napi::CallbackInfo &info);

        // Proprietà
        Napi::Value GetName(const Napi::CallbackInfo &info);
        Napi::Value GetAddress(const Napi::CallbackInfo &info);

    private:
        bool PrepareFFI(Napi::Env env);

        void *fn_ptr_;
        std::string name_;

        // FFI stuff
        ffi_cif cif_;
        bool cif_prepared_;
        ffi_abi abi_;

        // Tipi
        CType return_type_;
        std::vector<CType> arg_types_;

        // Cache dei tipi FFI
        ffi_type *ffi_return_type_;
        std::vector<ffi_type *> ffi_arg_types_;
    };

} // namespace ctypes

#endif // CTYPES_FUNCTION_H
