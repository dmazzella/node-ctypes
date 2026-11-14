#pragma once

// Chiamata "a registri" per le firme di soli scalari e puntatori, senza libffi.
//
// Ogni argomento è scritto al suo posto in un "frame" di parole (registro o
// slot di stack) secondo un piano calcolato una volta per funzione; una firma
// C++ fissa per ABI passa poi tutto il frame. I registri e gli slot non usati
// sono ignorati dalla funzione chiamata ma sono azzerati (Plan::Clear): ogni
// parola letta è inizializzata. Gli argomenti arrivano come parole intere
// (StoreArgument): interi stretti estesi, un float nei 32 bit bassi.
//
// - AArch64 (AAPCS64): interi e puntatori in x0-x7, float e double in v0-v7, i
//   due banchi indipendenti; poi lo stack in ordine, uno slot di 8 byte per
//   argomento. Firma R(uint64 × 8, double × 8, uint64 × K). Il prototipo è
//   fisso: con un prototipo variadico Apple passerebbe tutto sullo stack e
//   Windows i float nei registri interi. Apple impacchetta lo stack: ogni
//   scalare occupa la sua dimensione, allineato alla sua dimensione naturale
//   (come allocate_to_stack di libffi), invece di uno slot di 8 byte. Le parole
//   di stack passate dall'invoker sono la stessa sequenza di byte.
// - x86-64 System V: come AArch64 con 6 registri interi e 8 XMM. Il prototipo
//   è variadico, così il compilatore imposta AL (registri vettoriali usati)
//   come libffi: una funzione variadica dichiarata con argtypes (lo schema di
//   Python ctypes) riceve correttamente i double.
// - Win64: posizionale, l'argomento i < 4 va in RCX/RDX/R8/R9 o XMM0-3 secondo
//   il tipo, gli altri sullo stack in ordine. Le quattro posizioni passano
//   come double con un prototipo variadico: per le chiamate variadiche l'ABI
//   vuole il double sia nel registro XMM sia nel registro intero, quindi ogni
//   posizione arriva in entrambi e la callee legge quello del suo tipo (anche
//   una funzione variadica dichiarata con argtypes, come con libffi).

#include "types.h"

