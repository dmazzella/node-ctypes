#pragma once

#include <napi.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <bit>
#include <chrono>
#include <cmath>
#include <concepts>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <cwchar>
#include <filesystem>
#include <format>
#include <iomanip>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <span>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <type_traits>
#include <unordered_map>
#include <utility>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif

#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

// ssize_t non esiste su Windows MSVC
#ifdef _MSC_VER
#include <BaseTsd.h>
using ssize_t = SSIZE_T;
#endif

#include <ffi.h>

// Force-inline portable. Applicato agli helper di FFIFunction::Call
// (MarshalArguments, SelectReturnPtr, CaptureErrorState, FinalizeCall):
// unico caller, call-overhead misurato ~5% sui bench primitive.
//   GCC/Clang: [[gnu::always_inline]] inline   (C++ attribute)
//   MSVC:      __forceinline                   (prefisso non-standard)
// CTYPES_NOINLINE: percorsi lenti tenuti fuori dal codice inline del percorso caldo.
#if defined(_MSC_VER)
#define CTYPES_ALWAYS_INLINE __forceinline
#define CTYPES_NOINLINE __declspec(noinline)
#elif defined(__GNUC__) || defined(__clang__)
#define CTYPES_ALWAYS_INLINE [[gnu::always_inline]] inline
#define CTYPES_NOINLINE [[gnu::noinline]]
#else
#define CTYPES_ALWAYS_INLINE inline
#define CTYPES_NOINLINE
#endif

namespace ctypes {

// Classi wrapper riconosciute dal type tag delle loro istanze (Node-API
// napi_type_tag_object): un oggetto JS con gli stessi metodi non passa per
// una di esse, come accadeva riconoscendole dai nomi dei metodi.
template <typename T>
concept TypeTaggedWrap = std::derived_from<T, Napi::ObjectWrap<T>> && requires {
  { T::kTypeTag } -> std::convertible_to<const napi_type_tag&>;
};

// Valore di tipo T letto da memoria grezza (risultati di libffi, slot degli
// argomenti, memoria C). memcpy è il modo definito dallo standard
// (std::start_lifetime_as è C++23); il compilatore lo riduce a un load.
template <typename T>
  requires std::is_trivially_copyable_v<T>
[[nodiscard]] inline T LoadAs(const void* p) noexcept {
  T value;
  std::memcpy(&value, p, sizeof(T));
  return value;
}

// Istanza nativa di `value` se è un oggetto creato da T, altrimenti nullptr.
template <TypeTaggedWrap T>
[[nodiscard]] T* UnwrapTagged(const Napi::Value& value) {
  if (!value.IsObject()) {
    return nullptr;
  }
  const Napi::Object object = value.As<Napi::Object>();
  return object.CheckTypeTag(&T::kTypeTag) ? Napi::ObjectWrap<T>::Unwrap(object) : nullptr;
}

}  // namespace ctypes
