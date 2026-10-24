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

namespace {

// Electron (V8 memory cage) rifiuta i Buffer su memoria non allocata da V8:
// napi_create_external_buffer restituisce napi_no_external_buffers_allowed.
// Si prova una volta all'avvio, invece di riconoscere il runtime dal nome.
bool ExternalBuffersAllowed(napi_env env) {
  static uint8_t probe = 0;
  napi_value result;
  napi_status status = napi_create_external_buffer(env, sizeof(probe), &probe, nullptr, nullptr, &result);
  if (status == napi_ok) {
    return true;
  }
  bool pending = false;
  if (napi_is_exception_pending(env, &pending) == napi_ok && pending) {
    napi_value ignored;
    napi_get_and_clear_last_exception(env, &ignored);
  }
  return false;
}

}  // namespace

// Costruttore JS di una classe wrapper, tenuto dall'addon per tutta la sua vita.
template <typename WrapperType>
std::unique_ptr<Napi::FunctionReference> PersistentClass(Napi::Env env) {
  return std::make_unique<Napi::FunctionReference>(Napi::Persistent(WrapperType::GetClass(env)));
}

CTypesAddon::CTypesAddon(Napi::Env env, Napi::Object exports) {
  Napi::Object owners = env.Global().Get("WeakMap").As<Napi::Function>().New({});
  errcheck_owners = Napi::Persistent(owners);
  errcheck_owner_set = Napi::Persistent(owners.Get("set").As<Napi::Function>());
  errcheck_owner_delete = Napi::Persistent(owners.Get("delete").As<Napi::Function>());
  if (const napi_node_version* node = Napi::VersionManagement::GetNodeVersion(env)) {
    napi_fast::buffer_info_checks_type = node->major > 20 || (node->major == 20 && node->minor >= 12);
  }

  // Inizializza tutti i constructor come membri di istanza
  LibraryConstructor = PersistentClass<Library>(env);
  FFIFunctionConstructor = PersistentClass<FFIFunction>(env);
  CallbackConstructor = PersistentClass<Callback>(env);
  ThreadSafeCallbackConstructor = PersistentClass<ThreadSafeCallback>(env);
  StructTypeConstructor = PersistentClass<StructType>(env);
  ArrayTypeConstructor = PersistentClass<ArrayType>(env);

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
                         InstanceMethod("memmove", &CTypesAddon::Memmove),
                         InstanceMethod("readMemory", &CTypesAddon::ReadMemory),
                         InstanceMethod("writeMemory", &CTypesAddon::WriteMemory),
                         InstanceMethod("dyldSharedCacheContains", &CTypesAddon::DyldSharedCacheContains),
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
                         InstanceValue("externalBuffersAllowed", Napi::Boolean::New(env, ExternalBuffersAllowed(env)),
                                       napi_enumerable),
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

// macOS 11+: system libraries and frameworks live only in the dyld shared
// cache, not on disk (Python ctypes.macholib.dyld uses the same function).
Napi::Value CTypesAddon::DyldSharedCacheContains(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
#ifdef __APPLE__
  if (info.Length() > 0 && info[0].IsString()) {
    if (__builtin_available(macOS 11.0, *)) {
      const std::string path = info[0].As<Napi::String>().Utf8Value();
      return Napi::Boolean::New(env, _dyld_shared_cache_contains_path(path.c_str()));
    }
  }
#else
  static_cast<void>(info);
#endif
  return Napi::Boolean::New(env, false);
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

  const CType ctype = CTypeFromJS(info[1]);

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

  const CType ctype = CTypeFromJS(info[1]);

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

  const std::span<uint8_t> target(static_cast<uint8_t*>(ptr) + offset, type_size);

  int written = JSToC(info[2], ctype, target);
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

  const CType ctype = CTypeFromJS(info[0]);

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
// Sorgente di string_at / wstring_at: Buffer (letto entro la sua lunghezza) o
// indirizzo. Il layer JS risolve istanze, array e puntatori; null/undefined
// danno NULL, qualsiasi altro valore lancia (ritorna false).
bool StringSource(const Napi::Value& value, const uint8_t*& ptr, size_t& limit_bytes) {
  ptr = nullptr;
  limit_bytes = SIZE_MAX;
  if (value.IsBuffer()) {
    Napi::Buffer<uint8_t> buf = value.As<Napi::Buffer<uint8_t>>();
    limit_bytes = buf.Length();
    ptr = buf.Data();
    return true;
  }
  if (value.IsBigInt()) {
    bool lossless;
    ptr = reinterpret_cast<const uint8_t*>(value.As<Napi::BigInt>().Uint64Value(&lossless));
    return true;
  }
  if (value.IsNumber()) {
    ptr = reinterpret_cast<const uint8_t*>(static_cast<uintptr_t>(value.As<Napi::Number>().Int64Value()));
    return true;
  }
  if (value.IsNull() || value.IsUndefined()) {
    return true;
  }
  Napi::TypeError::New(value.Env(), "Expected a Buffer, an address or null").ThrowAsJavaScriptException();
  return false;
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

  const uint8_t* source;
  size_t limit_bytes;
  if (!StringSource(info[0], source, limit_bytes)) {
    return env.Undefined();
  }
  if (!source) {
    return env.Null();
  }
  const char* ptr = reinterpret_cast<const char*>(source);

  std::optional<size_t> size;
  if (!StringLength(info, 1, limit_bytes, size)) {
    return env.Undefined();
  }

  size_t len = 0;
  if (size) {
    len = *size;
  } else {
    // Fino al NUL (senza limite, come Python), entro la lunghezza del Buffer.
    if (limit_bytes == SIZE_MAX) {
      len = std::strlen(ptr);
    } else {
      const void* nul = std::memchr(ptr, '\0', limit_bytes);
      len = nul ? static_cast<size_t>(static_cast<const char*>(nul) - ptr) : limit_bytes;
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

  const uint8_t* ptr;
  size_t limit_bytes;
  if (!StringSource(info[0], ptr, limit_bytes)) {
    return env.Undefined();
  }
  if (!ptr) {
    return env.Null();
  }

  std::optional<size_t> size;
  if (!StringLength(info, sizeof(wchar_t), limit_bytes, size)) {
    return env.Undefined();
  }

  // Lettura per memcpy: l'indirizzo può non essere allineato a wchar_t.
  auto at = [ptr](size_t i) { return LoadAs<wchar_t>(ptr + i * sizeof(wchar_t)); };

  size_t len = 0;
  if (size) {
    len = *size;
  } else {
    const size_t max_len = limit_bytes == SIZE_MAX ? SIZE_MAX : limit_bytes / sizeof(wchar_t);
    while (len < max_len && at(len) != L'\0') {
      len++;
    }
  }

  if (reinterpret_cast<uintptr_t>(ptr) % alignof(wchar_t) == 0) {
    return WideToJS(env, std::wstring_view(reinterpret_cast<const wchar_t*>(ptr), len));
  }
  std::vector<wchar_t> aligned(len);
  for (size_t i = 0; i < len; i++) {
    aligned[i] = at(i);
  }
  return WideToJS(env, std::wstring_view(aligned.data(), len));
}

// Memoria di un argomento di memmove: Buffer/TypedArray/ArrayBuffer (con
// controllo dei limiti) oppure un indirizzo BigInt/number non nullo.
static uint8_t* MemoryArgument(Napi::Env env, const Napi::Value& value, size_t size, const char* name) {
  if (value.IsTypedArray()) {
    Napi::TypedArray array = value.As<Napi::TypedArray>();
    if (array.ByteLength() < size) {
      Napi::RangeError::New(env, std::format("memmove: {} is smaller than {} bytes", name, size))
        .ThrowAsJavaScriptException();
      return nullptr;
    }
    return static_cast<uint8_t*>(array.ArrayBuffer().Data()) + array.ByteOffset();
  }
  if (value.IsArrayBuffer()) {
    Napi::ArrayBuffer buffer = value.As<Napi::ArrayBuffer>();
    if (buffer.ByteLength() < size) {
      Napi::RangeError::New(env, std::format("memmove: {} is smaller than {} bytes", name, size))
        .ThrowAsJavaScriptException();
      return nullptr;
    }
    return static_cast<uint8_t*>(buffer.Data());
  }
  uintptr_t address = 0;
  if (value.IsBigInt()) {
    bool lossless;
    address = static_cast<uintptr_t>(value.As<Napi::BigInt>().Uint64Value(&lossless));
  } else if (value.IsNumber()) {
    address = static_cast<uintptr_t>(value.As<Napi::Number>().Int64Value());
  } else {
    Napi::TypeError::New(env, std::format("memmove: {} must be a Buffer or an address", name))
      .ThrowAsJavaScriptException();
    return nullptr;
  }
  if (address == 0) {
    Napi::TypeError::New(env, std::format("memmove: {} is a NULL pointer", name)).ThrowAsJavaScriptException();
    return nullptr;
  }
  return reinterpret_cast<uint8_t*>(address);
}

Napi::Value CTypesAddon::AddressOf(const Napi::CallbackInfo& info) {
  const Napi::Env env = info.Env();
  if (info.Length() < 1 || !(info[0].IsBuffer() || info[0].IsTypedArray() || info[0].IsDataView() || info[0].IsArrayBuffer())) {
    throw Napi::TypeError::New(env, "addressOf requires a Buffer, typed view or ArrayBuffer");
  }
  const auto address = reinterpret_cast<uintptr_t>(MemoryArgument(env, info[0], 0, "addressOf"));
  return Napi::BigInt::New(env, static_cast<uint64_t>(address));
}

// memmove(dst, src, size): copia tra Buffer e indirizzi senza creare Buffer
// esterni, l'unico modo di leggere/scrivere memoria nativa dove sono vietati.
Napi::Value CTypesAddon::Memmove(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[2].IsNumber()) {
    Napi::TypeError::New(env, "memmove(dst, src, size) requires a numeric size").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const double size_raw = info[2].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(size_raw) || size_raw < 0 || std::floor(size_raw) != size_raw ||
      size_raw > 9007199254740991.0 || size_raw > static_cast<double>(SIZE_MAX)) {
    throw Napi::RangeError::New(env, "memmove: size must be a non-negative safe integer");
  }
  size_t size = static_cast<size_t>(size_raw);
  if (size == 0) {
    if (info[0].IsNull() || (info[0].IsBigInt() && info[0].As<Napi::BigInt>().WordCount() == 0) ||
        (info[0].IsNumber() && info[0].As<Napi::Number>().DoubleValue() == 0)) return Napi::BigInt::New(env, uint64_t{0});
    return Napi::BigInt::New(env, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(MemoryArgument(env, info[0], 0, "dst"))));
  }
  uint8_t* dst = MemoryArgument(env, info[0], size, "dst");
  if (dst == nullptr) {
    return env.Undefined();
  }
  uint8_t* src = MemoryArgument(env, info[1], size, "src");
  if (src == nullptr) {
    return env.Undefined();
  }
  memmove(dst, src, size);
  return Napi::BigInt::New(env, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(dst)));
}

// readMemory / writeMemory(buf, offset, length, address): copia `length` byte
// da `address` a buf[offset] o viceversa, in una sola chiamata e senza
// subarray. È il percorso caldo delle copie di memoria nativa usate dove i
// Buffer esterni sono vietati (lib/memory/mirror.js): la lettura o la
// scrittura di un campo. Con NAPI_CPP_EXCEPTIONS un argomento del tipo
// sbagliato lancia già nella conversione, quindi niente Is*() in più.
struct MemoryRange {
  uint8_t* data = nullptr;
  uint8_t* address = nullptr;
  size_t length = 0;
};

namespace {

MemoryRange MemoryRangeArguments(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4) {
    throw Napi::TypeError::New(env, "readMemory/writeMemory(buf, offset, length, address)");
  }
  Napi::Uint8Array buf = info[0].As<Napi::Uint8Array>();
  uint32_t offset = info[1].As<Napi::Number>().Uint32Value();
  uint32_t length = info[2].As<Napi::Number>().Uint32Value();
  if (static_cast<uint64_t>(offset) + length > buf.ByteLength()) {
    throw Napi::RangeError::New(env, "readMemory/writeMemory: range outside the buffer");
  }
  uintptr_t address = 0;
  Napi::Value value = info[3];
  if (value.Type() == napi_number) {
    address = static_cast<uintptr_t>(value.As<Napi::Number>().Int64Value());
  } else {
    bool lossless;
    address = static_cast<uintptr_t>(value.As<Napi::BigInt>().Uint64Value(&lossless));
  }
  if (address == 0) {
    throw Napi::TypeError::New(env, "readMemory/writeMemory: NULL address");
  }
  return {buf.Data() + offset, reinterpret_cast<uint8_t*>(address), length};
}

}  // namespace

Napi::Value CTypesAddon::ReadMemory(const Napi::CallbackInfo& info) {
  MemoryRange range = MemoryRangeArguments(info);
  memmove(range.data, range.address, range.length);
  return info.Env().Undefined();
}

Napi::Value CTypesAddon::WriteMemory(const Napi::CallbackInfo& info) {
  MemoryRange range = MemoryRangeArguments(info);
  memmove(range.address, range.data, range.length);
  return info.Env().Undefined();
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
