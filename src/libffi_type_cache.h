#pragma once

#include <ffi.h>

#include <memory>
#include <vector>

namespace ctypes {

struct LibffiAggregateType {
  std::unique_ptr<ffi_type> type;
  std::vector<ffi_type*> elements;

  void Reset() noexcept { type.reset(); }
};

}  // namespace ctypes
