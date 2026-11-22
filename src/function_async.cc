#include "addon.h"
#include "executor.h"
#include "function_marshal.h"

namespace ctypes {

Napi::Value FFIFunction::CallAsyncChecked(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "a result handler function is required");
  }
  const Napi::Function errcheck = info[0].As<Napi::Function>();
  return CallAsyncArguments(FunctionArguments{info, 1}, &errcheck);
}

Napi::Value FFIFunction::CallOn(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(info.Env(), "callOn requires a call target");
  }
  const Napi::Object call = info[0].As<Napi::Object>();
  const Napi::Function errcheck = SnapshotErrcheck();
  return CallAsyncArguments(FunctionArguments{info, 1, false}, errcheck.IsEmpty() ? nullptr : &errcheck, &call);
}

Napi::Value FFIFunction::CallOnChecked(const Napi::CallbackInfo& info) {
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "a call target and a result handler function are required");
  }
  const Napi::Object call = info[0].As<Napi::Object>();
  const Napi::Function errcheck = info[1].As<Napi::Function>();
  return CallAsyncArguments(FunctionArguments{info, 2, true}, &errcheck, &call);
}

// ============================================================================
// CallAsync - Esegue l'invoker fisso o libffi su un worker, ritorna Promise
// Supporta variadic, buffer pinning, string fixup
// ============================================================================

Napi::Value FFIFunction::CallAsync(const Napi::CallbackInfo& info) {
  const Napi::Function errcheck = SnapshotErrcheck();
  return CallAsyncArguments(FunctionArguments{info}, errcheck.IsEmpty() ? nullptr : &errcheck);
}

