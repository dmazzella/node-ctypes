#include "layout.h"

namespace ctypes {

// ============================================================================
// StructInfo - Core logic (come CPython StgInfo)
// ============================================================================

StructInfo::StructInfo(bool is_union) : is_union_(is_union), size_(0), alignment_(1) {}

StructInfo::~StructInfo() = default;

void StructInfo::EnsureMutable() const {
  if (finalized_) {
    throw std::logic_error(kFinalizedError);
  }
}

void StructInfo::Finalize() {
  if (finalized_) {
    return;
  }
  CalculateLayout();
  finalized_ = true;
  for (const auto& field : fields_) {
    if (field.struct_type) {
      field.struct_type->Finalize();
    }
    if (field.array_type) {
      field.array_type->Finalize();
    }
  }
}

size_t StructInfo::GetTypeAlignment(CType type, std::shared_ptr<StructInfo> nested, std::shared_ptr<ArrayInfo> array) {
  if (array) {
    return array->GetAlignment();
  }

  if (nested) {
    return nested->GetAlignment();
  }

  return CTypeAlignment(type);
}

void StructInfo::AddField(const std::string& name, CType type, std::shared_ptr<StructInfo> nested, bool is_anonymous) {
  EnsureMutable();
  if (nested.get() == this) {
    throw std::invalid_argument("A structure cannot contain itself by value");
  }
  if (nested) {
    nested->Finalize();
  }
  FieldInfo field;
  field.name = name;
  field.type = type;
  field.struct_type = nested;
  field.array_type = nullptr;
  field.is_anonymous = is_anonymous;

  if (nested) {
    field.size = nested->GetSize();
  } else {
    field.size = CTypeSize(type);
  }

  fields_.push_back(field);
}

void StructInfo::AddArrayField(const std::string& name, std::shared_ptr<ArrayInfo> array_type) {
  EnsureMutable();
  array_type->Finalize();
  FieldInfo field;
  field.name = name;
  field.type = CType::CTYPES_ARRAY;
  field.struct_type = nullptr;
  field.array_type = array_type;
  field.size = array_type->GetSize();
  field.is_anonymous = false;

  fields_.push_back(field);
}

void StructInfo::CalculateLayout() {
  EnsureMutable();
  if (fields_.empty()) {
    size_ = 0;
    alignment_ = min_alignment_;
    return;
  }

  size_t current_offset = 0;
  size_t max_alignment = min_alignment_;

  for (auto& field : fields_) {
    size_t field_alignment = GetTypeAlignment(field.type, field.struct_type, field.array_type);
    max_alignment = std::max(max_alignment, field_alignment);

    if (is_union_) {
      // Union: tutti i campi allo stesso offset 0
      field.offset = 0;
    } else {
      // Struct: allinea offset al boundary del tipo
      size_t padding = (field_alignment - (current_offset % field_alignment)) % field_alignment;
      current_offset += padding;
      field.offset = current_offset;
      current_offset += field.size;
    }
  }

  alignment_ = max_alignment;

  if (is_union_) {
    // Union: size = max(field sizes)
    size_ = 0;
    for (const auto& field : fields_) {
      size_ = std::max(size_, field.size);
    }
  } else {
    // Struct: size = offset finale + padding finale
    size_ = current_offset;
  }

  // Padding finale per allineare la struct stessa
  size_t final_padding = (alignment_ - (size_ % alignment_)) % alignment_;
  size_ += final_padding;
}

bool StructInfo::JSToStruct(Napi::Env env,
                            Napi::Object obj,
                            std::span<uint8_t> buffer,
                            std::vector<Napi::ObjectReference>* owners) {
  if (buffer.size() < size_) {
    Napi::TypeError::New(env, "Buffer too small for struct").ThrowAsJavaScriptException();
    return false;
  }

  // Inizializza buffer a zero
  std::ranges::fill(buffer.first(size_), uint8_t{0});

  // Copia ogni campo
  for (const auto& field : fields_) {
    const std::span<uint8_t> field_bytes = buffer.subspan(field.offset, field.size);

    if (field.array_type) {
      // Array field — single Get() + undefined test evita il doppio
      // V8-crossing di Has()+Get().
      Napi::Value value = obj.Get(field.name);
      if (value.IsUndefined()) {
        continue;  // campo opzionale
      }
      if (owners && value.IsObject()) {
        owners->push_back(Napi::Persistent(value.As<Napi::Object>()));
      }
      if (!field.array_type->JSToArray(env, value, field_bytes, owners)) {
        return false;
      }
    } else if (field.struct_type) {
      // Nested struct
      if (field.is_anonymous) {
        // Anonymous field: leggi i suoi campi direttamente dall'oggetto
        if (!field.struct_type->JSToStruct(env, obj, field_bytes, owners)) {
          return false;
        }
      } else {
        Napi::Value value = obj.Get(field.name);
        if (value.IsUndefined()) {
          continue;  // campo opzionale
        }
        if (!value.IsObject()) {
          Napi::TypeError::New(env, std::format("Field {} must be an object", field.name)).ThrowAsJavaScriptException();
          return false;
        }
        if (owners) {
          owners->push_back(Napi::Persistent(value.As<Napi::Object>()));
        }
        if (!field.struct_type->JSToStruct(env, value.As<Napi::Object>(), field_bytes, owners)) {
          return false;
        }
      }
    } else {
      // Tipo primitivo
      Napi::Value value = obj.Get(field.name);
      if (value.IsUndefined()) {
        continue;  // campo opzionale
      }
      if (owners && value.IsObject()) {
        owners->push_back(Napi::Persistent(value.As<Napi::Object>()));
      }
      if (JSToC(value, field.type, field_bytes) < 0) {
        return false;
      }
    }
  }

  return true;
}

Napi::Object StructInfo::StructToJS(Napi::Env env, const void* buffer) {
  Napi::Object obj = Napi::Object::New(env);
  WriteFieldsTo(env, buffer, obj);
  return obj;
}

void StructInfo::WriteFieldsTo(Napi::Env env, const void* buffer, Napi::Object obj) {
  for (const auto& field : fields_) {
    const void* field_ptr = static_cast<const char*>(buffer) + field.offset;

    if (field.array_type) {
      obj.Set(field.name, field.array_type->ArrayToJS(env, field_ptr));
    } else if (field.struct_type) {
      if (field.is_anonymous) {
        // Scrivi i sotto-campi direttamente nell'obj esterno: evita di
        // creare un oggetto intermedio, enumerarne le chiavi e ricopiarle
        // una a una (GetPropertyNames + N Get/Set coppie V8↔C++).
        field.struct_type->WriteFieldsTo(env, field_ptr, obj);
      } else {
        obj.Set(field.name, field.struct_type->StructToJS(env, field_ptr));
      }
    } else {
      obj.Set(field.name, CToJS(env, field_ptr, field.type));
    }
  }
}

// ============================================================================
// ArrayInfo - Core logic
// ============================================================================

ArrayInfo::ArrayInfo(CType element_type, size_t count, std::shared_ptr<StructInfo> element_struct)
  : element_type_(element_type), count_(count), element_struct_(element_struct) {
  Finalize();
  if (element_struct) {
    element_size_ = element_struct->GetSize();
    alignment_ = element_struct->GetAlignment();
  } else {
    element_size_ = CTypeSize(element_type);

    alignment_ = CTypeAlignment(element_type);
  }

  size_ = element_size_ * count_;
}

ArrayInfo::~ArrayInfo() = default;

void ArrayInfo::Finalize() {
  if (element_struct_) {
    element_struct_->Finalize();
  }
}

bool ArrayInfo::JSToArray(Napi::Env env,
                          Napi::Value val,
                          std::span<uint8_t> buffer,
                          std::vector<Napi::ObjectReference>* owners) {
  if (buffer.size() < size_) {
    Napi::TypeError::New(env, "Buffer too small for array").ThrowAsJavaScriptException();
    return false;
  }
  const std::span<uint8_t> bytes = buffer.first(size_);
  std::ranges::fill(bytes, uint8_t{0});

  if (val.IsArray()) {
    Napi::Array arr = val.As<Napi::Array>();
    const size_t copy_len = std::min<size_t>(arr.Length(), count_);

    for (size_t i = 0; i < copy_len; i++) {
      Napi::Value elem = arr.Get(static_cast<uint32_t>(i));
      if (owners && elem.IsObject()) {
        owners->push_back(Napi::Persistent(elem.As<Napi::Object>()));
      }
      const std::span<uint8_t> elem_bytes = bytes.subspan(i * element_size_, element_size_);

      if (element_struct_) {
        // Element è struct
        if (elem.IsObject()) {
          if (!element_struct_->JSToStruct(env, elem.As<Napi::Object>(), elem_bytes, owners)) {
            return false;
          }
        } else if (elem.IsBuffer()) {
          Napi::Buffer<uint8_t> buf = elem.As<Napi::Buffer<uint8_t>>();
          if (buf.Length() >= element_size_) {
            std::ranges::copy_n(buf.Data(), element_size_, elem_bytes.begin());
          }
        }
      } else {
        // Element è tipo primitivo
        if (JSToC(elem, element_type_, elem_bytes) < 0) {
          return false;
        }
      }
    }
  } else if (val.IsBuffer()) {
    // Buffer già pronto
    Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
    std::ranges::copy_n(buf.Data(), std::min(buf.Length(), size_), bytes.begin());
  } else if (val.IsString() && (element_type_ == CType::CTYPES_INT8 || element_type_ == CType::CTYPES_CHAR)) {
    // Stringa → char array
    const std::string str = val.As<Napi::String>().Utf8Value();
    if (count_ > 0) {
      const size_t copy_len = std::min(str.length(), count_ - 1);
      std::ranges::copy_n(reinterpret_cast<const uint8_t*>(str.data()), copy_len, bytes.begin());
      bytes[copy_len] = 0;
    }
  } else {
    Napi::TypeError::New(env, "Expected array, buffer, or string").ThrowAsJavaScriptException();
    return false;
  }

  return true;
}

Napi::Array ArrayInfo::ArrayToJS(Napi::Env env, const void* buffer) {
  Napi::Array arr = Napi::Array::New(env, count_);

  for (size_t i = 0; i < count_; i++) {
    const void* elem_ptr = static_cast<const char*>(buffer) + (i * element_size_);

    if (element_struct_) {
      // Element è struct
      arr.Set(static_cast<uint32_t>(i), element_struct_->StructToJS(env, elem_ptr));
    } else {
      // Element è tipo primitivo
      arr.Set(static_cast<uint32_t>(i), CToJS(env, elem_ptr, element_type_));
    }
  }

  return arr;
}

}  // namespace ctypes
