#include "addon.h"
#include "array.h"
#include "function_marshal.h"

#ifndef CTYPES_DISABLE_DIRECT_CALLS
#include "direct_call.h"
#endif

namespace ctypes {

CallConv StringToCallConv(std::string_view name) {
  if (name == "cdecl" || name == "default") {
    return CallConv::CTYPES_CDECL;
  }
  if (name == "stdcall") {
    return CallConv::CTYPES_STDCALL;
  }
  if (name == "fastcall") {
    return CallConv::CTYPES_FASTCALL;
  }
  if (name == "thiscall") {
    return CallConv::CTYPES_THISCALL;
  }
  return CallConv::CTYPES_DEFAULT;
}

Napi::Function FFIFunction::GetClass(Napi::Env env) {
  return DefineClass(env, "FFIFunction",
                     {
                       InstanceMethod("call", &FFIFunction::Call),
                       InstanceMethod("callAsync", &FFIFunction::CallAsync),
                       InstanceMethod("_callWithErrcheck", &FFIFunction::CallChecked),
                       InstanceMethod("_callAsyncWithErrcheck", &FFIFunction::CallAsyncChecked),
                       InstanceMethod("callOn", &FFIFunction::CallOn),
                       InstanceMethod("_callOnWithErrcheck", &FFIFunction::CallOnChecked),
                       InstanceMethod("_makeCheckedCall", &FFIFunction::MakeCheckedCall),
                       InstanceMethod("_makeEntry", &FFIFunction::MakeEntry),
                       InstanceMethod("_setEntryDefer", &FFIFunction::SetEntryDefer),
                       InstanceMethod("setErrcheck", &FFIFunction::SetErrcheck),
                       InstanceMethod("getCapturedLastError", &FFIFunction::GetLastErrorCaptured),
                       InstanceMethod("getCapturedErrno", &FFIFunction::GetErrnoCaptured),
                       InstanceAccessor("name", &FFIFunction::GetName, nullptr),
                       InstanceAccessor("address", &FFIFunction::GetAddress, nullptr),
                     });
}

Napi::Value FFIFunction::GetLastErrorCaptured(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(last_error_));
}

Napi::Value FFIFunction::GetErrnoCaptured(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), last_errno_);
}

