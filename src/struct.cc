#include "struct.h"

#include "array.h"

namespace ctypes {
// ============================================================================
// StructType - Napi wrapper
// ============================================================================

Napi::Function StructType::GetClass(Napi::Env env) {
  return DefineClass(env, "StructType",
                     {
                       InstanceMethod("addField", &StructType::AddField),
                       InstanceMethod("getSize", &StructType::GetSize),
                       InstanceMethod("getAlignment", &StructType::GetAlignment),
                       InstanceMethod("create", &StructType::Create),
                       InstanceMethod("read", &StructType::Read),
                       InstanceMethod("toObject", &StructType::ToObject),
                     });
}

StructType::StructType(const Napi::CallbackInfo& info) : Napi::ObjectWrap<StructType>(info) {
  info.This().As<Napi::Object>().TypeTag(&kTypeTag);

  // Opzionale: { union: true, alignment: N, memoryClass: true }
  is_union_ = false;
  bool memory_class = false;
  size_t min_alignment = 1;
  if (info.Length() > 0 && info[0].IsObject()) {
    Napi::Object options = info[0].As<Napi::Object>();
    if (options.Has("union")) {
      is_union_ = options.Get("union").ToBoolean();
    }
    if (options.Has("memoryClass")) {
      memory_class = options.Get("memoryClass").ToBoolean();
    }
    Napi::Value alignment = options.Get("alignment");
    if (alignment.IsNumber()) {
      const int64_t value = alignment.As<Napi::Number>().Int64Value();
      if (alignment.As<Napi::Number>().DoubleValue() != static_cast<double>(value) || value < 1 || value > 1 << 15 ||
          (value & (value - 1)) != 0) {
        throw Napi::RangeError::New(info.Env(), "alignment must be a power of two between 1 and 32768");
      }
      min_alignment = static_cast<size_t>(value);
    }
  }

  struct_info_ = std::make_shared<StructInfo>(is_union_);
  struct_info_->SetMinimumAlignment(min_alignment);
  struct_info_->SetMemoryClass(memory_class);
}

void StructType::EnsureMutable(Napi::Env env) const {
  if (struct_info_->IsFinalized()) {
    throw Napi::TypeError::New(env, StructInfo::kFinalizedError);
  }
}

Napi::Value StructType::AddField(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  EnsureMutable(env);

  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected (name, type)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string name = info[0].As<Napi::String>().Utf8Value();

  bool is_anonymous = false;

  // Terzo parametro opzionale: { anonymous: true }
  if (info.Length() > 2 && info[2].IsObject()) {
    Napi::Object options = info[2].As<Napi::Object>();
    if (options.Has("anonymous")) {
      is_anonymous = options.Get("anonymous").ToBoolean();
    }
  }

  const TypeSpec spec = TypeSpecFromJS(info[1]);
  EnsureMutable(env);
  if (spec.struct_info == struct_info_) {
    throw Napi::TypeError::New(env, "A structure cannot contain itself by value");
  }
  const std::shared_ptr<ArrayInfo>& array = spec.array_info;

  if (array) {
    struct_info_->AddArrayField(name, array);
  } else {
    struct_info_->AddField(name, spec.type, spec.struct_info, is_anonymous);
  }
  struct_info_->CalculateLayout();

  return info.This();
}

Napi::Value StructType::GetSize(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(struct_info_->GetSize()));
}

Napi::Value StructType::GetAlignment(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(struct_info_->GetAlignment()));
}

Napi::Value StructType::Create(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  struct_info_->Finalize();

  // Crea buffer interno
  size_t size = struct_info_->GetSize();
  Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::New(env, size);

  if (info.Length() > 0 && info[0].IsObject()) {
    if (!struct_info_->JSToStruct(env, info[0].As<Napi::Object>(), std::span(buffer.Data(), size))) {
      return env.Undefined();
    }
  } else {
    std::memset(buffer.Data(), 0, size);
  }

  // Crea oggetto JS con accessor per ogni campo
  Napi::Object obj = Napi::Object::New(env);

  // Aggiungi campo dati interno (nascosto)
  obj.Set("_buffer", buffer);

  // Per ogni campo, aggiungi getter/setter. Il Buffer è letto da `_buffer` a
  // ogni accesso: un Napi::Buffer catturato sarebbe un handle valido solo
  // dentro questa chiamata.
  for (const auto& field : struct_info_->GetFields()) {
    std::string fieldName = field.name;

    auto field_data = [](const Napi::CallbackInfo& info, size_t offset, size_t size) -> uint8_t* {
      Napi::Value value = info.This().As<Napi::Object>().Get("_buffer");
      if (!value.IsBuffer() || value.As<Napi::Buffer<uint8_t>>().Length() < offset + size) {
        throw Napi::TypeError::New(info.Env(), "Invalid struct buffer");
      }
      return value.As<Napi::Buffer<uint8_t>>().Data() + offset;
    };

    // Getter
    auto getter = [field_data, offset = field.offset, size = field.size,
                   type = field.type](const Napi::CallbackInfo& info) -> Napi::Value {
      return CToJS(info.Env(), field_data(info, offset, size), type);
    };

    // Setter
    auto setter = [field_data, offset = field.offset, size = field.size, type = field.type,
                   name = field.name](const Napi::CallbackInfo& info) -> Napi::Value {
      if (info.Length() > 0 && JSToC(info[0], type, std::span(field_data(info, offset, size), size)) < 0) {
        throw Napi::TypeError::New(info.Env(), std::format("Cannot assign field '{}'", name));
      }
      return info.Env().Undefined();
    };

    Napi::PropertyDescriptor desc =
      Napi::PropertyDescriptor::Accessor(env, obj, fieldName, getter, setter, napi_default, nullptr);
    obj.DefineProperty(desc);
  }

  return obj;
}

Napi::Value StructType::ReadBuffer(const Napi::Buffer<uint8_t>& buffer) {
  if (buffer.Length() < struct_info_->GetSize()) {
    throw Napi::RangeError::New(buffer.Env(), "Buffer too small for struct");
  }
  struct_info_->Finalize();
  return struct_info_->StructToJS(buffer.Env(), buffer.Data());
}

Napi::Value StructType::Read(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected a Buffer").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
  return ReadBuffer(buffer);
}

Napi::Value StructType::ToObject(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected at least one argument").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Value arg = info[0];

  // Se è un buffer, convertilo direttamente
  if (arg.IsBuffer()) {
    Napi::Buffer<uint8_t> buffer = arg.As<Napi::Buffer<uint8_t>>();
    return ReadBuffer(buffer);
  }

  // Se è un oggetto con _buffer, estrai il buffer — single Get()
  if (arg.IsObject()) {
    Napi::Value bufferVal = arg.As<Napi::Object>().Get("_buffer");
    if (bufferVal.IsBuffer()) {
      Napi::Buffer<uint8_t> buffer = bufferVal.As<Napi::Buffer<uint8_t>>();
      return ReadBuffer(buffer);
    }
  }

  Napi::TypeError::New(env, "Expected a Buffer or struct instance").ThrowAsJavaScriptException();
  return env.Undefined();
}

}  // namespace ctypes
