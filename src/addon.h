#pragma once

#include "shared.h"

namespace ctypes {

class CTypesAddon : public Napi::Addon<CTypesAddon> {
 public:
  // Constructors per le classi wrapper
  std::unique_ptr<Napi::FunctionReference> LibraryConstructor;
  std::unique_ptr<Napi::FunctionReference> FFIFunctionConstructor;
  std::unique_ptr<Napi::FunctionReference> CallbackConstructor;
  std::unique_ptr<Napi::FunctionReference> ThreadSafeCallbackConstructor;
  std::unique_ptr<Napi::FunctionReference> StructTypeConstructor;
  std::unique_ptr<Napi::FunctionReference> ArrayTypeConstructor;
  std::unique_ptr<Napi::FunctionReference> ExecutorConstructor;

  // Slot catturati per GetLastError / errno — parity Python ctypes.
  // Essendo instance data di un Napi::Addon sono per-environment: ogni Worker
  // thread ha il suo CTypesAddon indipendente (effetto thread-local naturale
  // senza `thread_local` o variabili globali).
  uint32_t captured_last_error = 0;  // DWORD-like (unsigned) per parity Win32
  int captured_errno = 0;            // errno è int in POSIX

  // Callback JS eseguiti su questo environment: una chiamata sincrona che lo vede
  // cambiare controlla che nessun buffer argomento sia stato staccato nel frattempo.
  uint64_t callback_epoch = 0;

  // Classe JS ArgumentError (Python ctypes.ArgumentError), registrata da lib/index.js.
  Napi::FunctionReference argument_error_ctor;
  // JS ephemerons let a hook reference its own handle without rooting a cycle.
  Napi::ObjectReference errcheck_owners;
  Napi::FunctionReference errcheck_owner_set;
  Napi::FunctionReference errcheck_owner_delete;

  CTypesAddon(Napi::Env env, Napi::Object exports);
  ~CTypesAddon();

  // Per la durata di una chiamata nativa sincrona dal thread JS (SimpleCall,
  // Call): i callback JS eseguiti dentro la chiamata creano i loro handle nello
  // scope V8 della chiamata esterna invece di aprirne uno (napi_open_handle_scope
  // alloca a ogni apertura), fino a kBudget callback, così che un ciclo C lungo
  // non accumuli handle. Una chiamata annidata (da un callback) ha il suo budget.
  // Solo questa classe tocca il contatore (scopeless_callbacks_).
  class ScopelessCallbacks {
   public:
    static constexpr uint32_t kBudget = 64;
    explicit ScopelessCallbacks(CTypesAddon* addon) noexcept
      : addon_(addon), saved_(addon != nullptr ? std::exchange(addon->scopeless_callbacks_, kBudget) : 0) {}
    ~ScopelessCallbacks() {
      if (addon_ != nullptr) {
        addon_->scopeless_callbacks_ = saved_;
      }
    }
    ScopelessCallbacks(const ScopelessCallbacks&) = delete;
    ScopelessCallbacks& operator=(const ScopelessCallbacks&) = delete;

    // Dal thread JS, nel callback: true se può usare lo scope della chiamata
    // esterna (e ne consuma il budget), false se deve aprirne uno.
    [[nodiscard]] static bool Take(CTypesAddon* addon) noexcept {
      if (addon == nullptr || addon->scopeless_callbacks_ == 0) {
        return false;
      }
      addon->scopeless_callbacks_--;
      return true;
    }

   private:
    CTypesAddon* addon_;
    uint32_t saved_;
  };

 private:
  // Callback JS che possono ancora usare lo scope degli handle della chiamata
  // nativa sincrona in corso (ScopelessCallbacks).
  uint32_t scopeless_callbacks_ = 0;

  // Helper functions esportate (metodi membro per InstanceMethod)
  Napi::Value LoadLibrary(const Napi::CallbackInfo& info);
  Napi::Value Alloc(const Napi::CallbackInfo& info);
  Napi::Value ReadValue(const Napi::CallbackInfo& info);
  Napi::Value WriteValue(const Napi::CallbackInfo& info);
  Napi::Value SizeOf(const Napi::CallbackInfo& info);
  Napi::Value CreateCString(const Napi::CallbackInfo& info);
  Napi::Value ReadCString(const Napi::CallbackInfo& info);
  Napi::Value ReadWString(const Napi::CallbackInfo& info);
  Napi::Value PtrToBuffer(const Napi::CallbackInfo& info);
  Napi::Value AddressOf(const Napi::CallbackInfo& info);
  Napi::Value Memmove(const Napi::CallbackInfo& info);
  Napi::Value ReadMemory(const Napi::CallbackInfo& info);
  Napi::Value WriteMemory(const Napi::CallbackInfo& info);
  Napi::Value DyldSharedCacheContains(const Napi::CallbackInfo& info);

  // Module-level captured last-error / errno accessors (parity Python ctypes)
  Napi::Value GetCapturedLastError(const Napi::CallbackInfo& info);
  Napi::Value SetCapturedLastError(const Napi::CallbackInfo& info);
  Napi::Value GetCapturedErrno(const Napi::CallbackInfo& info);
  Napi::Value SetCapturedErrno(const Napi::CallbackInfo& info);
  Napi::Value SetArgumentError(const Napi::CallbackInfo& info);
};

}  // namespace ctypes