namespace ctypes::frame {
namespace {

enum class Abi { None, AArch64, SysV, Win64 };

#if defined(CTYPES_DISABLE_DIRECT_CALLS)
inline constexpr Abi kAbi = Abi::None;
#elif defined(__aarch64__) || defined(_M_ARM64)
inline constexpr Abi kAbi = Abi::AArch64;
#elif (defined(__x86_64__) || defined(_M_X64)) && defined(_WIN32)
inline constexpr Abi kAbi = Abi::Win64;
#elif defined(__x86_64__)
inline constexpr Abi kAbi = Abi::SysV;
#else
inline constexpr Abi kAbi = Abi::None;
#endif
// Stack impacchettato per dimensione (Apple ARM64) invece di slot di 8 byte.
#if defined(__APPLE__) && (defined(__aarch64__) || defined(_M_ARM64))
inline constexpr bool kPackedStack = true;
#else
inline constexpr bool kPackedStack = false;
#endif

// Registri del frame: interi e floating point (banchi indipendenti) o
// posizioni (Win64, kFpRegisters = 0).
// Argomenti variadici (oltre gli argtypes) con il frame: solo con il prototipo
// variadico di x86-64, che li passa come una funzione variadica si aspetta.
// AArch64 no: Apple li vuole sullo stack, Windows i float nei registri interi.
inline constexpr bool kVariadicCalls = kAbi == Abi::SysV || kAbi == Abi::Win64;

inline constexpr size_t kGpRegisters = kAbi == Abi::SysV ? 6 : kAbi == Abi::Win64 ? 4 : 8;
inline constexpr size_t kFpRegisters = kAbi == Abi::Win64 ? 0 : 8;
inline constexpr size_t kMaxStackWords = 32;
inline constexpr size_t kStackBase = kGpRegisters + kFpRegisters;
inline constexpr size_t kWords = kStackBase + kMaxStackWords;

using Word = uint64_t;
using Invoker = void (*)(void* fn, const Word* words, void* ret);

template <typename T, size_t>
using Repeated = T;

// Banchi indipendenti (AArch64, SysV).
template <typename R, size_t... Gs, size_t... Fs, size_t... Ks>
inline R CallBanks(void* fn,
                   const Word* words,
                   std::index_sequence<Gs...>,
                   std::index_sequence<Fs...>,
                   std::index_sequence<Ks...>) {
  if constexpr (kAbi == Abi::SysV) {
    using Fn = R (*)(...);
    return reinterpret_cast<Fn>(fn)(words[Gs]..., std::bit_cast<double>(words[kGpRegisters + Fs])...,
                                    words[kStackBase + Ks]...);
  } else {
    using Fn = R (*)(Repeated<Word, Gs>..., Repeated<double, Fs>..., Repeated<Word, Ks>...);
    return reinterpret_cast<Fn>(fn)(words[Gs]..., std::bit_cast<double>(words[kGpRegisters + Fs])...,
                                    words[kStackBase + Ks]...);
  }
}

// Win64: le posizioni in registro come double (XMM e registro intero).
template <typename R, size_t... Ps, size_t... Ks>
inline R CallPositions(void* fn, const Word* words, std::index_sequence<Ps...>, std::index_sequence<Ks...>) {
  using Fn = R (*)(...);
  return reinterpret_cast<Fn>(fn)(std::bit_cast<double>(words[Ps])..., words[kStackBase + Ks]...);
}

template <typename R, size_t K>
void Invoke(void* fn, const Word* words, [[maybe_unused]] void* ret) {
  const auto call = [&] {
    if constexpr (kAbi == Abi::Win64) {
      return CallPositions<R>(fn, words, std::make_index_sequence<kGpRegisters>{}, std::make_index_sequence<K>{});
    } else {
      return CallBanks<R>(fn, words, std::make_index_sequence<kGpRegisters>{}, std::make_index_sequence<kFpRegisters>{},
                          std::make_index_sequence<K>{});
    }
  };
  if constexpr (std::is_void_v<R>) {
    call();
  } else {
    StoreReturnValue(ret, call());
  }
}

// Slot di stack passati: il numero richiesto arrotondato, così che le firme
// condividano poche istanze (gli slot in più sono ignorati dalla callee).
[[nodiscard]] constexpr size_t StackSlots(size_t stack_words) noexcept {
  return stack_words == 0 ? 0 : stack_words <= 4 ? 4 : stack_words <= 8 ? 8 : stack_words <= 16 ? 16 : kMaxStackWords;
}

template <typename R>
Invoker Select(size_t stack_words) {
  switch (StackSlots(stack_words)) {
    case 0:
      return &Invoke<R, 0>;
    case 4:
      return &Invoke<R, 4>;
    case 8:
      return &Invoke<R, 8>;
    case 16:
      return &Invoke<R, 16>;
    default:
      return &Invoke<R, kMaxStackWords>;
  }
}

// Il tipo C++ del valore restituito (gli interi stretti sono estesi dal
// compilatore, puntatori e stringhe sono parole intere).
[[nodiscard]] inline Invoker SelectReturn(CType result, size_t stack_words) {
  switch (result) {
    case CType::CTYPES_VOID:
      return Select<void>(stack_words);
    case CType::CTYPES_INT8:
      return Select<int8_t>(stack_words);
    case CType::CTYPES_UINT8:
      return Select<uint8_t>(stack_words);
    case CType::CTYPES_INT16:
      return Select<int16_t>(stack_words);
    case CType::CTYPES_UINT16:
      return Select<uint16_t>(stack_words);
    case CType::CTYPES_INT32:
      return Select<int32_t>(stack_words);
    case CType::CTYPES_UINT32:
      return Select<uint32_t>(stack_words);
    case CType::CTYPES_INT64:
    case CType::CTYPES_SSIZE_T:
      return Select<int64_t>(stack_words);
    case CType::CTYPES_UINT64:
    case CType::CTYPES_SIZE_T:
    case CType::CTYPES_POINTER:
    case CType::CTYPES_STRING:
    case CType::CTYPES_WSTRING:
      return Select<uint64_t>(stack_words);
    case CType::CTYPES_FLOAT:
      return Select<float>(stack_words);
    case CType::CTYPES_DOUBLE:
      return Select<double>(stack_words);
    case CType::CTYPES_CHAR:
      return Select<char>(stack_words);
    case CType::CTYPES_WCHAR:
      return Select<wchar_t>(stack_words);
    case CType::CTYPES_BOOL:
      return Select<bool>(stack_words);
    case CType::CTYPES_LONG:
      return Select<long>(stack_words);
    case CType::CTYPES_ULONG:
      return Select<unsigned long>(stack_words);
    default:
      return nullptr;
  }
}

[[nodiscard]] constexpr bool IsFloatingPoint(CType type) noexcept {
  return type == CType::CTYPES_FLOAT || type == CType::CTYPES_DOUBLE;
}

}  // namespace

// Piano di una firma: la posizione nel frame di ogni argomento e l'invoker per
// il tipo restituito e gli slot di stack.
//
// Ogni argomento è scritto come parola intera (8 byte) dal suo offset, in
// ordine di argomento. Con lo stack impacchettato la parola di un argomento
// stretto copre anche i byte degli argomenti successivi, che però sono scritti
// dopo; Prepare garantisce che anche l'ultima parola stia nel frame.
struct Plan {
  std::vector<uint16_t> offsets;  // offset in byte nel frame, per argomento
  Invoker invoker = nullptr;
  size_t stack_words = 0;  // parole di stack occupate dagli argomenti
  size_t stack_slots = 0;  // slot passati dall'invoker (StackSlots)