FFIFunction::FFIFunction(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<FFIFunction>(info),
    fn_ptr_(nullptr),
    return_type_(CType::CTYPES_VOID),
    next_cache_slot_(0),
    capture_last_error_(false),
    capture_errno_(false),
    last_error_(0),
    last_errno_(0),
    addon_(nullptr) {
  Napi::Env env = info.Env();
  addon_ = env.GetInstanceData<CTypesAddon>();

  if (info.Length() < 3) {
    Napi::TypeError::New(env, "FFIFunction requires fnPtr, name, returnType, argTypes").ThrowAsJavaScriptException();
    return;
  }

  // 1. Function pointer (External from Library::GetFunction, or BigInt raw address)
  if (info[0].IsExternal()) {
    fn_ptr_ = info[0].As<Napi::External<void>>().Data();
  } else if (info[0].IsBigInt()) {
    bool lossless;
    uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    fn_ptr_ = reinterpret_cast<void*>(addr);
  } else {
    Napi::TypeError::New(env, "First argument must be a function pointer (External or BigInt address)")
      .ThrowAsJavaScriptException();
    return;
  }

  // CRITICAL: Valida che il puntatore non sia NULL
  if (fn_ptr_ == nullptr) {
    Napi::Error::New(env, "Function pointer is NULL - cannot call invalid function").ThrowAsJavaScriptException();
    return;
  }

  // 2. Name (string or null for raw function pointers)
  if (info[1].IsString()) {
    name_ = info[1].As<Napi::String>().Utf8Value();
  } else if (info[1].IsNull() || info[1].IsUndefined()) {
    // Raw function pointer — use hex address as name for error messages
    name_ = std::format("{}", fn_ptr_);
  } else {
    Napi::TypeError::New(env, "Second argument must be function name (string) or null").ThrowAsJavaScriptException();
    return;
  }

  // 3. Return type
  try {
    const TypeSpec spec = TypeSpecFromJS(info[2]);
    return_type_ = spec.type;
    return_struct_info_ = spec.struct_info;
    return_array_info_ = spec.array_info;
  } catch (const Napi::Error& e) {
    throw Napi::TypeError::New(env, std::format("Invalid return type: {}", e.Message()));
  }

  // 4. Argument types
  if (info.Length() > 3 && info[3].IsArray()) {
    const Napi::Array arr = info[3].As<Napi::Array>();
    const uint32_t count = arr.Length();
    arg_types_.reserve(count);
    arg_struct_infos_.reserve(count);
    arg_array_infos_.reserve(count);
    for (uint32_t i = 0; i < count; i++) {
      try {
        TypeSpec spec = TypeSpecFromJS(arr.Get(i));
        arg_types_.push_back(spec.type);
        arg_struct_infos_.push_back(std::move(spec.struct_info));
        arg_array_infos_.push_back(std::move(spec.array_info));
      } catch (const Napi::Error& e) {
        throw Napi::TypeError::New(env, std::format("Invalid argument type at index {}: {}", i, e.Message()));
      }
    }
  }

  // 5. Options
  if (info.Length() > 4 && info[4].IsObject()) {
    Napi::Object opts = info[4].As<Napi::Object>();
    if (opts.Has("abi")) {
      SetCallConv(StringToCallConv(opts.Get("abi").As<Napi::String>().Utf8Value()));
    }
    if (opts.Has("use_last_error")) {
      capture_last_error_ = opts.Get("use_last_error").ToBoolean().Value();
    }
    if (opts.Has("use_errno")) {
      capture_errno_ = opts.Get("use_errno").ToBoolean().Value();
    }
    struct_as_buffer_ = opts.Get("struct_buffer").ToBoolean().Value();
    scalar_as_buffer_ = opts.Get("scalar_buffer").ToBoolean().Value();
    if (scalar_as_buffer_ && CTypeSize(return_type_) == 0) {
      throw Napi::TypeError::New(env, "scalar_buffer requires a non-void primitive return type");
    }
    // CFUNCTYPE((name, dll)): la libreria del simbolo, come Library::GetFunction.
    Napi::Value library = opts.Get("library");
    if (!library.IsUndefined() && !library.IsNull()) {
      if (UnwrapTagged<Library>(library) == nullptr) {
        throw Napi::TypeError::New(env, "library option must be a Library");
      }
      AttachLibrary(library.As<Napi::Object>());
    }
  }

  // Pre-alloca lo scratch dell'istanza (come CPython - pool struct argument)
  if (arg_types_.size() > MAX_INLINE_ARGS) {
    scratch_.arg_storage.resize(arg_types_.size() * ARG_SLOT_SIZE);
    scratch_.arg_values.resize(arg_types_.size());
  }

  if (!PrepareCall(env)) {
    return;
  }

  InstallFastCall(env);
}

void FFIFunction::AttachLibrary(Napi::Object library) {
  library_ = Napi::ObjectWrap<Library>::Unwrap(library);
  library_ref_ = Napi::Persistent(library);
}

FFIFunction::~FFIFunction() {
  // Release errcheck callback to prevent memory leak
  if (!errcheck_callback_.IsEmpty()) {
    errcheck_callback_.Reset();
  }

  // Free reusable call plan della signature fissa (le entry variadiche
  // liberano il proprio nel distruttore).
  call_plan_.reset();
}

bool FFIFunction::PrepareCall(Napi::Env env) {
  // Il layout catturato resta immutabile anche senza costruire i tipi libffi.
  if (return_struct_info_) {
    return_struct_info_->Finalize();
  }
  if (return_array_info_) {
    return_array_info_->Finalize();
  }
  for (size_t i = 0; i < arg_types_.size(); i++) {
    if (arg_struct_infos_[i]) {
      arg_struct_infos_[i]->Finalize();
    }
    if (arg_array_infos_[i]) {
      arg_array_infos_[i]->Finalize();
    }
  }

  SetupFixedCall();
  if (!fixed_invoker_ && UsesDefaultABI()) {
    frame_plan_.Prepare(return_type_, arg_types_);
  }
  if (!fixed_invoker_) {
    if (!PrepareFFI(env)) {
      return false;
    }
    PreparePlan();
  }

  if (struct_as_buffer_ && return_type_ == CType::CTYPES_STRUCT && return_struct_info_) {
    Napi::Buffer<uint8_t> result = Napi::Buffer<uint8_t>::New(env, return_struct_info_->GetSize());
    struct_result_data_ = result.Data();
    struct_result_ = Napi::Persistent(result);
  }
  const bool simple_return =
    return_type_ == CType::CTYPES_STRUCT
      ? struct_result_data_ != nullptr && return_struct_info_->GetSize() <= kMaxSimpleStructReturn
      : return_type_ != CType::CTYPES_ARRAY && return_type_ != CType::CTYPES_UNION;
  simple_call_ = arg_types_.size() <= kMaxSimpleArgs && simple_return;
  for (size_t i = 0; simple_call_ && i < arg_types_.size(); i++) {
    simple_call_ = IsSimpleArgumentType(arg_types_[i]) ||
                   (arg_types_[i] == CType::CTYPES_STRUCT && i < arg_struct_infos_.size() && arg_struct_infos_[i]);
  }
  return true;
}

void FFIFunction::SetupFixedCall() {
  fixed_invoker_ = nullptr;

  if constexpr (sizeof(void*) != 8 || std::endian::native != std::endian::little) {
    return;
  }
  if (!UsesDefaultABI()) {
    return;
  }

#ifndef CTYPES_DISABLE_DIRECT_CALLS
  if (arg_types_.size() <= direct::kMaxDirectArgs) {
    fixed_invoker_ = direct::Select(return_type_, arg_types_);
  }
#endif
}

// ============================================================================
// Call - Ottimizzato con fast paths
// ============================================================================

// ============================================================================
// Per-section helpers for Call() — vedi function.h::CallContext.
// ============================================================================

// Convalida argc e determina se la call è variadic.
// Shared tra Call() (sync) e CallAsync() (async).
bool FFIFunction::ValidateAndResolveArgc(Napi::Env env,
                                         const FunctionArguments& info,
                                         size_t& out_argc,
                                         bool& out_is_variadic) const {
  if (!fixed_invoker_ && !cif_prepared_) [[unlikely]] {
    Napi::Error::New(env, "FFI call interface not prepared").ThrowAsJavaScriptException();
    return false;
  }
  const size_t info_argc = info.Length();
  const size_t expected_argc = arg_types_.size();
  if (info_argc == expected_argc) [[likely]] {
    out_argc = expected_argc;
    out_is_variadic = false;
    return true;
  }
  if (info_argc > expected_argc) {
    out_argc = info_argc;
    out_is_variadic = true;
    return true;
  }
  Napi::TypeError::New(env, std::format("Expected {} arguments, got {}", expected_argc, info_argc))
    .ThrowAsJavaScriptException();
  return false;
}

// Loop di marshalling per-argomento. Dispatch su CType con fast path
// primitivo. Ritorna false se un'eccezione JS è stata lanciata e il
// caller deve restituire env.Undefined().
CTYPES_ALWAYS_INLINE bool FFIFunction::MarshalArguments(CallContext& ctx) {
  Napi::Env env = ctx.env;
  const auto& info = ctx.info;
  const size_t argc = ctx.argc;
  const size_t expected_argc = ctx.expected_argc;
  uint8_t* const arg_storage = ctx.arg_storage;
  void** const arg_values = ctx.arg_values;
  CallScratch& scratch = *ctx.scratch;

  for (size_t i = 0; i < argc; i++) {
    uint8_t* slot = arg_storage + (i * ARG_SLOT_SIZE);
    arg_values[i] = slot;
    if (i >= expected_argc && i - expected_argc < ctx.num_marshaled_extra) {
      continue;
    }
    const Napi::Value val = i < expected_argc ? info[i] : ctx.extra_values[i - expected_argc];

    CType type;
    if (i < expected_argc) [[likely]] {
      type = arg_types_[i];
    } else if (ctx.cache_entry) {
      type = ctx.cache_entry->extra_types[i - expected_argc];
    } else {
      type = ctx.extra_types_ptr[i - expected_argc];
    }

    // Fast path: primitivi.
    try {
      if (MarshalPrimitive(val, type, slot)) {
        continue;
      }
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }

    // Python c_void_p accetta anche bytes/str: la stringa passa come char* UTF-8.
    if (type == CType::CTYPES_POINTER && val.Type() == napi_string) {
      type = CType::CTYPES_STRING;
    }

    try {
      switch (type) {
        case CType::CTYPES_POINTER: {
          void* ptr = PointerArg(val, val.Type(), type);
          memcpy(slot, &ptr, sizeof(ptr));
          break;
        }

        case CType::CTYPES_STRING: {
          const char* str_ptr = nullptr;
          switch (val.Type()) {
            case napi_string: {
              const Napi::String js_str = val.As<Napi::String>();
              // SBO: prova prima il buffer inline (una sola copia, vedi napi_fast.h)
              char* dest = ctx.inline_strings + ctx.inline_string_offset;
              if (auto copied = napi_fast::TryCopyUtf8Into(
                    js_str, std::span(dest, kInlineStringBufferSize - ctx.inline_string_offset))) {
                str_ptr = dest;
                ctx.inline_string_offset += *copied + 1;
                break;
              }
              // Encode into reusable storage; fix pointers after any later growth.
              const size_t offset = ctx.heap_string_offset;
              if (auto copied = napi_fast::TryCopyUtf8Into(js_str, std::span(scratch.strings).subspan(offset))) {
                ctx.heap_string_offset = offset + *copied + 1;
              } else {
                const std::string str = js_str.Utf8Value();
                const size_t needed = str.size() + 1;
                const size_t capacity =
                  std::max(needed + napi_fast::kMaxUtf8CharBytes, napi_fast::kMaxUtf8CharBytes + 2);
                if (capacity > scratch.strings.max_size() - offset) {
                  throw Napi::RangeError::New(env, "String argument buffer is too large");
                }
                // resize alone can round capacity past the retention limit.
                scratch.strings.reserve(offset + capacity);
                scratch.strings.resize(offset + capacity);
                memcpy(scratch.strings.data() + offset, str.c_str(), needed);
                ctx.heap_string_offset = offset + needed;
              }
              scratch.string_fixups.emplace_back(i, offset);
              break;
            }
            case napi_object:
              str_ptr = static_cast<const char*>(ObjectData(val, type));
              break;
            case napi_bigint:
              str_ptr = reinterpret_cast<const char*>(AddressFromBigInt(val));
              break;
            case napi_number:
              str_ptr = reinterpret_cast<const char*>(AddressFromNumber(val));
              break;
            case napi_null:
            case napi_undefined:
              break;
            default:
              ThrowWrongType(val, type);
          }
          memcpy(slot, &str_ptr, sizeof(str_ptr));
          break;
        }

        case CType::CTYPES_WSTRING: {
          const wchar_t* str_ptr = nullptr;
          switch (val.Type()) {
            case napi_string: {
              const std::u16string u16str = val.As<Napi::String>().Utf16Value();
              constexpr size_t wchar_size = sizeof(wchar_t);
              constexpr size_t wchar_align = alignof(wchar_t);
              size_t byte_len = (u16str.length() + 1) * wchar_size;
              size_t offset = ctx.heap_string_offset;
              offset = (offset + wchar_align - 1) & ~(wchar_align - 1);
              ctx.heap_string_offset = offset + byte_len;
              if (scratch.strings.size() < ctx.heap_string_offset) {
                scratch.strings.reserve(ctx.heap_string_offset);
                scratch.strings.resize(ctx.heap_string_offset);
              }
              Utf16ToWide(u16str,
                          std::span(reinterpret_cast<wchar_t*>(scratch.strings.data() + offset), u16str.size() + 1));
              scratch.string_fixups.emplace_back(i, offset);
              break;
            }
            case napi_object:
              str_ptr = static_cast<const wchar_t*>(ObjectData(val, type));
              break;
            case napi_bigint:
              str_ptr = reinterpret_cast<const wchar_t*>(AddressFromBigInt(val));
              break;
            case napi_number:
              str_ptr = reinterpret_cast<const wchar_t*>(AddressFromNumber(val));
              break;
            case napi_null:
            case napi_undefined:
              break;
            default:
              ThrowWrongType(val, type);
          }
          memcpy(slot, &str_ptr, sizeof(str_ptr));
          break;
        }

        case CType::CTYPES_STRUCT: {
          if (i < expected_argc && arg_struct_infos_[i]) {
            if (!MarshalStructArg(env, val, i, arg_struct_infos_[i], slot, &arg_values[i], scratch.large_args,
                                  nullptr)) {
              return false;
            }
          } else {
            MarshalOther(val, type, slot);
          }
          break;
        }

        case CType::CTYPES_ARRAY: {
          if (i < expected_argc && arg_array_infos_[i]) {
            if (!MarshalArrayArg(env, val, i, arg_array_infos_[i], slot, &arg_values[i], scratch.large_args, nullptr)) {
              return false;
            }
          } else {
            MarshalOther(val, type, slot);
          }
          break;
        }

        default:
          MarshalOther(val, type, slot);
          break;
      }
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }
  }

  // Puntatori alle stringhe nel heap scratch.strings: scritti solo ora, quando il
  // buffer non verrà più riallocato in questa call.
  for (const auto& [slot_index, offset] : scratch.string_fixups) {
    const char* str_ptr = scratch.strings.data() + offset;
    memcpy(arg_storage + (slot_index * ARG_SLOT_SIZE), &str_ptr, sizeof(str_ptr));
  }
  return true;
}

// Seleziona il return buffer: ReturnValue della chiamata per tipi primitivi,
// scratch.return_buffer per struct/array > sizeof(ReturnValue).
CTYPES_ALWAYS_INLINE void FFIFunction::SelectReturnPtr(CallContext& ctx) {
  ctx.return_ptr = ctx.return_value;
  size_t ret_size = 0;
  if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_) {
    ret_size = return_struct_info_->GetSize();
  } else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_) {
    ret_size = return_array_info_->GetSize();
  }
  if (ret_size > sizeof(ReturnValue)) {
    ctx.scratch->return_buffer.resize(ret_size);
    ctx.return_ptr = ctx.scratch->return_buffer.data();
  }
}

