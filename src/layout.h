#pragma once

// Descrittori dei tipi C composti: layout, ffi_type e conversioni JS <-> C di
// struct, union e array. I wrapper JS (StructType, ArrayType) sono in
// struct.h e array.h.

#include "shared.h"
#include "types.h"

namespace ctypes {

// StructInfo - layout di una struct/union (come CPython StgInfo).
// I campi di una struct possono essere array e gli elementi di un array
// possono essere struct: ArrayInfo e FieldInfo sono definiti dentro
// StructInfo, dove il nome StructInfo è già dichiarato.
class StructInfo {
 public:
  // ArrayInfo - array a dimensione fissa (come c_int * 5 in Python)
  class ArrayInfo {
   public:
    ArrayInfo(CType element_type, size_t count, std::shared_ptr<StructInfo> element_struct = nullptr);
    ~ArrayInfo();

    // Getter
    CType GetElementType() const { return element_type_; }
    size_t GetCount() const { return count_; }
    size_t GetSize() const { return size_; }
    size_t GetAlignment() const { return alignment_; }
    std::shared_ptr<StructInfo> GetElementStruct() const { return element_struct_; }

    void Finalize();

    // Crea ffi_type custom per questo array
    [[nodiscard]] ffi_type* GetFFIType();

    // Converte JS array → C array buffer
    [[nodiscard]] bool JSToArray(Napi::Env env, Napi::Value val, std::span<uint8_t> buffer,
                                std::vector<Napi::ObjectReference>* owners = nullptr);

    // Converte C array buffer → JS array
    Napi::Array ArrayToJS(Napi::Env env, const void* buffer);

   private:
    CType element_type_;
    size_t count_;
    size_t element_size_;
    size_t size_;  // count * element_size
    size_t alignment_;
    std::shared_ptr<StructInfo> element_struct_;  // Se element_type == STRUCT
    std::unique_ptr<ffi_type> ffi_type_;
    std::vector<ffi_type*> ffi_element_types_;  // Per ffi_type.elements
  };

  // Field descriptor - singolo campo di struct/union
  struct FieldInfo {
    std::string name;
    CType type;
    size_t offset;                            // offset in bytes dall'inizio della struct
    size_t size;                              // dimensione del campo
    std::shared_ptr<StructInfo> struct_type;  // per nested structs
    std::shared_ptr<ArrayInfo> array_type;    // per array fields
    bool is_anonymous;                        // se true, i suoi campi sono accessibili direttamente
  };

  StructInfo(bool is_union = false);
  ~StructInfo();

  static constexpr const char* kFinalizedError = "Type is finalized; create a new StructType to change its layout";
  void Finalize();
  bool IsFinalized() const { return finalized_; }

  // Aggiunge un campo e ricalcola layout
  void AddField(const std::string& name,
                CType type,
                std::shared_ptr<StructInfo> nested = nullptr,
                bool is_anonymous = false);

  // Aggiunge un campo array
  void AddArrayField(const std::string& name, std::shared_ptr<ArrayInfo> array_type);

  // Calcola offsets e padding (seguendo regole platform ABI)
  void CalculateLayout();

  // Allineamento minimo (Python `_align_`, o il tipo base dei bitfield
  // rappresentati come byte): la struct ha almeno questo allineamento.
  void SetMinimumAlignment(size_t alignment) {
    EnsureMutable();
    min_alignment_ = std::max<size_t>(alignment, 1);
    CalculateLayout();
  }

  // Struct con campi non allineati (`_pack_`): l'ABI x86-64 System V la passa
  // e la restituisce in memoria (classe MEMORY), come fanno GCC e clang.
  void SetMemoryClass(bool memory_class) {
    EnsureMutable();
    memory_class_ = memory_class;
    ffi_type_.reset();
  }

  // Getter
  size_t GetSize() const { return size_; }
  size_t GetAlignment() const { return alignment_; }
  const std::vector<FieldInfo>& GetFields() const { return fields_; }
  bool IsUnion() const { return is_union_; }

  // Crea ffi_type custom per questa struct (necessario per libffi)
  ffi_type* GetFFIType();

  // Converte JS object -> C struct buffer
  [[nodiscard]] bool JSToStruct(Napi::Env env, Napi::Object obj, std::span<uint8_t> buffer,
                               std::vector<Napi::ObjectReference>* owners = nullptr);

  // Converte C struct buffer -> JS object
  [[nodiscard]] Napi::Object StructToJS(Napi::Env env, const void* buffer);

  // Scrive i campi direttamente in un oggetto esistente. Usato dal path
  // _anonymous_ per evitare oggetti intermedi.
  void WriteFieldsTo(Napi::Env env, const void* buffer, Napi::Object target);

 private:
  bool is_union_;
  size_t size_;
  size_t alignment_;
  size_t min_alignment_ = 1;
  bool memory_class_ = false;
  bool finalized_ = false;
  std::vector<FieldInfo> fields_;
  std::unique_ptr<ffi_type> ffi_type_;
  std::vector<ffi_type*> ffi_field_types_;  // per ffi_type.elements

  void EnsureMutable() const;

  // Helper per calcolare alignment di un tipo
  static size_t GetTypeAlignment(CType type, std::shared_ptr<StructInfo> nested, std::shared_ptr<ArrayInfo> array);
};

using ArrayInfo = StructInfo::ArrayInfo;
using FieldInfo = StructInfo::FieldInfo;

}  // namespace ctypes
