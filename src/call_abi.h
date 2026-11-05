#pragma once

#include <cstdint>
#include <string_view>
#include <type_traits>

namespace ctypes {

enum class CallConv { CTYPES_DEFAULT, CTYPES_CDECL, CTYPES_STDCALL, CTYPES_FASTCALL, CTYPES_THISCALL };

[[nodiscard]] CallConv StringToCallConv(std::string_view name);

// x32 e AArch64 ILP32 usano slot ABI a 64 bit anche con puntatori a 32 bit.
#if defined(__ILP32__) && (defined(__x86_64__) || defined(__aarch64__))
using AbiWord = uint64_t;
#else
using AbiWord = uintptr_t;
#endif
using SignedAbiWord = std::make_signed_t<AbiWord>;

}  // namespace ctypes
