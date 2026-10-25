#pragma once

#include "addon.h"
#include "direct_call.h"
#include "layout.h"
#include "library.h"
#include "napi_fast.h"
#include "shared.h"
#include "types.h"

namespace ctypes {

// Calling conventions supportate
enum class CallConv { CTYPES_DEFAULT, CTYPES_CDECL, CTYPES_STDCALL, CTYPES_FASTCALL, CTYPES_THISCALL };

[[nodiscard]] CallConv StringToCallConv(std::string_view name);
[[nodiscard]] ffi_abi CallConvToFFI(CallConv conv);

// Costanti per ottimizzazione
static constexpr size_t MAX_INLINE_ARGS = 16;
static constexpr size_t ARG_SLOT_SIZE = 16;  // Abbastanza per qualsiasi tipo base
static constexpr size_t RETURN_BUFFER_SIZE = 64;
static constexpr size_t MAX_VARIADIC_EXTRA_ARGS = 8;    // Per stack allocation
static constexpr size_t MAX_CACHED_VARIADIC_CIFS = 16;  // Cache per pattern comuni
static constexpr size_t SMALL_STRING_BUFFER = 1024;     // Stack buffer per stringhe piccole
static constexpr int MAX_AS_PARAMETER_DEPTH = 100;      // Ricorsione _as_parameter_ (come CPython)

// Valore restituito da libffi o dal direct invoker: byte grezzi, letti con
// LoadAs<T> (leggere un membro non attivo di una union è indefinito in C++).
// libffi scrive almeno un ffi_arg, con i tipi più stretti estesi.
struct ReturnValue {
  alignas(8) std::array<std::byte, 8> bytes{};
};

// Cache entry per CIF variadici (es. sprintf con 1-2 argomenti extra)
struct VariadicCifCache {
  size_t total_args = 0;  // Numero totale argomenti (fissi + variadici)
  ffi_cif cif;
  std::vector<ffi_type*> ffi_types;
  std::vector<CType> extra_types;  // Tipi degli argomenti extra
  bool valid = false;
  // Chiamate in corso che usano questo CIF: una chiamata rientrante (da un
  // callback) non può ricostruire lo slot mentre la chiamata esterna lo usa.
  uint32_t in_use = 0;
  // Reusable call plan per questo CIF variadico (libffi 3.7+). Ricostruito
  // insieme al cif quando lo slot viene riutilizzato.
  ffi_call_plan* plan = nullptr;

  VariadicCifCache() = default;
  VariadicCifCache(const VariadicCifCache&) = delete;
  VariadicCifCache& operator=(const VariadicCifCache&) = delete;
  ~VariadicCifCache() { ResetPlan(); }

  void ResetPlan() noexcept {
    if (plan) {
      ffi_call_plan_free(plan);
      plan = nullptr;
    }
  }
};

// Buffer heap di una chiamata sincrona. L'istanza ne riusa uno (capacità
// conservata tra le chiamate); una chiamata rientrante usa il proprio.
struct CallScratch {
  std::vector<char> strings;                             // stringhe oltre il buffer inline
  std::vector<std::pair<size_t, size_t>> string_fixups;  // (slot, offset in strings)
  std::vector<uint8_t> arg_storage;                      // slot oltre MAX_INLINE_ARGS
  std::vector<void*> arg_values;
  std::vector<std::vector<uint8_t>> large_args;  // struct/array > ARG_SLOT_SIZE
  std::vector<uint8_t> return_buffer;            // struct/array > sizeof(ReturnValue)

  void Reset() {
    // CallContext counts used bytes; keep initialized storage to avoid zeroing it again.
    if (strings.capacity() > 10 * 1024 * 1024) {
      strings.clear();
      strings.shrink_to_fit();
    }
    string_fixups.clear();
    large_args.clear();
  }
};

// Argomento oltre gli argtypes: il tipo con cui passarlo e il valore da
// convertire (per un'istanza SimpleCData il suo valore, vedi InferVariadic).
struct VariadicValue {
  CType type;
  Napi::Value value;
};

// Valori di sistema di errno / GetLastError() salvati prima di una chiamata
// con use_errno / use_last_error e ripristinati dopo (scambio come CPython).
struct SavedErrorState {
  int errno_value = 0;
  uint32_t last_error = 0;
};

struct FunctionArguments {
  const Napi::CallbackInfo& callback;
  const size_t first;
  const size_t argc;
  const Napi::Env env;

