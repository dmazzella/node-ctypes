#include <napi.h>
#include <stdexcept>
#include "types.h"
#include "library.h"
#include "function.h"
#include "callback.h"
#include "struct.h"
#include "array.h"

namespace ctypes
{

    // Funzione helper per caricare una libreria (scorciatoia)
    Napi::Value LoadLibrary(const Napi::CallbackInfo &info)
    {
        return Library::constructor.New({info[0]});
    }

    // Funzione per allocare memoria nativa
    Napi::Value Alloc(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsNumber())
        {
            Napi::TypeError::New(env, "Size (number) expected")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        size_t size = static_cast<size_t>(info[0].ToNumber().Int64Value());

        if (size == 0)
        {
            return env.Null();
        }

        // Usa un Buffer Node.js per la memoria
        // Questo ha il vantaggio di essere garbage-collected automaticamente
        return Napi::Buffer<uint8_t>::New(env, size);
    }

    // Funzione per leggere un valore dalla memoria
    Napi::Value ReadValue(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        // readValue(pointer, type, [offset])
        if (info.Length() < 2)
        {
            Napi::TypeError::New(env, "Pointer and type required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        void *ptr = nullptr;
        size_t offset = 0;

        // Parse pointer
        if (info[0].IsBuffer())
        {
            ptr = info[0].As<Napi::Buffer<uint8_t>>().Data();
        }
        else if (info[0].IsBigInt())
        {
            bool lossless;
            uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
            ptr = reinterpret_cast<void *>(addr);
        }
        else if (info[0].IsNumber())
        {
            ptr = reinterpret_cast<void *>(
                static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
        }
        else
        {
            Napi::TypeError::New(env, "Invalid pointer type")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Parse type
        CType ctype;
        try
        {
            if (info[1].IsString())
            {
                ctype = StringToCType(info[1].As<Napi::String>().Utf8Value());
            }
            else if (info[1].IsObject())
            {
                Napi::Object obj = info[1].As<Napi::Object>();
                if (obj.InstanceOf(TypeInfo::constructor.Value()))
                {
                    TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                    ctype = ti->GetCType();
                }
                else
                {
                    throw std::runtime_error("Invalid type object");
                }
            }
            else
            {
                throw std::runtime_error("Type must be string or CType");
            }
        }
        catch (const std::exception &e)
        {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Parse offset
        if (info.Length() > 2 && info[2].IsNumber())
        {
            offset = static_cast<size_t>(info[2].ToNumber().Int64Value());
        }

        if (!ptr)
        {
            return env.Null();
        }

        // Leggi il valore
        void *read_ptr = static_cast<uint8_t *>(ptr) + offset;
        return CToJS(env, read_ptr, ctype);
    }

    // Funzione per scrivere un valore in memoria
    Napi::Value WriteValue(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        // writeValue(pointer, type, value, [offset])
        if (info.Length() < 3)
        {
            Napi::TypeError::New(env, "Pointer, type and value required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        void *ptr = nullptr;
        size_t offset = 0;

        // Parse pointer
        if (info[0].IsBuffer())
        {
            ptr = info[0].As<Napi::Buffer<uint8_t>>().Data();
        }
        else if (info[0].IsBigInt())
        {
            bool lossless;
            uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
            ptr = reinterpret_cast<void *>(addr);
        }
        else if (info[0].IsNumber())
        {
            ptr = reinterpret_cast<void *>(
                static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
        }
        else
        {
            Napi::TypeError::New(env, "Invalid pointer type")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Parse type
        CType ctype;
        try
        {
            if (info[1].IsString())
            {
                ctype = StringToCType(info[1].As<Napi::String>().Utf8Value());
            }
            else if (info[1].IsObject())
            {
                Napi::Object obj = info[1].As<Napi::Object>();
                if (obj.InstanceOf(TypeInfo::constructor.Value()))
                {
                    TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                    ctype = ti->GetCType();
                }
                else
                {
                    throw std::runtime_error("Invalid type object");
                }
            }
            else
            {
                throw std::runtime_error("Type must be string or CType");
            }
        }
        catch (const std::exception &e)
        {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Parse offset
        if (info.Length() > 3 && info[3].IsNumber())
        {
            offset = static_cast<size_t>(info[3].ToNumber().Int64Value());
        }

        if (!ptr)
        {
            Napi::Error::New(env, "Cannot write to null pointer")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Scrivi il valore
        void *write_ptr = static_cast<uint8_t *>(ptr) + offset;
        size_t type_size = CTypeSize(ctype);

        int written = JSToC(env, info[2], ctype, write_ptr, type_size);
        if (written < 0)
        {
            Napi::Error::New(env, "Failed to write value")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        return Napi::Number::New(env, written);
    }

    // Funzione per ottenere la dimensione di un tipo
    Napi::Value SizeOf(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 1)
        {
            Napi::TypeError::New(env, "Type required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        CType ctype;
        try
        {
            if (info[0].IsString())
            {
                ctype = StringToCType(info[0].As<Napi::String>().Utf8Value());
            }
            else if (info[0].IsObject())
            {
                Napi::Object obj = info[0].As<Napi::Object>();
                if (obj.InstanceOf(TypeInfo::constructor.Value()))
                {
                    TypeInfo *ti = Napi::ObjectWrap<TypeInfo>::Unwrap(obj);
                    ctype = ti->GetCType();
                }
                else
                {
                    throw std::runtime_error("Invalid type object");
                }
            }
            else
            {
                throw std::runtime_error("Type must be string or CType");
            }
        }
        catch (const std::exception &e)
        {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        return Napi::Number::New(env, static_cast<double>(CTypeSize(ctype)));
    }

    // Crea una stringa C null-terminata da una stringa JS
    Napi::Value CreateCString(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString())
        {
            Napi::TypeError::New(env, "String expected")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        std::string str = info[0].As<Napi::String>().Utf8Value();

        // Crea un buffer con la stringa null-terminata
        auto buffer = Napi::Buffer<char>::New(env, str.length() + 1);
        memcpy(buffer.Data(), str.c_str(), str.length() + 1);

        return buffer;
    }

    // Legge una stringa C da un puntatore
    Napi::Value ReadCString(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 1)
        {
            Napi::TypeError::New(env, "Pointer required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        const char *ptr = nullptr;

        if (info[0].IsBuffer())
        {
            ptr = reinterpret_cast<const char *>(
                info[0].As<Napi::Buffer<uint8_t>>().Data());
        }
        else if (info[0].IsBigInt())
        {
            bool lossless;
            uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
            ptr = reinterpret_cast<const char *>(addr);
        }
        else if (info[0].IsNumber())
        {
            ptr = reinterpret_cast<const char *>(
                static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
        }

        if (!ptr)
        {
            return env.Null();
        }

        // Limite opzionale sulla lunghezza
        size_t max_len = SIZE_MAX;
        if (info.Length() > 1 && info[1].IsNumber())
        {
            max_len = static_cast<size_t>(info[1].ToNumber().Int64Value());
        }

        // Trova la lunghezza della stringa (con limite)
        size_t len = 0;
        while (len < max_len && ptr[len] != '\0')
        {
            len++;
        }

        return Napi::String::New(env, ptr, len);
    }

    // Crea un Buffer che punta a un indirizzo di memoria esistente
    // ATTENZIONE: Pericoloso! L'utente deve garantire che la memoria sia valida
    Napi::Value PtrToBuffer(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 2)
        {
            Napi::TypeError::New(env, "Address and size required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        void *ptr = nullptr;

        if (info[0].IsBigInt())
        {
            bool lossless;
            uint64_t addr = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
            ptr = reinterpret_cast<void *>(addr);
        }
        else if (info[0].IsNumber())
        {
            ptr = reinterpret_cast<void *>(
                static_cast<uintptr_t>(info[0].ToNumber().Int64Value()));
        }
        else
        {
            Napi::TypeError::New(env, "Address must be BigInt or Number")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (!ptr)
        {
            return env.Null();
        }

        size_t size = static_cast<size_t>(info[1].ToNumber().Int64Value());

        // Crea un Buffer esterno che punta alla memoria esistente
        // NON viene deallocato automaticamente quando il Buffer viene GC'd
        return Napi::Buffer<uint8_t>::New(
            env,
            static_cast<uint8_t *>(ptr),
            size,
            [](Napi::Env, void *)
            {
                // No-op finalizer: non deallochiamo memoria che non abbiamo allocato
            });
    }

    // Inizializzazione del modulo
    Napi::Object Init(Napi::Env env, Napi::Object exports)
    {
        // Inizializza le classi
        TypeInfo::Init(env, exports);
        Library::Init(env, exports);
        FFIFunction::Init(env, exports);
        Callback::Init(env, exports);
        ThreadSafeCallback::Init(env, exports);
        StructType::Init(env, exports);
        ArrayType::Init(env, exports);

        // Esporta funzioni helper
        exports.Set("load", Napi::Function::New(env, LoadLibrary));
        exports.Set("alloc", Napi::Function::New(env, Alloc));
        exports.Set("readValue", Napi::Function::New(env, ReadValue));
        exports.Set("writeValue", Napi::Function::New(env, WriteValue));
        exports.Set("sizeof", Napi::Function::New(env, SizeOf));
        exports.Set("cstring", Napi::Function::New(env, CreateCString));
        exports.Set("readCString", Napi::Function::New(env, ReadCString));
        exports.Set("ptrToBuffer", Napi::Function::New(env, PtrToBuffer));

        // Esporta i tipi predefiniti
        exports.Set("types", CreatePredefinedTypes(env));

        // Costanti utili
        exports.Set("POINTER_SIZE", Napi::Number::New(env, sizeof(void *)));
        exports.Set("WCHAR_SIZE", Napi::Number::New(env, sizeof(wchar_t)));
        exports.Set("NULL", env.Null());

        return exports;
    }

    NODE_API_MODULE(node_ctypes, Init)

} // namespace ctypes
