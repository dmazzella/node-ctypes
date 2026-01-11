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
        DEFAULT,
        CDECL,
        STDCALL,
        FASTCALL,
        THISCALL
    };

    CallConv StringToCallConv(const std::string &name);
    ffi_abi CallConvToFFI(CallConv conv);

    // Costanti per ottimizzazione
    static constexpr size_t MAX_INLINE_ARGS = 16;
    static constexpr size_t ARG_SLOT_SIZE = 16; // Abbastanza per qualsiasi tipo base
    static constexpr size_t RETURN_BUFFER_SIZE = 64;

    // Wrapper per una funzione C chiamabile da JavaScript
    class FFIFunction : public Napi::ObjectWrap<FFIFunction>
    {
    public:
        static Napi::Object Init(Napi::Env env, Napi::Object exports);
        static Napi::FunctionReference constructor;

        FFIFunction(const Napi::CallbackInfo &info);
        ~FFIFunction();

        Napi::Value Call(const Napi::CallbackInfo &info);
        Napi::Value GetName(const Napi::CallbackInfo &info);
        Napi::Value GetAddress(const Napi::CallbackInfo &info);

    private:
        bool PrepareFFI(Napi::Env env);
        inline Napi::Value ConvertReturnValue(Napi::Env env);

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

        // ============================================================
        // Buffer pre-allocati per evitare allocazioni in Call()
        // ============================================================

        // Buffer inline per argomenti (fino a MAX_INLINE_ARGS)
        alignas(16) uint8_t inline_arg_storage_[MAX_INLINE_ARGS * ARG_SLOT_SIZE];
        void *inline_arg_values_[MAX_INLINE_ARGS];

        // Buffer inline per return value
        alignas(16) uint8_t inline_return_buffer_[RETURN_BUFFER_SIZE];

        // Buffer per stringhe (riutilizzato, resize se necessario)
        std::vector<char> string_buffer_;

        // Heap fallback per molti argomenti
        std::vector<uint8_t> heap_arg_storage_;
        std::vector<void *> heap_arg_values_;

        // Flag per sapere se usare inline o heap
        bool use_inline_storage_;
    };

} // namespace ctypes

#endif // CTYPES_FUNCTION_H
