#include "libffi_callback.h"

#include "callback.h"
#include "libffi_call.h"

namespace ctypes {

bool LibffiCallbackState::PrepareCIF(Napi::Env env, CType result, std::span<const TypeSpec> args, CallConv conv) {
  ffi_return_type = CTypeToFFI(result);
  for (const auto& type : args) {
    ffi_arg_types.push_back(type.struct_info ? GetLibffiType(*type.struct_info) : CTypeToFFI(type.type));
  }
  const ffi_status status = ffi_prep_cif(&cif, CallConvToFFI(conv), static_cast<unsigned int>(ffi_arg_types.size()),
                                         ffi_return_type, ffi_arg_types.empty() ? nullptr : ffi_arg_types.data());
  if (status != FFI_OK) {
    Napi::Error::New(env, "Failed to prepare callback CIF").ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

bool LibffiCallbackState::AllocateClosure(void*& code_ptr) {
  closure.reset(static_cast<ffi_closure*>(ffi_closure_alloc(sizeof(ffi_closure), &code_ptr)));
  return closure != nullptr;
}

bool LibffiCallbackState::PrepareClosure(LibffiClosureHandler handler, void* context, void* code_ptr) {
  return ffi_prep_closure_loc(closure.get(), &cif, handler, context, code_ptr) == FFI_OK;
}

void LibffiCallbackHandler(ffi_cif*, void* ret, void** args, void* user_data) {
  DispatchCallback(static_cast<CallbackData*>(user_data), ret, args);
}

void LibffiThreadSafeCallbackHandler(ffi_cif*, void* ret, void** args, void* user_data) {
  DispatchThreadSafeNative(static_cast<ThreadSafeCallbackState*>(user_data), ret, args);
}

}  // namespace ctypes