// Pubblica uno snapshot preso su un altro thread (callAsync) negli slot
// letti da get_last_error() / get_errno(). Solo dal main thread.
void FFIFunction::PublishErrorState(uint32_t last_error, int last_errno) {
  if (capture_last_error_) {
    last_error_ = last_error;
    if (addon_) {
      addon_->captured_last_error = last_error;
    }
  }
  if (capture_errno_) {
    last_errno_ = last_errno;
    if (addon_) {
      addon_->captured_errno = last_errno;
    }
  }
}

Napi::Value FFIFunction::StructResult(const void* bytes) {
  memcpy(struct_result_data_, bytes, return_struct_info_->GetSize());
  return struct_result_.Value();
}

// Convert return value e applica errcheck se presente.
CTYPES_ALWAYS_INLINE Napi::Value FFIFunction::FinalizeCall(CallContext& ctx) {
  Napi::Value result = struct_result_data_ != nullptr
                         ? StructResult(ctx.return_ptr)
                         : ConvertReturn(ctx.env, ctx.return_ptr, return_type_, return_struct_info_, return_array_info_,
                                         struct_as_buffer_, scalar_as_buffer_);
  if (ctx.errcheck == nullptr) [[likely]] {
    return result;
  }
  return ApplyErrcheck(ctx.env, result, ctx.info, *ctx.errcheck);
}

