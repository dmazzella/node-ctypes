#include "array.h"
#include "struct.h"

namespace ctypes
{

    // ============================================================================
    // ArrayInfo - Core logic
    // ============================================================================

    ArrayInfo::ArrayInfo(CType element_type, size_t count, std::shared_ptr<StructInfo> element_struct)
        : element_type_(element_type), count_(count), element_struct_(element_struct)
    {
        spdlog::trace(__FUNCTION__);

        if (element_struct)
        {
            element_size_ = element_struct->GetSize();
            alignment_ = element_struct->GetAlignment();
        }
        else
        {
            element_size_ = CTypeSize(element_type);

            // Alignment dell'elemento
            switch (element_type)
            {
            case CType::CTYPES_INT8:
            case CType::CTYPES_UINT8:
            case CType::CTYPES_BOOL:
                alignment_ = 1;
                break;
            case CType::CTYPES_INT16:
            case CType::CTYPES_UINT16:
            case CType::CTYPES_WCHAR:
                alignment_ = 2;
                break;
            case CType::CTYPES_INT32:
            case CType::CTYPES_UINT32:
            case CType::CTYPES_FLOAT:
            case CType::CTYPES_LONG:
            case CType::CTYPES_ULONG:
                alignment_ = 4;
                break;
            case CType::CTYPES_INT64:
            case CType::CTYPES_UINT64:
            case CType::CTYPES_DOUBLE:
            case CType::CTYPES_POINTER:
            case CType::CTYPES_STRING:
            case CType::CTYPES_WSTRING:
            case CType::CTYPES_SIZE_T:
            case CType::CTYPES_SSIZE_T:
                alignment_ = sizeof(void *);
                break;
            default:
                alignment_ = 1;
            }
        }

        size_ = element_size_ * count_;
    }

    ArrayInfo::~ArrayInfo() = default;

    ffi_type *ArrayInfo::GetFFIType()
    {
        spdlog::trace(__FUNCTION__);

        if (ffi_type_)
        {
            return ffi_type_.get();
        }

        // Array è rappresentato in libffi come struct con elementi ripetuti
        ffi_element_types_.clear();
        ffi_element_types_.reserve(count_ + 1);

        ffi_type *element_ffi;
        if (element_struct_)
        {
            element_ffi = element_struct_->GetFFIType();
        }
        else
        {
            element_ffi = CTypeToFFI(element_type_);
        }

        // Ripeti element_ffi count_ volte
        for (size_t i = 0; i < count_; i++)
        {
            ffi_element_types_.push_back(element_ffi);
        }
        // Terminator NULL
        ffi_element_types_.push_back(nullptr);

        // Crea ffi_type
        ffi_type_ = std::make_unique<ffi_type>();
        ffi_type_->size = size_;
        ffi_type_->alignment = static_cast<unsigned short>(alignment_);
        ffi_type_->type = FFI_TYPE_STRUCT; // Array come struct
        ffi_type_->elements = ffi_element_types_.data();

        return ffi_type_.get();
    }

    bool ArrayInfo::JSToArray(Napi::Env env, Napi::Value val, void *buffer, size_t bufsize)
    {
        spdlog::trace(__FUNCTION__);

        if (bufsize < size_)
        {
            Napi::TypeError::New(env, "Buffer too small for array").ThrowAsJavaScriptException();
            return false;
        }

        std::memset(buffer, 0, size_);

        if (val.IsArray())
        {
            Napi::Array arr = val.As<Napi::Array>();
            size_t arr_len = arr.Length();
            size_t copy_len = std::min(arr_len, count_);

            for (size_t i = 0; i < copy_len; i++)
            {
                Napi::Value elem = arr.Get(i);
                void *elem_ptr = static_cast<char *>(buffer) + (i * element_size_);

                if (element_struct_)
                {
                    // Element è struct
                    if (elem.IsObject())
                    {
                        if (!element_struct_->JSToStruct(env, elem.As<Napi::Object>(), elem_ptr, element_size_))
                        {
                            return false;
                        }
                    }
                    else if (elem.IsBuffer())
                    {
                        Napi::Buffer<uint8_t> buf = elem.As<Napi::Buffer<uint8_t>>();
                        if (buf.Length() >= element_size_)
                        {
                            std::memcpy(elem_ptr, buf.Data(), element_size_);
                        }
                    }
                }
                else
                {
                    // Element è tipo primitivo
                    if (JSToC(env, elem, element_type_, elem_ptr, element_size_) < 0)
                    {
                        return false;
                    }
                }
            }
        }
        else if (val.IsBuffer())
        {
            // Buffer già pronto
            Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
            size_t copy_size = std::min(buf.Length(), size_);
            std::memcpy(buffer, buf.Data(), copy_size);
        }
        else if (val.IsString() && element_type_ == CType::CTYPES_INT8)
        {
            // Stringa → char array
            std::string str = val.As<Napi::String>().Utf8Value();
            size_t copy_len = std::min(str.length(), count_ - 1);
            std::memcpy(buffer, str.c_str(), copy_len);
            static_cast<char *>(buffer)[copy_len] = '\0';
        }
        else
        {
            Napi::TypeError::New(env, "Expected array, buffer, or string").ThrowAsJavaScriptException();
            return false;
        }

        return true;
    }

