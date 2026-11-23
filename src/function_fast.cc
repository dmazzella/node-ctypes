#include "addon.h"
#include "array.h"
#include "function_marshal.h"

#ifndef CTYPES_DISABLE_DIRECT_CALLS
#include "direct_call.h"
#endif

namespace ctypes {

namespace {

constexpr size_t kCoreDirectMaxArgs = 4;
#ifndef CTYPES_DISABLE_DIRECT_CALLS
static_assert(kCoreDirectMaxArgs == direct::kMaxDirectArgs);
#endif

}  // namespace

template <typename Args, bool HasErrcheck>
  requires(std::same_as<Args, Napi::CallbackInfo> || std::same_as<Args, FunctionArguments>)
CTYPES_ALWAYS_INLINE Napi::Value FFIFunction::InvokeCall(const Args& args, const Napi::Function* errcheck) {
  if (simple_call_ && args.Length() >= arg_types_.size()) [[likely]] {
    if (Napi::Value result; SimpleCall<Args, HasErrcheck>(args, result, errcheck)) [[likely]] {
      return result;
    }
  }
  return CallArguments(FunctionArguments{args}, errcheck);
}

// ============================================================================
// Ingressi Node-API veloci (FastCall, FastEntry, SimpleCall e specializzazioni)
// ============================================================================

// Ingresso veloce di fn.call per i casi semplici: lettura argomenti su stack
// e SimpleCall diretta. Il resto (più argomenti, errcheck, rientranza) passa
// a CallFromInfo, che rilegge gli argomenti. Fuori da
// node-addon-api, quindi le eccezioni C++ si convertono qui come in
// details::WrapCallback (NODE_ADDON_API_CPP_EXCEPTIONS_ALL).
template <size_t Capacity>
napi_value FFIFunction::FastCall(napi_env env, napi_callback_info info) {
  return GuardNapiCall(env, [&]() -> napi_value {
    // napi_get_cb_info scrive undefined in tutti gli slot oltre argc: la prima
    // lettura ne ha quanti gli argomenti dichiarati, oltre si rilegge tutto.
    std::array<napi_value, Capacity> argv;
    size_t argc = 0;
    void* data = nullptr;
    if (!napi_fast::GetArguments(env, info, argv, argc, data)) [[unlikely]] {
      return nullptr;
    }
    FFIFunction* self = static_cast<FFIFunction*>(data);
    if (self->simple_call_ && argc >= self->arg_types_.size() && self->errcheck_callback_.IsEmpty() &&
        argc <= kMaxSimpleArgs) [[likely]] {
      std::array<napi_value, kMaxSimpleArgs> all;
      napi_value* values = argv.data();
      if (argc > argv.size()) [[unlikely]] {
        if (!napi_fast::GetArguments(env, info, std::span(all).first(argc), argc, data)) [[unlikely]] {
          return nullptr;
        }
        values = all.data();
      }
      if (Napi::Value result; self->SimpleCall<RawArguments, false>(RawArguments{Napi::Env(env), values, argc}, result,
                                                                    nullptr)) [[likely]] {
        return result;
      }
    }
    return self->CallFromInfo(Napi::CallbackInfo(env, info));
  });
}

// Puntatore letto secondo il suggerimento della sua posizione (pointer_hints_):
// false se il valore è di un altro tipo. Fuori linea: il percorso delle viste
// per c_void_p, che non usa suggerimenti, resta compatto.
CTYPES_NOINLINE bool FFIFunction::HintedPointer(const Napi::Value& val, PointerHint hint, void*& ptr, bool& memory) {
  switch (hint) {
    case PointerHint::kView:
      ptr = napi_fast::TryViewData(val);
      memory = ptr != nullptr;
      return memory;
    case PointerHint::kBigInt:
      if (uint64_t bits; napi_fast::TryBigIntWord(val, bits)) {
        ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(bits));
        return true;
      }
      return false;
    case PointerHint::kNumber:
      if (double number; napi_fast::TryDouble(val, number)) {
        ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(IntegerBitsFromNumber(val, number)));
        return true;
      }
      return false;
    case PointerHint::kNullish: {
      const napi_valuetype kind = val.Type();
      ptr = nullptr;
      return kind == napi_null || kind == napi_undefined;
    }
    default:
      return false;
  }
}

