#pragma once

#include "array.h"
#include "shared.h"
#include "types.h"

namespace ctypes {

struct ClosureDeleter {
  void operator()(ffi_closure* closure) const noexcept { ffi_closure_free(closure); }
};
using ClosureHandle = std::unique_ptr<ffi_closure, ClosureDeleter>;

// ========================================================================
// Callback - Solo main thread, veloce, zero overhead
// ========================================================================

struct CallbackData {
  Napi::FunctionReference js_function_ref;
  Napi::FunctionReference error_handler_ref;  // Error handler opzionale
  ClosureHandle closure;
  void* code_ptr = nullptr;
  ffi_cif cif;
  CType return_type;
  std::vector<TypeSpec> arg_types;  // primitivi o struct per valore
  std::vector<ffi_type*> ffi_arg_types;
  ffi_type* ffi_return_type = nullptr;
  std::atomic<bool> released{false};
  std::string last_error;  // Ultimo errore catturato
  std::mutex error_mutex;  // Protezione per last_error
  // Thread che ha creato il callback, l'unico su cui può eseguire JS.
  std::thread::id thread_id;
};

class Callback : public Napi::ObjectWrap<Callback> {
 public:
  static Napi::Function GetClass(Napi::Env env);

  Callback(const Napi::CallbackInfo& info);
  ~Callback();

  Napi::Value GetPointer(const Napi::CallbackInfo& info);
  Napi::Value Release(const Napi::CallbackInfo& info);
  Napi::Value SetErrorHandler(const Napi::CallbackInfo& info);
  Napi::Value GetLastError(const Napi::CallbackInfo& info);

 private:
  std::unique_ptr<CallbackData> data_;
};

// ========================================================================
// ThreadSafeCallback - Supporta chiamate da qualsiasi thread
// ========================================================================

// Condiviso tra chiamante, lista delle chiamate pendenti e TSFN. args/ret sono validi
// solo fino al completamento; le consegne TSFN successive non devono piu accedervi.
struct PendingCallbackCall {
  PendingCallbackCall(void** call_args, void* call_ret) : args(call_args), ret(call_ret) {}
  PendingCallbackCall(const PendingCallbackCall&) = delete;
  PendingCallbackCall& operator=(const PendingCallbackCall&) = delete;

  void** args;
  void* ret;
  std::mutex mutex;
  std::condition_variable cv;
  bool done = false;
  std::atomic<bool> claimed{false};
  void* native_error = nullptr;
};
using PendingCallback = std::shared_ptr<PendingCallbackCall>;

struct NativeCallbackContext {
  using State = void*;
  using Error = void*;
  using Suspend = State (*)();
  using Resume = void (*)(State);
  using ErrorHandler = void (*)(Error);
  using Notify = void (*)();

  Suspend suspend;
  Resume resume;
  ErrorHandler on_error;
  Notify notify = nullptr;
};

struct ThreadSafeCallbackData {
  Napi::FunctionReference js_function_ref;
  Napi::FunctionReference error_handler_ref;  // Error handler opzionale
  std::thread::id main_thread_id;
  ClosureHandle closure;
  void* code_ptr = nullptr;
  ffi_cif cif;
  CType return_type;
  std::vector<TypeSpec> arg_types;  // primitivi o struct per valore
  std::vector<ffi_type*> ffi_arg_types;
  ffi_type* ffi_return_type = nullptr;
  std::atomic<bool> released{false};
  std::string last_error;  // Ultimo errore catturato
  std::mutex error_mutex;  // Protezione per last_error
  std::optional<NativeCallbackContext> native_context;
  PendingCallbackCall* active_call = nullptr;  // Accessibile solo dal thread host Node.
  std::atomic<size_t> active_calls{0};
  std::mutex pending_mutex;
  std::vector<PendingCallback> pending;
};

// Eseguita sul main thread per ogni chiamata in coda (env nullo quando la
// coda viene svuotata alla chiusura dell'environment).
void CallThreadSafeCallback(Napi::Env env,
                            Napi::Function js_callback,
                            ThreadSafeCallbackData* data,
                            PendingCallback* call);

using ThreadSafeCallbackFunction =
  Napi::TypedThreadSafeFunction<ThreadSafeCallbackData, PendingCallback, CallThreadSafeCallback>;

struct ThreadSafeCallbackState : ThreadSafeCallbackData {
  ThreadSafeCallbackFunction tsfn;
  // TSFN assente o finalizzata: non va rilasciata.
  bool tsfn_finalized = true;
};

class ThreadSafeCallback : public Napi::ObjectWrap<ThreadSafeCallback> {
 public:
  static Napi::Function GetClass(Napi::Env env);

  ThreadSafeCallback(const Napi::CallbackInfo& info);
  ~ThreadSafeCallback();

  Napi::Value GetPointer(const Napi::CallbackInfo& info);
  Napi::Value Release(const Napi::CallbackInfo& info);
  Napi::Value SetErrorHandler(const Napi::CallbackInfo& info);
  Napi::Value GetLastError(const Napi::CallbackInfo& info);
  Napi::Value Ref(const Napi::CallbackInfo& info);
  Napi::Value Unref(const Napi::CallbackInfo& info);
  Napi::Value SetNativeError(const Napi::CallbackInfo& info);
  Napi::Value Drain(const Napi::CallbackInfo& info);

 private:
  // Libera closure e riferimenti e rilascia la TSFN: release() o GC del wrapper.
  void ReleaseResources();

  // Condiviso con il finalizzatore della TSFN: le chiamate già in coda usano i
  // dati anche dopo il GC del wrapper.
  std::shared_ptr<ThreadSafeCallbackState> data_;
};

}  // namespace ctypes
