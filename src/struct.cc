#include "struct.h"
#include "array.h"
#include <cstring>
#include <algorithm>

namespace ctypes
{

    Napi::FunctionReference StructType::constructor;

    // ============================================================================
    // StructInfo - Core logic (come CPython StgInfo)
    // ============================================================================

    StructInfo::StructInfo(bool is_union)
        : is_union_(is_union), size_(0), alignment_(1)
    {
    }

    StructInfo::~StructInfo() = default;

    size_t StructInfo::GetTypeAlignment(CType type, std::shared_ptr<StructInfo> nested, std::shared_ptr<ArrayInfo> array)
    {
        if (array)
        {
            return array->GetAlignment();
        }
        
        if (nested)
        {
            return nested->GetAlignment();
        }

        switch (type)
        {
        case CType::INT8:
        case CType::UINT8:
        case CType::BOOL:
            return 1;
        case CType::INT16:
        case CType::UINT16:
        case CType::WCHAR:
            return 2;
        case CType::INT32:
        case CType::UINT32:
        case CType::FLOAT:
        case CType::LONG:   // 4 su Windows
        case CType::ULONG:
            return 4;
        case CType::INT64:
        case CType::UINT64:
        case CType::DOUBLE:
        case CType::POINTER:
        case CType::STRING:
        case CType::WSTRING:
        case CType::SIZE_T:
        case CType::SSIZE_T:
            return sizeof(void *); // 8 su x64, 4 su x86
        default:
            return 1;
        }
    }

    bool StructInfo::AddField(const std::string &name, CType type, std::shared_ptr<StructInfo> nested, bool is_anonymous)
    {
        FieldInfo field;
        field.name = name;
        field.type = type;
        field.struct_type = nested;
        field.array_type = nullptr;
        field.is_anonymous = is_anonymous;

        if (nested)
        {
            field.size = nested->GetSize();
        }
        else
        {
            field.size = CTypeSize(type);
        }

        fields_.push_back(field);
        return true;
    }
    
    bool StructInfo::AddArrayField(const std::string &name, std::shared_ptr<ArrayInfo> array_type)
    {
        FieldInfo field;
        field.name = name;
        field.type = CType::ARRAY;
        field.struct_type = nullptr;
        field.array_type = array_type;
        field.size = array_type->GetSize();
        field.is_anonymous = false;

        fields_.push_back(field);
        return true;
    }

    void StructInfo::CalculateLayout()
    {
        if (fields_.empty())
        {
            size_ = 0;
            alignment_ = 1;
            return;
        }

        size_t current_offset = 0;
        size_t max_alignment = 1;

        for (auto &field : fields_)
        {
            size_t field_alignment = GetTypeAlignment(field.type, field.struct_type, field.array_type);
            max_alignment = std::max(max_alignment, field_alignment);

            if (is_union_)
            {
                // Union: tutti i campi allo stesso offset 0
                field.offset = 0;
            }
            else
            {
                // Struct: allinea offset al boundary del tipo
                size_t padding = (field_alignment - (current_offset % field_alignment)) % field_alignment;
                current_offset += padding;
                field.offset = current_offset;
                current_offset += field.size;
            }
        }

        alignment_ = max_alignment;

        if (is_union_)
        {
            // Union: size = max(field sizes)
            size_ = 0;
            for (const auto &field : fields_)
            {
                size_ = std::max(size_, field.size);
            }
        }
        else
        {
            // Struct: size = offset finale + padding finale
            size_ = current_offset;
        }

        // Padding finale per allineare la struct stessa
        size_t final_padding = (alignment_ - (size_ % alignment_)) % alignment_;
        size_ += final_padding;
    }

    ffi_type *StructInfo::GetFFIType()
    {
        if (ffi_type_)
        {
            return ffi_type_.get();
        }

        ffi_field_types_.clear();
        for (const auto &field : fields_)
        {
            if (field.array_type)
            {
                ffi_field_types_.push_back(field.array_type->GetFFIType());
            }
            else if (field.struct_type)
            {
                ffi_field_types_.push_back(field.struct_type->GetFFIType());
            }
            else
            {
                ffi_field_types_.push_back(CTypeToFFI(field.type));
            }
        }

        ffi_field_types_.push_back(nullptr); // Terminatore

        ffi_type_ = std::make_unique<ffi_type>();
        ffi_type_->size = size_;
        ffi_type_->alignment = static_cast<unsigned short>(alignment_);
        ffi_type_->type = FFI_TYPE_STRUCT;
        ffi_type_->elements = ffi_field_types_.data();

        return ffi_type_.get();
    }

