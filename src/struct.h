#pragma once

#include "shared.h"
#include "types.h"

namespace ctypes
{
    // Forward declarations
    class ArrayInfo;

    // Field descriptor - singolo campo di struct/union
    struct FieldInfo
    {
        std::string name;
        CType type;
        size_t offset;                                 // offset in bytes dall'inizio della struct
        size_t size;                                   // dimensione del campo
        std::shared_ptr<class StructInfo> struct_type; // per nested structs
        std::shared_ptr<ArrayInfo> array_type;         // per array fields
        bool is_anonymous;                             // se true, i suoi campi sono accessibili direttamente
    };

    // StructInfo - layout di una struct/union (come CPython StgInfo)
    class StructInfo
    {
    public:
        StructInfo(bool is_union = false);
        ~StructInfo();

        // Aggiunge un campo e ricalcola layout
        bool AddField(const std::string &name, CType type, std::shared_ptr<StructInfo> nested = nullptr, bool is_anonymous = false);

        // Aggiunge un campo array
        bool AddArrayField(const std::string &name, std::shared_ptr<ArrayInfo> array_type);

        // Calcola offsets e padding (seguendo regole platform ABI)
        void CalculateLayout();

        // Getter
        size_t GetSize() const { return size_; }
        size_t GetAlignment() const { return alignment_; }
        const std::vector<FieldInfo> &GetFields() const { return fields_; }
        bool IsUnion() const { return is_union_; }

        // Crea ffi_type custom per questa struct (necessario per libffi)
        ffi_type *GetFFIType();

        // Converte JS object -> C struct buffer
        bool JSToStruct(Napi::Env env, Napi::Object obj, void *buffer, size_t bufsize);

        // Converte C struct buffer -> JS object
        Napi::Object StructToJS(Napi::Env env, const void *buffer);

    private:
        bool is_union_;
        size_t size_;
        size_t alignment_;
        std::vector<FieldInfo> fields_;
        std::unique_ptr<ffi_type> ffi_type_;
        std::vector<ffi_type *> ffi_field_types_; // per ffi_type.elements

        // Helper per calcolare alignment di un tipo
        static size_t GetTypeAlignment(CType type, std::shared_ptr<StructInfo> nested, std::shared_ptr<ArrayInfo> array);
    };

    // Wrapper Napi per esporre struct a JavaScript
    class StructType : public Napi::ObjectWrap<StructType>
    {
    public:
        static Napi::Function GetClass(Napi::Env env);

        StructType(const Napi::CallbackInfo &info);

        // Metodi JS
        Napi::Value AddField(const Napi::CallbackInfo &info);
        Napi::Value GetSize(const Napi::CallbackInfo &info);
        Napi::Value GetAlignment(const Napi::CallbackInfo &info);
        Napi::Value Create(const Napi::CallbackInfo &info); // crea istanza struct
        Napi::Value Read(const Napi::CallbackInfo &info);   // legge struct da buffer

        std::shared_ptr<StructInfo> GetStructInfo() const { return struct_info_; }

    private:
        std::shared_ptr<StructInfo> struct_info_;
        bool is_union_;
    };

} // namespace ctypes
