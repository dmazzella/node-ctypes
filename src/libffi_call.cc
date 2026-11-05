#include "libffi_call.h"

#include "function.h"

namespace ctypes {

ffi_abi CallConvToFFI(CallConv conv) {
  switch (conv) {
#if defined(_WIN32) && defined(__i386__)
    case CallConv::CTYPES_STDCALL:
      return FFI_STDCALL;
    case CallConv::CTYPES_FASTCALL:
      return FFI_FASTCALL;
    case CallConv::CTYPES_THISCALL:
      return FFI_THISCALL;
#endif
    case CallConv::CTYPES_CDECL:
    case CallConv::CTYPES_DEFAULT:
    default:
      return FFI_DEFAULT_ABI;
  }
}

void LibffiCallState::PreparePlan() {
  call_plan_.reset(ffi_call_plan_alloc(&cif_));
}

void LibffiCallState::SetCallConv(CallConv conv) noexcept {
  abi_ = CallConvToFFI(conv);
}

void FFIFunction::PrepareFFITypes() {
  if (ffi_return_type_ != nullptr) {
    return;
  }
  ffi_type* result;
  if (return_type_ == CType::CTYPES_STRUCT && return_struct_info_) {
    result = GetLibffiType(*return_struct_info_);
  } else if (return_type_ == CType::CTYPES_ARRAY && return_array_info_) {
    result = GetLibffiType(*return_array_info_);
  } else {
    result = CTypeToFFI(return_type_);
  }

  std::vector<ffi_type*> arguments;
  arguments.reserve(arg_types_.size());
  for (size_t i = 0; i < arg_types_.size(); i++) {
    if (arg_types_[i] == CType::CTYPES_STRUCT && arg_struct_infos_[i]) {
      arguments.push_back(GetLibffiType(*arg_struct_infos_[i]));
    } else if (arg_types_[i] == CType::CTYPES_ARRAY && arg_array_infos_[i]) {
      arguments.push_back(GetLibffiType(*arg_array_infos_[i]));
    } else {
      arguments.push_back(CTypeToFFI(arg_types_[i]));
    }
  }
  ffi_arg_types_ = std::move(arguments);
  ffi_return_type_ = result;
}

bool FFIFunction::PrepareFFI(Napi::Env env) {
  if (cif_prepared_) {
    return true;
  }
  PrepareFFITypes();
  const ffi_status status = ffi_prep_cif(&cif_, abi_, static_cast<unsigned int>(ffi_arg_types_.size()),
                                         ffi_return_type_, ffi_arg_types_.empty() ? nullptr : ffi_arg_types_.data());
  if (status != FFI_OK) {
    Napi::Error::New(env, "Failed to prepare FFI call interface").ThrowAsJavaScriptException();
    return false;
  }
  cif_prepared_ = true;
  return true;
}

bool FFIFunction::PrepareExtraFFI(Napi::Env env, ExtraCallCache& entry) {
  if (entry.cif_prepared) {
    return true;
  }
  PrepareFFITypes();
  const size_t fixed_args = arg_types_.size();
  entry.ffi_types.resize(entry.total_args);
  std::copy(ffi_arg_types_.begin(), ffi_arg_types_.end(), entry.ffi_types.begin());
  for (size_t i = 0; i < entry.extra_types.size(); i++) {
    entry.ffi_types[fixed_args + i] = CTypeToFFI(entry.extra_types[i]);
  }

  // Senza argtypes sono argomenti fissi; solo il suffisso dopo gli argtypes e' variadico.
  const ffi_status status =
    fixed_args == 0
      ? ffi_prep_cif(&entry.cif, abi_, static_cast<unsigned int>(entry.total_args), ffi_return_type_,
                     entry.ffi_types.data())
      : ffi_prep_cif_var(&entry.cif, abi_, static_cast<unsigned int>(fixed_args),
                         static_cast<unsigned int>(entry.total_args), ffi_return_type_, entry.ffi_types.data());
  if (status != FFI_OK) {
    Napi::Error::New(env, "Failed to prepare variadic FFI call").ThrowAsJavaScriptException();
    return false;
  }
  entry.plan = ffi_call_plan_alloc(&entry.cif);
  entry.cif_prepared = true;
  return true;
}

bool FFIFunction::PrepareAsyncFFI(Napi::Env env,
                                  size_t argc,
                                  std::span<const CType> extra_types,
                                  LibffiAsyncCallState& state) {
  PrepareFFITypes();
  const size_t expected_argc = arg_types_.size();
  auto& owned_cif = state.owned_cif_;
  auto& owned_ffi_types = state.owned_ffi_types_;
  owned_cif = std::make_unique<ffi_cif>();
  owned_ffi_types.resize(argc);
  for (size_t i = 0; i < expected_argc; i++) {
    owned_ffi_types[i] = ffi_arg_types_[i];
  }
  for (size_t i = 0; i < extra_types.size(); i++) {
    owned_ffi_types[expected_argc + i] = CTypeToFFI(extra_types[i]);
  }
  const ffi_status status =
    expected_argc == 0
      ? ffi_prep_cif(owned_cif.get(), abi_, static_cast<unsigned int>(argc), ffi_return_type_, owned_ffi_types.data())
      : ffi_prep_cif_var(owned_cif.get(), abi_, static_cast<unsigned int>(expected_argc),
                         static_cast<unsigned int>(argc), ffi_return_type_, owned_ffi_types.data());
  if (status != FFI_OK) {
    Napi::Error::New(env, "Failed to prepare variadic FFI call for async").ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

}  // namespace ctypes