  explicit FunctionArguments(const Napi::CallbackInfo& info, size_t first_arg = 0)
    : callback(info), first(first_arg), argc(info.Length() - first_arg), env(info.Env()) {}

  Napi::Env Env() const { return env; }
  size_t Length() const { return argc; }
  Napi::Value operator[](size_t index) const { return callback[index + first]; }
  bool HasResultHandler() const noexcept { return first != 0; }
};

#if defined(_MSC_VER)
// The inline return/string buffers require alignas(16); class padding is intentional.
#pragma warning(push)
#pragma warning(disable : 4324)
#endif

// Wrapper per una funzione C chiamabile da JavaScript
class FFIFunction : public Napi::ObjectWrap<FFIFunction> {
 public:
  static Napi::Function GetClass(Napi::Env env);

  FFIFunction(const Napi::CallbackInfo& info);
  ~FFIFunction();

  Napi::Value Call(const Napi::CallbackInfo& info);
  Napi::Value CallAsync(const Napi::CallbackInfo& info);
  Napi::Value CallChecked(const Napi::CallbackInfo& info);
  Napi::Value CallAsyncChecked(const Napi::CallbackInfo& info);
  Napi::Value MakeCheckedCall(const Napi::CallbackInfo& info);

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
    const FunctionArguments& info;
    size_t argc = 0;
    size_t expected_argc = 0;
    ffi_cif* active_cif = nullptr;
    ffi_call_plan* active_plan = nullptr;
    VariadicCifCache* cache_entry = nullptr;
    size_t num_extra = 0;
    // Puntatore al primo elemento dell'array di tipi extra (che risiede
    // su stack o heap nel frame di Call()). Valido solo se need_reprep.
    const CType* extra_types_ptr = nullptr;
    const Napi::Value* extra_values = nullptr;
    uint8_t* arg_storage = nullptr;
    void** arg_values = nullptr;
    void* return_ptr = nullptr;
    // Stato della singola chiamata (stack di Call() o scratch dell'istanza):
    // mai condiviso con una chiamata rientrante.
    CallScratch* scratch = nullptr;
    char* inline_strings = nullptr;
    size_t inline_string_offset = 0;
    size_t heap_string_offset = 0;
    ReturnValue* return_value = nullptr;
    const Napi::Function* errcheck = nullptr;
  };

  // Lega la funzione alla libreria da cui proviene: la libreria resta caricata
  // finché la funzione è viva, e le chiamate dopo close() sono un errore.
  void AttachLibrary(Napi::Object library);
  Napi::Value GetName(const Napi::CallbackInfo& info);
  Napi::Value GetAddress(const Napi::CallbackInfo& info);
  Napi::Value SetErrcheck(const Napi::CallbackInfo& info);

  // Static helpers shared between sync Call() and async CallWorker
  [[nodiscard]] static CType InferTypeFromJS(const Napi::Value& val);
  // Tipo e valore di un argomento oltre gli argtypes.
  [[nodiscard]] static VariadicValue InferVariadic(const Napi::Value& val);
  [[nodiscard]] static Napi::Value ConvertReturn(Napi::Env env,
                                                 void* return_data,
                                                 CType type,
                                                 const std::shared_ptr<StructInfo>& struct_info,
                                                 const std::shared_ptr<ArrayInfo>& array_info,
                                                 bool struct_as_buffer,
                                                 bool scalar_as_buffer = false);
  [[nodiscard]] static inline bool MarshalPrimitive(const Napi::Value& val, CType type, uint8_t* slot);
  [[nodiscard]] static bool MarshalStructArg(Napi::Env env,
                                             const Napi::Value& val,
                                             size_t arg_index,
                                             const std::shared_ptr<StructInfo>& struct_info,
                                             uint8_t* slot,
                                             void** arg_value_ptr,
                                             std::vector<std::vector<uint8_t>>& large_buffers,
                                             std::vector<size_t>* large_indices,
                                             std::vector<Napi::ObjectReference>* owners = nullptr);
  [[nodiscard]] static bool MarshalArrayArg(Napi::Env env,
                                            const Napi::Value& val,
                                            size_t arg_index,
                                            const std::shared_ptr<ArrayInfo>& array_info,
                                            uint8_t* slot,
                                            void** arg_value_ptr,
                                            std::vector<std::vector<uint8_t>>& large_buffers,
                                            std::vector<size_t>* large_indices,
                                            std::vector<Napi::ObjectReference>* owners = nullptr);

