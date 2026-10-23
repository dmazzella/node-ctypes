#pragma once

#include "shared.h"

namespace ctypes {

// Wrapper per librerie dinamiche (dlopen/LoadLibrary)
class Library : public Napi::ObjectWrap<Library> {
 public:
  static constexpr napi_type_tag kTypeTag{0x91a1b36aba97e63aULL, 0x3f6e5eab4b544eabULL};
  static Napi::Function GetClass(Napi::Env env);

  Library(const Napi::CallbackInfo& info);
  ~Library();

  void* GetHandle() const { return handle_; }
  const std::string& GetPath() const { return path_; }
  bool IsLoaded() const noexcept { return is_loaded_; }

  // Chiamate in corso (sincrone e callAsync) delle funzioni della libreria:
  // close() è rifiutato finché ce ne sono.
  void BeginCall() noexcept { ++active_calls_; }
  void EndCall() noexcept { --active_calls_; }

  // Ottiene un puntatore a funzione
  Napi::Value GetFunction(const Napi::CallbackInfo& info);

  // Ottiene un callback
  Napi::Value GetCallback(const Napi::CallbackInfo& info);

  // Ottiene un puntatore a simbolo (variabile globale)
  Napi::Value GetSymbol(const Napi::CallbackInfo& info);

  // Chiude la libreria
  Napi::Value Close(const Napi::CallbackInfo& info);

  // Proprietà
  Napi::Value GetPath(const Napi::CallbackInfo& info);
  Napi::Value GetIsLoaded(const Napi::CallbackInfo& info);

 private:
  void* handle_;
  std::string path_;
  bool is_loaded_;
  uint32_t active_calls_ = 0;
};

// Helper per caricare una libreria (wrapper di livello inferiore)
// `mode`: flag di dlopen combinati con RTLD_NOW (RTLD_LOCAL / RTLD_GLOBAL, Python
// ctypes `CDLL(name, mode)`); su Windows i flag di LoadLibraryExW (`winmode`,
// -1 = default di Python). Un path vuoto apre l'eseguibile corrente.
[[nodiscard]] void* LoadSharedLibrary(const std::string& path, std::string& error, int mode);
[[nodiscard]] void* GetSymbolAddress(void* handle, const std::string& name, std::string& error);
bool CloseSharedLibrary(void* handle);

}  // namespace ctypes
