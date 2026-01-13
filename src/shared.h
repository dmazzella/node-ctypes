#pragma once

#include <napi.h>

#include <atomic>
#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <iomanip>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>
#include <unordered_map>
#include <cstring>
#include <cwchar>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif

// ssize_t non esiste su Windows MSVC
#ifdef _MSC_VER
#include <BaseTsd.h>
typedef SSIZE_T ssize_t;
#endif

#pragma warning(push)
#pragma warning(disable : 4996)
#include <spdlog/tweakme.h>
#include <spdlog/spdlog.h>
#include <spdlog/sinks/null_sink.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <spdlog/fmt/bin_to_hex.h>
#pragma warning(pop)

#include <dotenv/dotenv.h>

#include <ffi.h>

namespace ctypes
{
    // Helper per verificare se un oggetto è un StructType (ha metodo addField)
    inline bool IsStructType(Napi::Object obj)
    {
        if (obj.IsEmpty() || obj.IsNull() || obj.IsUndefined())
        {
            return false;
        }
        return obj.Has("addField") && obj.Get("addField").IsFunction();
    }

    // Helper per verificare se un oggetto è un ArrayType (ha metodo getLength)
    inline bool IsArrayType(Napi::Object obj)
    {
        if (obj.IsEmpty() || obj.IsNull() || obj.IsUndefined())
        {
            return false;
        }
        return obj.Has("getLength") && obj.Get("getLength").IsFunction();
    }

    // Helper per verificare se un oggetto è un TypeInfo (ha metodo name ma non addField/getLength)
    inline bool IsTypeInfo(Napi::Object obj)
    {
        if (obj.IsEmpty() || obj.IsNull() || obj.IsUndefined())
        {
            return false;
        }
        // TypeInfo ha "name" e "size" ma non "addField" né "getLength"
        return obj.Has("name") && obj.Get("name").IsFunction() &&
               !obj.Has("addField") && !obj.Has("getLength");
    }
}