ExtraCallCache* FFIFunction::AcquireExtraCall(size_t argc,
                                              std::span<const CType> extra_types,
                                              std::optional<ExtraCallCache>& fallback) {
  const auto matches = [argc, extra_types](const ExtraCallCache& entry) {
    return entry.valid && entry.total_args == argc && entry.extra_count == extra_types.size() &&
           std::memcmp(entry.extra_types.data(), extra_types.data(), extra_types.size() * sizeof(CType)) == 0;
  };
  if (extra_types.size() <= std::tuple_size_v<decltype(ExtraCallCache::extra_types)>) [[likely]] {
    if (last_extra_cache_ != nullptr && matches(*last_extra_cache_)) [[likely]] {
      return last_extra_cache_;
    }
    for (ExtraCallCache& entry : extra_call_cache_) {
      if (matches(entry)) {
        last_extra_cache_ = &entry;
        return &entry;
      }
    }
  }

  // Cache miss: ricostruisce uno slot (round-robin) non usato da una chiamata
  // in corso; se sono tutti in uso (chiamate rientranti) la firma è locale.
  ExtraCallCache* target = nullptr;
  if (extra_types.size() <= std::tuple_size_v<decltype(ExtraCallCache::extra_types)>) [[likely]] {
    for (size_t attempt = 0; attempt < MAX_CACHED_EXTRA_CALLS && target == nullptr; attempt++) {
      ExtraCallCache& candidate = extra_call_cache_[next_cache_slot_];
      next_cache_slot_ = (next_cache_slot_ + 1) % MAX_CACHED_EXTRA_CALLS;
      if (candidate.in_use == 0) {
        target = &candidate;
      }
    }
  }
  const bool cached = target != nullptr;
  if (!cached) [[unlikely]] {
    target = &fallback.emplace();
  }

  ExtraCallCache& entry = *target;
  entry.valid = false;
  entry.cif_prepared = false;
  entry.ResetPlan();
  entry.frame = {};
  entry.ffi_types.clear();
  entry.total_args = argc;
  entry.extra_types_overflow.clear();
  if (extra_types.size() <= entry.extra_types.size()) [[likely]] {
    entry.extra_count = extra_types.size();
    if (entry.extra_count > 0) {
      std::memcpy(entry.extra_types.data(), extra_types.data(), entry.extra_count * sizeof(CType));
    }
  } else {
    entry.extra_count = 0;
    entry.extra_types_overflow.assign(extra_types.begin(), extra_types.end());
  }
  entry.valid = true;
  if (cached) {
    last_extra_cache_ = &entry;
  }
  return &entry;
}