std::unique_ptr<FFIFunction::PreparedCall> FFIFunction::PrepareAsyncCall(const FunctionArguments& info,
                                                                         const Napi::Function* errcheck) {
  Napi::Env env = info.Env();

  size_t argc;
  bool is_variadic = false;
  if (!ValidateAndResolveArgc(env, info, argc, is_variadic)) {
    return nullptr;
  }
  const LibraryCallScope library_scope(library_, env);
  const size_t expected_argc = arg_types_.size();

  // ---- Validate argc (shared with Call sync, done above) -----------
  //       fatto da ValidateAndResolveArgc sopra.

  // ---- Infer types for extra variadic args -------------------------
  // =====================================================================
  // Tipi per argomenti extra variadic (inferiti dai valori JS)
  // =====================================================================
  std::vector<CType> extra_types;
  std::vector<Napi::Value> extra_values;
  if (is_variadic) {
    extra_types.reserve(argc - expected_argc);
    extra_values.reserve(argc - expected_argc);
    for (size_t i = expected_argc; i < argc; i++) {
      const VariadicValue extra = InferVariadic(info[i]);
      extra_types.push_back(extra.type);
      extra_values.push_back(extra.value);
    }
  }

  // Le firme extra hanno un CIF/array di tipi propri, preparati sul thread JS.
  LibffiAsyncCallState libffi;

  if (is_variadic) {
    if (!PrepareAsyncFFI(env, argc, extra_types, libffi)) {
      return nullptr;
    }
  } else if (!fixed_invoker_ && !PrepareFFI(env)) {
    return nullptr;
  }

  // =====================================================================
  // ---- Marshal JS → C (main thread), with Buffer pinning
  //              e fixup post-move per le stringhe --------------------
  //
  // Tutto va su heap. Tracciamo string offsets per fixup post-move
  // e pinniamo i Buffer JS.
  // =====================================================================

  // SBO: per <= PreparedCall::kInlineArgs evita le allocazioni heap di arg_storage/arg_values.
  alignas(16) std::array<uint8_t, PreparedCall::kInlineArgs * ARG_SLOT_SIZE> inline_arg_storage{};
  std::vector<uint8_t> heap_arg_storage;
  if (argc > PreparedCall::kInlineArgs) {
    heap_arg_storage.resize(argc * ARG_SLOT_SIZE, 0);
  }
  std::vector<char> async_string_buffer;
  std::vector<std::pair<size_t, size_t>> string_fixups;
  std::vector<std::pair<size_t, size_t>> wstring_fixups;
  std::vector<Napi::ObjectReference> buffer_refs;
  std::vector<std::vector<uint8_t>> large_arg_buffers;
  std::vector<size_t> large_arg_indices;  // tracks which arg slots use large_arg_buffers (in order)

  // Stima spazio stringhe
  {
    size_t str_count = 0;
    for (size_t i = 0; i < argc; i++) {
      CType t = (i < expected_argc) ? arg_types_[i] : extra_types[i - expected_argc];
      if (t == CType::CTYPES_STRING || t == CType::CTYPES_WSTRING) {
        str_count++;
      }
    }
    if (str_count > 0) {
      async_string_buffer.reserve(str_count * 128);
    }
  }

  uint8_t* arg_storage = argc <= PreparedCall::kInlineArgs ? inline_arg_storage.data() : heap_arg_storage.data();

  for (size_t i = 0; i < argc; i++) {
    uint8_t* slot = arg_storage + (i * ARG_SLOT_SIZE);
    void* arg_value_placeholder = slot;

    CType type = (i < expected_argc) ? arg_types_[i] : extra_types[i - expected_argc];
    const Napi::Value val = (i < expected_argc) ? info[i] : extra_values[i - expected_argc];
    if (i >= expected_argc && info[i].IsObject()) {
      buffer_refs.push_back(Napi::Persistent(info[i].As<Napi::Object>()));
    }
    if (val.IsObject()) {
      buffer_refs.push_back(Napi::Persistent(val.As<Napi::Object>()));
    }

    // Fast path: primitive types (shared implementation)
    try {
      if (MarshalPrimitive(val, type, slot)) {
        continue;
      }
    } catch (const Napi::Error& e) {
      throw ArgumentErrorFor(env, i, e);
    }

    if (type == CType::CTYPES_POINTER && val.IsString()) {
      type = CType::CTYPES_STRING;
    }

    try {
      switch (type) {
        case CType::CTYPES_POINTER: {
          void* ptr = nullptr;
          if (val.IsNull() || val.IsUndefined()) {
            ptr = nullptr;
          } else if (val.IsObject()) {
            ptr = ObjectData(val, type);
          } else if (val.IsBigInt()) {
            bool lossless;
            ptr = reinterpret_cast<void*>(val.As<Napi::BigInt>().Uint64Value(&lossless));
          } else if (val.IsNumber()) {
            ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value()));
          } else if (val.IsBoolean()) {
            ptr = reinterpret_cast<void*>(static_cast<uintptr_t>(val.As<Napi::Boolean>().Value()));
          } else {
            ThrowWrongType(val, type);
          }
          memcpy(slot, &ptr, sizeof(ptr));
          break;
        }

        case CType::CTYPES_STRING: {
          if (val.IsString()) {
            const size_t offset = async_string_buffer.size();
            napi_fast::AppendUtf8(val.As<Napi::String>(), async_string_buffer);

            // Puntatore provvisorio (verrà fixato dal worker)
            const char* str_ptr = async_string_buffer.data() + offset;
            memcpy(slot, &str_ptr, sizeof(str_ptr));

            // Registra per fixup post-move
            string_fixups.emplace_back(i, offset);
          } else if (val.IsObject()) {
            const char* ptr = static_cast<const char*>(ObjectData(val, type));
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsBigInt()) {
            // Raw pointer address (parity CTYPES_POINTER)
            bool lossless;
            uint64_t addr = val.As<Napi::BigInt>().Uint64Value(&lossless);
            const char* ptr = reinterpret_cast<const char*>(addr);
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsNumber()) {
            const char* ptr =
              reinterpret_cast<const char*>(static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value()));
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsNull() || val.IsUndefined()) {
            const char* null_ptr = nullptr;
            memcpy(slot, &null_ptr, sizeof(null_ptr));
          } else {
            ThrowWrongType(val, type);
          }
          break;
        }

        case CType::CTYPES_WSTRING: {
          if (val.IsString()) {
            std::u16string u16str = val.As<Napi::String>().Utf16Value();
            size_t wchar_size = sizeof(wchar_t);
            size_t byte_len = (u16str.length() + 1) * wchar_size;

            // Align offset for wchar_t to avoid unaligned access
            // (critical on ARM, perf penalty on x86)
            size_t offset = async_string_buffer.size();
            constexpr size_t wchar_align = alignof(wchar_t);
            offset = (offset + wchar_align - 1) & ~(wchar_align - 1);
            async_string_buffer.resize(offset + byte_len);

            Utf16ToWide(u16str,
                        std::span(reinterpret_cast<wchar_t*>(async_string_buffer.data() + offset), u16str.size() + 1));

            const wchar_t* str_ptr = reinterpret_cast<const wchar_t*>(async_string_buffer.data() + offset);
            memcpy(slot, &str_ptr, sizeof(str_ptr));

            wstring_fixups.emplace_back(i, offset);
          } else if (val.IsObject()) {
            const wchar_t* ptr = static_cast<const wchar_t*>(ObjectData(val, type));
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsBigInt()) {
            // Raw pointer address (parity CTYPES_POINTER)
            bool lossless;
            uint64_t addr = val.As<Napi::BigInt>().Uint64Value(&lossless);
            const wchar_t* ptr = reinterpret_cast<const wchar_t*>(addr);
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsNumber()) {
            const wchar_t* ptr =
              reinterpret_cast<const wchar_t*>(static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value()));
            memcpy(slot, &ptr, sizeof(ptr));
          } else if (val.IsNull() || val.IsUndefined()) {
            const wchar_t* null_ptr = nullptr;
            memcpy(slot, &null_ptr, sizeof(null_ptr));
          } else {
            ThrowWrongType(val, type);
          }
          break;
        }

        case CType::CTYPES_STRUCT: {
          if (i < expected_argc && arg_struct_infos_[i]) {
            if (!MarshalStructArg(env, val, i, arg_struct_infos_[i], slot, &arg_value_placeholder, large_arg_buffers,
                                  &large_arg_indices, &buffer_refs)) {
              return nullptr;
            }
          } else {
            MarshalOther(val, type, slot);
          }
          break;
        }

        case CType::CTYPES_ARRAY: {
          if (i < expected_argc && arg_array_infos_[i]) {
            if (!MarshalArrayArg(env, val, i, arg_array_infos_[i], slot, &arg_value_placeholder, large_arg_buffers,
                                 &large_arg_indices, &buffer_refs)) {
              return nullptr;
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

  // =====================================================================
  // ---- PreparedCall: owns the converted arguments until completion ----
  // =====================================================================

  auto call = std::make_unique<PreparedCall>(
    env, this, is_variadic ? nullptr : fixed_invoker_, fn_ptr_, return_type_, return_struct_info_, return_array_info_,
    argc, std::span(inline_arg_storage).first(std::min(argc, PreparedCall::kInlineArgs) * ARG_SLOT_SIZE),
    std::move(heap_arg_storage), std::move(async_string_buffer), std::move(string_fixups), std::move(wstring_fixups),
    std::move(buffer_refs), std::move(libffi), std::move(large_arg_buffers), std::move(large_arg_indices), errcheck,
    info.HasResultHandler());

  if (errcheck != nullptr && !info.HasResultHandler()) {
    call->KeepArguments(info);
  }
  return call;
}

// callAsync(): un worker del pool libuv. callOn(): la coda dell'Executor
// indicato da `target`, l'oggetto di questa sola invocazione: le conversioni
// degli argomenti (from_param) e gli errcheck possono eseguire altre callOn,
// che hanno ciascuna il proprio. Conversioni, errcheck e risultato sono gli stessi.
Napi::Value FFIFunction::CallAsyncArguments(const FunctionArguments& info,
                                            const Napi::Function* errcheck,
                                            const Napi::Object* target) {
  Napi::Env env = info.Env();
  Executor* executor = nullptr;
  if (target != nullptr) {
    executor = UnwrapTagged<Executor>(target->Get("executor"));
    if (executor == nullptr) {
      throw Napi::TypeError::New(env, "callOn requires an Executor");
    }
  }

  std::unique_ptr<PreparedCall> call = PrepareAsyncCall(info, errcheck);
  if (!call) {
    return env.Undefined();
  }
  Napi::Promise promise = call->GetPromise();
  if (executor != nullptr) {
    // Un segnale annullato durante la preparazione degli argomenti (un
    // adattatore può farlo): la chiamata non viene accodata.
    if (const Napi::Value signal = target->Get("signal"); signal.IsObject()) {
      const Napi::Object abort = signal.As<Napi::Object>();
      if (abort.Get("aborted").ToBoolean().Value()) {
        call->Reject(abort.Get("reason"));
        return promise;
      }
    }
    // L'identità della chiamata, per annullarla finché è in coda: scritta
    // nell'oggetto dell'invocazione, non ricostruita in seguito.
    const uint64_t job = executor->Submit(env, std::move(call));
    target->Set("job", Napi::Number::New(env, static_cast<double>(job)));
  } else {
    auto worker = std::make_unique<CallWorker>(env, std::move(call));
    worker->Queue();
    worker.release();
  }
  return promise;
}

// ============================================================================
// PreparedCall / CallWorker implementations (nested classes)
// ============================================================================

FFIFunction::PreparedCall::PreparedCall(Napi::Env env,
                                        FFIFunction* parent,
                                        FixedInvoker invoker,
                                        void* fn_ptr,
                                        CType return_type,
                                        std::shared_ptr<StructInfo> return_struct_info,
                                        std::shared_ptr<ArrayInfo> return_array_info,
                                        size_t argc,
                                        std::span<const uint8_t> inline_arg_storage,
                                        std::vector<uint8_t>&& heap_arg_storage,
                                        std::vector<char>&& string_buffer,
                                        std::vector<std::pair<size_t, size_t>>&& string_fixups,
                                        std::vector<std::pair<size_t, size_t>>&& wstring_fixups,
                                        std::vector<Napi::ObjectReference>&& buffer_refs,
                                        LibffiAsyncCallState&& libffi,
                                        std::vector<std::vector<uint8_t>>&& large_arg_buffers,
                                        std::vector<size_t>&& large_arg_indices,
                                        const Napi::Function* errcheck,
                                        bool result_handler)
  : LibffiAsyncCallState(std::move(libffi)),
    ffi_function_(parent),
    invoker_(invoker),
    fn_ptr_(fn_ptr),
    return_type_(return_type),
    return_struct_info_(std::move(return_struct_info)),
    return_array_info_(std::move(return_array_info)),
    argc_(argc),
    arg_storage_(std::move(heap_arg_storage)),
    string_buffer_(std::move(string_buffer)),
    string_fixups_(std::move(string_fixups)),
    wstring_fixups_(std::move(wstring_fixups)),
    buffer_refs_(std::move(buffer_refs)),
    large_arg_buffers_(std::move(large_arg_buffers)),
    large_arg_indices_(std::move(large_arg_indices)),
    return_ptr_(nullptr),
    deferred_(Napi::Promise::Deferred::New(env)),
    errcheck_ref_(errcheck == nullptr ? Napi::FunctionReference() : Napi::Persistent(*errcheck)),
    result_handler_(result_handler),
    capture_last_error_(parent->capture_last_error_),
    capture_errno_(parent->capture_errno_),
    struct_as_buffer_(parent->struct_as_buffer_),
    scalar_as_buffer_(parent->scalar_as_buffer_) {
  if (parent->addon_ != nullptr) {
    last_error_in_ = parent->addon_->captured_last_error;
    errno_in_ = parent->addon_->captured_errno;
  }

  if (argc_ <= kInlineArgs) {
    if (!inline_arg_storage.empty()) {
      std::memcpy(inline_arg_storage_.data(), inline_arg_storage.data(), inline_arg_storage.size());
    }
  } else {
    arg_values_.resize(argc_);
  }

  Activate(*parent, invoker_ != nullptr);

  // Storage inline fino a kInlineReturnSize (64 B): evita allocazione heap per struct/HFA comuni.
  return_ptr_ = inline_return_storage_.data();
  if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_) {
    const size_t ret_size = return_struct_info_->GetSize();
    if (ret_size > kInlineReturnSize) {
      return_buffer_.resize(ret_size, 0);
      return_ptr_ = return_buffer_.data();
    }
  } else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_) {
    const size_t ret_size = return_array_info_->GetSize();
    if (ret_size > kInlineReturnSize) {
      return_buffer_.resize(ret_size, 0);
      return_ptr_ = return_buffer_.data();
    }
  }

  // Ricalcola tutti i puntatori dopo il move
  FixupPointers();
  // Il parent trattiene libreria e metadata.
  ffi_function_->Ref();
  if (ffi_function_->library_ != nullptr) {
    ffi_function_->library_->BeginCall();
  }
}

