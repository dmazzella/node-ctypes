#pragma once

#include "layout.h"
#include "shared.h"
#include "types.h"

namespace ctypes {

// Wrapper Napi per esporre struct a JavaScript
class StructType : public Napi::ObjectWrap<StructType> {
 public:
  static constexpr napi_type_tag kTypeTag{0xa02e219576529b8cULL, 0x3af335d5ea3c4a5fULL};
  static Napi::Function GetClass(Napi::Env env);

  StructType(const Napi::CallbackInfo& info);

  // Metodi JS
  Napi::Value AddField(const Napi::CallbackInfo& info);
  Napi::Value GetSize(const Napi::CallbackInfo& info);
  Napi::Value GetAlignment(const Napi::CallbackInfo& info);
  Napi::Value Create(const Napi::CallbackInfo& info);    // crea istanza struct
  Napi::Value Read(const Napi::CallbackInfo& info);      // legge struct da buffer
  Napi::Value ToObject(const Napi::CallbackInfo& info);  // converte buffer in plain object

  std::shared_ptr<StructInfo> GetStructInfo() const { return struct_info_; }

 private:
  std::shared_ptr<StructInfo> struct_info_;
  bool is_union_;
};

}  // namespace ctypes