Napi::Value FFIFunction::Call(const Napi::CallbackInfo& info) {
  const Napi::Function errcheck = SnapshotErrcheck();
  return CallArguments(FunctionArguments{info}, errcheck.IsEmpty() ? nullptr : &errcheck);
}

Napi::Value FFIFunction::CallArguments(const FunctionArguments& info, const Napi::Function* errcheck) {
  Napi::Env env = info.Env();

  size_t argc;
  bool need_reprep = false;
  if (!ValidateAndResolveArgc(env, info, argc, need_reprep)) {
    return env.Undefined();
  }
  const LibraryCallScope library_scope(library_, env);
  const size_t expected_argc = arg_types_.size();

  // Una chiamata rientrante (da un callback durante la chiamata a questa
  // stessa funzione) non può toccare i buffer della chiamata esterna: usa
  // stringhe e scratch propri, sullo stack di questo frame.
  struct NestedCallState {
    CallScratch scratch;
    alignas(16) std::array<char, kInlineStringBufferSize> strings;
  };
  std::optional<NestedCallState> nested;
  CallScratch* scratch = &scratch_;
  char* inline_strings = inline_strings_.data();
  if (call_depth_ != 0) [[unlikely]] {
    NestedCallState& state = nested.emplace();
    scratch = &state.scratch;
    inline_strings = state.strings.data();
  }
  const CountScope depth_scope(&call_depth_);
  scratch->Reset();

  alignas(16) std::array<uint8_t, MAX_INLINE_ARGS * ARG_SLOT_SIZE> inline_arg_storage;

  // =====================================================================
  // Gestione variadic ottimizzata (ispirata a CPython ctypes)
  // =====================================================================
  LibffiCallContext libffi = GetLibffiContext(fixed_invoker_ == nullptr);
  ExtraCallCache* cache_entry = nullptr;
  std::optional<ExtraCallCache> fallback_entry;
  size_t num_extra = 0;  // Numero di argomenti extra variadic
  size_t num_marshaled_extra = 0;

  // Stack-allocated array per piccoli numeri di argomenti extra (come alloca in CPython)
  std::array<CType, MAX_VARIADIC_EXTRA_ARGS> extra_types_stack;
  std::vector<CType> extra_types_heap;
  CType* extra_types = nullptr;
  // Valori degli argomenti extra (un'istanza SimpleCData passa il suo valore).
  std::array<Napi::Value, MAX_VARIADIC_EXTRA_ARGS> extra_values_stack;
  std::vector<Napi::Value> extra_values_heap;
  Napi::Value* extra_values = nullptr;

  if (need_reprep) {
    num_extra = argc - expected_argc;
    if (num_extra <= MAX_VARIADIC_EXTRA_ARGS) {
      extra_types = extra_types_stack.data();
      extra_values = extra_values_stack.data();
    } else {
      extra_types_heap.resize(num_extra);
      extra_values_heap.resize(num_extra);
      extra_types = extra_types_heap.data();
      extra_values = extra_values_heap.data();
    }
    for (size_t i = 0; i < num_extra; i++) {
      const Napi::Value value = info[expected_argc + i];
      if (argc <= MAX_INLINE_ARGS && i == num_marshaled_extra) {
        if (double number; napi_fast::TryDouble(value, number)) {
          const CType type = VariadicNumberType(number);
          extra_types[i] = type;
          extra_values[i] = value;
          StoreVariadicNumber(number, type, inline_arg_storage.data() + (expected_argc + i) * ARG_SLOT_SIZE);
          num_marshaled_extra++;
          continue;
        }
      }
      const VariadicValue extra = InferVariadic(value);
      extra_types[i] = extra.type;
      extra_values[i] = extra.value;
    }

    cache_entry = AcquireExtraCall(argc, {extra_types, num_extra}, fallback_entry);
    if (!PrepareExtraFFI(env, *cache_entry)) {
      return env.Undefined();
    }
    libffi = cache_entry->GetLibffiContext();
  }
  const CountScope cache_scope(cache_entry != nullptr ? &cache_entry->in_use : nullptr);

  // =====================================================================
  // Stato della chiamata: slot e return value sullo stack.
  // =====================================================================
  std::array<void*, MAX_INLINE_ARGS> inline_arg_values;
  alignas(16) ReturnValue return_value{};

  CallContext ctx{env, info};
  ctx.errcheck = errcheck;
  ctx.argc = argc;
  ctx.expected_argc = expected_argc;
  ctx.libffi = libffi;
  ctx.cache_entry = cache_entry;
  ctx.num_extra = num_extra;
  ctx.num_marshaled_extra = num_marshaled_extra;
  ctx.extra_types_ptr = extra_types;
  ctx.extra_values = extra_values;
  ctx.scratch = scratch;
  ctx.inline_strings = inline_strings;
  ctx.return_value = &return_value;

  // ---- Select arg storage (inline vs heap) --------------------------
  if (argc <= MAX_INLINE_ARGS) [[likely]] {
    ctx.arg_storage = inline_arg_storage.data();
    ctx.arg_values = inline_arg_values.data();
  } else {
    const size_t required_size = argc * ARG_SLOT_SIZE;
    if (scratch->arg_storage.size() < required_size) {
      scratch->arg_storage.resize(required_size);
    }
    if (scratch->arg_values.size() < argc) {
      scratch->arg_values.resize(argc);
    }
    ctx.arg_storage = scratch->arg_storage.data();
    ctx.arg_values = scratch->arg_values.data();
  }

  // ---- Marshal arguments -------------------------------------------
  if (!MarshalArguments(ctx)) {
    return env.Undefined();
  }

  // ---- Select return buffer ---------------------------------------
  SelectReturnPtr(ctx);

  // ---- ffi_call + capture errno/GetLastError -----------------------
  // Firme coperte: invoker direct fisso.
  // Altrimenti reusable call plan quando disponibile (fast path su x86-64;
  // fallback sicuro a ffi_call altrove e se l'allocazione del plan è fallita).
  const uint64_t epoch = CallbackEpoch();
  const CTypesAddon::ScopelessCallbacks scopeless(addon_);
  if (cache_entry == nullptr && fixed_invoker_) [[likely]] {
    const SavedErrorState saved_errors = SwapInErrorState();
    fixed_invoker_(fn_ptr_, ctx.arg_values, ctx.return_ptr);
    CaptureErrorState(saved_errors);
  } else {
    const SavedErrorState saved_errors = SwapInErrorState();
    InvokeLibffi(ctx.libffi, fn_ptr_, ctx.return_ptr, ctx.arg_values);
    CaptureErrorState(saved_errors);
  }
  if (CallbackEpoch() != epoch) [[unlikely]] {
    ThrowIfArgumentDetached(info);
  }

  // ---- Convert return + apply errcheck -----------------------------
  return FinalizeCall(ctx);
}