 private:
  bool PrepareFFI(Napi::Env env);

  // Entry point of the per-instance `call` function: the FFIFunction* is the
  // function's N-API data, so the hot path skips the napi_unwrap of InstanceMethod.
  static Napi::Value FastCall(const Napi::CallbackInfo& info);
  static Napi::Value FastCheckedCall(const Napi::CallbackInfo& info);
  void InstallFastCall(Napi::Env env);
  void SetupDirectCall();

  // Firma semplice (vedi SimpleCall): argomenti fissi primitivi, puntatori o
  // stringhe e ritorno che non è una struct/array. Calcolato in PrepareFFI.
  static constexpr size_t kMaxSimpleArgs = 8;
  static constexpr size_t kMaxSimpleStructReturn = 64;
  bool simple_call_ = false;
  // Percorso veloce delle firme semplici; false (senza effetti) se un
  // argomento richiede Call(): stringa lunga o chiamata rientrante.
  template <typename Args, bool HasErrcheck = true>
    requires(std::same_as<Args, Napi::CallbackInfo> || std::same_as<Args, FunctionArguments>)
  [[nodiscard]] bool SimpleCall(const Args& info, Napi::Value& result, const Napi::Function* errcheck);
  template <typename Args, bool HasErrcheck = true>
    requires(std::same_as<Args, Napi::CallbackInfo> || std::same_as<Args, FunctionArguments>)
  Napi::Value InvokeCall(const Args& info, const Napi::Function* errcheck);
  Napi::Value CallArguments(const FunctionArguments& info, const Napi::Function* errcheck);
  Napi::Value CallAsyncArguments(const FunctionArguments& info, const Napi::Function* errcheck);
  [[nodiscard]] Napi::Function SnapshotErrcheck() const {
    return errcheck_callback_.IsEmpty() ? Napi::Function() : errcheck_callback_.Value();
  }

  // Per-section helpers for Call(). `always_inline` marcato sulla definition
  // (vedi function.cc) — vengono chiamati esattamente una volta dal
  // caller, l'overhead di call erode il hot path FFI.
  [[nodiscard]] bool MarshalArguments(CallContext& ctx);
  void SelectReturnPtr(CallContext& ctx);
  SavedErrorState SwapInErrorState();
  void CaptureErrorState(const SavedErrorState& saved);
  void PublishErrorState(uint32_t last_error, int last_errno);
  Napi::Value FinalizeCall(CallContext& ctx);

  // Helper condiviso tra Call() (sincrona) e CallAsync (asincrona):
  // valida info.Length() vs arg_types_.size(), produce argc effettivo
  // e flag is_variadic. In caso di errore, throws JS exception e
  // ritorna false (caller deve restituire env.Undefined()).
  [[nodiscard]] bool ValidateAndResolveArgc(Napi::Env env,
                                            const FunctionArguments& info,
                                            size_t& out_argc,
                                            bool& out_is_variadic) const;

