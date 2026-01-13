#ifndef CTYPES_FUNCTION_H
#define CTYPES_FUNCTION_H

#include "shared.h"
#include "types.h"
#include "struct.h"
#include "array.h"

namespace ctypes
{

    // Calling conventions supportate
    enum class CallConv
    {
        CTYPES_DEFAULT,
        CTYPES_CDECL,
        CTYPES_STDCALL,
        CTYPES_FASTCALL,
        CTYPES_THISCALL
    };

    CallConv StringToCallConv(const std::string &name);
    ffi_abi CallConvToFFI(CallConv conv);

    // Costanti per ottimizzazione
    static constexpr size_t MAX_INLINE_ARGS = 16;
    static constexpr size_t ARG_SLOT_SIZE = 16; // Abbastanza per qualsiasi tipo base
    static constexpr size_t RETURN_BUFFER_SIZE = 64;
    static constexpr size_t MAX_VARIADIC_EXTRA_ARGS = 8;  // Per stack allocation
    static constexpr size_t MAX_CACHED_VARIADIC_CIFS = 4; // Cache per pattern comuni
    static constexpr size_t SMALL_STRING_BUFFER = 256;    // Stack buffer per stringhe piccole
    static constexpr int MAX_AS_PARAMETER_DEPTH = 100;    // Ricorsione _as_parameter_ (come CPython)

    // Union per return value (come CPython - migliore cache locality)
    union ReturnValue
    {
        char c;
        int8_t i8;
        uint8_t u8;
        int16_t i16;
        uint16_t u16;
        int32_t i32;
        uint32_t u32;
        int64_t i64;
        uint64_t u64;
        float f;
        double d;
        void *p;
        char *str;
        wchar_t *wstr;
    };

    // Cache entry per CIF variadici (es. sprintf con 1-2 argomenti extra)
    struct VariadicCifCache
    {
        size_t total_args; // Numero totale argomenti (fissi + variadici)
        ffi_cif cif;
        std::vector<ffi_type *> ffi_types;
        std::vector<CType> extra_types; // Tipi degli argomenti extra
        bool valid;

        VariadicCifCache() : total_args(0), valid(false) {}
    };

    // Wrapper per una funzione C chiamabile da JavaScript
    class FFIFunction : public Napi::ObjectWrap<FFIFunction>
    {
    public:
        static Napi::Function GetClass(Napi::Env env);

        FFIFunction(const Napi::CallbackInfo &info);
        ~FFIFunction();

        Napi::Value Call(const Napi::CallbackInfo &info);
        Napi::Value GetName(const Napi::CallbackInfo &info);
        Napi::Value GetAddress(const Napi::CallbackInfo &info);
        Napi::Value SetErrcheck(const Napi::CallbackInfo &info);

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

        // Struct/Array info per argomenti e return (se STRUCT/UNION/ARRAY)
        std::shared_ptr<StructInfo> return_struct_info_;
        std::shared_ptr<ArrayInfo> return_array_info_;
        std::vector<std::shared_ptr<StructInfo>> arg_struct_infos_;
        std::vector<std::shared_ptr<ArrayInfo>> arg_array_infos_;

        // Cache dei tipi FFI
        ffi_type *ffi_return_type_;
        std::vector<ffi_type *> ffi_arg_types_;

        // ============================================================
        // Buffer pre-allocati per evitare allocazioni in Call()
        // ============================================================

        // Buffer inline per argomenti (fino a MAX_INLINE_ARGS)
        alignas(16) uint8_t inline_arg_storage_[MAX_INLINE_ARGS * ARG_SLOT_SIZE];
        void *inline_arg_values_[MAX_INLINE_ARGS];

        // Union per return value (ottimizza cache locality)
        alignas(16) ReturnValue return_value_;

        // Buffer per stringhe (riutilizzato, resize se necessario)
        std::vector<char> string_buffer_;

        // Heap fallback per molti argomenti
        std::vector<uint8_t> heap_arg_storage_;
        std::vector<void *> heap_arg_values_;

        // Flag per sapere se usare inline o heap
        bool use_inline_storage_;

        // ============================================================
        // Cache per CIF variadici (ottimizzazione chiamate ripetute)
        // ============================================================
        VariadicCifCache variadic_cache_[MAX_CACHED_VARIADIC_CIFS];
        size_t next_cache_slot_; // Round-robin replacement

        // ============================================================
        // Error checking callback (Python ctypes errcheck)
        // ============================================================
        Napi::FunctionReference errcheck_callback_;

        // Helper per applicare errcheck callback
        Napi::Value ApplyErrcheck(Napi::Env env, Napi::Value result, const Napi::CallbackInfo &info);
    };

} // namespace ctypes

#endif // CTYPES_FUNCTION_H
