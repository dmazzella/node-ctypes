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

  // Slot catturati per GetLastError / errno — parity Python ctypes.
  // Essendo instance data di un Napi::Addon sono per-environment: ogni Worker
  // thread ha il suo CTypesAddon indipendente (effetto thread-local naturale
  // senza `thread_local` o variabili globali).
  uint32_t captured_last_error = 0;  // DWORD-like (unsigned) per parity Win32
  int captured_errno = 0;            // errno è int in POSIX

  CTypesAddon(Napi::Env env, Napi::Object exports);
  ~CTypesAddon();

 private:
  // Helper functions esportate (metodi membro per InstanceMethod)
  Napi::Value LoadLibrary(const Napi::CallbackInfo& info);
  Napi::Value Alloc(const Napi::CallbackInfo& info);
  Napi::Value ReadValue(const Napi::CallbackInfo& info);
  Napi::Value WriteValue(const Napi::CallbackInfo& info);
  Napi::Value SizeOf(const Napi::CallbackInfo& info);
  Napi::Value CreateCString(const Napi::CallbackInfo& info);
  Napi::Value ReadCString(const Napi::CallbackInfo& info);
  Napi::Value PtrToBuffer(const Napi::CallbackInfo& info);
  Napi::Value AddressOf(const Napi::CallbackInfo& info);

  // Module-level captured last-error / errno accessors (parity Python ctypes)
  Napi::Value GetCapturedLastError(const Napi::CallbackInfo& info);
  Napi::Value SetCapturedLastError(const Napi::CallbackInfo& info);
  Napi::Value GetCapturedErrno(const Napi::CallbackInfo& info);
  Napi::Value SetCapturedErrno(const Napi::CallbackInfo& info);
};

}  // namespace ctypes
