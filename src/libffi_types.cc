#include "libffi_types.h"

namespace ctypes {

#if defined(__x86_64__) && !defined(_WIN32)
namespace {

// Un elemento oltre 32 byte forza MEMORY senza alterare dimensione e allineamento dichiarati.
ffi_type* kMemoryClassElements[] = {&ffi_type_uint8, nullptr};
ffi_type kMemoryClassMarker = {64, 1, FFI_TYPE_STRUCT, kMemoryClassElements};

// Ogni eightbyte di una union prende la classe INTEGER se almeno un membro la richiede.
enum class SlotClass : uint8_t { kNone, kSse, kInteger };

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

ffi_type* GetLibffiType(StructInfo& info) {
  info.Finalize();
  auto& cache = info.GetLibffiTypeCache();
  if (cache.type) {
    return cache.type.get();
  }

  cache.elements.clear();
#if defined(__x86_64__) && !defined(_WIN32)
  if (info.HasMemoryClass()) {
    cache.elements = {&kMemoryClassMarker, nullptr};
    cache.type = std::make_unique<ffi_type>();
    cache.type->size = info.GetSize();
    cache.type->alignment = static_cast<unsigned short>(info.GetAlignment());
    cache.type->type = FFI_TYPE_STRUCT;
    cache.type->elements = cache.elements.data();
    return cache.type.get();
  }
  if (info.IsUnion() && info.GetSize() > 0) {
    const size_t slot_size = std::min<size_t>(info.GetAlignment(), 8);
    std::vector<SlotClass> slots(info.GetSize() / slot_size, SlotClass::kNone);
    ClassifySlots(info, 0, slot_size, slots);
    for (const SlotClass slot : slots) {
      cache.elements.push_back(SlotType(slot, slot_size));
    }
    cache.elements.push_back(nullptr);
    cache.type = std::make_unique<ffi_type>();
    cache.type->size = info.GetSize();
    cache.type->alignment = static_cast<unsigned short>(info.GetAlignment());
    cache.type->type = FFI_TYPE_STRUCT;
    cache.type->elements = cache.elements.data();
    return cache.type.get();
  }
#endif
  for (const auto& field : info.GetFields()) {
    if (field.array_type) {
      cache.elements.push_back(GetLibffiType(*field.array_type));
    } else if (field.struct_type) {
      cache.elements.push_back(GetLibffiType(*field.struct_type));
    } else {
      cache.elements.push_back(CTypeToFFI(field.type));
    }
  }

  cache.elements.push_back(nullptr);
  cache.type = std::make_unique<ffi_type>();
  cache.type->size = info.GetSize();
  cache.type->alignment = static_cast<unsigned short>(info.GetAlignment());
  cache.type->type = FFI_TYPE_STRUCT;
  cache.type->elements = cache.elements.data();
  return cache.type.get();
}

ffi_type* GetLibffiType(ArrayInfo& info) {
  info.Finalize();
  auto& cache = info.GetLibffiTypeCache();
  if (cache.type) {
    return cache.type.get();
  }

  cache.elements.clear();
  cache.elements.reserve(info.GetCount() + 1);
  ffi_type* element_ffi;
  if (const auto element = info.GetElementStruct()) {
    element_ffi = GetLibffiType(*element);
  } else {
    element_ffi = CTypeToFFI(info.GetElementType());
  }

  for (size_t i = 0; i < info.GetCount(); i++) {
    cache.elements.push_back(element_ffi);
  }
  cache.elements.push_back(nullptr);
  cache.type = std::make_unique<ffi_type>();
  cache.type->size = info.GetSize();
  cache.type->alignment = static_cast<unsigned short>(info.GetAlignment());
  cache.type->type = FFI_TYPE_STRUCT;
  cache.type->elements = cache.elements.data();
  return cache.type.get();
}

}  // namespace ctypes