void FFIFunction::PreparedCall::FixupPointers() {
  uint8_t* base = argc_ <= kInlineArgs ? inline_arg_storage_.data() : arg_storage_.data();
  void** values = argc_ <= kInlineArgs ? inline_arg_values_.data() : arg_values_.data();

  // 1. Ricalcola i puntatori agli slot dal base definitivo
  for (size_t i = 0; i < argc_; i++) {
    values[i] = base + (i * ARG_SLOT_SIZE);
  }

  // 2. Fixup large struct/array args: point to their overflow buffers
  for (size_t k = 0; k < large_arg_indices_.size(); k++) {
    const size_t arg_idx = large_arg_indices_[k];
    values[arg_idx] = large_arg_buffers_[k].data();
  }

  // 3. Fixup puntatori a stringhe (char*) dentro gli slot
  const char* str_base = string_buffer_.data();
  for (const auto& [slot_index, str_offset] : string_fixups_) {
    uint8_t* slot = base + (slot_index * ARG_SLOT_SIZE);
    const char* new_ptr = str_base + str_offset;
    memcpy(slot, &new_ptr, sizeof(new_ptr));
  }

  // 4. Fixup puntatori a wstring (wchar_t*) dentro gli slot
  for (const auto& [slot_index, str_offset] : wstring_fixups_) {
    uint8_t* slot = base + (slot_index * ARG_SLOT_SIZE);
    const wchar_t* new_ptr = reinterpret_cast<const wchar_t*>(str_base + str_offset);
    memcpy(slot, &new_ptr, sizeof(new_ptr));
  }
}