template <size_t Capacity, int ShortArity, typename T>
napi_value FFIFunction::FastEntry(napi_env env, napi_callback_info info) {
  return GuardNapiCall(env, [&]() -> napi_value {
    std::array<napi_value, Capacity> argv;
    size_t argc = 0;
    void* data = nullptr;
    if (!napi_fast::GetArguments(env, info, argv, argc, data)) [[unlikely]] {
      return nullptr;
    }
    FFIFunction* self = static_cast<FFIFunction*>(data);
    if (!self->entry_defer_ && argc >= self->arg_types_.size() && self->errcheck_callback_.IsEmpty()) [[likely]] {
      if constexpr (ShortArity >= 0) {
        static_assert(std::is_arithmetic_v<T>);
        bool needs_js = false;
        if (argc == ShortArity && self->call_depth_ == 0) {
          const LibraryCallScope library_scope(self->library_, env);
          T arg = 0;
          bool ready = true;
          if constexpr (ShortArity == 1) {
            const Napi::Value val(env, argv[0]);
            if constexpr (std::same_as<T, bool>) {
              ready = napi_fast::TryBool(val, arg);
              if (!ready) {
                if (IsObjectLike(val)) {
                  needs_js = true;
                } else {
                  arg = val.ToBoolean().Value();
                  ready = true;
                }
              }
            } else {
              double number;
              ready = napi_fast::TryDouble(val, number);
              if constexpr (std::floating_point<T>) {
                if (ready) {
                  arg = static_cast<T>(number);
                } else if (IsObjectLike(val)) {
                  needs_js = true;
                } else {
                  try {
                    // Per i reali un BigInt va arrotondato, non troncato a 64 bit.
                    arg = static_cast<T>(DoubleArgSlow(val));
                  } catch (const Napi::Error& e) {
                    throw ArgumentErrorFor(env, 0, e);
                  }
                  ready = true;
                }
              } else if (ready) {
                try {
                  if constexpr (sizeof(T) == sizeof(uint64_t)) {
                    arg = static_cast<T>(Int64FromNumber(val, number));
                  } else if constexpr (std::is_unsigned_v<T>) {
                    arg = static_cast<T>(Uint32FromNumber(val, number));
                  } else {
                    arg = static_cast<T>(Int32FromNumber(val, number));
                  }
                } catch (const Napi::Error& e) {
                  throw ArgumentErrorFor(env, 0, e);
                }
              } else {
                const auto kind = val.Type();
                if (kind == napi_bigint) {
                  bool lossless;
                  arg = static_cast<T>(val.As<Napi::BigInt>().Uint64Value(&lossless));
                  ready = true;
                } else if (kind == napi_boolean) {
                  arg = static_cast<T>(val.As<Napi::Boolean>().Value());
                  ready = true;
                } else {
                  needs_js = kind == napi_object || kind == napi_function;
                }
              }
            }
          }
          if (ready) {
            const CountScope depth(&self->call_depth_);
            const CTypesAddon::ScopelessCallbacks callbacks(self->addon_);
            const auto saved = self->SwapInErrorState();
            T out;
            if constexpr (ShortArity == 0) {
              out = reinterpret_cast<T (*)()>(self->fn_ptr_)();
            } else {
              out = reinterpret_cast<T (*)(T)>(self->fn_ptr_)(arg);
            }
            self->CaptureErrorState(saved);
            if constexpr (std::same_as<T, bool>) {
              return Napi::Boolean::New(env, out);
            } else if constexpr (std::floating_point<T>) {
              return Napi::Number::New(env, static_cast<double>(out));
            } else if constexpr (sizeof(T) == sizeof(uint64_t)) {
              return Napi::BigInt::New(env, out);
            } else if constexpr (std::is_unsigned_v<T>) {
              return napi_fast::Uint32(env, out);
            } else {
              return napi_fast::Int32(env, out);
            }
          }
        }
        if (needs_js) {
          // Il getter JS può chiudere la libreria: chiamarlo fuori da library_scope.
          return self->CallEntryFallback(env, info);
        }
      }
      bool needs_js = argc > kMaxSimpleArgs;
      if (!needs_js) [[likely]] {
        std::array<napi_value, kMaxSimpleArgs> all;
        napi_value* values = argv.data();
        if (argc > argv.size()) [[unlikely]] {
          if (!napi_fast::GetArguments(env, info, std::span(all).first(argc), argc, data)) [[unlikely]] {
            return nullptr;
          }
          values = all.data();
        }
        if (Napi::Value result; self->SimpleCall<RawArguments, false, true>(RawArguments{Napi::Env(env), values, argc},
                                                                            result, nullptr, &needs_js)) [[likely]] {
          return result;
        }
      }
      // Nessun argomento da convertire in JS (chiamata rientrante) e nessun
      // oggetto tra gli argomenti non ancora esaminati: il percorso nativo
      // generale, come dal wrapper.
      if (!needs_js) {
        const Napi::CallbackInfo call(env, info);
        if (!HasObjectArgument(call)) {
          return self->CallFromInfo(call);
        }
      }
    }
    return self->CallEntryFallback(env, info);
  });
}

// Il wrapper JS con this e argomenti della chiamata.
napi_value FFIFunction::CallEntryFallback(napi_env env, napi_callback_info info) {
  const Napi::CallbackInfo call(env, info);
  // Gli argomenti sullo stack (fino a kMaxSimpleArgs), senza allocazioni.
  const size_t argc = call.Length();
  std::array<napi_value, kMaxSimpleArgs> inline_args;
  std::vector<napi_value> heap_args;
  napi_value* args = inline_args.data();
  if (argc > inline_args.size()) [[unlikely]] {
    heap_args.resize(argc);
    args = heap_args.data();
  }
  for (size_t i = 0; i < argc; i++) {
    args[i] = call[i];
  }
  Napi::Function fallback = entry_fallback_.Value();
  if (fallback.IsEmpty()) [[unlikely]] {
    throw Napi::Error::New(env, "function wrapper is no longer available");
  }
  return fallback.Call(call.This(), argc, args);
}

Napi::Value FFIFunction::MakeEntry(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!simple_call_ || info.Length() < 1 || !info[0].IsFunction()) {
    return env.Undefined();
  }
  const Napi::Function fallback = info[0].As<Napi::Function>();
  const std::string name = info.Length() > 1 && info[1].IsString() ? info[1].As<Napi::String>().Utf8Value() : name_;
  const size_t declared = arg_types_.size();
  napi_callback callback = declared <= 2               ? &FFIFunction::FastEntry<2>
                           : declared <= 4             ? &FFIFunction::FastEntry<4>
                           : declared <= kFastCallArgs ? &FFIFunction::FastEntry<kFastCallArgs>
                           : declared <= 16            ? &FFIFunction::FastEntry<16>
                                                       : &FFIFunction::FastEntry<kMaxSimpleArgs>;
  constexpr std::array mixed = {CType::CTYPES_INT8, CType::CTYPES_UINT8, CType::CTYPES_INT16, CType::CTYPES_UINT16};
  // Solo prototipi esatti T() e T(T), già ammessi dall'invoker per questa ABI.
  if (fixed_invoker_ && !scalar_as_buffer_ && (declared == 0 || (declared == 1 && arg_types_[0] == return_type_))) {
    const auto entry = [declared]<typename T>() { return declared == 0 ? &FastEntry<2, 0, T> : &FastEntry<2, 1, T>; };
    switch (return_type_) {
      case CType::CTYPES_BOOL:
        callback = entry.operator()<bool>();
        break;
      case CType::CTYPES_INT8:
        callback = entry.operator()<int8_t>();
        break;
      case CType::CTYPES_UINT8:
        callback = entry.operator()<uint8_t>();
        break;
      case CType::CTYPES_INT16:
        callback = entry.operator()<int16_t>();
        break;
      case CType::CTYPES_UINT16:
        callback = entry.operator()<uint16_t>();
        break;
      case CType::CTYPES_INT32:
        callback = entry.operator()<int32_t>();
        break;
      case CType::CTYPES_UINT32:
        callback = entry.operator()<uint32_t>();
        break;
      case CType::CTYPES_INT64:
        callback = entry.operator()<int64_t>();
        break;
      case CType::CTYPES_UINT64:
        callback = entry.operator()<uint64_t>();
        break;
      case CType::CTYPES_FLOAT:
        callback = entry.operator()<float>();
        break;
      case CType::CTYPES_DOUBLE:
        callback = entry.operator()<double>();
        break;
      default:
        break;
    }
  } else if (!scalar_as_buffer_ && declared == 1 && arg_types_[0] == CType::CTYPES_STRING && frame_plan_.invoker &&
             IsDirectScalarReturn(return_type_)) {
    callback = &FFIFunction::UnaryStringEntry;
  } else if (!scalar_as_buffer_ && fixed_invoker_ && declared >= 2 && declared <= kCoreDirectMaxArgs &&
             std::ranges::all_of(arg_types_, [](CType t) {
               return t == CType::CTYPES_INT32 || t == CType::CTYPES_DOUBLE || t == CType::CTYPES_FLOAT;
             })) {
    switch (return_type_) {
      case CType::CTYPES_VOID:
        callback = &FFIFunction::CoreDirectEntry<void>;
        break;
      case CType::CTYPES_INT32:
        callback = &FFIFunction::CoreDirectEntry<int32_t>;
        break;
      case CType::CTYPES_FLOAT:
        callback = &FFIFunction::CoreDirectEntry<float>;
        break;
      case CType::CTYPES_DOUBLE:
        callback = &FFIFunction::CoreDirectEntry<double>;
        break;
      default:
        break;
    }
  } else if (!scalar_as_buffer_ && frame_plan_.invoker && declared >= 2 && declared <= kMaxSimpleArgs &&
             IsDirectScalarReturn(return_type_) &&
             std::ranges::all_of(arg_types_, [](CType t) { return t == CType::CTYPES_INT32; })) {
    callback = declared <= 4               ? &FFIFunction::AllInt32Entry<4>
               : declared <= kFastCallArgs ? &FFIFunction::AllInt32Entry<kFastCallArgs>
               : declared <= 16            ? &FFIFunction::AllInt32Entry<16>
                                           : &FFIFunction::AllInt32Entry<kMaxSimpleArgs>;
  }
  if (!scalar_as_buffer_ && frame_plan_.invoker &&
      (return_type_ == CType::CTYPES_INT32 || return_type_ == CType::CTYPES_INT64) && declared >= 4 && declared <= 16 &&
      (declared % 4 == 0 || declared > 8)) {
    const auto groups = std::span(arg_types_);
    bool matches = true;
    for (size_t i = 0; i < declared && matches; i += 4) {
      const auto length = std::min(size_t{4}, declared - i);
      matches = std::ranges::equal(groups.subspan(i, length), std::span(mixed).first(length));
    }
    if (matches) {
      constexpr std::array<napi_callback, 4> entries = {&MixedEntry<4>, &MixedEntry<8>, &MixedEntry<12>,
                                                        &MixedEntry<16>};
      callback = declared % 4 == 0 ? entries[declared / 4 - 1] : &MixedEntry<0>;
    }
  }
  Napi::Function entry = napi_fast::NewFunction(env, name.c_str(), callback, this);
  // La funzione d'ingresso tiene vivi l'istanza nativa e il wrapper JS.
  entry.DefineProperty(Napi::PropertyDescriptor::Value("_ffiFunction", Value(), napi_default));
  entry.DefineProperty(Napi::PropertyDescriptor::Value("_fallback", fallback, napi_default));
  entry_fallback_ = Napi::Weak(fallback);
  return entry;
}

