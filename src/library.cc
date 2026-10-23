#include "library.h"

#include "addon.h"
#include "function.h"

namespace ctypes {

std::string GetErrorMessage(const uint32_t errorCode) {
  std::string result;

#ifdef _WIN32
  WCHAR localeName[LOCALE_NAME_MAX_LENGTH] = {0};
  LANGID langId = MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT);
  if (GetLocaleInfoEx(LOCALE_NAME_USER_DEFAULT, LOCALE_SNAME, localeName, LOCALE_NAME_MAX_LENGTH)) {
    LCID lcid = LocaleNameToLCID(localeName, 0);
    if (lcid != 0) {
      langId = LANGIDFROMLCID(lcid);
    }
  }

  LPWSTR msgBufW = nullptr;
  DWORD dwFlags = FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_MAX_WIDTH_MASK;
  if (FormatMessageW(dwFlags, nullptr, static_cast<DWORD>(errorCode), langId, reinterpret_cast<LPWSTR>(&msgBufW), 0,
                     nullptr) &&
      msgBufW) {
    int utf8Length = WideCharToMultiByte(CP_UTF8, 0, msgBufW, -1, nullptr, 0, nullptr, nullptr);
    if (utf8Length > 0) {
      std::vector<char> utf8Buffer(utf8Length);
      if (WideCharToMultiByte(CP_UTF8, 0, msgBufW, -1, utf8Buffer.data(), utf8Length, nullptr, nullptr) > 0) {
        result = std::string(utf8Buffer.data());
      }
    }
    LocalFree(msgBufW);
  }
#else
  result = std::format("Error 0x{:08x}", static_cast<uint32_t>(errorCode));
#endif

  return result;
}

#ifdef _WIN32
namespace {

std::wstring Utf8ToWide(std::string_view utf8) {
  if (utf8.empty()) {
    return {};
  }
  const int length = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
  std::wstring wide(static_cast<size_t>(length), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(), length);
  return wide;
}

std::string WindowsError(std::string_view function, DWORD err) {
  return std::format("{} failed: 0x{:08x} {}", function, static_cast<uint32_t>(err),
                     GetErrorMessage(static_cast<uint32_t>(err)));
}

}  // namespace
#endif

// Platform-specific implementations
void* LoadSharedLibrary(const std::string& path, std::string& error, [[maybe_unused]] int mode) {
#ifdef _WIN32
  // Python ctypes (CDLL.__init__ + _ctypes.LoadLibrary): `mode` is winmode;
  // -1 (winmode=None) selects LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, plus the
  // library's own directory when the name is a path (made absolute, as
  // LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR requires). The DLL search path of the
  // process is never changed.
  std::wstring name = Utf8ToWide(path);
  DWORD flags = static_cast<DWORD>(mode);
  if (mode == -1) {
    flags = LOAD_LIBRARY_SEARCH_DEFAULT_DIRS;
    if (name.find_first_of(L"/\\") != std::wstring::npos) {
      std::error_code ec;
      std::filesystem::path absolute = std::filesystem::absolute(std::filesystem::path(name), ec);
      if (!ec) {
        name = absolute.make_preferred().wstring();
      }
      flags |= LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR;
    }
  }
  HMODULE handle = LoadLibraryExW(name.c_str(), nullptr, flags);
  if (!handle) {
    error = WindowsError("LoadLibraryExW", GetLastError());
    return nullptr;
  }
  return static_cast<void*>(handle);
#else
  // Python ctypes (py_dl_open): symbols are always resolved at load time.
  void* handle = dlopen(path.empty() ? nullptr : path.c_str(), RTLD_NOW | mode);
  if (!handle) {
    error = dlerror();
    return nullptr;
  }
  return handle;
#endif
}

void* GetSymbolAddress(void* handle, const std::string& name, std::string& error) {
#ifdef _WIN32
  void* addr = reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(handle), name.c_str()));
  if (!addr) {
    error = WindowsError("GetProcAddress", GetLastError());
    return nullptr;
  }
  return addr;
#else
  dlerror();  // Clear previous errors
  void* addr = dlsym(handle, name.c_str());
  const char* err = dlerror();
  if (err) {
    error = err;
    return nullptr;
  }
  return addr;
#endif
}

bool CloseSharedLibrary(void* handle) {
  if (!handle) {
    return true;
  }
#ifdef _WIN32
  return FreeLibrary(static_cast<HMODULE>(handle)) != 0;
#else
  return dlclose(handle) == 0;
#endif
}

// Library class implementation
Napi::Function Library::GetClass(Napi::Env env) {
  return DefineClass(env, "Library",
                     {
                       InstanceMethod("func", &Library::GetFunction),
                       InstanceMethod("callback", &Library::GetCallback),
                       InstanceMethod("symbol", &Library::GetSymbol),
                       InstanceMethod("close", &Library::Close),
                       InstanceAccessor("path", &Library::GetPath, nullptr),
                       InstanceAccessor("loaded", &Library::GetIsLoaded, nullptr),
                     });
}