  // CIF per una call variadica: uno slot della cache con gli stessi tipi, uno
  // slot libero da ricostruire o, se sono tutti in uso, `fallback`. nullptr se
  // ffi_prep_cif fallisce (eccezione JS già lanciata).
  [[nodiscard]] VariadicCifCache* AcquireVariadicCif(Napi::Env env,
                                                     size_t argc,
                                                     const CType* extra_types,
                                                     size_t num_extra,
                                                     std::optional<VariadicCifCache>& fallback);

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
               const Napi::Function* errcheck,
               bool result_handler);
    ~CallWorker();

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;
    Napi::Promise GetPromise() { return deferred_.Promise(); }
    void KeepArguments(const FunctionArguments& info);

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
    Napi::FunctionReference errcheck_ref_;
    bool result_handler_;
    Napi::ObjectReference args_ref_;  // JS arguments, for errcheck(result, func, args)
    // use_last_error / use_errno: snapshot on the worker thread, right after ffi_call
    bool capture_last_error_;
    bool capture_errno_;
    bool struct_as_buffer_;
    bool scalar_as_buffer_;
    uint32_t last_error_ = 0;
    int last_errno_ = 0;
    // Valori privati (get_last_error() / get_errno()) al momento della chiamata.
    uint32_t last_error_in_ = 0;
    int errno_in_ = 0;
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
  // Stato delle chiamate sincrone. Slot inline, return value e stringhe corte
  // stanno sullo stack di Call(); i buffer heap della chiamata più esterna
  // sono riusati tra le chiamate, una chiamata rientrante ne ha di propri.
  // ============================================================

  static constexpr size_t kInlineStringBufferSize = 512;
  CallScratch scratch_;
  // Stringhe corte della chiamata più esterna. Restano valide fino alla call
  // successiva, come prima: un puntatore restituito che punta dentro un
  // argomento stringa (es. strchr("abc", 'b')) resta leggibile dopo la call.
  alignas(16) std::array<char, kInlineStringBufferSize> inline_strings_;
  uint32_t call_depth_ = 0;

  // Libreria da cui proviene la funzione (nullptr per indirizzi raw): tenuta
  // viva dal riferimento finché la funzione esiste.
  Library* library_ = nullptr;
  Napi::ObjectReference library_ref_;

  // ============================================================
  // Cache per CIF variadici (ottimizzazione chiamate ripetute)
  // ============================================================
  std::array<VariadicCifCache, MAX_CACHED_VARIADIC_CIFS> variadic_cache_;
  size_t next_cache_slot_;  // Round-robin replacement

  // ============================================================
  // Error checking callback (Python ctypes errcheck)
  // ============================================================
  Napi::FunctionReference errcheck_callback_;  // weak; the environment's JS WeakMap owns the callback

  // Helper per applicare errcheck callback
  Napi::Value ApplyErrcheck(Napi::Env env,
                            Napi::Value result,
                            const FunctionArguments& info,
                            const Napi::Function& errcheck);

  // ============================================================
  // Cattura last-error / errno (parity Python use_last_error / use_errno).
  // Snapshot subito dopo ffi_call così il codice successivo non può
  // sovrascriverli prima che l'utente li rilegga.
  // ============================================================
  bool capture_last_error_;  // snapshot GetLastError dopo ogni call
  bool capture_errno_;       // snapshot errno dopo ogni call
  // Struct restituite come Buffer dei loro byte (opzione `struct_buffer`):
  // il wrapper JS ne fa un'istanza della classe, come Python.
  bool struct_as_buffer_ = false;
  bool scalar_as_buffer_ = false;
  // Con struct_as_buffer_: Buffer in cui una chiamata sincrona restituisce i
  // byte della struct, riusato a ogni chiamata (il chiamante JS li copia
  // subito nell'istanza). Buffer::Copy allocava con malloc e cambiava il
  // prototipo di un nuovo oggetto a ogni chiamata.
  Napi::Reference<Napi::Buffer<uint8_t>> struct_result_;
  uint8_t* struct_result_data_ = nullptr;
  Napi::Value StructResult(const void* bytes);
  uint32_t last_error_;  // DWORD-like (unsigned), parity Win32
  int last_errno_;       // errno è int in POSIX

  // Cached addon pointer (avoid GetInstanceData<>() map lookup on every call).
  // CTypesAddon lives in env instance data; lifetime >= this object's lifetime.
  CTypesAddon* addon_;

 public:
  Napi::Value GetLastErrorCaptured(const Napi::CallbackInfo& info);
  Napi::Value GetErrnoCaptured(const Napi::CallbackInfo& info);
};

#if defined(_MSC_VER)
#pragma warning(pop)
#endif

}  // namespace ctypes
