#pragma once

#include "addon.h"
#include "array.h"
#include "direct_call.h"
#include "napi_fast.h"
#include "shared.h"
#include "struct.h"
#include "types.h"

namespace ctypes {

// Calling conventions supportate
enum class CallConv { CTYPES_DEFAULT, CTYPES_CDECL, CTYPES_STDCALL, CTYPES_FASTCALL, CTYPES_THISCALL };

CallConv StringToCallConv(const std::string& name);
ffi_abi CallConvToFFI(CallConv conv);

// Costanti per ottimizzazione
static constexpr size_t MAX_INLINE_ARGS = 16;
static constexpr size_t ARG_SLOT_SIZE = 16;  // Abbastanza per qualsiasi tipo base
static constexpr size_t RETURN_BUFFER_SIZE = 64;
static constexpr size_t MAX_VARIADIC_EXTRA_ARGS = 8;    // Per stack allocation
static constexpr size_t MAX_CACHED_VARIADIC_CIFS = 16;  // Cache per pattern comuni
static constexpr size_t SMALL_STRING_BUFFER = 1024;     // Stack buffer per stringhe piccole
static constexpr int MAX_AS_PARAMETER_DEPTH = 100;      // Ricorsione _as_parameter_ (come CPython)

// Union per return value (come CPython - migliore cache locality)
union ReturnValue {
  char c;
  int8_t i8;
  uint8_t u8;
  int16_t i16;
  uint16_t u16;
  int32_t i32;
  uint32_t u32;
  int64_t i64;
  uint64_t u64;
  float f;
  double d;
  void* p;
  char* str;
  wchar_t* wstr;
};

// Cache entry per CIF variadici (es. sprintf con 1-2 argomenti extra)
struct VariadicCifCache {
  size_t total_args;  // Numero totale argomenti (fissi + variadici)
  ffi_cif cif;
  std::vector<ffi_type*> ffi_types;
  std::vector<CType> extra_types;  // Tipi degli argomenti extra
  bool valid;
  // Reusable call plan per questo CIF variadico (libffi 3.7+). Ricostruito
  // insieme al cif quando lo slot viene riutilizzato; liberato nel distruttore.
  ffi_call_plan* plan = nullptr;

  VariadicCifCache() : total_args(0), valid(false) {}
};

// Wrapper per una funzione C chiamabile da JavaScript
class FFIFunction : public Napi::ObjectWrap<FFIFunction> {
 public:
  static Napi::Function GetClass(Napi::Env env);

  FFIFunction(const Napi::CallbackInfo& info);
  ~FFIFunction();

  Napi::Value Call(const Napi::CallbackInfo& info);
  Napi::Value CallAsync(const Napi::CallbackInfo& info);

  // ==========================================================================
  // CallContext — mutable state shared tra le fasi di Call().
  // Oggi è usato solo dal path sincrono. Le fasi sono 4 helper privati:
  //   1. MarshalArguments      — loop di marshalling per-argomento
  //   2. SelectReturnPtr       — gestisce il return buffer per struct/array grandi
  //   3. CaptureErrorState     — snapshot di errno/GetLastError post-ffi_call
  //   4. FinalizeCall          — convert return + errcheck
  // The variadic setup block (CIF cache lookup + prep_cif_var) resta inline
  // in Call() perché usa SBO stack arrays che sarebbero persi con
  // l'estrazione.
  // ==========================================================================
  struct CallContext {
    Napi::Env env;
    const Napi::CallbackInfo& info;
    size_t argc = 0;
    size_t expected_argc = 0;
    ffi_cif* active_cif = nullptr;
    ffi_call_plan* active_plan = nullptr;
    VariadicCifCache* cache_entry = nullptr;
    size_t num_extra = 0;
    // Puntatore al primo elemento dell'array di tipi extra (che risiede
    // su stack o heap nel frame di Call()). Valido solo se need_reprep.
    const CType* extra_types_ptr = nullptr;
    uint8_t* arg_storage = nullptr;
    void** arg_values = nullptr;
    void* return_ptr = nullptr;
  };
  Napi::Value GetName(const Napi::CallbackInfo& info);
  Napi::Value GetAddress(const Napi::CallbackInfo& info);
  Napi::Value SetErrcheck(const Napi::CallbackInfo& info);

  // Static helpers shared between sync Call() and async CallWorker
  static CType InferTypeFromJS(const Napi::Value& val);
  static Napi::Value ConvertReturn(Napi::Env env,
                                   void* return_data,
                                   CType type,
                                   const std::shared_ptr<StructInfo>& struct_info,
                                   const std::shared_ptr<ArrayInfo>& array_info);
  static inline bool MarshalPrimitive(Napi::Env env, const Napi::Value& val, CType type, uint8_t* slot);
  static bool MarshalStructArg(Napi::Env env,
                               const Napi::Value& val,
                               size_t arg_index,
                               const std::shared_ptr<StructInfo>& struct_info,
                               uint8_t* slot,
                               void** arg_value_ptr,
                               std::vector<std::vector<uint8_t>>& large_buffers,
                               std::vector<size_t>* large_indices);
  static bool MarshalArrayArg(Napi::Env env,
                              const Napi::Value& val,
                              size_t arg_index,
                              const std::shared_ptr<ArrayInfo>& array_info,
                              uint8_t* slot,
                              void** arg_value_ptr,
                              std::vector<std::vector<uint8_t>>& large_buffers,
                              std::vector<size_t>* large_indices);

