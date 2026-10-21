#include "addon.h"

#include "array.h"
#include "callback.h"
#include "function.h"
#include "library.h"
#include "struct.h"
#include "types.h"
#include "version.h"

namespace ctypes {
// Helper per creare l'oggetto Version (dichiarato prima dell'uso)
Napi::Object CreateVersionObject(Napi::Env env) {
  Napi::Object version = Napi::Object::New(env);
  version.Set("major", Napi::Number::New(env, CTYPES_MAJOR_VERSION));
  version.Set("minor", Napi::Number::New(env, CTYPES_MINOR_VERSION));
  version.Set("patch", Napi::Number::New(env, CTYPES_PATCH_VERSION));
  version.Set("toString", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
                return Napi::String::New(info.Env(), std::format("{}.{}.{}", CTYPES_MAJOR_VERSION, CTYPES_MINOR_VERSION,
                                                                 CTYPES_PATCH_VERSION));
              }));
  return version;
}

template <typename Func>
auto SafeInvoke(Napi::Env env, Func&& func) -> decltype(func()) {
  try {
    return func();
  } catch (const std::bad_alloc& e) {
    Napi::Error::New(env, std::format("Memory allocation failed: {}", e.what())).ThrowAsJavaScriptException();
    if constexpr (std::is_void_v<decltype(func())>) {
      return;
    } else {
      return {};
    }
  } catch (const std::runtime_error& e) {
    Napi::Error::New(env, std::format("Runtime error: {}", e.what())).ThrowAsJavaScriptException();
    if constexpr (std::is_void_v<decltype(func())>) {
      return;
    } else {
      return {};
    }
  } catch (const std::exception& e) {
    Napi::Error::New(env, std::format("Exception: {}", e.what())).ThrowAsJavaScriptException();
    if constexpr (std::is_void_v<decltype(func())>) {
      return;
    } else {
      return {};
    }
  } catch (...) {
    Napi::Error::New(env, "Unknown exception occurred").ThrowAsJavaScriptException();
    if constexpr (std::is_void_v<decltype(func())>) {
      return;
    } else {
      return {};
    }
  }
}

template <typename WrapperType>
std::unique_ptr<Napi::FunctionReference> SafeInitializeWrapper(Napi::Env env, const std::string& wrapperName) {
  return SafeInvoke(env, [&]() -> std::unique_ptr<Napi::FunctionReference> {
    Napi::Function func = WrapperType::GetClass(env);
    auto result = std::make_unique<Napi::FunctionReference>();
    *result = Napi::Persistent(func);
    if (!result) {
      throw std::runtime_error(std::format("Failed to initialize {} wrapper constructor", wrapperName));
    }
    return result;
  });
}

CTypesAddon::CTypesAddon(Napi::Env env, Napi::Object exports) {
  // Inizializza tutti i constructor come membri di istanza
  LibraryConstructor = SafeInitializeWrapper<Library>(env, "Library");
  FFIFunctionConstructor = SafeInitializeWrapper<FFIFunction>(env, "FFIFunction");
  CallbackConstructor = SafeInitializeWrapper<Callback>(env, "Callback");
  ThreadSafeCallbackConstructor = SafeInitializeWrapper<ThreadSafeCallback>(env, "ThreadSafeCallback");
  StructTypeConstructor = SafeInitializeWrapper<StructType>(env, "StructType");
  ArrayTypeConstructor = SafeInitializeWrapper<ArrayType>(env, "ArrayType");

  // Definisci l'addon con tutte le esportazioni
  DefineAddon(exports, {
                         // Version info (semplice oggetto, non classe)
                         InstanceValue("Version", CreateVersionObject(env), napi_enumerable),

                         // Classi wrapper
                         InstanceValue("Library", LibraryConstructor->Value(), napi_enumerable),
                         InstanceValue("FFIFunction", FFIFunctionConstructor->Value(), napi_enumerable),
                         InstanceValue("Callback", CallbackConstructor->Value(), napi_enumerable),
                         InstanceValue("ThreadSafeCallback", ThreadSafeCallbackConstructor->Value(), napi_enumerable),
                         InstanceValue("StructType", StructTypeConstructor->Value(), napi_enumerable),
                         InstanceValue("ArrayType", ArrayTypeConstructor->Value(), napi_enumerable),

                         // Funzioni helper
                         InstanceMethod("load", &CTypesAddon::LoadLibrary),
                         InstanceMethod("alloc", &CTypesAddon::Alloc),
                         InstanceMethod("readValue", &CTypesAddon::ReadValue),
                         InstanceMethod("writeValue", &CTypesAddon::WriteValue),
                         InstanceMethod("sizeof", &CTypesAddon::SizeOf),
                         InstanceMethod("cstring", &CTypesAddon::CreateCString),
                         InstanceMethod("readCString", &CTypesAddon::ReadCString),
                         InstanceMethod("readWString", &CTypesAddon::ReadWString),
                         InstanceMethod("ptrToBuffer", &CTypesAddon::PtrToBuffer),
                         InstanceMethod("addressOf", &CTypesAddon::AddressOf),
                         // Slot module-level last-error / errno (parity Python ctypes)
                         InstanceMethod("getCapturedLastError", &CTypesAddon::GetCapturedLastError),
                         InstanceMethod("setCapturedLastError", &CTypesAddon::SetCapturedLastError),
                         InstanceMethod("getCapturedErrno", &CTypesAddon::GetCapturedErrno),
                         InstanceMethod("setCapturedErrno", &CTypesAddon::SetCapturedErrno),
                         InstanceMethod("setArgumentError", &CTypesAddon::SetArgumentError),

                         // CType enum - single source of truth per i tipi
                         InstanceValue("CType", CreateCType(env), napi_enumerable),

                         // Costanti
                         InstanceValue("POINTER_SIZE", Napi::Number::New(env, sizeof(void*)), napi_enumerable),
                         InstanceValue("WCHAR_SIZE", Napi::Number::New(env, sizeof(wchar_t)), napi_enumerable),
                         InstanceValue("NULL", env.Null(), napi_enumerable),
#ifdef _WIN32
                         InstanceValue("RTLD_GLOBAL", Napi::Number::New(env, 0), napi_enumerable),
                         InstanceValue("RTLD_LOCAL", Napi::Number::New(env, 0), napi_enumerable),
#else
                         InstanceValue("RTLD_GLOBAL", Napi::Number::New(env, RTLD_GLOBAL), napi_enumerable),
                         InstanceValue("RTLD_LOCAL", Napi::Number::New(env, RTLD_LOCAL), napi_enumerable),
#endif
                       });
}

