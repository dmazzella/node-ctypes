#include "library.h"
#include "function.h"
#include "addon.h"

namespace ctypes
{

    std::string GetErrorMessage(const DWORD errorCode)
    {
        spdlog::trace(__FUNCTION__);
        std::string result;

#ifdef _WIN32
        WCHAR localeName[LOCALE_NAME_MAX_LENGTH] = {0};
        LANGID langId = MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT);
        if (GetLocaleInfoEx(LOCALE_NAME_USER_DEFAULT, LOCALE_SNAME, localeName, LOCALE_NAME_MAX_LENGTH))
        {
            LCID lcid = LocaleNameToLCID(localeName, 0);
            if (lcid != 0)
            {
                langId = LANGIDFROMLCID(lcid);
            }
        }

        LPWSTR msgBufW = nullptr;
        DWORD dwFlags = FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_MAX_WIDTH_MASK;
        if (FormatMessageW(dwFlags, NULL, errorCode, langId, (LPWSTR)&msgBufW, 0, NULL) && msgBufW)
        {
            int utf8Length = WideCharToMultiByte(CP_UTF8, 0, msgBufW, -1, nullptr, 0, nullptr, nullptr);
            if (utf8Length > 0)
            {
                std::vector<char> utf8Buffer(utf8Length);
                if (WideCharToMultiByte(CP_UTF8, 0, msgBufW, -1, utf8Buffer.data(), utf8Length, nullptr, nullptr) > 0)
                {
                    result = std::string(utf8Buffer.data());
                }
            }
            LocalFree(msgBufW);
        }
#else
        result = fmt::format("Error 0x{:08x}", static_cast<uint32_t>(errorCode));
#endif

        return result;
    }

    // Platform-specific implementations
    void *LoadSharedLibrary(const std::string &path, std::string &error)
    {
        spdlog::trace(__FUNCTION__);

#ifdef _WIN32
        HMODULE handle = LoadLibraryExA(path.c_str(), NULL, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS | LOAD_LIBRARY_SEARCH_USER_DIRS);
        if (!handle)
        {
            DWORD err = GetLastError();
            error = fmt::format("LoadLibraryExA failed: 0x{:08x} {}", static_cast<uint32_t>(err), GetErrorMessage(err));
            return nullptr;
        }
        return static_cast<void *>(handle);
#else
        void *handle = dlopen(path.c_str(), RTLD_LAZY | RTLD_LOCAL);
        if (!handle)
        {
            error = dlerror();
            return nullptr;
        }
        return handle;
#endif
    }

    void *GetSymbolAddress(void *handle, const std::string &name, std::string &error)
    {
        spdlog::trace(__FUNCTION__);

#ifdef _WIN32
        void *addr = reinterpret_cast<void *>(
            GetProcAddress(static_cast<HMODULE>(handle), name.c_str()));
        if (!addr)
        {
            DWORD err = GetLastError();
            char buf[256];
            FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM, NULL, err, 0, buf, sizeof(buf), NULL);
            error = buf;
        }
        return addr;
#else
        dlerror(); // Clear previous errors
        void *addr = dlsym(handle, name.c_str());
        const char *err = dlerror();
        if (err)
        {
            error = err;
            return nullptr;
        }
        return addr;
#endif
    }

    bool CloseSharedLibrary(void *handle)
    {
        spdlog::trace(__FUNCTION__);

        if (!handle)
            return true;
#ifdef _WIN32
        return FreeLibrary(static_cast<HMODULE>(handle)) != 0;
#else
        return dlclose(handle) == 0;
#endif
    }

    // Library class implementation
    Napi::Function Library::GetClass(Napi::Env env)
    {
        spdlog::trace(__FUNCTION__);

        return DefineClass(
            env,
            "Library",
            {
                InstanceMethod("func", &Library::GetFunction),
                InstanceMethod("callback", &Library::GetCallback),
                InstanceMethod("symbol", &Library::GetSymbol),
                InstanceMethod("close", &Library::Close),
                InstanceAccessor("path", &Library::GetPath, nullptr),
                InstanceAccessor("loaded", &Library::GetIsLoaded, nullptr),
            });
    }

    Library::Library(const Napi::CallbackInfo &info)
        : Napi::ObjectWrap<Library>(info), handle_(nullptr), is_loaded_(false)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (info.Length() < 1)
        {
            Napi::TypeError::New(env, "Library path expected")
                .ThrowAsJavaScriptException();
            return;
        }

        // Gestisce sia stringhe che null (per caricare l'eseguibile corrente)
        if (info[0].IsNull() || info[0].IsUndefined())
        {
            path_ = "";
        }
        else if (info[0].IsString())
        {
            path_ = info[0].As<Napi::String>().Utf8Value();
        }
        else
        {
            Napi::TypeError::New(env, "Library path must be a string or null")
                .ThrowAsJavaScriptException();
            return;
        }

        std::string error;

        // Se path è vuoto, carica l'eseguibile corrente (RTLD_DEFAULT su Unix)
        if (path_.empty())
        {
#ifdef _WIN32
            handle_ = GetModuleHandle(NULL);
#else
            handle_ = dlopen(NULL, RTLD_LAZY);
#endif
        }
        else
        {
#ifdef _WIN32
            try
            {
                std::filesystem::path lib_path(path_);
                if (lib_path.has_parent_path() && lib_path.parent_path() != std::filesystem::path("."))
                {
                    std::filesystem::path parent_dir;
                    if (lib_path.is_absolute())
                    {
                        parent_dir = lib_path.parent_path();
                    }
                    else
                    {
                        parent_dir = std::filesystem::current_path() / lib_path.parent_path();
                    }

                    if (!parent_dir.empty() && std::filesystem::exists(parent_dir))
                    {
                        if (SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS | LOAD_LIBRARY_SEARCH_USER_DIRS))
                        {
                            std::wstring wparent = parent_dir.wstring();
                            DLL_DIRECTORY_COOKIE cookie = AddDllDirectory(wparent.c_str());
                            if (!cookie)
                            {
                                DWORD err = GetLastError();
                                std::string errMsg = GetErrorMessage(err);
                                spdlog::error("AddDllDirectory failed for {}: error {}: {}", parent_dir.string(), err, errMsg);
                            }
                            else
                            {
                                spdlog::trace("AddDllDirectory successful for {}", parent_dir.string());
                                m_dll_directory_cookie.reset(reinterpret_cast<void *>(cookie));
                            }
                        }
                        else
                        {
                            DWORD err = GetLastError();
                            std::string errMsg = GetErrorMessage(err);
                            spdlog::error("SetDefaultDllDirectories failed: error {}: {}", err, errMsg);
                        }
                    }
                    else
                    {
                        spdlog::warn("Parent directory '{}' does not exist or is empty", parent_dir.string());
                    }
                }
            }
            catch (const std::exception &ex)
            {
                spdlog::warn("Exception inspecting library path '{}': {}", path_, ex.what());
            }
            handle_ = LoadSharedLibrary(path_, error);
