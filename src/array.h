#pragma once

#include "shared.h"
#include "types.h"

namespace ctypes
{
    // Forward declarations
    class StructInfo;
    class TypeInfo;

    // ArrayInfo - descrizione di array a dimensione fissa (come c_int * 5 in Python)
    class ArrayInfo
    {
    public:
        ArrayInfo(CType element_type, size_t count, std::shared_ptr<StructInfo> element_struct = nullptr);
        ~ArrayInfo();

        // Getter
        CType GetElementType() const { return element_type_; }
        size_t GetCount() const { return count_; }
        size_t GetSize() const { return size_; }
        size_t GetAlignment() const { return alignment_; }
        std::shared_ptr<StructInfo> GetElementStruct() const { return element_struct_; }

        // Crea ffi_type custom per questo array
        ffi_type *GetFFIType();

        // Converte JS array → C array buffer
        bool JSToArray(Napi::Env env, Napi::Value val, void *buffer, size_t bufsize);

        // Converte C array buffer → JS array
        Napi::Array ArrayToJS(Napi::Env env, const void *buffer);

    private:
        CType element_type_;
        size_t count_;
        size_t element_size_;
        size_t size_; // count * element_size
        size_t alignment_;
        std::shared_ptr<StructInfo> element_struct_; // Se element_type == STRUCT
        std::unique_ptr<ffi_type> ffi_type_;
        std::vector<ffi_type *> ffi_element_types_; // Per ffi_type.elements
    };

    // Wrapper Napi per esporre array a JavaScript
    class ArrayType : public Napi::ObjectWrap<ArrayType>
    {
    public:
        static Napi::Function GetClass(Napi::Env env);

        ArrayType(const Napi::CallbackInfo &info);

        // Metodi JS
        Napi::Value GetSize(const Napi::CallbackInfo &info);
        Napi::Value GetLength(const Napi::CallbackInfo &info);
        Napi::Value GetAlignment(const Napi::CallbackInfo &info);
        Napi::Value Create(const Napi::CallbackInfo &info); // crea buffer array

        std::shared_ptr<ArrayInfo> GetArrayInfo() const { return array_info_; }

    private:
        std::shared_ptr<ArrayInfo> array_info_;
    };

} // namespace ctypes
