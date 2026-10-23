#pragma once

#include "layout.h"
#include "shared.h"
#include "types.h"

namespace ctypes {

// Wrapper Napi per esporre array a JavaScript
class ArrayType : public Napi::ObjectWrap<ArrayType> {
 public:
  static constexpr napi_type_tag kTypeTag{0x98984d3f16325cbaULL, 0x7a6208b182764014ULL};
  static Napi::Function GetClass(Napi::Env env);

  ArrayType(const Napi::CallbackInfo& info);

  // Metodi JS
  Napi::Value GetSize(const Napi::CallbackInfo& info);
  Napi::Value GetLength(const Napi::CallbackInfo& info);
  Napi::Value GetAlignment(const Napi::CallbackInfo& info);
  Napi::Value Create(const Napi::CallbackInfo& info);  // crea buffer array

  std::shared_ptr<ArrayInfo> GetArrayInfo() const { return array_info_; }

 private:
  std::shared_ptr<ArrayInfo> array_info_;
};

// Tipo di un argomento, di un valore restituito o di un campo: un CType
// primitivo (numero dell'enum), una struct/union (StructType) o un array
// (ArrayType, anche il wrapper JS di array() tramite `_native`).
struct TypeSpec {
  CType type = CType::CTYPES_VOID;
  std::shared_ptr<StructInfo> struct_info{};
  std::shared_ptr<ArrayInfo> array_info{};
};

// TypeSpec di un valore JS; TypeError se non è un tipo.
[[nodiscard]] TypeSpec TypeSpecFromJS(const Napi::Value& value);

}  // namespace ctypes
