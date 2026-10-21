#pragma once

// Direct-call fast path: for simple fixed signatures the target is invoked
// through a C function pointer of a matching register class, so the compiler
// emits the platform calling convention and libffi's per-call classification
// (ffi_call_int / ffi_call_SYSV) is skipped.
//
// Eligibility (see FFIFunction::PrepareFFI):
//   - 64-bit little-endian target, default ABI, non-variadic call;
//   - at most kMaxDirectArgs arguments, so every argument travels in a
//     register on Win64 (4 slots), SysV x86-64, AAPCS64 and Apple arm64;
//   - integer/pointer/string, double or float arguments (no float/double
//     arguments on x86-64, see kFloatArgsAllowed);
//   - void, integer/pointer/string, double or float return.
// Integer arguments narrower than 64 bits are sign/zero-extended in their slot
// before the call, and narrow integer returns are extended afterwards, matching
// what libffi does with ffi_arg.

#include "shared.h"
#include "types.h"

namespace ctypes::direct {

inline constexpr size_t kMaxDirectArgs = 4;

// On x86-64 libffi also makes a variadic function declared with all its
// arguments (e.g. printf with argtypes [c_char_p, c_double]) work: on Win64 it
// loads every argument into both the integer and the xmm registers, on SysV it
// always sets %al to the number of vector registers used. A typed direct call
// does neither, so float/double arguments keep going through libffi there.
// On arm64 libffi places them exactly like the direct call (Windows ARM64 uses
// integer registers only for ffi_prep_cif_var), so there is nothing to keep.
#if defined(__x86_64__) || defined(_M_X64)
inline constexpr bool kFloatArgsAllowed = false;
#else
inline constexpr bool kFloatArgsAllowed = true;
#endif

// Register classes.
enum class ArgClass : uint8_t { Int = 0, Double = 1, Float = 2 };
enum class RetClass : uint8_t { Void = 0, Int = 1, Double = 2, Float = 3 };
inline constexpr size_t kArgClassCount = kFloatArgsAllowed ? 3 : 1;

using Invoker = void (*)(void* fn, void** args, void* ret);

// Internal linkage: keeps the invoker instantiations out of the exported
// symbol table (this header is only included by function.cc).
namespace {

template <int C>
using ArgOf = std::conditional_t<C == 0, int64_t, std::conditional_t<C == 1, double, float>>;

template <int R>
using RetOf =
  std::conditional_t<R == 0, void, std::conditional_t<R == 1, int64_t, std::conditional_t<R == 2, double, float>>>;

template <typename T>
inline T Load(const void* p) {
  T v;
  std::memcpy(&v, p, sizeof(T));
  return v;
}

template <typename R, typename... A, size_t... Is>
inline void InvokeImpl(void* fn, void** args, void* ret, std::index_sequence<Is...>) {
  using Fn = R (*)(A...);
  if constexpr (std::is_void_v<R>) {
    (void)args;
    (void)ret;
    reinterpret_cast<Fn>(fn)(Load<A>(args[Is])...);
  } else {
    R r = reinterpret_cast<Fn>(fn)(Load<A>(args[Is])...);
    std::memcpy(ret, &r, sizeof(R));
  }
}

template <typename R, typename... A>
void Invoke(void* fn, void** args, void* ret) {
  InvokeImpl<R, A...>(fn, args, ret, std::index_sequence_for<A...>{});
}

// Code encodes the argument classes in base kArgClassCount, first argument
// in the least significant digit.
template <size_t Code, size_t N, typename R, typename... Acc>
constexpr Invoker Build() {
  if constexpr (N == 0) {
    return &Invoke<R, Acc...>;
  } else {
    return Build<Code / kArgClassCount, N - 1, R, Acc..., ArgOf<static_cast<int>(Code % kArgClassCount)>>();
  }
}

constexpr size_t Pow(size_t base, size_t exp) {
  return exp == 0 ? 1 : base * Pow(base, exp - 1);
}

template <int R, size_t N, size_t... Codes>
constexpr std::array<Invoker, sizeof...(Codes)> MakeRow(std::index_sequence<Codes...>) {
  return {Build<Codes, N, RetOf<R>>()...};
}

template <int R, size_t N>
inline constexpr auto kRow = MakeRow<R, N>(std::make_index_sequence<Pow(kArgClassCount, N)>{});

}  // namespace

template <int R>
inline Invoker SelectForRet(size_t n, size_t code) {
  static_assert(kMaxDirectArgs == 4, "update the arity switch");
  switch (n) {
    case 0:
      return kRow<R, 0>[code];
    case 1:
      return kRow<R, 1>[code];
    case 2:
      return kRow<R, 2>[code];
    case 3:
      return kRow<R, 3>[code];
    case 4:
      return kRow<R, 4>[code];
    default:
      return nullptr;
  }
}

inline Invoker Select(RetClass ret, size_t n, size_t code) {
  switch (ret) {
    case RetClass::Void:
      return SelectForRet<0>(n, code);
    case RetClass::Int:
      return SelectForRet<1>(n, code);
    case RetClass::Double:
      return SelectForRet<2>(n, code);
    case RetClass::Float:
      return SelectForRet<3>(n, code);
  }
  return nullptr;
}

// Integer CTypes that travel in a general purpose register.
inline bool IsIntClass(CType t) {
  switch (t) {
    case CType::CTYPES_INT8:
    case CType::CTYPES_UINT8:
    case CType::CTYPES_INT16:
    case CType::CTYPES_UINT16:
    case CType::CTYPES_INT32:
    case CType::CTYPES_UINT32:
    case CType::CTYPES_INT64:
    case CType::CTYPES_UINT64:
    case CType::CTYPES_POINTER:
    case CType::CTYPES_STRING:
    case CType::CTYPES_WSTRING:
    case CType::CTYPES_WCHAR:
    case CType::CTYPES_CHAR:
    case CType::CTYPES_BOOL:
    case CType::CTYPES_SIZE_T:
    case CType::CTYPES_SSIZE_T:
    case CType::CTYPES_LONG:
    case CType::CTYPES_ULONG:
      return true;
    default:
      return false;
  }
}

inline bool IsSignedInt(CType t) {
  switch (t) {
    case CType::CTYPES_INT8:
    case CType::CTYPES_INT16:
    case CType::CTYPES_INT32:
    case CType::CTYPES_LONG:
      return true;
    case CType::CTYPES_WCHAR:
      return std::is_signed_v<wchar_t>;
    case CType::CTYPES_CHAR:
      return std::is_signed_v<char>;
    default:
      return false;
  }
}

// Integer value of `size` bytes at p, extended in place to 64 bits.
struct Widen {
  uint8_t index;
  uint8_t size;
  bool is_signed;
};

inline void WidenInPlace(void* p, uint8_t size, bool is_signed) {
  int64_t v;
  switch (size) {
    case 1:
      v = is_signed ? static_cast<int64_t>(Load<int8_t>(p)) : static_cast<int64_t>(Load<uint8_t>(p));
      break;
    case 2:
      v = is_signed ? static_cast<int64_t>(Load<int16_t>(p)) : static_cast<int64_t>(Load<uint16_t>(p));
      break;
    case 4:
      v = is_signed ? static_cast<int64_t>(Load<int32_t>(p)) : static_cast<int64_t>(Load<uint32_t>(p));
      break;
    default:
      return;
  }
  std::memcpy(p, &v, sizeof(v));
}

}  // namespace ctypes::direct