Napi::Value FFIFunction::SetEntryDefer(const Napi::CallbackInfo& info) {
  entry_defer_ = info.Length() > 0 && info[0].ToBoolean().Value();
  return info.Env().Undefined();
}

Napi::Value FFIFunction::CallFromInfo(const Napi::CallbackInfo& info) {
  if (errcheck_callback_.IsEmpty()) [[likely]] {
    return InvokeCall<Napi::CallbackInfo, false>(info, nullptr);
  }
  const Napi::Function errcheck = SnapshotErrcheck();
  return InvokeCall(info, errcheck.IsEmpty() ? nullptr : &errcheck);
}

Napi::Value FFIFunction::CallChecked(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "a result handler function is required");
  }
  const FunctionArguments args{info, 1};
  const Napi::Function errcheck = info[0].As<Napi::Function>();
  return InvokeCall(args, &errcheck);
}

Napi::Value FFIFunction::FastCheckedCall(const Napi::CallbackInfo& info) {
  return static_cast<FFIFunction*>(info.Data())->CallChecked(info);
}

Napi::Value FFIFunction::MakeCheckedCall(const Napi::CallbackInfo& info) {
  Napi::Function call = Napi::Function::New<&FFIFunction::FastCheckedCall>(info.Env(), "_callWithErrcheck", this);
  call.DefineProperty(Napi::PropertyDescriptor::Value("_ffiFunction", Value(), napi_default));
  return call;
}

// Shadows the prototype `call` (InstanceMethod) with an own-property function
// whose N-API data is `this`. InstanceMethod resolves the instance through
// napi_unwrap(info.This()), a full V8 property lookup that was ~1/3 of the
// cost of a simple call. The function keeps a strong reference to the wrapper
// object, so the native instance outlives any detached reference to `call`.
void FFIFunction::InstallFastCall(Napi::Env env) {
  Napi::Object self = Value();
  const size_t declared = arg_types_.size();
  napi_callback callback = declared <= 2               ? &FFIFunction::FastCall<2>
                           : declared <= 4             ? &FFIFunction::FastCall<4>
                           : declared <= kFastCallArgs ? &FFIFunction::FastCall<kFastCallArgs>
                           : declared <= 16            ? &FFIFunction::FastCall<16>
                                                       : &FFIFunction::FastCall<kMaxSimpleArgs>;
  if (declared == 1 && arg_types_[0] == CType::CTYPES_POINTER && frame_plan_.invoker && !scalar_as_buffer_ &&
      IsDirectScalarReturn(return_type_)) {
    callback = &FFIFunction::UnaryPointerCall;
  } else if (declared >= 2 && declared <= 4 && frame_plan_.invoker && !scalar_as_buffer_ &&
             IsDirectScalarReturn(return_type_) &&
             std::ranges::any_of(arg_types_, [](CType t) { return t == CType::CTYPES_POINTER; }) &&
             std::ranges::all_of(arg_types_, [](CType t) {
               return t == CType::CTYPES_POINTER || t == CType::CTYPES_INT32 || t == CType::CTYPES_UINT32 ||
                      t == CType::CTYPES_INT64 || t == CType::CTYPES_UINT64 || t == CType::CTYPES_SIZE_T ||
                      t == CType::CTYPES_SSIZE_T;
             })) {
    callback = &FFIFunction::DirectPointerCall;
  }
  Napi::Function fast_call = napi_fast::NewFunction(env, "call", callback, this);
  fast_call.DefineProperty(Napi::PropertyDescriptor::Value("_ffiFunction", self, napi_default));
  self.DefineProperty(Napi::PropertyDescriptor::Value(
    "call", fast_call, static_cast<napi_property_attributes>(napi_writable | napi_configurable)));
}

