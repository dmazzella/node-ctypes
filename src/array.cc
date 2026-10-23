#include "array.h"

#include "struct.h"

namespace ctypes {

// ============================================================================
// ArrayType - Napi wrapper
// ============================================================================

TypeSpec TypeSpecFromJS(const Napi::Value& value) {
  if (value.IsNumber()) {
    return {.type = CTypeFromJS(value)};
  }
  if (const StructType* st = UnwrapTagged<StructType>(value)) {
    return {.type = CType::CTYPES_STRUCT, .struct_info = st->GetStructInfo()};
  }
  const ArrayType* at = UnwrapTagged<ArrayType>(value);
  if (at == nullptr && value.IsObject()) {
    // Wrapper JS di array(): il tipo nativo è `_native`.
    at = UnwrapTagged<ArrayType>(value.As<Napi::Object>().Get("_native"));
  }
  if (at != nullptr) {
    return {.type = CType::CTYPES_ARRAY, .array_info = at->GetArrayInfo()};
  }
  throw Napi::TypeError::New(value.Env(), "Type must be a CType enum value (number), StructType or ArrayType");
}

Napi::Function ArrayType::GetClass(Napi::Env env) {
  return DefineClass(env, "ArrayType",
                     {
                       InstanceMethod("getSize", &ArrayType::GetSize),
                       InstanceMethod("getLength", &ArrayType::GetLength),
                       InstanceMethod("getAlignment", &ArrayType::GetAlignment),
                       InstanceMethod("create", &ArrayType::Create),
                     });
}

ArrayType::ArrayType(const Napi::CallbackInfo& info) : Napi::ObjectWrap<ArrayType>(info) {
  Napi::Env env = info.Env();
  info.This().As<Napi::Object>().TypeTag(&kTypeTag);

  if (info.Length() < 2) {
    Napi::TypeError::New(env, "ArrayType requires (element_type, count)").ThrowAsJavaScriptException();
    return;
  }

  // Elementi primitivi o struct (un array di array è un array di byte in JS).
  const TypeSpec element = TypeSpecFromJS(info[0]);
  if (element.array_info) {
    throw Napi::TypeError::New(env, "Invalid element type");
  }
  const CType element_type = element.type;
  const std::shared_ptr<StructInfo>& element_struct = element.struct_info;

  // Parse count: intero non negativo, con dimensione totale rappresentabile.
  if (!info[1].IsNumber()) {
    throw Napi::TypeError::New(env, "Array length must be a number");
  }
  const double length = info[1].As<Napi::Number>().DoubleValue();
  const size_t element_size = element_struct ? element_struct->GetSize() : CTypeSize(element_type);
  if (!(length >= 0) || length != std::floor(length) || length > 9007199254740991.0 ||
      (element_size != 0 && length > static_cast<double>(SIZE_MAX / 2 / element_size))) {
    throw Napi::RangeError::New(env, "Invalid array length");
  }
  size_t count = static_cast<size_t>(length);

  array_info_ = std::make_shared<ArrayInfo>(element_type, count, element_struct);
}

Napi::Value ArrayType::GetSize(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), array_info_->GetSize());
}

Napi::Value ArrayType::GetLength(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), array_info_->GetCount());
}

Napi::Value ArrayType::GetAlignment(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), array_info_->GetAlignment());
}

Napi::Value ArrayType::Create(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  size_t size = array_info_->GetSize();
  Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::New(env, size);

  if (info.Length() > 0) {
    if (!array_info_->JSToArray(env, info[0], std::span(buffer.Data(), size))) {
      return env.Undefined();
    }
  } else {
    std::memset(buffer.Data(), 0, size);
  }

  return buffer;
}

}  // namespace ctypes
