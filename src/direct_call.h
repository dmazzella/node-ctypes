#pragma once

// Exact scalar signatures only. Pointer pointees/qualifiers are not represented
// by CType, so their register-class compatibility is not enough for a C++ call.
#include "types.h"

namespace ctypes::direct {
namespace {

inline constexpr size_t kMaxDirectArgs = 4;
#if defined(__x86_64__) || defined(_M_X64)
inline constexpr bool kFloatArgsAllowed = false;
#else
inline constexpr bool kFloatArgsAllowed = true;
#endif

extern "C" {
using CFunctionType = int32_t(int32_t);
}
inline constexpr bool kCFunctionTypesCompatible = std::same_as<CFunctionType, int32_t(int32_t)>;
inline constexpr size_t kArgClassCount = kFloatArgsAllowed ? 3 : 1;
using Invoker = void (*)(void* fn, void** args, void* ret);

template <typename T>
concept Scalar = std::integral<T> || std::same_as<T, float> || std::same_as<T, double>;

template <typename R>
concept ScalarResult = std::is_void_v<R> || Scalar<R>;

template <ScalarResult R, Scalar... A, size_t... Is>
inline void InvokeImpl(void* fn, [[maybe_unused]] void** args, [[maybe_unused]] void* ret, std::index_sequence<Is...>) {
  using Fn = R (*)(A...);
  if constexpr (std::is_void_v<R>) {
    reinterpret_cast<Fn>(fn)(LoadAs<A>(args[Is])...);
  } else {
    StoreReturnValue(ret, reinterpret_cast<Fn>(fn)(LoadAs<A>(args[Is])...));
  }
}

template <ScalarResult R, Scalar... A>
void Invoke(void* fn, void** args, void* ret) {
  InvokeImpl<R, A...>(fn, args, ret, std::index_sequence_for<A...>{});
}

template <typename Factory>
constexpr Invoker VisitScalar(CType type, Factory make) {
  switch (type) {
    case CType::CTYPES_INT8:
      return make.template operator()<int8_t>();
    case CType::CTYPES_UINT8:
      return make.template operator()<uint8_t>();
    case CType::CTYPES_INT16:
      return make.template operator()<int16_t>();
    case CType::CTYPES_UINT16:
      return make.template operator()<uint16_t>();
    case CType::CTYPES_INT32:
      return make.template operator()<int32_t>();
    case CType::CTYPES_UINT32:
      return make.template operator()<uint32_t>();
    case CType::CTYPES_INT64:
      return make.template operator()<int64_t>();
    case CType::CTYPES_UINT64:
      return make.template operator()<uint64_t>();
    case CType::CTYPES_FLOAT:
      return make.template operator()<float>();
    case CType::CTYPES_DOUBLE:
      return make.template operator()<double>();
    case CType::CTYPES_CHAR:
      return make.template operator()<char>();
    case CType::CTYPES_WCHAR:
      return make.template operator()<wchar_t>();
    case CType::CTYPES_BOOL:
      return make.template operator()<bool>();
    case CType::CTYPES_SIZE_T:
      return make.template operator()<size_t>();
    case CType::CTYPES_SSIZE_T:
      return make.template operator()<ssize_t>();
    case CType::CTYPES_LONG:
      return make.template operator()<long>();
    case CType::CTYPES_ULONG:
      return make.template operator()<unsigned long>();
    default:
      return nullptr;
  }
}

template <typename T>
[[nodiscard]] constexpr bool Matches(CType type) {
  bool matches = false;
  VisitScalar(type, [&matches]<typename U>() -> Invoker {
    matches = std::same_as<T, U>;
    return nullptr;
  });
  return matches;
}

template <size_t Code>
using CoreArg = std::conditional_t<Code == 0, int32_t, std::conditional_t<Code == 1, double, float>>;

template <size_t Code, size_t N, typename R, typename... Acc>
constexpr Invoker BuildCore() {
  if constexpr (N == 0) {
    return &Invoke<R, Acc...>;
  } else {
    return BuildCore<Code / kArgClassCount, N - 1, R, Acc..., CoreArg<Code % kArgClassCount>>();
  }
}

constexpr size_t Pow(size_t base, size_t exponent) {
  return exponent == 0 ? 1 : base * Pow(base, exponent - 1);
}

template <typename R, size_t N, size_t... Codes>
constexpr auto MakeRow(std::index_sequence<Codes...>) {
  return std::array<Invoker, sizeof...(Codes)>{BuildCore<Codes, N, R>()...};
}

template <typename R, size_t N>
inline constexpr auto kRow = MakeRow<R, N>(std::make_index_sequence<Pow(kArgClassCount, N)>{});

template <typename R>
Invoker SelectCore(size_t count, size_t code) {
  switch (count) {
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

template <typename T, size_t>
using Repeated = T;

template <typename R, typename A, size_t... Is>
constexpr Invoker Repeat(std::index_sequence<Is...>) {
  return &Invoke<R, Repeated<A, Is>...>;
}

template <typename R, typename A>
Invoker SelectHomogeneous(size_t count) {
  switch (count) {
    case 2:
      return Repeat<R, A>(std::make_index_sequence<2>{});
    case 3:
      return Repeat<R, A>(std::make_index_sequence<3>{});
    case 4:
      return Repeat<R, A>(std::make_index_sequence<4>{});
    default:
      return nullptr;
  }
}

template <ScalarResult R>
Invoker SelectForResult(std::span<const CType> args) {
  if (args.empty()) {
    return &Invoke<R>;
  }
  if (args.size() == 1) {
    return VisitScalar(args[0], []<Scalar A>() -> Invoker {
      if constexpr (!kFloatArgsAllowed && std::is_floating_point_v<A>) {
        return nullptr;
      } else {
        return &Invoke<R, A>;
      }
    });
  }
  if constexpr (std::is_void_v<R> || std::same_as<R, int32_t> || std::same_as<R, double> || std::same_as<R, float>) {
    size_t code = 0, weight = 1;
    bool core = true;
    for (const auto type : args) {
      if (Matches<int32_t>(type)) {
      } else if constexpr (kFloatArgsAllowed) {
        if (Matches<double>(type)) {
          code += weight;
        } else if (Matches<float>(type)) {
          code += 2 * weight;
        } else {
          core = false;
          break;
        }
      } else {
        core = false;
        break;
      }
      weight *= kArgClassCount;
    }
    if (core) {
      return SelectCore<R>(args.size(), code);
    }
  }
  return VisitScalar(args[0], [args]<Scalar A>() -> Invoker {
    if constexpr ((!kFloatArgsAllowed && std::is_floating_point_v<A>) || (!std::is_void_v<R> && !std::same_as<R, A>)) {
      return nullptr;
    } else {
      if (!std::ranges::all_of(args, [](CType type) { return Matches<A>(type); })) {
        return nullptr;
      }
      return SelectHomogeneous<R, A>(args.size());
    }
  });
}

[[nodiscard]] inline Invoker Select(CType result, std::span<const CType> args) {
  if (!kCFunctionTypesCompatible || args.size() > kMaxDirectArgs) {
    return nullptr;
  }
  if (result == CType::CTYPES_VOID) {
    return SelectForResult<void>(args);
  }
  return VisitScalar(result, [args]<Scalar R>() { return SelectForResult<R>(args); });
}

}  // namespace
}  // namespace ctypes::direct