 private:
  bool PrepareFFI(Napi::Env env);

  // Entry point of the per-instance `call` function: the FFIFunction* is the
  // function's N-API data, so the hot path skips the napi_unwrap of InstanceMethod.
  static Napi::Value FastCall(const Napi::CallbackInfo& info);
  void InstallFastCall(Napi::Env env);
  void SetupDirectCall();

  // Per-section helpers for Call(). `always_inline` marcato sulla definition
  // (vedi function.cc) — vengono chiamati esattamente una volta dal
  // caller, l'overhead di call erode il hot path FFI.
  bool MarshalArguments(CallContext& ctx);
  void SelectReturnPtr(CallContext& ctx);
  void CaptureErrorState();
  void PublishErrorState(uint32_t last_error, int last_errno);
  Napi::Value FinalizeCall(CallContext& ctx);

  // Helper condiviso tra Call() (sincrona) e CallAsync (asincrona):
  // valida info.Length() vs arg_types_.size(), produce argc effettivo
  // e flag is_variadic. In caso di errore, throws JS exception e
  // ritorna false (caller deve restituire env.Undefined()).
  bool ValidateAndResolveArgc(Napi::Env env,
                              const Napi::CallbackInfo& info,
                              size_t& out_argc,
                              bool& out_is_variadic) const;

  // Thin wrapper that calls ConvertReturn with member state
  inline Napi::Value ConvertReturnValue(Napi::Env env) {
    return ConvertReturn(env, &return_value_, return_type_, return_struct_info_, return_array_info_);
  }

  // ============================================================
  // Nested async worker for CallAsync (no separate files)
  // ============================================================
  class CallWorker : public Napi::AsyncWorker {
   public:
    CallWorker(Napi::Env env,
               FFIFunction* ffi_function,
               ffi_cif* cif,
               void* fn_ptr,
               CType return_type,
               std::shared_ptr<StructInfo> return_struct_info,
               std::shared_ptr<ArrayInfo> return_array_info,
               std::vector<uint8_t>&& arg_storage,
               std::vector<void*>&& arg_values,
               std::vector<char>&& string_buffer,
               std::vector<std::pair<size_t, size_t>>&& string_fixups,
               std::vector<std::pair<size_t, size_t>>&& wstring_fixups,
               std::vector<Napi::ObjectReference>&& buffer_refs,
               std::unique_ptr<ffi_cif>&& owned_cif,
               std::vector<ffi_type*>&& owned_ffi_types,
               std::vector<std::vector<uint8_t>>&& large_arg_buffers,
               std::vector<size_t>&& large_arg_indices,
               Napi::FunctionReference* errcheck_ref);
    ~CallWorker();

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;
    Napi::Promise GetPromise() { return deferred_.Promise(); }
    void KeepArguments(const Napi::CallbackInfo& info);

   private:
    void FixupPointers();

    FFIFunction* ffi_function_;
    ffi_cif* active_cif_;
    void* fn_ptr_;
    CType return_type_;
    std::shared_ptr<StructInfo> return_struct_info_;
    std::shared_ptr<ArrayInfo> return_array_info_;
    alignas(16) ReturnValue return_value_;
    std::vector<uint8_t> arg_storage_;
    std::vector<void*> arg_values_;
    std::vector<char> string_buffer_;
    std::vector<std::pair<size_t, size_t>> string_fixups_;
    std::vector<std::pair<size_t, size_t>> wstring_fixups_;
    std::vector<Napi::ObjectReference> buffer_refs_;
    std::unique_ptr<ffi_cif> owned_cif_;
    std::vector<ffi_type*> owned_ffi_types_;
    std::vector<std::vector<uint8_t>> large_arg_buffers_;  // overflow for struct/array > ARG_SLOT_SIZE
    std::vector<size_t> large_arg_indices_;                // which arg slots use large_arg_buffers_ (in order)
    std::vector<uint8_t> return_buffer_;                   // for struct/array returns > sizeof(ReturnValue)
    void* return_ptr_;                                     // &return_value_ or return_buffer_.data()
    Napi::Promise::Deferred deferred_;
    Napi::FunctionReference* errcheck_ref_;
    Napi::ObjectReference args_ref_;  // JS arguments, for errcheck(result, func, args)
    // use_last_error / use_errno: snapshot on the worker thread, right after ffi_call
    bool capture_last_error_;
    bool capture_errno_;
    uint32_t last_error_ = 0;
    int last_errno_ = 0;
  };

  void* fn_ptr_;
  std::string name_;