Napi::Value FFIFunction::SetErrcheck(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const Napi::Value callback = info.Length() == 0 ? env.Null() : info[0];
  if (!callback.IsFunction() && !callback.IsNull()) {
    Napi::TypeError::New(env, "errcheck must be a function or null").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (callback.IsNull() && errcheck_callback_.IsEmpty()) {
    return env.Undefined();
  }
  if (addon_ == nullptr) {
    throw Napi::Error::New(env, "Addon not properly initialized");
  }
  Napi::FunctionReference next =
    callback.IsNull() ? Napi::FunctionReference() : Napi::Weak(callback.As<Napi::Function>());
  if (callback.IsNull()) {
    addon_->errcheck_owner_delete.Call(addon_->errcheck_owners.Value(), {Value()});
  } else {
    addon_->errcheck_owner_set.Call(addon_->errcheck_owners.Value(), {Value(), callback});
  }
  errcheck_callback_ = std::move(next);

  return env.Undefined();
}

Napi::Value FFIFunction::ApplyErrcheck(Napi::Env env,
                                       Napi::Value result,
                                       const FunctionArguments& info,
                                       const Napi::Function& errcheck) {
  if (info.HasResultHandler()) {
    return errcheck.Call(env.Undefined(), {result});
  }

  // errcheck(result, this, args). Un'eccezione lanciata da errcheck diventa
  // Napi::Error (NAPI_CPP_EXCEPTIONS) e si propaga al caller JS.
  Napi::Array args_array = Napi::Array::New(env, info.Length());
  for (size_t i = 0; i < info.Length(); i++) {
    args_array.Set(static_cast<uint32_t>(i), info[i]);
  }
  return errcheck.Call(env.Undefined(), {result, Value(), args_array});
}

Napi::Value FFIFunction::GetName(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), name_);
}

Napi::Value FFIFunction::GetAddress(const Napi::CallbackInfo& info) {
  return Napi::BigInt::New(info.Env(), reinterpret_cast<uint64_t>(fn_ptr_));
}

}  // namespace ctypes