void FFIFunction::PreparedCall::KeepArguments(const FunctionArguments& info) {
  Napi::Array args = Napi::Array::New(info.Env(), info.Length());
  for (size_t i = 0; i < info.Length(); i++) {
    args.Set(static_cast<uint32_t>(i), info[i]);
  }
  args_ref_ = Napi::Persistent(args.As<Napi::Object>());
}

FFIFunction::PreparedCall::~PreparedCall() {
  if (signature_ && signature_->types.size() <= MAX_INLINE_ARGS && !ffi_function_->idle_async_signature_) {
    ffi_function_->idle_async_signature_ = std::move(signature_);
  }
  if (ffi_function_->library_ != nullptr) {
    ffi_function_->library_->EndCall();
  }
  // Unpin the FFIFunction instance. A destructor must not throw: while the
  // environment is shutting down Node-API can refuse the call.
  try {
    ffi_function_->Unref();
  } catch (...) {
  }
}

void FFIFunction::PreparedCall::Run() noexcept {
  // *** THREAD NATIVO - Nessun accesso a V8! ***
  const auto started = std::chrono::steady_clock::now();
  try {
    const SavedErrorState saved = SwapErrorStateIn(capture_last_error_, capture_errno_, last_error_in_, errno_in_);
    void** args = argc_ == 0 ? nullptr : (argc_ <= kInlineArgs ? inline_arg_values_.data() : arg_values_.data());
    if (invoker_) {
      invoker_(fn_ptr_, args, return_ptr_);
    } else {
      InvokeLibffi(*this, fn_ptr_, return_ptr_, args);
    }
    // Snapshot su questo thread, subito dopo la chiamata (come CaptureErrorState).
    SwapErrorStateOut(capture_last_error_, capture_errno_, saved, last_error_, last_errno_);
  } catch (...) {
    failed_ = true;
    failure_ = "Native function threw an exception";
  }
  run_duration_ = std::chrono::steady_clock::now() - started;
}