std::optional<size_t> FFIFunction::CopyStringToScratch(const Napi::Value& val, size_t heap_offset) {
  if (heap_offset == 0) {
    scratch_.Reset();
  }
  std::vector<char>& buffer = scratch_.strings;
  if (buffer.size() >= heap_offset + napi_fast::kMaxUtf8CharBytes + 2) {
    bool is_string = false;
    if (const auto copied = napi_fast::TryCopyUtf8IfString(val, std::span(buffer).subspan(heap_offset), is_string)) {
      return copied;
    }
    if (!is_string) {
      return std::nullopt;
    }
  }
  const std::optional<size_t> length = napi_fast::Utf8LengthIfString(val);
  if (!length) {
    return std::nullopt;
  }
  const size_t needed = heap_offset + *length + napi_fast::kMaxUtf8CharBytes + 2;
  if (buffer.size() < needed) {
    // resize da solo può arrotondare la capacità oltre il limite di Reset.
    buffer.reserve(needed);
    buffer.resize(needed);
  }
  return napi_fast::TryCopyUtf8Into(val.As<Napi::String>(), std::span(buffer).subspan(heap_offset));
}

// Firme semplici (simple_call_): slot e risultato sullo stack, senza
// CallContext o scratch. Le stringhe corte vanno nel buffer
// inline dell'istanza, come in Call(); una stringa che non ci sta e le chiamate
// rientranti passano a Call() prima di qualunque effetto.
template <ArgumentList Args, bool HasErrcheck, bool Entry>
bool FFIFunction::SimpleCall(const Args& info, Napi::Value& result, const Napi::Function* errcheck, bool* needs_js) {
  // Funzione d'ingresso: un argomento che solo il wrapper JS sa convertire.
  const auto defer = [needs_js] {
    if (needs_js != nullptr) {
      *needs_js = true;
    }
    return false;
  };
  // Chiamata rientrante: il buffer inline delle stringhe è della chiamata esterna.
  if (call_depth_ != 0) [[unlikely]] {
    return false;
  }
  const size_t argc = info.Length();
  const size_t expected_argc = arg_types_.size();
  if (argc > kMaxSimpleArgs) [[unlikely]] {
    return false;
  }
  Napi::Env env = info.Env();
  const LibraryCallScope library_scope(library_, env);
  alignas(16) std::array<uint64_t, kMaxSimpleArgs*(ARG_SLOT_SIZE / sizeof(uint64_t))> slots;
  std::array<void*, kMaxSimpleArgs> values;
  // Argomenti variadici (oltre argtypes): tipo dedotto dal valore, come Call().
  std::array<CType, kMaxSimpleArgs> extra_types;
  const size_t num_extra = argc - expected_argc;
  size_t string_offset = 0;
  // Stringhe che non stanno nel buffer inline: nello scratch riutilizzabile
  // delle chiamate (scratch_.strings, come CallArguments), libero perché
  // SimpleCall lavora solo fuori da una chiamata in corso e senza eseguire
  // JavaScript prima dell'invocazione. Lo scratch può spostarsi crescendo: lo
  // slot riceve intanto l'offset nello scratch (bit i di long_strings) e il
  // puntatore dopo il ciclo. Nessun array: il frame di SimpleCall resta piccolo.
  // Come in CallArguments, Reset applica il limite di ritenzione prima dell'uso
  // dello scratch e mai dopo la chiamata C: il risultato (per esempio di strchr)
  // può puntare dentro una stringa argomento, letta dalla conversione e
  // dall'errcheck. La memoria resta valida fino al prossimo uso dello scratch.
  uint32_t long_strings = 0;
  size_t heap_offset = 0;
  // Chiamata a registri: ogni argomento è convertito direttamente nella sua
  // parola del frame (registro o slot di stack), senza slot intermedi.
  const bool use_frame = fixed_invoker_ == nullptr && frame_plan_.invoker != nullptr && num_extra == 0;
  alignas(16) std::array<frame::Word, frame::kWords> frame_words;
  if (use_frame) {
    frame_plan_.Clear(frame_words.data());
  }
  // Argomenti che sono memoria JS (bit i): dopo un callback JS durante la
  // chiamata solo questi possono essere stati staccati.
  static_assert(kMaxSimpleArgs <= 32);
  uint32_t memory_args = 0;

  for (size_t i = 0; i < argc; i++) {
    uint8_t* slot =
      use_frame ? frame_plan_.At(frame_words.data(), i) : reinterpret_cast<uint8_t*>(slots.data()) + i * ARG_SLOT_SIZE;
    values[i] = slot;
    Napi::Value val = info[i];
    CType type;
    if (i < expected_argc) [[likely]] {
      type = arg_types_[i];
      // Funzione d'ingresso: solo i valori che il JavaScript passerebbe così
      // come sono; un oggetto o una funzione va al wrapper JS (false).
      if constexpr (Entry) {
        if (IsNumericCType(type)) {
          if (double number; napi_fast::TryDouble(val, number)) [[likely]] {
            try {
              MarshalNumber(val, number, type, slot);
            } catch (const Napi::Error& e) {
              throw ArgumentErrorFor(env, i, e);
            }
            continue;
          }
          const napi_valuetype kind = val.Type();
          if (kind == napi_object || kind == napi_function) {
            return defer();
          }
          // BigInt per un intero: i bit troncati al tipo, come MarshalPrimitive.
          if (kind == napi_bigint && type != CType::CTYPES_FLOAT && type != CType::CTYPES_DOUBLE) {
            bool lossless;
            MarshalIntegerBits(val.As<Napi::BigInt>().Uint64Value(&lossless), type, slot);
            continue;
          }
        } else if (type == CType::CTYPES_BOOL) {
          if (bool value; napi_fast::TryBool(val, value)) [[likely]] {
            StoreArgument(slot, static_cast<uint8_t>(value ? 1 : 0));
            continue;
          }
          if (IsObjectLike(val)) {
            return defer();
          }
        } else if (type != CType::CTYPES_STRING && IsObjectLike(val)) {
          return defer();
        }
      }
    } else {
      // Number variadico: tipo e valore da una sola lettura (il tipo dedotto
      // è esatto per il valore, quindi il cast non perde nulla).
      if (double number; napi_fast::TryDouble(val, number)) [[likely]] {
        type = VariadicNumberType(number);
        extra_types[i - expected_argc] = type;
        StoreVariadicNumber(number, type, slot);
        continue;
      }
      if constexpr (Entry) {
        if (IsObjectLike(val)) {
          return defer();
        }
      }
      const VariadicValue extra = InferVariadic(val);
      type = extra.type;
      val = extra.value;
      extra_types[i - expected_argc] = type;
      if (!IsSimpleArgumentType(type)) {
        return false;
      }
    }
    try {
      if (bool memory = false; MarshalPrimitive(val, type, slot, &memory)) [[likely]] {
        memory_args |= memory ? 1u << i : 0u;
        continue;
      }
      // Struct per valore: solo i byte di una vista di memoria (il Buffer
      // prodotto dal JS); il resto passa a Call(). Oltre uno slot libffi legge
      // i byte dalla vista e li copia prima della chiamata, su ogni ABI.
      if (type == CType::CTYPES_STRUCT) {
        const size_t struct_size = arg_struct_infos_[i]->GetSize();
        size_t length = 0;
        void* data = napi_fast::TryViewData(val, &length);
        if (data == nullptr || length < struct_size) {
          return false;
        }
        if (struct_size <= ARG_SLOT_SIZE) {
          memcpy(slot, data, struct_size);
        } else {
          values[i] = data;
        }
        memory_args |= 1u << i;
        continue;
      }
      // Puntatori e stringhe con il minimo di chiamate a V8 (napi_typeof è
      // una sequenza di test, e per gli oggetti tra i più lenti): per
      // c_char_p prima la copia della stringa, poi la memoria di una vista
      // (Buffer, TypedArray), poi il tipo.
      void* ptr = nullptr;
      char* dest = inline_strings_.data() + string_offset;
      const size_t capacity = kInlineStringBufferSize - string_offset;
      bool is_string = false;
      std::optional<size_t> copied;
      // Il tipo di valore visto l'ultima volta in questa posizione, letto per
      // primo (pointer_hints_). La funzione d'ingresso accetta per c_char_p
      // solo stringhe, null e undefined: lì vale solo il suggerimento null.
      PointerHint& hint = pointer_hints_[i];
      if (hint != PointerHint::kNone && (!Entry || hint == PointerHint::kNullish)) {
        if (bool memory = false; HintedPointer(val, hint, ptr, memory)) {
          memory_args |= memory ? 1u << i : 0u;
          memcpy(slot, &ptr, sizeof(ptr));
          continue;
        }
        hint = PointerHint::kNone;
      }
      if (type == CType::CTYPES_STRING) {
        if ((long_string_hints_ & (1u << i)) != 0) {
          if (const std::optional<size_t> heap = CopyStringToScratch(val, heap_offset)) {
            static_assert(sizeof(heap_offset) == sizeof(void*));
            memcpy(slot, &heap_offset, sizeof(heap_offset));
            long_strings |= 1u << i;
            heap_offset += *heap + 1;
            continue;
          }
          is_string = false;
        } else {
          copied = napi_fast::TryCopyUtf8IfString(val, std::span(dest, capacity), is_string);
        }
      }
      if constexpr (Entry) {
        // c_char_p: dal JavaScript passano solo stringhe, null e undefined.
        if (type == CType::CTYPES_STRING && !is_string) {
          const napi_valuetype kind = val.Type();
          if (kind != napi_null && kind != napi_undefined) {
            return defer();
          }
          hint = PointerHint::kNullish;
          memcpy(slot, &ptr, sizeof(ptr));
          continue;
        }
      }
      if (!is_string) {
        ptr = napi_fast::TryViewData(val);
        if (ptr != nullptr) {
          memory_args |= 1u << i;
          // c_void_p prova già per prima la vista: il suggerimento serve solo
          // a c_char_p, che prova prima la copia della stringa.
          hint = type == CType::CTYPES_STRING ? PointerHint::kView : PointerHint::kNone;
        } else {
          const napi_valuetype kind = val.Type();
          if (kind == napi_string) {
            // Python: c_void_p accetta anche bytes/str.
            is_string = true;
            copied = napi_fast::TryCopyUtf8Into(val.As<Napi::String>(), std::span(dest, capacity));
          } else {
            ptr = PointerArg(val, kind, type);
            memory_args |= kind == napi_object ? 1u << i : 0u;
            hint = kind == napi_bigint                           ? PointerHint::kBigInt
                   : kind == napi_number                         ? PointerHint::kNumber
                   : kind == napi_null || kind == napi_undefined ? PointerHint::kNullish
                                                                 : PointerHint::kNone;
          }
        }
      }
      if (is_string) {
        if (!copied) {
          const std::optional<size_t> heap = CopyStringToScratch(val, heap_offset);
          if (!heap) {
            // Con il buffer inline pieno il tipo non era ancora verificato: per
            // la funzione d'ingresso valgono le stesse regole di c_char_p sopra
            // (un numero non è un indirizzo per il wrapper JS).
            if constexpr (Entry) {
              if (type == CType::CTYPES_STRING) {
                const napi_valuetype kind = val.Type();
                if (kind != napi_null && kind != napi_undefined) {
                  return defer();
                }
                memcpy(slot, &ptr, sizeof(ptr));
                continue;
              }
            }
            return false;
          }
          static_assert(sizeof(heap_offset) == sizeof(void*));
          long_string_hints_ |= 1u << i;
          memcpy(slot, &heap_offset, sizeof(heap_offset));
          long_strings |= 1u << i;
          heap_offset += *heap + 1;
          continue;
        }
        string_offset += *copied + 1;
        ptr = dest;
      }
      memcpy(slot, &ptr, sizeof(ptr));
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }
  }
  for (uint32_t pending = long_strings; pending != 0; pending &= pending - 1) {
    void* const slot = values[std::countr_zero(pending)];
    size_t offset;
    memcpy(&offset, slot, sizeof(offset));
    const char* str = scratch_.strings.data() + offset;
    memcpy(slot, &str, sizeof(str));
  }

  // Firma concreta dalla cache, con lo slot segnato in uso così
  // che una chiamata rientrante (da un callback) non lo ricostruisca.
  ExtraCallCache* cache_entry = nullptr;
  std::optional<ExtraCallCache> fallback_entry;
  if (num_extra != 0) {
    cache_entry = AcquireExtraCall(argc, {extra_types.data(), num_extra}, fallback_entry);
    if (!cache_entry->cif_prepared && !PrepareExtraFFI(env, *cache_entry)) {
      result = env.Undefined();
      return true;
    }
  }
  const CountScope cache_scope(cache_entry != nullptr ? &cache_entry->in_use : nullptr);

  const CountScope depth_scope(&call_depth_);
  // Valore restituito: primitivo, o i byte di una struct fino a kMaxSimpleStructReturn.
  alignas(16) std::array<std::byte, kMaxSimpleStructReturn> return_storage{};
  void* const return_value = return_storage.data();
  const uint64_t epoch = CallbackEpoch();
  const CTypesAddon::ScopelessCallbacks scopeless(addon_);
  const SavedErrorState saved_errors = SwapInErrorState();
  if (cache_entry == nullptr && fixed_invoker_) [[likely]] {
    fixed_invoker_(fn_ptr_, values.data(), return_value);
  } else if (use_frame) {
    frame_plan_.invoker(fn_ptr_, frame_words.data(), return_value);
  } else if (cache_entry != nullptr && cache_entry->frame.invoker != nullptr) {
    // Firma con argomenti dedotti: gli slot (parole intere, vedi
    // StoreArgument) al loro posto nel frame.
    cache_entry->frame.Clear(frame_words.data());
    for (size_t i = 0; i < argc; i++) {
      memcpy(cache_entry->frame.At(frame_words.data(), i), values[i], sizeof(frame::Word));
    }
    cache_entry->frame.invoker(fn_ptr_, frame_words.data(), return_value);
  } else if (cache_entry != nullptr) {
    InvokeLibffi(*cache_entry, fn_ptr_, return_value, values.data());
  } else {
    InvokeLibffi(*this, fn_ptr_, return_value, values.data());
  }
  CaptureErrorState(saved_errors);
  if (CallbackEpoch() != epoch && memory_args != 0) [[unlikely]] {
    ThrowIfArgumentDetached(info, memory_args);
  }

  if (scalar_as_buffer_) {
    result = ConvertReturn(env, return_value, return_type_, return_struct_info_, return_array_info_, false, true);
  } else {
    switch (return_type_) {
      case CType::CTYPES_VOID:
        result = env.Undefined();
        break;
      case CType::CTYPES_INT32:
        result = napi_fast::Int32(env, LoadAs<int32_t>(return_value));
        break;
      case CType::CTYPES_UINT32:
        result = napi_fast::Uint32(env, LoadAs<uint32_t>(return_value));
        break;
      case CType::CTYPES_DOUBLE:
        result = Napi::Number::New(env, LoadAs<double>(return_value));
        break;
      case CType::CTYPES_STRUCT:
        result = StructResult(return_value);
        break;
      default:
        result =
          ConvertReturn(env, return_value, return_type_, return_struct_info_, return_array_info_, struct_as_buffer_);
        break;
    }
  }
  if constexpr (HasErrcheck) {
    if (errcheck != nullptr) [[unlikely]] {
      result = ApplyErrcheck(env, result, FunctionArguments{info}, *errcheck);
    }
  }
  return true;
}