#else
            handle_ = LoadSharedLibrary(path_, error);
#endif
        }

        if (!handle_)
        {
            std::string msg = "Failed to load library";
            if (!path_.empty())
                msg += " '" + path_ + "'";
            if (!error.empty())
                msg += ": " + error;
            Napi::Error::New(env, msg).ThrowAsJavaScriptException();
            return;
        }

        is_loaded_ = true;
    }

    Library::~Library()
    {
        spdlog::trace(__FUNCTION__);

        if (is_loaded_ && handle_ && !path_.empty())
        {
            CloseSharedLibrary(handle_);
        }
    }

    Napi::Value Library::GetFunction(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!is_loaded_)
        {
            Napi::Error::New(env, "Library is not loaded").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // func(name, returnType, [argTypes], [options])
        if (info.Length() < 2)
        {
            Napi::TypeError::New(env, "Function name and return type required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (!info[0].IsString())
        {
            Napi::TypeError::New(env, "Function name must be a string")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        std::string name = info[0].As<Napi::String>().Utf8Value();

        // Trova il simbolo
        std::string error;
        void *fn_ptr = GetSymbolAddress(handle_, name, error);

        if (!fn_ptr)
        {
            std::string msg = "Symbol '" + name + "' not found";
            if (!error.empty())
                msg += ": " + error;
            Napi::Error::New(env, msg).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Crea l'oggetto FFIFunction
        // Passiamo: fn_ptr (come External), returnType, argTypes
        std::vector<napi_value> args;
        args.push_back(Napi::External<void>::New(env, fn_ptr));
        args.push_back(Napi::String::New(env, name));

        // Return type
        args.push_back(info[1]);

        // Arg types (se presenti)
        if (info.Length() > 2)
        {
            args.push_back(info[2]);
        }
        else
        {
            args.push_back(Napi::Array::New(env, 0));
        }

        // Options (se presenti)
        if (info.Length() > 3)
        {
            args.push_back(info[3]);
        }

        // Ottieni il costruttore FFIFunction dall'addon
        CTypesAddon *addon = env.GetInstanceData<CTypesAddon>();
        if (!addon || !addon->FFIFunctionConstructor)
        {
            Napi::Error::New(env, "FFIFunction constructor not available").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        return addon->FFIFunctionConstructor->New(args);
    }

    Napi::Value Library::GetSymbol(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (!is_loaded_)
        {
            Napi::Error::New(env, "Library is not loaded").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (info.Length() < 1 || !info[0].IsString())
        {
            Napi::TypeError::New(env, "Symbol name required")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        std::string name = info[0].As<Napi::String>().Utf8Value();

        std::string error;
        void *sym_ptr = GetSymbolAddress(handle_, name, error);

        if (!sym_ptr)
        {
            std::string msg = "Symbol '" + name + "' not found";
            if (!error.empty())
                msg += ": " + error;
            Napi::Error::New(env, msg).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Ritorna il puntatore come BigInt
        return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(sym_ptr));
    }

    Napi::Value Library::Close(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        if (is_loaded_ && handle_ && !path_.empty())
        {
            CloseSharedLibrary(handle_);
            handle_ = nullptr;
            is_loaded_ = false;
        }

        return env.Undefined();
    }

    Napi::Value Library::GetCallback(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        Napi::Env env = info.Env();

        // callback(returnType, [argTypes], jsFunction)
        if (info.Length() < 3)
        {
            Napi::TypeError::New(env, "Callback requires returnType, argTypes, jsFunction")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (!info[2].IsFunction())
        {
            Napi::TypeError::New(env, "Third argument must be a function")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Crea Callback object - ordine: jsFunction, returnType, argTypes
        std::vector<napi_value> args;
        args.push_back(info[2]); // jsFunction
        args.push_back(info[0]); // returnType
        args.push_back(info[1]); // argTypes

        // Ottieni il costruttore Callback dall'addon
        CTypesAddon *addon = env.GetInstanceData<CTypesAddon>();
        if (!addon || !addon->CallbackConstructor)
        {
            Napi::Error::New(env, "Callback constructor not available").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        return addon->CallbackConstructor->New(args);
    }

    Napi::Value Library::GetPath(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        return Napi::String::New(info.Env(), path_);
    }

    Napi::Value Library::GetIsLoaded(const Napi::CallbackInfo &info)
    {
        spdlog::trace(__FUNCTION__);

        return Napi::Boolean::New(info.Env(), is_loaded_);
    }

} // namespace ctypes