  // FFI stuff
  ffi_cif cif_;
  bool cif_prepared_;
  ffi_abi abi_;

  // Reusable call plan per la signature fissa (libffi 3.7+). Costruito una volta
  // in PrepareFFI e riusato ad ogni chiamata: cattura il posizionamento degli
  // argomenti così ffi_call_plan_invoke evita di riclassificarli. Su x86-64 usa
  // il fast path di libffi; altrove ffi_call_plan_invoke ricade su ffi_call.
  ffi_call_plan* call_plan_ = nullptr;

  // Direct-call fast path (see direct_call.h); nullptr when the signature is
  // not eligible and the call goes through libffi.
  direct::Invoker direct_invoker_ = nullptr;
  std::array<direct::Widen, direct::kMaxDirectArgs> direct_arg_widen_{};
  uint8_t direct_arg_widen_count_ = 0;
  uint8_t direct_ret_widen_size_ = 0;  // 0 = return needs no widening
  bool direct_ret_signed_ = false;

  // Tipi
  CType return_type_;
  std::vector<CType> arg_types_;

  // Struct/Array info per argomenti e return (se STRUCT/UNION/ARRAY)
  std::shared_ptr<StructInfo> return_struct_info_;
  std::shared_ptr<ArrayInfo> return_array_info_;
  std::vector<std::shared_ptr<StructInfo>> arg_struct_infos_;
  std::vector<std::shared_ptr<ArrayInfo>> arg_array_infos_;

  // Cache dei tipi FFI
  ffi_type* ffi_return_type_;
  std::vector<ffi_type*> ffi_arg_types_;

  // ============================================================
  // Buffer pre-allocati per evitare allocazioni in Call()
  // ============================================================

  // Buffer inline per argomenti (fino a MAX_INLINE_ARGS)
  alignas(16) uint8_t inline_arg_storage_[MAX_INLINE_ARGS * ARG_SLOT_SIZE];
  void* inline_arg_values_[MAX_INLINE_ARGS];

  // Union per return value (ottimizza cache locality)
  alignas(16) ReturnValue return_value_;

  // SBO per stringhe: buffer inline per stringhe corte
  static constexpr size_t kInlineStringBufferSize = 512;
  alignas(16) char inline_string_buffer_[kInlineStringBufferSize];
  size_t inline_string_offset_;  // Offset corrente nel buffer inline

  // Buffer per stringhe lunghe (fallback quando inline esaurisce)
  std::vector<char> string_buffer_;
  // (slot index, offset in string_buffer_) delle stringhe finite nel buffer heap
  // durante la call corrente; i puntatori sono scritti a fine marshalling.
  std::vector<std::pair<size_t, size_t>> string_fixups_;

  // Heap fallback per molti argomenti
  std::vector<uint8_t> heap_arg_storage_;
  std::vector<void*> heap_arg_values_;

  // Overflow buffers for struct/array args > ARG_SLOT_SIZE (sync path)
  std::vector<std::vector<uint8_t>> sync_large_arg_buffers_;

  // Return buffer for struct/array returns > sizeof(ReturnValue) (sync path)
  std::vector<uint8_t> sync_return_buffer_;

  // Flag per sapere se usare inline o heap
  bool use_inline_storage_;

  // Precalcolati a construction time per saltare il setup per-call
  // quando la signature non ha argomenti stringa / struct / array / union.
  bool has_string_args_;        // almeno uno STRING/WSTRING in arg_types_
  bool has_struct_array_args_;  // almeno uno STRUCT/UNION/ARRAY in arg_types_

  // ============================================================
  // Cache per CIF variadici (ottimizzazione chiamate ripetute)
  // ============================================================
  VariadicCifCache variadic_cache_[MAX_CACHED_VARIADIC_CIFS];
  size_t next_cache_slot_;  // Round-robin replacement

  // ============================================================
  // Error checking callback (Python ctypes errcheck)
  // ============================================================
  Napi::FunctionReference errcheck_callback_;

  // Helper per applicare errcheck callback
  Napi::Value ApplyErrcheck(Napi::Env env, Napi::Value result, const Napi::CallbackInfo& info);

  // ============================================================
  // Cattura last-error / errno (parity Python use_last_error / use_errno).
  // Snapshot subito dopo ffi_call così il codice successivo non può
  // sovrascriverli prima che l'utente li rilegga.
  // ============================================================
  bool capture_last_error_;  // snapshot GetLastError dopo ogni call
  bool capture_errno_;       // snapshot errno dopo ogni call
  uint32_t last_error_;      // DWORD-like (unsigned), parity Win32
  int last_errno_;           // errno è int in POSIX

  // Cached addon pointer (avoid GetInstanceData<>() map lookup on every call).
  // CTypesAddon lives in env instance data; lifetime >= this object's lifetime.
  CTypesAddon* addon_;

 public:
  Napi::Value GetLastErrorCaptured(const Napi::CallbackInfo& info);
  Napi::Value GetErrnoCaptured(const Napi::CallbackInfo& info);
};

}  // namespace ctypes