template <size_t Count>
napi_value FFIFunction::MixedEntry(napi_env env, napi_callback_info info) {
  return GuardNapiCall(env, [&]() -> napi_value {
    // Count == 0: ingresso condiviso per le firme con un ultimo gruppo parziale.
    constexpr size_t capacity = Count == 0 ? 16 : Count;
    std::array<napi_value, capacity> args;
    size_t argc = 0;
    void* data = nullptr;
    napi_value receiver;
    if (!napi_fast::GetArguments(env, info, args, argc, data, &receiver)) {
      return nullptr;
    }
    auto* self = static_cast<FFIFunction*>(data);
    const size_t expected = Count == 0 ? self->arg_types_.size() : Count;
    bool needs_js = false;
    if (argc == expected && !self->entry_defer_ && self->call_depth_ == 0 && self->errcheck_callback_.IsEmpty()) {
      const LibraryCallScope scope(self->library_, env);
      alignas(16) std::array<frame::Word, frame::kWords> words;
      self->frame_plan_.Clear(words.data());
      const auto convert = [&]<CType T>(size_t i) {
        Napi::Value val(env, args[i]);
        double number;
        if (!napi_fast::TryDouble(val, number)) {
          const auto kind = val.Type();
          if (kind == napi_bigint) {
            bool lossless;
            MarshalIntegerBits(val.As<Napi::BigInt>().Uint64Value(&lossless), T, self->frame_plan_.At(words.data(), i));
            return true;
          }
          needs_js = kind == napi_object || kind == napi_function;
          return false;
        }
        try {
          MarshalNumber(val, number, T, self->frame_plan_.At(words.data(), i));
        } catch (const Napi::Error& e) {
          throw ArgumentErrorFor(env, i, e);
        }
        return true;
      };
      size_t i = 0;
      const size_t full = expected - expected % 4;
      while (i < full && convert.template operator()<CType::CTYPES_INT8>(i) &&
             convert.template operator()<CType::CTYPES_UINT8>(i + 1) &&
             convert.template operator()<CType::CTYPES_INT16>(i + 2) &&
             convert.template operator()<CType::CTYPES_UINT16>(i + 3)) {
        i += 4;
      }
      bool complete = i == full;
      if constexpr (Count == 0) {
        complete = complete && convert.template operator()<CType::CTYPES_INT8>(i) &&
                   (expected - i < 2 || convert.template operator()<CType::CTYPES_UINT8>(i + 1)) &&
                   (expected - i < 3 || convert.template operator()<CType::CTYPES_INT16>(i + 2));
      }
      if (complete) {
        const CountScope depth(&self->call_depth_);
        const CTypesAddon::ScopelessCallbacks callbacks(self->addon_);
        alignas(16) std::array<std::byte, kMaxSimpleStructReturn> out{};
        const auto saved = self->SwapInErrorState();
        self->frame_plan_.invoker(self->fn_ptr_, words.data(), out.data());
        self->CaptureErrorState(saved);
        if (self->return_type_ == CType::CTYPES_INT64) {
          return Napi::BigInt::New(env, LoadAs<int64_t>(out.data()));
        }
        return napi_fast::Int32(env, LoadAs<int32_t>(out.data()));
      }
    }
    if (argc == expected && (needs_js || self->entry_defer_ || !self->errcheck_callback_.IsEmpty())) {
      Napi::Function fallback = self->entry_fallback_.Value();
      if (fallback.IsEmpty()) {
        throw Napi::Error::New(env, "function wrapper is no longer available");
      }
      return fallback.Call(receiver, argc, args.data());
    }
    return FastEntry<(capacity > 8 ? 16 : capacity)>(env, info);
  });
}