Library::Library(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<Library>(info), handle_(nullptr), is_loaded_(false) {
  Napi::Env env = info.Env();
  info.This().As<Napi::Object>().TypeTag(&kTypeTag);

  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Library path expected").ThrowAsJavaScriptException();
    return;
  }

  // Gestisce sia stringhe che null (per caricare l'eseguibile corrente)
  if (info[0].IsNull() || info[0].IsUndefined()) {
    path_ = "";
  } else if (info[0].IsString()) {
    path_ = info[0].As<Napi::String>().Utf8Value();
  } else {
    Napi::TypeError::New(env, "Library path must be a string or null").ThrowAsJavaScriptException();
    return;
  }

  // Python ctypes: CDLL(name, mode, winmode=None). `mode` is the dlopen flag
  // (RTLD_LOCAL by default), `winmode` the LoadLibraryExW flags (-1 = None).
#ifdef _WIN32
  int mode = -1;
  constexpr size_t kModeArg = 2;
#else
  int mode = RTLD_LOCAL;
  constexpr size_t kModeArg = 1;
#endif
  if (info.Length() > kModeArg && info[kModeArg].IsNumber()) {
    mode = info[kModeArg].As<Napi::Number>().Int32Value();
  }

  std::string error;

  // Se path è vuoto, carica l'eseguibile corrente (RTLD_DEFAULT su Unix)
#ifdef _WIN32
  handle_ = path_.empty() ? static_cast<void*>(GetModuleHandleW(nullptr)) : LoadSharedLibrary(path_, error, mode);
#else
  handle_ = LoadSharedLibrary(path_, error, mode);
#endif

  if (!handle_) {
    Napi::Error::New(env, std::format("Failed to load library{}{}", path_.empty() ? "" : std::format(" '{}'", path_),
                                      error.empty() ? "" : std::format(": {}", error)))
      .ThrowAsJavaScriptException();
    return;
  }

  is_loaded_ = true;
}

Library::~Library() {
  if (is_loaded_ && handle_ && !path_.empty()) {
    CloseSharedLibrary(handle_);
  }
}

Napi::Value Library::GetFunction(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!is_loaded_) {
    Napi::Error::New(env, "Library is not loaded").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // func(name, returnType, [argTypes], [options])
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Function name and return type required").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!info[0].IsString()) {
    Napi::TypeError::New(env, "Function name must be a string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string name = info[0].As<Napi::String>().Utf8Value();

  // Trova il simbolo
  std::string error;
  void* fn_ptr = GetSymbolAddress(handle_, name, error);

  if (!fn_ptr) {
    Napi::Error::New(env, std::format("Symbol '{}' not found{}", name, error.empty() ? "" : std::format(": {}", error)))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Crea l'oggetto FFIFunction
  // Passiamo: fn_ptr (come External), returnType, argTypes
  std::vector<napi_value> args;
  args.push_back(Napi::External<void>::New(env, fn_ptr));
  args.push_back(Napi::String::New(env, name));

  // Return type
  args.push_back(info[1]);

  // Arg types (se presenti)
  if (info.Length() > 2) {
    args.push_back(info[2]);
  } else {
    args.push_back(Napi::Array::New(env, 0));
  }

  // Options (se presenti)
  if (info.Length() > 3) {
    args.push_back(info[3]);
  }

  // Ottieni il costruttore FFIFunction dall'addon
  CTypesAddon* addon = env.GetInstanceData<CTypesAddon>();
  if (!addon || !addon->FFIFunctionConstructor) {
    Napi::Error::New(env, "FFIFunction constructor not available").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object function = addon->FFIFunctionConstructor->New(args);
  Napi::ObjectWrap<FFIFunction>::Unwrap(function)->AttachLibrary(Value());
  return function;
}

Napi::Value Library::GetSymbol(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!is_loaded_) {
    Napi::Error::New(env, "Library is not loaded").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Symbol name required").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string name = info[0].As<Napi::String>().Utf8Value();

  std::string error;
  void* sym_ptr = GetSymbolAddress(handle_, name, error);

  if (!sym_ptr) {
    Napi::Error::New(env, std::format("Symbol '{}' not found{}", name, error.empty() ? "" : std::format(": {}", error)))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Ritorna il puntatore come BigInt
  return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(sym_ptr));
}

Napi::Value Library::Close(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Una chiamata in corso (un callback che chiude la libreria della funzione
  // che lo sta eseguendo, o un callAsync non ancora terminato) userebbe codice
  // scaricato.
  if (active_calls_ != 0) {
    Napi::Error::New(env, "Cannot close the library while calls to its functions are in progress")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (is_loaded_ && handle_ && !path_.empty()) {
    CloseSharedLibrary(handle_);
    handle_ = nullptr;
    is_loaded_ = false;
  }

  return env.Undefined();
}

Napi::Value Library::GetCallback(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // callback(returnType, [argTypes], jsFunction)
  if (info.Length() < 3) {
    Napi::TypeError::New(env, "Callback requires returnType, argTypes, jsFunction").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!info[2].IsFunction()) {
    Napi::TypeError::New(env, "Third argument must be a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Crea Callback object - ordine: jsFunction, returnType, argTypes
  std::vector<napi_value> args;
  args.push_back(info[2]);  // jsFunction
  args.push_back(info[0]);  // returnType
  args.push_back(info[1]);  // argTypes

  // Ottieni il costruttore Callback dall'addon
  CTypesAddon* addon = env.GetInstanceData<CTypesAddon>();
  if (!addon || !addon->CallbackConstructor) {
    Napi::Error::New(env, "Callback constructor not available").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return addon->CallbackConstructor->New(args);
}

Napi::Value Library::GetPath(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), path_);
}

Napi::Value Library::GetIsLoaded(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), is_loaded_);
}

}  // namespace ctypes
