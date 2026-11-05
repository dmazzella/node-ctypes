#pragma once

#include "array.h"
#include "libffi_types.h"

namespace ctypes {

struct ClosureDeleter {
  void operator()(ffi_closure* closure) const noexcept { ffi_closure_free(closure); }
};
using ClosureHandle = std::unique_ptr<ffi_closure, ClosureDeleter>;
using LibffiClosureHandler = void (*)(ffi_cif*, void*, void**, void*);

struct LibffiCallbackState {
  ClosureHandle closure;
  ffi_cif cif;
  std::vector<ffi_type*> ffi_arg_types;
  ffi_type* ffi_return_type = nullptr;

  [[nodiscard]] bool PrepareCIF(Napi::Env env, CType result, std::span<const TypeSpec> args, CallConv conv);
  [[nodiscard]] bool AllocateClosure(void*& code_ptr);
  [[nodiscard]] bool PrepareClosure(LibffiClosureHandler handler, void* context, void* code_ptr);
};

void LibffiCallbackHandler(ffi_cif*, void* ret, void** args, void* user_data);
void LibffiThreadSafeCallbackHandler(ffi_cif*, void* ret, void** args, void* user_data);

}  // namespace ctypes