template <typename R>
napi_value FFIFunction::CoreDirectEntry(napi_env env, napi_callback_info info) {
  return GuardNapiCall(env, [&]() -> napi_value {
    std::array<napi_value, kCoreDirectMaxArgs> args;
    size_t argc = 0;
    void* data = nullptr;
    if (!napi_fast::GetArguments(env, info, args, argc, data)) [[unlikely]] {
      return nullptr;
    }
    auto* self = static_cast<FFIFunction*>(data);
    const size_t expected = self->arg_types_.size();
    bool needs_js = false;
    if (argc == expected && !self->entry_defer_ && self->call_depth_ == 0 && self->errcheck_callback_.IsEmpty())
      [[likely]] {
      const LibraryCallScope scope(self->library_, env);
      alignas(16) std::array<uint64_t, kCoreDirectMaxArgs> slots;
      std::array<void*, kCoreDirectMaxArgs> ptrs;
      bool complete = true;
      for (size_t i = 0; i < expected; i++) {
        uint8_t* slot = reinterpret_cast<uint8_t*>(&slots[i]);
        ptrs[i] = slot;
        const Napi::Value val(env, args[i]);
        const CType type = self->arg_types_[i];
        double number;
        if (napi_fast::TryDouble(val, number)) [[likely]] {
          if (type == CType::CTYPES_DOUBLE) {
            StoreArgument(slot, number);
          } else if (type == CType::CTYPES_FLOAT) {
            StoreArgument(slot, static_cast<float>(number));
          } else {
            try {
              StoreArgument(slot, Int32FromNumber(val, number));
            } catch (const Napi::Error& e) {
              throw ArgumentErrorFor(env, i, e);
            }
          }
        } else {
          const auto kind = val.Type();
          if (kind == napi_object || kind == napi_function) {
            needs_js = true;
            complete = false;
            break;
          }
          if (type == CType::CTYPES_DOUBLE || type == CType::CTYPES_FLOAT) {
            try {
              const double d = DoubleArgSlow(val);
              if (type == CType::CTYPES_FLOAT) {
                StoreArgument(slot, static_cast<float>(d));
              } else {
                StoreArgument(slot, d);
              }
            } catch (const Napi::Error& e) {
              throw ArgumentErrorFor(env, i, e);
            }
          } else if (kind == napi_bigint) {
            bool lossless;
            StoreArgument(slot, static_cast<int32_t>(val.As<Napi::BigInt>().Uint64Value(&lossless)));
          } else if (kind == napi_boolean) {
            StoreArgument(slot, static_cast<int32_t>(val.As<Napi::Boolean>().Value() ? 1 : 0));
          } else {
            complete = false;
            break;
          }
        }
      }
      if (complete) [[likely]] {
        const CountScope depth(&self->call_depth_);
        const CTypesAddon::ScopelessCallbacks callbacks(self->addon_);
        alignas(8) std::array<std::byte, 8> out{};
        const auto saved = self->SwapInErrorState();
        self->fixed_invoker_(self->fn_ptr_, ptrs.data(), out.data());
        self->CaptureErrorState(saved);
        if constexpr (std::is_void_v<R>) {
          return Napi::Env(env).Undefined();
        } else if constexpr (std::floating_point<R>) {
          return Napi::Number::New(env, static_cast<double>(LoadAs<R>(out.data())));
        } else {
          return napi_fast::Int32(env, LoadAs<int32_t>(out.data()));
        }
      }
    }
    if (needs_js) {
      return self->CallEntryFallback(env, info);
    }
    return FastEntry<kCoreDirectMaxArgs>(env, info);
  });
}

