#include "layout.h"

namespace ctypes {

// ============================================================================
// StructInfo - Core logic (come CPython StgInfo)
// ============================================================================

StructInfo::StructInfo(bool is_union) : is_union_(is_union), size_(0), alignment_(1) {}

StructInfo::~StructInfo() = default;

size_t StructInfo::GetTypeAlignment(CType type, std::shared_ptr<StructInfo> nested, std::shared_ptr<ArrayInfo> array) {
  if (array) {
    return array->GetAlignment();
  }

  if (nested) {
    return nested->GetAlignment();
  }

  switch (type) {
    case CType::CTYPES_INT8:
    case CType::CTYPES_UINT8:
    case CType::CTYPES_CHAR:
    case CType::CTYPES_BOOL:
      return 1;
    case CType::CTYPES_INT16:
    case CType::CTYPES_UINT16:
      return 2;
    case CType::CTYPES_WCHAR:
      return alignof(wchar_t);  // 2 su Windows, 4 su Unix
    case CType::CTYPES_INT32:
    case CType::CTYPES_UINT32:
    case CType::CTYPES_FLOAT:
      return 4;
    case CType::CTYPES_LONG:
    case CType::CTYPES_ULONG:
      return sizeof(long);  // 4 su Windows (LLP64), 8 su Unix 64-bit (LP64)
    case CType::CTYPES_INT64:
    case CType::CTYPES_UINT64:
    case CType::CTYPES_DOUBLE:
    case CType::CTYPES_POINTER:
    case CType::CTYPES_STRING:
    case CType::CTYPES_WSTRING:
    case CType::CTYPES_SIZE_T:
    case CType::CTYPES_SSIZE_T:
      return sizeof(void*);  // 8 su x64, 4 su x86
    default:
      return 1;
  }
}

void StructInfo::AddField(const std::string& name, CType type, std::shared_ptr<StructInfo> nested, bool is_anonymous) {
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

#if defined(__x86_64__) && !defined(_WIN32)
namespace {

// libffi classifica le struct per i loro elementi e non applica la regola
// System V "campo non allineato → MEMORY"; un elemento più grande di 32 byte è
// sempre MEMORY. size e alignment della struct restano quelli dichiarati (libffi
// non li ricalcola), quindi la copia sullo stack o tramite il puntatore nascosto
// del risultato riguarda solo i byte della struct.
ffi_type* kMemoryClassElements[] = {&ffi_type_uint8, nullptr};
ffi_type kMemoryClassMarker = {64, 1, FFI_TYPE_STRUCT, kMemoryClassElements};

// libffi non ha un tipo union: con i membri come elementi li dispone in
// sequenza e classifica male gli eightbyte (libffi#33; union { double d;
// int64_t i; } finirebbe in un registro SSE invece che INTEGER). Una union è
// descritta come una sequenza di slot di min(allineamento, 8) byte, ognuno
// con la classe System V dei membri che lo coprono: INTEGER se almeno uno è un
// intero o un puntatore, SSE se sono tutti float/double.
enum class SlotClass : uint8_t { kNone, kSse, kInteger };

void ClassifySlots(const StructInfo& info, size_t base, size_t slot_size, std::span<SlotClass> slots);

void ClassifyLeaf(CType type, size_t offset, size_t size, size_t slot_size, std::span<SlotClass> slots) {
  const SlotClass leaf =
    type == CType::CTYPES_FLOAT || type == CType::CTYPES_DOUBLE ? SlotClass::kSse : SlotClass::kInteger;
  for (size_t slot = offset / slot_size; slot < slots.size() && slot * slot_size < offset + size; slot++) {
    slots[slot] = std::max(slots[slot], leaf);
  }
}

void ClassifySlots(const StructInfo& info, size_t base, size_t slot_size, std::span<SlotClass> slots) {
  for (const auto& field : info.GetFields()) {
    const size_t offset = base + field.offset;
    if (field.array_type) {
      const ArrayInfo& array = *field.array_type;
      const size_t element_size = array.GetCount() == 0 ? 0 : array.GetSize() / array.GetCount();
      for (size_t i = 0; i < array.GetCount(); i++) {
        if (const auto element = array.GetElementStruct()) {
          ClassifySlots(*element, offset + i * element_size, slot_size, slots);
        } else {
          ClassifyLeaf(array.GetElementType(), offset + i * element_size, element_size, slot_size, slots);
        }
      }
    } else if (field.struct_type) {
      ClassifySlots(*field.struct_type, offset, slot_size, slots);
    } else {
      ClassifyLeaf(field.type, offset, field.size, slot_size, slots);
    }
  }
}

ffi_type* SlotType(SlotClass slot, size_t slot_size) {
  if (slot == SlotClass::kSse && slot_size == 8) {
    return &ffi_type_double;
  }
  if (slot == SlotClass::kSse && slot_size == 4) {
    return &ffi_type_float;
  }
  switch (slot_size) {
    case 8:
      return &ffi_type_uint64;
    case 4:
      return &ffi_type_uint32;
    case 2:
      return &ffi_type_uint16;
    default:
      return &ffi_type_uint8;
  }
}

}  // namespace
#endif

ffi_type* StructInfo::GetFFIType() {
  if (ffi_type_) {
    return ffi_type_.get();
  }

  ffi_field_types_.clear();
#if defined(__x86_64__) && !defined(_WIN32)
  if (memory_class_) {
    ffi_field_types_ = {&kMemoryClassMarker, nullptr};
    ffi_type_ = std::make_unique<ffi_type>();
    ffi_type_->size = size_;
    ffi_type_->alignment = static_cast<unsigned short>(alignment_);
    ffi_type_->type = FFI_TYPE_STRUCT;
    ffi_type_->elements = ffi_field_types_.data();
    return ffi_type_.get();
  }
  if (is_union_ && size_ > 0) {
    const size_t slot_size = std::min<size_t>(alignment_, 8);
    std::vector<SlotClass> slots(size_ / slot_size, SlotClass::kNone);
    ClassifySlots(*this, 0, slot_size, slots);
    for (const SlotClass slot : slots) {
      ffi_field_types_.push_back(SlotType(slot, slot_size));
    }
    ffi_field_types_.push_back(nullptr);
    ffi_type_ = std::make_unique<ffi_type>();
    ffi_type_->size = size_;
    ffi_type_->alignment = static_cast<unsigned short>(alignment_);
    ffi_type_->type = FFI_TYPE_STRUCT;
    ffi_type_->elements = ffi_field_types_.data();
    return ffi_type_.get();
  }
#endif
  for (const auto& field : fields_) {
    if (field.array_type) {
      ffi_field_types_.push_back(field.array_type->GetFFIType());
    } else if (field.struct_type) {
      ffi_field_types_.push_back(field.struct_type->GetFFIType());
    } else {
      ffi_field_types_.push_back(CTypeToFFI(field.type));
    }
  }

  ffi_field_types_.push_back(nullptr);  // Terminatore

  ffi_type_ = std::make_unique<ffi_type>();
  ffi_type_->size = size_;
  ffi_type_->alignment = static_cast<unsigned short>(alignment_);
  ffi_type_->type = FFI_TYPE_STRUCT;
  ffi_type_->elements = ffi_field_types_.data();

  return ffi_type_.get();
}

bool StructInfo::JSToStruct(Napi::Env env, Napi::Object obj, std::span<uint8_t> buffer) {
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
      if (!field.array_type->JSToArray(env, value, field_bytes)) {
        return false;
      }
    } else if (field.struct_type) {
      // Nested struct
      if (field.is_anonymous) {
        // Anonymous field: leggi i suoi campi direttamente dall'oggetto
        if (!field.struct_type->JSToStruct(env, obj, field_bytes)) {
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
        if (!field.struct_type->JSToStruct(env, value.As<Napi::Object>(), field_bytes)) {
          return false;
        }
      }
    } else {
      // Tipo primitivo
      Napi::Value value = obj.Get(field.name);
      if (value.IsUndefined()) {
        continue;  // campo opzionale
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
  if (element_struct) {
    element_size_ = element_struct->GetSize();
    alignment_ = element_struct->GetAlignment();
  } else {
    element_size_ = CTypeSize(element_type);

    // Alignment dell'elemento
    switch (element_type) {
      case CType::CTYPES_INT8:
      case CType::CTYPES_UINT8:
      case CType::CTYPES_CHAR:
      case CType::CTYPES_BOOL:
        alignment_ = 1;
        break;
      case CType::CTYPES_INT16:
      case CType::CTYPES_UINT16:
        alignment_ = 2;
        break;
      case CType::CTYPES_WCHAR:
        alignment_ = alignof(wchar_t);  // 2 su Windows, 4 su Unix
        break;
      case CType::CTYPES_INT32:
      case CType::CTYPES_UINT32:
      case CType::CTYPES_FLOAT:
        alignment_ = 4;
        break;
      case CType::CTYPES_LONG:
      case CType::CTYPES_ULONG:
        alignment_ = sizeof(long);  // 4 su Windows (LLP64), 8 su Unix 64-bit (LP64)
        break;
      case CType::CTYPES_INT64:
      case CType::CTYPES_UINT64:
      case CType::CTYPES_DOUBLE:
      case CType::CTYPES_POINTER:
      case CType::CTYPES_STRING:
      case CType::CTYPES_WSTRING:
      case CType::CTYPES_SIZE_T:
      case CType::CTYPES_SSIZE_T:
        alignment_ = sizeof(void*);
        break;
      default:
        alignment_ = 1;
    }
  }

  size_ = element_size_ * count_;
}

ArrayInfo::~ArrayInfo() = default;

ffi_type* ArrayInfo::GetFFIType() {
  if (ffi_type_) {
    return ffi_type_.get();
  }

  // Array è rappresentato in libffi come struct con elementi ripetuti
  ffi_element_types_.clear();
  ffi_element_types_.reserve(count_ + 1);

  ffi_type* element_ffi;
  if (element_struct_) {
    element_ffi = element_struct_->GetFFIType();
  } else {
    element_ffi = CTypeToFFI(element_type_);
  }

  // Ripeti element_ffi count_ volte
  for (size_t i = 0; i < count_; i++) {
    ffi_element_types_.push_back(element_ffi);
  }
  // Terminator NULL
  ffi_element_types_.push_back(nullptr);

  // Crea ffi_type
  ffi_type_ = std::make_unique<ffi_type>();
  ffi_type_->size = size_;
  ffi_type_->alignment = static_cast<unsigned short>(alignment_);
  ffi_type_->type = FFI_TYPE_STRUCT;  // Array come struct
  ffi_type_->elements = ffi_element_types_.data();

  return ffi_type_.get();
}

bool ArrayInfo::JSToArray(Napi::Env env, Napi::Value val, std::span<uint8_t> buffer) {
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
      Napi::Value elem = arr.Get(i);
      const std::span<uint8_t> elem_bytes = bytes.subspan(i * element_size_, element_size_);

      if (element_struct_) {
        // Element è struct
        if (elem.IsObject()) {
          if (!element_struct_->JSToStruct(env, elem.As<Napi::Object>(), elem_bytes)) {
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
      arr.Set(i, element_struct_->StructToJS(env, elem_ptr));
    } else {
      // Element è tipo primitivo
      arr.Set(i, CToJS(env, elem_ptr, element_type_));
    }
  }

  return arr;
}

}  // namespace ctypes