  // L'invoker legge tutti i registri e stack_slots slot: prima degli argomenti
  // (che sovrascrivono le loro posizioni) azzera i registri e gli slot aggiunti
  // dall'arrotondamento, così che nessuna parola letta sia indeterminata. Con
  // lo stack impacchettato azzera tutti gli slot: allineamenti e argomenti
  // stretti lasciano byte non scritti anche dentro le parole occupate.
  void Clear(Word* frame) const noexcept {
    std::fill_n(frame, kStackBase, Word{0});
    std::fill(frame + kStackBase + (kPackedStack ? 0 : stack_words), frame + kStackBase + stack_slots, Word{0});
  }

  // La posizione dell'argomento i in un frame.
  [[nodiscard]] uint8_t* At(Word* frame, size_t i) const noexcept {
    return reinterpret_cast<uint8_t*>(frame) + offsets[i];
  }

  // false se la firma non è coperta (aggregati, troppi argomenti sullo stack).
  bool Prepare(CType result, std::span<const CType> args) {
    offsets.clear();
    invoker = nullptr;
    stack_words = stack_slots = 0;
    if constexpr (kAbi == Abi::None || sizeof(void*) != sizeof(Word) || std::endian::native != std::endian::little) {
      return false;
    }
    constexpr size_t kStackBytes = kMaxStackWords * sizeof(Word);
    size_t gp = 0, fp = 0, stack = 0;  // stack: byte usati dagli argomenti
    // Posizione sullo stack: uno slot di 8 byte, o (Apple) la dimensione del
    // tipo al suo allineamento naturale; false se la sua parola uscirebbe dal frame.
    const auto on_stack = [&stack](CType type, size_t& offset) {
      size_t size = sizeof(Word);
      size_t alignment = sizeof(Word);
      if constexpr (kPackedStack) {
        size = CTypeSize(type);  // > 0 per ogni tipo ammesso (IsSimpleArgumentType)
        alignment = CTypeAlignment(type);
      }
      const size_t start = (stack + alignment - 1) / alignment * alignment;
      if (start + sizeof(Word) > kStackBytes) {
        return false;
      }
      offset = kStackBase * sizeof(Word) + start;
      stack = start + size;
      return true;
    };
    for (const CType type : args) {
      if (!IsSimpleArgumentType(type)) {
        return false;
      }
      const bool floating = IsFloatingPoint(type);
      size_t offset;
      if constexpr (kAbi == Abi::Win64) {
        if (gp < kGpRegisters) {
          offset = gp++ * sizeof(Word);
        } else if (!on_stack(type, offset)) {
          return false;
        }
      } else if (floating && fp < kFpRegisters) {
        offset = (kGpRegisters + fp++) * sizeof(Word);
      } else if (!floating && gp < kGpRegisters) {
        offset = gp++ * sizeof(Word);
      } else if (!on_stack(type, offset)) {
        return false;
      }
      offsets.push_back(static_cast<uint16_t>(offset));
    }
    stack_words = (stack + sizeof(Word) - 1) / sizeof(Word);
    invoker = SelectReturn(result, stack_words);
    stack_slots = StackSlots(stack_words);
    return invoker != nullptr;
  }
};

}  // namespace ctypes::frame