template <size_t Capacity>
napi_value FFIFunction::AllInt32Entry(napi_env env, napi_callback_info info) {
  return GuardNapiCall(env, [&]() -> napi_value {
    std::array<napi_value, Capacity> args;
    size_t argc = 0;
    void* data = nullptr;
    if (!napi_fast::GetArguments(env, info, args, argc, data)) [[unlikely]] {
      return nullptr;
    }
    auto* self = static_cast<FFIFunction*>(data);
    const size_t expected = self->arg_types_.size();
    bool needs_js = false;
    if (argc == expected && !self->entry_defer_ && self->call_depth_ == 0 && self->errcheck_callback_.IsEmpty())
      [[likely]] {
      const LibraryCallScope scope(self->library_, env);
      alignas(16) std::array<frame::Word, frame::kWords> words;
      self->frame_plan_.Clear(words.data());
      bool complete = true;
      for (size_t i = 0; i < expected; i++) {
        const Napi::Value val(env, args[i]);
        double number;
        if (napi_fast::TryDouble(val, number)) [[likely]] {
          if (int32_t v; TryExactInt(number, v)) [[likely]] {
            StoreArgument(self->frame_plan_.At(words.data(), i), v);
            continue;
          }
          try {
            StoreArgument(self->frame_plan_.At(words.data(), i), Int32FromNumber(val, number));
          } catch (const Napi::Error& e) {
            throw ArgumentErrorFor(env, i, e);
          }
        } else {
          const auto kind = val.Type();
          if (kind == napi_bigint) {
            bool lossless;
            StoreArgument(self->frame_plan_.At(words.data(), i),
                          static_cast<int32_t>(val.As<Napi::BigInt>().Uint64Value(&lossless)));
          } else if (kind == napi_boolean) {
            StoreArgument(self->frame_plan_.At(words.data(), i),
                          static_cast<int32_t>(val.As<Napi::Boolean>().Value() ? 1 : 0));
          } else {
            needs_js = kind == napi_object || kind == napi_function;
            complete = false;
            break;
          }
        }
      }
      if (complete) [[likely]] {
        const CountScope depth(&self->call_depth_);
        const CTypesAddon::ScopelessCallbacks callbacks(self->addon_);
        alignas(8) std::array<std::byte, 8> out{};
        const auto saved = self->SwapInErrorState();
        self->frame_plan_.invoker(self->fn_ptr_, words.data(), out.data());
        self->CaptureErrorState(saved);
        return ReturnScalar(env, self->return_type_, out.data());
      }
    }
    if (needs_js) {
      return self->CallEntryFallback(env, info);
    }
    return FastEntry<Capacity>(env, info);
  });
}

napi_value FFIFunction::UnaryStringEntry(napi_env env, napi_callback_info info) {
  return GuardNapiCall(env, [&]() -> napi_value {
    std::array<napi_value, 2> args;
    size_t argc = 0;
    void* data = nullptr;
    if (!napi_fast::GetArguments(env, info, args, argc, data)) [[unlikely]] {
      return nullptr;
    }
    auto* self = static_cast<FFIFunction*>(data);
    if (argc == 1 && !self->entry_defer_ && self->call_depth_ == 0 && self->errcheck_callback_.IsEmpty()) [[likely]] {
      const LibraryCallScope scope(self->library_, env);
      const Napi::Value val(env, args[0]);
      const char* str = nullptr;
      bool is_string = false;
      if ((self->long_string_hints_ & 1u) == 0) {
        if (napi_fast::TryCopyUtf8IfString(val, std::span(self->inline_strings_), is_string)) [[likely]] {
          str = self->inline_strings_.data();
        }
      }
      if (str == nullptr && ((self->long_string_hints_ & 1u) != 0 || is_string)) {
        if (self->CopyStringToScratch(val, 0)) {
          self->long_string_hints_ |= 1u;
          str = self->scratch_.strings.data();
        }
      }
      if (str != nullptr) [[likely]] {
        const CountScope depth(&self->call_depth_);
        const CTypesAddon::ScopelessCallbacks callbacks(self->addon_);
        alignas(8) std::array<std::byte, 8> out{};
        const auto saved = self->SwapInErrorState();
        InvokeUnaryPointer(self->fn_ptr_, self->return_type_, str, out.data());
        self->CaptureErrorState(saved);
        return ReturnScalar(env, self->return_type_, out.data());
      }
    }
    return FastEntry<2>(env, info);
  });
}

