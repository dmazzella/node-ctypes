#ifndef CTYPES_CALLBACK_H
#define CTYPES_CALLBACK_H

#include "shared.h"
#include "types.h"

namespace ctypes
{

    // ========================================================================
    // Callback - Solo main thread, veloce, zero overhead
    // ========================================================================

    struct CallbackData
    {
        Napi::FunctionReference js_function_ref;
        Napi::FunctionReference error_handler_ref; // Error handler opzionale
        ffi_closure *closure = nullptr;
        void *code_ptr = nullptr;
        ffi_cif cif;
        CType return_type;
        std::vector<CType> arg_types;
        std::vector<ffi_type *> ffi_arg_types;
        ffi_type *ffi_return_type = nullptr;
        std::atomic<bool> released{false};
        std::string last_error; // Ultimo errore catturato
        std::mutex error_mutex; // Protezione per last_error
    };

    class Callback : public Napi::ObjectWrap<Callback>
    {
    public:
        static Napi::Function GetClass(Napi::Env env);

        Callback(const Napi::CallbackInfo &info);
        ~Callback();

        Napi::Value GetPointer(const Napi::CallbackInfo &info);
        Napi::Value Release(const Napi::CallbackInfo &info);
        Napi::Value SetErrorHandler(const Napi::CallbackInfo &info);
        Napi::Value GetLastError(const Napi::CallbackInfo &info);

    private:
        std::unique_ptr<CallbackData> data_;
    };

    // ========================================================================
    // ThreadSafeCallback - Supporta chiamate da qualsiasi thread
    // ========================================================================

    struct ThreadSafeCallbackData
    {
        Napi::ThreadSafeFunction tsfn;
        Napi::FunctionReference js_function_ref;
        Napi::FunctionReference error_handler_ref; // Error handler opzionale
        std::thread::id main_thread_id;
        ffi_closure *closure = nullptr;
        void *code_ptr = nullptr;
        ffi_cif cif;
        CType return_type;
        std::vector<CType> arg_types;
        std::vector<ffi_type *> ffi_arg_types;
        ffi_type *ffi_return_type = nullptr;
        std::atomic<bool> released{false};

        // Sincronizzazione per thread esterni
        std::mutex result_mutex;
        std::condition_variable result_cv;
        uint8_t result_buffer[64];
        std::atomic<bool> result_ready{false};
        std::string last_error; // Ultimo errore catturato
    };

    class ThreadSafeCallback : public Napi::ObjectWrap<ThreadSafeCallback>
    {
    public:
        static Napi::Function GetClass(Napi::Env env);

        ThreadSafeCallback(const Napi::CallbackInfo &info);
        ~ThreadSafeCallback();

        Napi::Value GetPointer(const Napi::CallbackInfo &info);
        Napi::Value Release(const Napi::CallbackInfo &info);
        Napi::Value SetErrorHandler(const Napi::CallbackInfo &info);
        Napi::Value GetLastError(const Napi::CallbackInfo &info);

    private:
        std::unique_ptr<ThreadSafeCallbackData> data_;
    };

} // namespace ctypes

#endif // CTYPES_CALLBACK_H