    bool StructInfo::JSToStruct(Napi::Env env, Napi::Object obj, void *buffer, size_t bufsize)
    {
        if (bufsize < size_)
        {
            Napi::TypeError::New(env, "Buffer too small for struct").ThrowAsJavaScriptException();
            return false;
        }

        // Inizializza buffer a zero
        std::memset(buffer, 0, size_);

        // Copia ogni campo
        for (const auto &field : fields_)
        {
            void *field_ptr = static_cast<char *>(buffer) + field.offset;

            if (field.array_type)
            {
                // Array field
                if (!obj.Has(field.name))
                {
                    continue; // campo opzionale
                }
                Napi::Value value = obj.Get(field.name);
                if (!field.array_type->JSToArray(env, value, field_ptr, field.size))
                {
                    return false;
                }
            }
            else if (field.struct_type)
            {
                // Nested struct
                if (field.is_anonymous)
                {
                    // Anonymous field: leggi i suoi campi direttamente dall'oggetto
                    if (!field.struct_type->JSToStruct(env, obj, field_ptr, field.size))
                    {
                        return false;
                    }
                }
                else
                {
                    // Named field
                    if (!obj.Has(field.name))
                    {
                        continue; // campo opzionale
                    }
                    Napi::Value value = obj.Get(field.name);
                    if (!value.IsObject())
                    {
                        Napi::TypeError::New(env, "Field " + field.name + " must be an object").ThrowAsJavaScriptException();
                        return false;
                    }
                    if (!field.struct_type->JSToStruct(env, value.As<Napi::Object>(), field_ptr, field.size))
                    {
                        return false;
                    }
                }
            }
            else
            {
                // Tipo primitivo
                if (!obj.Has(field.name))
                {
                    continue; // campo opzionale
                }
                Napi::Value value = obj.Get(field.name);
                if (JSToC(env, value, field.type, field_ptr, field.size) < 0)
                {
                    return false;
                }
            }
        }

        return true;
    }

    Napi::Object StructInfo::StructToJS(Napi::Env env, const void *buffer)
    {
        Napi::Object obj = Napi::Object::New(env);

        for (const auto &field : fields_)
        {
            const void *field_ptr = static_cast<const char *>(buffer) + field.offset;

            if (field.array_type)
            {
                // Array field - return as JS array
                obj.Set(field.name, field.array_type->ArrayToJS(env, field_ptr));
            }
            else if (field.struct_type)
            {
                // Nested struct
                Napi::Object nested = field.struct_type->StructToJS(env, field_ptr);
                
                if (field.is_anonymous)
                {
                    // Anonymous field: esponi i suoi campi direttamente
                    Napi::Array keys = nested.GetPropertyNames();
                    for (uint32_t i = 0; i < keys.Length(); i++)
                    {
                        Napi::Value key = keys.Get(i);
                        obj.Set(key, nested.Get(key));
                    }
                }
                else
                {
                    obj.Set(field.name, nested);
                }
            }
            else
            {
                // Tipo primitivo
                obj.Set(field.name, CToJS(env, field_ptr, field.type));
            }
        }

        return obj;
    }

    // ============================================================================
    // StructType - Napi wrapper
    // ============================================================================

    Napi::Object StructType::Init(Napi::Env env, Napi::Object exports)
    {
        Napi::Function func = DefineClass(env, "StructType",
                                          {
                                              InstanceMethod("addField", &StructType::AddField),
                                              InstanceMethod("getSize", &StructType::GetSize),
                                              InstanceMethod("getAlignment", &StructType::GetAlignment),
                                              InstanceMethod("create", &StructType::Create),
                                              InstanceMethod("read", &StructType::Read),
                                          });

        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();

        exports.Set("StructType", func);
        return exports;
    }