napi_value FFIFunction::UnaryPointerCall(napi_env env, napi_callback_info info) {
  return GuardNapiCall(env, [&]() -> napi_value {
    std::array<napi_value, 2> args;
    size_t argc = 0;
    void* data = nullptr;
    if (!napi_fast::GetArguments(env, info, args, argc, data)) [[unlikely]] {
      return nullptr;
    }
    auto* self = static_cast<FFIFunction*>(data);
    if (argc == 1 && self->simple_call_ && self->call_depth_ == 0 && self->errcheck_callback_.IsEmpty()) [[likely]] {
      const Napi::Value val(env, args[0]);
      if (void* ptr = napi_fast::TryViewData(val); ptr != nullptr) [[likely]] {
        const LibraryCallScope scope(self->library_, env);
        const CountScope depth(&self->call_depth_);
        const uint64_t epoch = self->CallbackEpoch();
        const CTypesAddon::ScopelessCallbacks callbacks(self->addon_);
        alignas(8) std::array<std::byte, 8> out{};
        const auto saved = self->SwapInErrorState();
        InvokeUnaryPointer(self->fn_ptr_, self->return_type_, ptr, out.data());
        self->CaptureErrorState(saved);
        if (self->CallbackEpoch() != epoch && IsDetachedView(val)) [[unlikely]] {
          throw Napi::Error::New(env, std::format("argument 1: {}", kDetachedArgumentMessage));
        }
        return ReturnScalar(env, self->return_type_, out.data());
      }
    }
    return FastCall<2>(env, info);
  });
}

// Percorso diretto per firme da 2-4 argomenti con puntatori e interi (es. memset,
// memcpy, memcmp, qsort): scrive direttamente nel frame evitando lo stack di SimpleCall.
napi_value FFIFunction::DirectPointerCall(napi_env env, napi_callback_info info) {
  return GuardNapiCall(env, [&]() -> napi_value {
    std::array<napi_value, 4> args;
    size_t argc = 0;
    void* data = nullptr;
    if (!napi_fast::GetArguments(env, info, args, argc, data)) [[unlikely]] {
      return nullptr;
    }
    auto* self = static_cast<FFIFunction*>(data);
    const size_t expected = self->arg_types_.size();
    if (argc == expected && self->simple_call_ && self->call_depth_ == 0 && self->errcheck_callback_.IsEmpty())
      [[likely]] {
      const LibraryCallScope scope(self->library_, env);
      alignas(16) std::array<frame::Word, frame::kWords> words;
      self->frame_plan_.Clear(words.data());
      uint32_t memory_args = 0;
      bool complete = true;
      for (size_t i = 0; i < expected; i++) {
        uint8_t* slot = self->frame_plan_.At(words.data(), i);
        const Napi::Value val(env, args[i]);
        switch (self->arg_types_[i]) {
          case CType::CTYPES_POINTER:
            if (void* ptr = napi_fast::TryViewData(val); ptr != nullptr) [[likely]] {
              StoreArgument(slot, ptr);
              memory_args |= 1u << i;
            } else if (uint64_t addr; napi_fast::TryBigIntWord(val, addr)) {
              StoreArgument(slot, reinterpret_cast<void*>(static_cast<uintptr_t>(addr)));
            } else {
              const auto kind = val.Type();
              if (kind == napi_null || kind == napi_undefined) {
                StoreArgument(slot, static_cast<void*>(nullptr));
              } else {
                complete = false;
              }
            }
            break;
          case CType::CTYPES_INT32:
            if (double d; napi_fast::TryDouble(val, d)) [[likely]] {
              if (int32_t v; TryExactInt(d, v)) [[likely]] {
                StoreArgument(slot, v);
                break;
              }
            }
            complete = false;
            break;
          case CType::CTYPES_UINT32:
            if (double d; napi_fast::TryDouble(val, d)) [[likely]] {
              if (uint32_t v; TryExactInt(d, v)) [[likely]] {
                StoreArgument(slot, v);
                break;
              }
            }
            complete = false;
            break;
          case CType::CTYPES_INT64:
          case CType::CTYPES_SSIZE_T:
            if (double d; napi_fast::TryDouble(val, d)) [[likely]] {
              if (int64_t v; TryExactInt(d, v)) [[likely]] {
                StoreArgument(slot, v);
                break;
              }
            } else if (uint64_t bits; napi_fast::TryBigIntWord(val, bits)) {
              StoreArgument(slot, static_cast<int64_t>(bits));
              break;
            }
            complete = false;
            break;
          case CType::CTYPES_UINT64:
          case CType::CTYPES_SIZE_T:
            if (double d; napi_fast::TryDouble(val, d)) [[likely]] {
              if (uint64_t v; TryExactInt(d, v)) [[likely]] {
                StoreArgument(slot, v);
                break;
              }
            } else if (uint64_t bits; napi_fast::TryBigIntWord(val, bits)) {
              StoreArgument(slot, bits);
              break;
            }
            complete = false;
            break;
          default:
            complete = false;
            break;
        }
        if (!complete) [[unlikely]] {
          break;
        }
      }
      if (complete) [[likely]] {
        const CountScope depth(&self->call_depth_);
        const uint64_t epoch = self->CallbackEpoch();
        const CTypesAddon::ScopelessCallbacks callbacks(self->addon_);
        alignas(8) std::array<std::byte, 8> out{};
        const auto saved = self->SwapInErrorState();
        self->frame_plan_.invoker(self->fn_ptr_, words.data(), out.data());
        self->CaptureErrorState(saved);
        if (self->CallbackEpoch() != epoch && memory_args != 0) [[unlikely]] {
          ThrowIfArgumentDetached(RawArguments{Napi::Env(env), args.data(), argc}, memory_args);
        }
        return ReturnScalar(env, self->return_type_, out.data());
      }
    }
    if (self->simple_call_ && argc >= expected && argc <= kMaxSimpleArgs && self->errcheck_callback_.IsEmpty())
      [[likely]] {
      std::array<napi_value, kMaxSimpleArgs> all;
      napi_value* values = args.data();
      if (argc > args.size()) [[unlikely]] {
        if (!napi_fast::GetArguments(env, info, std::span(all).first(argc), argc, data)) [[unlikely]] {
          return nullptr;
        }
        values = all.data();
      }
      if (Napi::Value result; self->SimpleCall<RawArguments, false>(RawArguments{Napi::Env(env), values, argc}, result,
                                                                    nullptr)) [[likely]] {
        return result;
      }
    }
    return self->CallFromInfo(Napi::CallbackInfo(env, info));
  });
}

}  // namespace ctypes
