#pragma once

#include "call_abi.h"
#include "libffi_types.h"

namespace ctypes {

[[nodiscard]] ffi_abi CallConvToFFI(CallConv conv);

struct LibffiCallContext {
  ffi_cif* active_cif = nullptr;
  ffi_call_plan* active_plan = nullptr;
};

struct LibffiCallState {
  ffi_cif cif_;
  bool cif_prepared_ = false;
  ffi_abi abi_ = FFI_DEFAULT_ABI;
  struct CallPlanDeleter {
    void operator()(ffi_call_plan* plan) const noexcept { ffi_call_plan_free(plan); }
  };
  std::unique_ptr<ffi_call_plan, CallPlanDeleter> call_plan_;
  ffi_type* ffi_return_type_ = nullptr;
  std::vector<ffi_type*> ffi_arg_types_;

  void SetCallConv(CallConv conv) noexcept;
  void PreparePlan();
  [[nodiscard]] bool UsesDefaultABI() const noexcept { return abi_ == FFI_DEFAULT_ABI; }
  [[nodiscard]] LibffiCallContext GetLibffiContext(bool active) noexcept {
    return {active ? &cif_ : nullptr, call_plan_.get()};
  }
};

struct LibffiExtraCallState {
  ffi_cif cif;
  std::vector<ffi_type*> ffi_types;
  bool cif_prepared = false;
  ffi_call_plan* plan = nullptr;

  LibffiExtraCallState() = default;
  LibffiExtraCallState(const LibffiExtraCallState&) = delete;
  LibffiExtraCallState& operator=(const LibffiExtraCallState&) = delete;
  ~LibffiExtraCallState() { ResetPlan(); }

  [[nodiscard]] LibffiCallContext GetLibffiContext() noexcept { return {&cif, plan}; }

  void ResetPlan() noexcept {
    if (plan) {
      ffi_call_plan_free(plan);
      plan = nullptr;
    }
  }
};

struct LibffiAsyncCallState {
  ffi_cif* active_cif_ = nullptr;
  std::unique_ptr<ffi_cif> owned_cif_;
  std::vector<ffi_type*> owned_ffi_types_;

  void Activate(LibffiCallState& parent, bool has_invoker) {
    active_cif_ = has_invoker ? nullptr : owned_cif_ ? owned_cif_.get() : parent.cif_prepared_ ? &parent.cif_ : nullptr;
    if (!has_invoker && active_cif_ == nullptr) {
      throw std::logic_error("Async call has neither a native invoker nor a prepared FFI interface");
    }
  }
};

// Resta inline: errno/GetLastError devono essere catturati subito dopo il ritorno nativo.
CTYPES_ALWAYS_INLINE void InvokeLibffi(const LibffiCallContext& context, void* fn, void* ret, void** args) {
  if (context.active_plan) {
    ffi_call_plan_invoke(context.active_plan, FFI_FN(fn), ret, args);
  } else {
    ffi_call(context.active_cif, FFI_FN(fn), ret, args);
  }
}

CTYPES_ALWAYS_INLINE void InvokeLibffi(LibffiCallState& state, void* fn, void* ret, void** args) {
  InvokeLibffi(state.GetLibffiContext(true), fn, ret, args);
}

CTYPES_ALWAYS_INLINE void InvokeLibffi(LibffiExtraCallState& state, void* fn, void* ret, void** args) {
  InvokeLibffi(state.GetLibffiContext(), fn, ret, args);
}

CTYPES_ALWAYS_INLINE void InvokeLibffi(LibffiAsyncCallState& state, void* fn, void* ret, void** args) {
  ffi_call(state.active_cif_, FFI_FN(fn), ret, args);
}

}  // namespace ctypes