    StructType::StructType(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<StructType>(info)
    {
        Napi::Env env = info.Env();

        // Opzionale: { union: true }
        is_union_ = false;
        if (info.Length() > 0 && info[0].IsObject())
        {
            Napi::Object options = info[0].As<Napi::Object>();
            if (options.Has("union"))
            {
                is_union_ = options.Get("union").ToBoolean();
            }
        }

        struct_info_ = std::make_shared<StructInfo>(is_union_);
    }

    Napi::Value StructType::AddField(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 2)
        {
            Napi::TypeError::New(env, "Expected (name, type)").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        std::string name = info[0].As<Napi::String>().Utf8Value();
        
        CType type;
        std::shared_ptr<StructInfo> nested;
        std::shared_ptr<ArrayInfo> array;
        bool is_anonymous = false;

        // Terzo parametro opzionale: { anonymous: true }
        if (info.Length() > 2 && info[2].IsObject())
        {
            Napi::Object options = info[2].As<Napi::Object>();
            if (options.Has("anonymous"))
            {
                is_anonymous = options.Get("anonymous").ToBoolean();
            }
        }

        // Tipo può essere string, StructType, o ArrayType
        if (info[1].IsString())
        {
            std::string type_name = info[1].As<Napi::String>().Utf8Value();
            type = StringToCType(type_name);
        }
        else if (info[1].IsObject())
        {
            Napi::Object type_obj = info[1].As<Napi::Object>();
            if (type_obj.InstanceOf(StructType::constructor.Value()))
            {
                StructType *st = Napi::ObjectWrap<StructType>::Unwrap(type_obj);
                nested = st->GetStructInfo();
                type = CType::STRUCT;
            }
            else if (type_obj.InstanceOf(ArrayType::constructor.Value()))
            {
                ArrayType *at = Napi::ObjectWrap<ArrayType>::Unwrap(type_obj);
                array = at->GetArrayInfo();
                type = CType::ARRAY;
            }
            else if (type_obj.Has("_native") && type_obj.Get("_native").IsObject())
            {
                // È un wrapper JavaScript di array() - estrai il _native
                Napi::Object native_obj = type_obj.Get("_native").As<Napi::Object>();
                if (native_obj.InstanceOf(ArrayType::constructor.Value()))
                {
                    ArrayType *at = Napi::ObjectWrap<ArrayType>::Unwrap(native_obj);
                    array = at->GetArrayInfo();
                    type = CType::ARRAY;
                }
                else
                {
                    Napi::TypeError::New(env, "Invalid type").ThrowAsJavaScriptException();
                    return env.Undefined();
                }
            }
            else
            {
                Napi::TypeError::New(env, "Invalid type").ThrowAsJavaScriptException();
                return env.Undefined();
            }
        }
        else
        {
            Napi::TypeError::New(env, "Type must be string, StructType, or ArrayType").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (array)
        {
            struct_info_->AddArrayField(name, array);
        }
        else
        {
            struct_info_->AddField(name, type, nested, is_anonymous);
        }
        struct_info_->CalculateLayout();

        return info.This();
    }

    Napi::Value StructType::GetSize(const Napi::CallbackInfo &info)
    {
        return Napi::Number::New(info.Env(), struct_info_->GetSize());
    }

    Napi::Value StructType::GetAlignment(const Napi::CallbackInfo &info)
    {
        return Napi::Number::New(info.Env(), struct_info_->GetAlignment());
    }

    Napi::Value StructType::Create(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        // Crea buffer e popola da JS object (se fornito)
        size_t size = struct_info_->GetSize();
        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::New(env, size);
        
        if (info.Length() > 0 && info[0].IsObject())
        {
            if (!struct_info_->JSToStruct(env, info[0].As<Napi::Object>(), buffer.Data(), size))
            {
                return env.Undefined();
            }
        }
        else
        {
            std::memset(buffer.Data(), 0, size);
        }

        return buffer;
    }

    Napi::Value StructType::Read(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsBuffer())
        {
            Napi::TypeError::New(env, "Expected a Buffer").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
        return struct_info_->StructToJS(env, buffer.Data());
    }

} // namespace ctypes
