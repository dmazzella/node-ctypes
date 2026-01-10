#ifndef CTYPES_CALLBACK_H
#define CTYPES_CALLBACK_H

#include <napi.h>
#include <ffi.h>
#include <vector>
#include <memory>
#include <mutex>
#include <condition_variable>
#include <thread>
#include "types.h"

namespace ctypes
{

    // Dati associati a un callback
    struct CallbackData
    {
        Napi::ThreadSafeFunction tsfn;
        Napi::FunctionReference js_function_ref; // Per chiamate dirette dal main thread
        std::thread::id main_thread_id;          // ID del thread principale
        ffi_closure *closure;
        void *code_ptr;
        ffi_cif cif;
        CType return_type;
        std::vector<CType> arg_types;
        std::vector<ffi_type *> ffi_arg_types;
        ffi_type *ffi_return_type;
        bool released;

        // Per sincronizzazione quando chiamato da thread esterni
        std::mutex result_mutex;
        std::condition_variable result_cv;
        uint8_t result_buffer[32];
        bool result_ready;
    };

    // Wrapper per callback JavaScript chiamabili da C
    class Callback : public Napi::ObjectWrap<Callback>
    {
    public:
        static Napi::Object Init(Napi::Env env, Napi::Object exports);
        static Napi::FunctionReference constructor;

        Callback(const Napi::CallbackInfo &info);
        ~Callback();

        // Ottiene il puntatore a funzione da passare al C
        Napi::Value GetPointer(const Napi::CallbackInfo &info);

        // Rilascia le risorse (chiamare quando non serve più)
        Napi::Value Release(const Napi::CallbackInfo &info);

    private:
        std::unique_ptr<CallbackData> data_;
    };

} // namespace ctypes

#endif // CTYPES_CALLBACK_H