void FFIFunction::PreparedCall::Reject(Napi::Value reason) {
  deferred_.Reject(reason);
}

void FFIFunction::PreparedCall::Complete(Napi::Env env) {
  // *** MAIN THREAD ***
  Napi::HandleScope scope(env);

  if (failed_) {
    deferred_.Reject(Napi::Error::New(env, failure_).Value());
    return;
  }

  // get_last_error() / get_errno() see this call, also inside errcheck.
  if (capture_last_error_ || capture_errno_) {
    ffi_function_->PublishErrorState(last_error_, last_errno_);
  }

  // Il thread nativo ha usato la memoria dei buffer per tutta la chiamata: se
  // uno è stato staccato nel frattempo il risultato non è affidabile.
  for (const Napi::ObjectReference& ref : buffer_refs_) {
    if (IsDetachedView(ref.Value())) {
      deferred_.Reject(Napi::Error::New(env, std::format("buffer argument: {}", kDetachedArgumentMessage)).Value());
      return;
    }
  }

  try {
    // Riusa ConvertReturn statico (shared con ConvertReturnValue sync)
    Napi::Value result = FFIFunction::ConvertReturn(env, return_ptr_, return_type_, return_struct_info_,
                                                    return_array_info_, struct_as_buffer_, scalar_as_buffer_);

    // Errcheck (se presente)
    if (!errcheck_ref_.IsEmpty()) {
      try {
        if (result_handler_) {
          result = errcheck_ref_.Call({result});
        } else {
          Napi::Value args_array = args_ref_.IsEmpty() ? Napi::Array::New(env, 0) : args_ref_.Value();
          result = errcheck_ref_.Call({result, ffi_function_->Value(), args_array});
        }
      } catch (const Napi::Error& e) {
        deferred_.Reject(e.Value());
        return;
      }
    }

    deferred_.Resolve(result);
  } catch (const Napi::Error& e) {
    deferred_.Reject(e.Value());
  }
}

FFIFunction::CallWorker::CallWorker(Napi::Env env, std::unique_ptr<PreparedCall> call)
  : Napi::AsyncWorker(env), call_(std::move(call)) {}

void FFIFunction::CallWorker::Execute() {
  // *** WORKER THREAD - Nessun accesso a V8! ***
  call_->Run();
  if (call_->Failed()) {
    SetError(call_->FailureMessage());
  }
}

void FFIFunction::CallWorker::OnOK() {
  call_->Complete(Env());
}

void FFIFunction::CallWorker::OnError(const Napi::Error& error) {
  call_->Reject(error.Value());
}

}  // namespace ctypes
