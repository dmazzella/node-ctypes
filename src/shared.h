#pragma once

#include <napi.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
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
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
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

// ssize_t non esiste su Windows MSVC
#ifdef _MSC_VER
#include <BaseTsd.h>
typedef SSIZE_T ssize_t;
#endif

#include <ffi.h>

// Force-inline portable. Applicato agli helper di FFIFunction::Call
// (MarshalArguments, SelectReturnPtr, CaptureErrorState, FinalizeCall):
// unico caller, call-overhead misurato ~5% sui bench primitive.
//   GCC/Clang: [[gnu::always_inline]] inline   (C++ attribute)
//   MSVC:      __forceinline                   (prefisso non-standard)
#if defined(_MSC_VER)
#  define CTYPES_ALWAYS_INLINE __forceinline
#elif defined(__GNUC__) || defined(__clang__)
#  define CTYPES_ALWAYS_INLINE [[gnu::always_inline]] inline
#else
#  define CTYPES_ALWAYS_INLINE inline
#endif

namespace ctypes {
// Helper per verificare se un oggetto è un StructType (ha metodo addField)
inline bool IsStructType(Napi::Object obj) {
  if (obj.IsEmpty() || obj.IsNull() || obj.IsUndefined()) {
    return false;
  }
  return obj.Has("addField") && obj.Get("addField").IsFunction();
}

// Helper per verificare se un oggetto è un ArrayType (ha metodo getLength)
inline bool IsArrayType(Napi::Object obj) {
  if (obj.IsEmpty() || obj.IsNull() || obj.IsUndefined()) {
    return false;
  }
  return obj.Has("getLength") && obj.Get("getLength").IsFunction();
}

// Helper per verificare se un oggetto è un TypeInfo (ha metodo name ma non addField/getLength)
inline bool IsTypeInfo(Napi::Object obj) {
  if (obj.IsEmpty() || obj.IsNull() || obj.IsUndefined()) {
    return false;
  }
  // TypeInfo ha "name" e "size" ma non "addField" né "getLength"
  return obj.Has("name") && obj.Get("name").IsFunction() && !obj.Has("addField") && !obj.Has("getLength");
}
}  // namespace ctypes