    Napi::Array ArrayInfo::ArrayToJS(Napi::Env env, const void *buffer)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Array arr = Napi::Array::New(env, count_);

        for (size_t i = 0; i < count_; i++)
        {
            const void *elem_ptr = static_cast<const char *>(buffer) + (i * element_size_);

            if (element_struct_)
            {
                // Element è struct
                arr.Set(i, element_struct_->StructToJS(env, elem_ptr));
            }
            else
            {
                // Element è tipo primitivo
                arr.Set(i, CToJS(env, elem_ptr, element_type_));
            }
        }

        return arr;
    }

    // ============================================================================
    // ArrayType - Napi wrapper
    // ============================================================================

    Napi::Function ArrayType::GetClass(Napi::Env env)
    {
        spdlog::trace(__FUNCTION__);

        return DefineClass(
            env,
            "ArrayType",
            {
                InstanceMethod("getSize", &ArrayType::GetSize),
                InstanceMethod("getLength", &ArrayType::GetLength),
                InstanceMethod("getAlignment", &ArrayType::GetAlignment),
                InstanceMethod("create", &ArrayType::Create),
            });
    }

    ArrayType::ArrayType(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<ArrayType>(info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 2)
        {
            Napi::TypeError::New(env, "ArrayType requires (element_type, count)").ThrowAsJavaScriptException();
            return;
        }

        CType element_type;
        std::shared_ptr<StructInfo> element_struct;

        // Parse element type
        if (info[0].IsString())
        {
            element_type = StringToCType(info[0].As<Napi::String>().Utf8Value());
        }
        else if (info[0].IsObject())
        {
            Napi::Object type_obj = info[0].As<Napi::Object>();

            // Check if StructType (duck typing: has addField method)
            if (IsStructType(type_obj))
            {
                StructType *st = Napi::ObjectWrap<StructType>::Unwrap(type_obj);
                element_struct = st->GetStructInfo();
                element_type = CType::CTYPES_STRUCT;
            }
            else if (IsTypeInfo(type_obj))
            {
                element_type = Napi::ObjectWrap<TypeInfo>::Unwrap(type_obj)->GetCType();
            }
            else
            {
                Napi::TypeError::New(env, "Invalid element type").ThrowAsJavaScriptException();
                return;
            }
        }
        else
        {
            Napi::TypeError::New(env, "Element type must be string or type object").ThrowAsJavaScriptException();
            return;
        }

        // Parse count
        size_t count = static_cast<size_t>(info[1].As<Napi::Number>().Int64Value());

        array_info_ = std::make_shared<ArrayInfo>(element_type, count, element_struct);
    }

    Napi::Value ArrayType::GetSize(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        return Napi::Number::New(info.Env(), array_info_->GetSize());
    }

    Napi::Value ArrayType::GetLength(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        return Napi::Number::New(info.Env(), array_info_->GetCount());
    }

    Napi::Value ArrayType::GetAlignment(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        return Napi::Number::New(info.Env(), array_info_->GetAlignment());
    }

    Napi::Value ArrayType::Create(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        size_t size = array_info_->GetSize();
        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::New(env, size);

        if (info.Length() > 0)
        {
            if (!array_info_->JSToArray(env, info[0], buffer.Data(), size))
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

} // namespace ctypes