CTypesAddon::~CTypesAddon() {}

// ========== Helper functions ==========

Napi::Value CTypesAddon::LoadLibrary(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!LibraryConstructor) {
    Napi::Error::New(env, "Addon not properly initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return LibraryConstructor->New({info[0]});
}

Napi::Value CTypesAddon::Alloc(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Size (number) expected").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int64_t size_raw = info[0].ToNumber().Int64Value();

  // Validate: must be positive and within reasonable bounds
  if (size_raw <= 0 || size_raw > static_cast<int64_t>(SIZE_MAX / 2)) {
    Napi::RangeError::New(env, "Invalid buffer size: must be positive and within reasonable limits")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  size_t size = static_cast<size_t>(size_raw);
  return Napi::Buffer<uint8_t>::New(env, size);
}

Napi::Value CTypesAddon::ReadValue(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Pointer and type required").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  void* ptr = nullptr;
  size_t offset = 0;

  // Parse pointer
  if (info[0].IsBuffer()) {
    ptr = info[0].As<Napi::Buffer<uint8_t>>().Data();
  } else if (info[0].IsBigInt()) {
    bool lossless;
    uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    if (!lossless) {
      Napi::TypeError::New(env, "BigInt conversion to pointer lost precision").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    ptr = reinterpret_cast<void*>(addr);
  } else if (info[0].IsNumber()) {
    ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
  } else {
    Napi::TypeError::New(env, "Invalid pointer type").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Parse type - solo numeri (CType enum values)
  if (!info[1].IsNumber()) {
    Napi::TypeError::New(env, "Type must be a CType enum value (number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  CType ctype;
  try {
    ctype = IntToCType(info[1].As<Napi::Number>().Int32Value());
  } catch (const std::exception& e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Parse offset
  if (info.Length() > 2 && info[2].IsNumber()) {
    int64_t offset_raw = info[2].ToNumber().Int64Value();
    if (offset_raw < 0) {
      Napi::RangeError::New(env, "Offset must be non-negative").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    offset = static_cast<size_t>(offset_raw);
  }

  if (!ptr) {
    return env.Null();
  }

  // Additional validation: check if we can safely add offset
  if (info[0].IsBuffer()) {
    size_t buffer_size = info[0].As<Napi::Buffer<uint8_t>>().Length();
    size_t type_size = CTypeSize(ctype);
    if (offset + type_size > buffer_size) {
      Napi::RangeError::New(env, "Read would exceed buffer bounds").ThrowAsJavaScriptException();
      return env.Undefined();
    }
  }

  void* read_ptr = static_cast<uint8_t*>(ptr) + offset;
  return CToJS(env, read_ptr, ctype);
}

Napi::Value CTypesAddon::WriteValue(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3) {
    Napi::TypeError::New(env, "Pointer, type and value required").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  void* ptr = nullptr;
  size_t offset = 0;

  // Parse pointer
  if (info[0].IsBuffer()) {
    ptr = info[0].As<Napi::Buffer<uint8_t>>().Data();
  } else if (info[0].IsBigInt()) {
    bool lossless;
    uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    if (!lossless) {
      Napi::TypeError::New(env, "BigInt conversion to pointer lost precision").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    ptr = reinterpret_cast<void*>(addr);
  } else if (info[0].IsNumber()) {
    ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
  } else {
    Napi::TypeError::New(env, "Invalid pointer type").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Parse type - solo numeri (CType enum values)
  if (!info[1].IsNumber()) {
    Napi::TypeError::New(env, "Type must be a CType enum value (number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  CType ctype;
  try {
    ctype = IntToCType(info[1].As<Napi::Number>().Int32Value());
  } catch (const std::exception& e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Parse offset
  if (info.Length() > 3 && info[3].IsNumber()) {
    int64_t offset_raw = info[3].ToNumber().Int64Value();
    if (offset_raw < 0) {
      Napi::RangeError::New(env, "Offset must be non-negative").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    offset = static_cast<size_t>(offset_raw);
  }

  if (!ptr) {
    Napi::Error::New(env, "Cannot write to null pointer").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  size_t type_size = CTypeSize(ctype);

  // Additional validation for buffer writes
  if (info[0].IsBuffer()) {
    size_t buffer_size = info[0].As<Napi::Buffer<uint8_t>>().Length();
    if (offset + type_size > buffer_size) {
      Napi::RangeError::New(env, "Write would exceed buffer bounds").ThrowAsJavaScriptException();
      return env.Undefined();
    }
  }

  void* write_ptr = static_cast<uint8_t*>(ptr) + offset;

  int written = JSToC(env, info[2], ctype, write_ptr, type_size);
  if (written < 0) {
    Napi::Error::New(env, "Failed to write value").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return Napi::Number::New(env, written);
}

Napi::Value CTypesAddon::SizeOf(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "CType enum value (number) required").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  CType ctype;
  try {
    ctype = IntToCType(info[0].As<Napi::Number>().Int32Value());
  } catch (const std::exception& e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return Napi::Number::New(env, static_cast<double>(CTypeSize(ctype)));
}

Napi::Value CTypesAddon::CreateCString(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string str = info[0].As<Napi::String>().Utf8Value();

  auto buffer = Napi::Buffer<char>::New(env, str.length() + 1);
  memcpy(buffer.Data(), str.c_str(), str.length() + 1);

  return buffer;
}

namespace {

// Memoria di partenza di string_at / wstring_at: Buffer (con il suo limite in
// byte), BigInt o Number. nullptr per NULL o tipi non supportati.
const uint8_t* StringSource(const Napi::Value& value, size_t& limit_bytes) {
  limit_bytes = SIZE_MAX;
  if (value.IsBuffer()) {
    Napi::Buffer<uint8_t> buf = value.As<Napi::Buffer<uint8_t>>();
    limit_bytes = buf.Length();
    return buf.Data();
  }
  if (value.IsBigInt()) {
    bool lossless;
    return reinterpret_cast<const uint8_t*>(value.As<Napi::BigInt>().Uint64Value(&lossless));
  }
  if (value.IsNumber()) {
    return reinterpret_cast<const uint8_t*>(static_cast<uintptr_t>(value.As<Napi::Number>().Int64Value()));
  }
  return nullptr;
}

// Python string_at / wstring_at: con `size` si leggono esattamente `size`
// unità (NUL interni compresi), altrimenti fino al NUL. Ritorna false se ha
// lanciato un'eccezione JS.
bool StringLength(const Napi::CallbackInfo& info, size_t unit, size_t limit_bytes, std::optional<size_t>& size) {
  if (info.Length() > 1 && info[1].IsNumber()) {
    const int64_t raw = info[1].As<Napi::Number>().Int64Value();
    if (raw < 0 || static_cast<uint64_t>(raw) > (SIZE_MAX / 2) / unit) {
      Napi::RangeError::New(info.Env(), "Invalid size: must be a non-negative integer").ThrowAsJavaScriptException();
      return false;
    }
    size = static_cast<size_t>(raw);
    if (limit_bytes != SIZE_MAX && *size * unit > limit_bytes) {
      Napi::RangeError::New(info.Env(), "size exceeds the buffer length").ThrowAsJavaScriptException();
      return false;
    }
  }
  return true;
}

}  // namespace

Napi::Value CTypesAddon::ReadCString(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Pointer required").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  size_t limit_bytes;
  const char* ptr = reinterpret_cast<const char*>(StringSource(info[0], limit_bytes));
  if (!ptr) {
    return env.Null();
  }

  std::optional<size_t> size;
  if (!StringLength(info, 1, limit_bytes, size)) {
    return env.Undefined();
  }

  size_t len = 0;
  if (size) {
    len = *size;
  } else {
    // Fino al NUL, entro il Buffer o un limite di sicurezza (anti-DoS).
    const size_t max_len = std::min<size_t>(limit_bytes, 1024 * 1024);
    while (len < max_len && ptr[len] != '\0') {
      len++;
    }
  }

  return Napi::String::New(env, ptr, len);
}

Napi::Value CTypesAddon::ReadWString(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Pointer required").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  size_t limit_bytes;
  const uint8_t* ptr = StringSource(info[0], limit_bytes);
  if (!ptr) {
    return env.Null();
  }

  std::optional<size_t> size;
  if (!StringLength(info, sizeof(wchar_t), limit_bytes, size)) {
    return env.Undefined();
  }

  // Lettura per memcpy: l'indirizzo può non essere allineato a wchar_t.
  auto at = [ptr](size_t i) {
    wchar_t wc;
    memcpy(&wc, ptr + i * sizeof(wchar_t), sizeof(wchar_t));
    return wc;
  };

  size_t len = 0;
  if (size) {
    len = *size;
  } else {
    const size_t max_len = std::min<size_t>(limit_bytes / sizeof(wchar_t), 1024 * 1024);
    while (len < max_len && at(len) != L'\0') {
      len++;
    }
  }

  std::u16string out;
  out.reserve(len);
  for (size_t i = 0; i < len; i++) {
#ifdef _WIN32
    out.push_back(static_cast<char16_t>(at(i)));
#else
    // wchar_t è UTF-32: code point non validi diventano U+FFFD.
    uint32_t cp = static_cast<uint32_t>(at(i));
    if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) {
      cp = 0xFFFD;
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      out.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
      out.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
    } else {
      out.push_back(static_cast<char16_t>(cp));
    }
#endif
  }
  return Napi::String::New(env, out);
}

Napi::Value CTypesAddon::AddressOf(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "addressOf requires a Buffer argument").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  void* ptr = info[0].As<Napi::Buffer<uint8_t>>().Data();
  return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(ptr));
}

Napi::Value CTypesAddon::PtrToBuffer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Address and size required").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  void* ptr = nullptr;

  if (info[0].IsBigInt()) {
    bool lossless;
    uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    ptr = reinterpret_cast<void*>(addr);
  } else if (info[0].IsNumber()) {
    ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
  } else {
    Napi::TypeError::New(env, "Address must be BigInt or Number").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!ptr) {
    return env.Null();
  }

  int64_t size_raw = info[1].ToNumber().Int64Value();
  if (size_raw <= 0 || size_raw > static_cast<int64_t>(SIZE_MAX / 2)) {
    Napi::RangeError::New(env, "Invalid buffer size").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  size_t size = static_cast<size_t>(size_raw);

  // WARNING: This creates a Buffer viewing external memory.
  // The caller MUST ensure the underlying memory remains valid
  // for the lifetime of the Buffer. Consider copying data instead
  // if ownership is unclear.
  return Napi::Buffer<uint8_t>::New(env, static_cast<uint8_t*>(ptr), size, [](Napi::Env, void*) {
    // No-op finalizer - caller owns the memory
    // This is intentional but requires careful usage
  });
}

// ========== Module-level captured last-error / errno ==========
// Slot privati thread-local aggiornati da FFIFunction::Call quando la library
// è aperta con use_last_error / use_errno. Parity Python ctypes: le API
// get_last_error / set_last_error / get_errno / set_errno leggono e scrivono
// SOLO questa slot, non il valore di sistema.

Napi::Value CTypesAddon::GetCapturedLastError(const Napi::CallbackInfo& info) {
  // Ritorna unsigned (DWORD) come double — copre l'intero range uint32.
  return Napi::Number::New(info.Env(), static_cast<double>(captured_last_error));
}

Napi::Value CTypesAddon::SetCapturedLastError(const Napi::CallbackInfo& info) {
  uint32_t prev = captured_last_error;
  if (info.Length() >= 1 && info[0].IsNumber()) {
    captured_last_error = info[0].As<Napi::Number>().Uint32Value();
  }
  return Napi::Number::New(info.Env(), static_cast<double>(prev));
}

Napi::Value CTypesAddon::GetCapturedErrno(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), captured_errno);
}

Napi::Value CTypesAddon::SetArgumentError(const Napi::CallbackInfo& info) {
  if (info.Length() >= 1 && info[0].IsFunction()) {
    argument_error_ctor = Napi::Persistent(info[0].As<Napi::Function>());
  }
  return info.Env().Undefined();
}

Napi::Value CTypesAddon::SetCapturedErrno(const Napi::CallbackInfo& info) {
  int prev = captured_errno;
  if (info.Length() >= 1 && info[0].IsNumber()) {
    captured_errno = info[0].As<Napi::Number>().Int32Value();
  }
  return Napi::Number::New(info.Env(), prev);
}

}  // namespace ctypes
