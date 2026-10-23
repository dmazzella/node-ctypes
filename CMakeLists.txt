cmake_minimum_required(VERSION 3.15 FATAL_ERROR)

project(ctypes)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# C++20 standard (-std=c++20, /std:c++20), senza estensioni del compilatore.
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS TRUE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ============================================================================
# Release optimization: LTO/IPO (cross-file inlining).
# Applied only in Release / RelWithDebInfo (default for cmake-js).
# ============================================================================

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "" FORCE)
endif()

if(CMAKE_BUILD_TYPE STREQUAL "Release" OR CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
    include(CheckIPOSupported)
    check_ipo_supported(RESULT CTYPES_IPO_OK OUTPUT CTYPES_IPO_MSG)
    if(CTYPES_IPO_OK)
        set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)
        message(STATUS "[ctypes] LTO/IPO enabled")
    else()
        message(STATUS "[ctypes] LTO/IPO not supported: ${CTYPES_IPO_MSG}")
    endif()
endif()

# ============================================================================
# Determina architettura
# ============================================================================

if(WIN32)
    if(CMAKE_VS_PLATFORM_NAME)
        if(CMAKE_VS_PLATFORM_NAME STREQUAL "ARM64")
            set(FFI_ARCH "arm64")
        elseif(CMAKE_VS_PLATFORM_NAME STREQUAL "x64")
            set(FFI_ARCH "amd64")
        elseif(CMAKE_VS_PLATFORM_NAME STREQUAL "Win32")
            set(FFI_ARCH "win32")
        endif()
    elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "ARM64|aarch64")
        set(FFI_ARCH "arm64")
    elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "AMD64|x86_64")
        set(FFI_ARCH "amd64")
    else()
        set(FFI_ARCH "win32")
    endif()
else()
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
        set(FFI_ARCH "aarch64")
    elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|amd64")
        set(FFI_ARCH "x86_64")
    else()
        set(FFI_ARCH "x86")
    endif()
endif()

message(STATUS "Target architecture: ${FFI_ARCH}")

# ============================================================================
# Build libffi from source (static)
# ============================================================================

message(STATUS "Building libffi from source...")
add_subdirectory(${CMAKE_SOURCE_DIR}/third-party/libffi_cmake)

# ============================================================================
# node-ctypes module
# ============================================================================

# node-addon-api
execute_process(
    COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
)
file(GLOB_RECURSE SOURCE_FILES "src/*.cc" "src/*.h")

add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})

set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
target_compile_features(${PROJECT_NAME} PRIVATE cxx_std_20)
# NODE_ADDON_API_CPP_EXCEPTIONS_ALL: anche un'eccezione C++ che non è un
# Napi::Error (es. std::runtime_error, std::bad_alloc) diventa un errore JS
# invece di terminare il processo.
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=9 NAPI_CPP_EXCEPTIONS NODE_ADDON_API_CPP_EXCEPTIONS_ALL)

if(MSVC)
    target_compile_options(${PROJECT_NAME} PRIVATE /W4)
else()
    target_compile_options(${PROJECT_NAME} PRIVATE -Wall -Wextra)
endif()

if(NODE_ADDON_API_DIR)
    string(REGEX REPLACE "[\r\n\"]" "" NODE_ADDON_API_DIR "${NODE_ADDON_API_DIR}")
    # SYSTEM: header esterni, senza i loro warning (MSVC: /external:I + /external:W0).
    target_include_directories(${PROJECT_NAME} SYSTEM PRIVATE ${NODE_ADDON_API_DIR})
endif()

# Include directories
if(CMAKE_JS_INC)
    target_include_directories(${PROJECT_NAME} SYSTEM PRIVATE ${CMAKE_JS_INC})
endif()

# third-party
target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/third-party)

# libffi (includes exported via target_include_directories PUBLIC)
target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/src)

# Link
if(CMAKE_JS_LIB)
    target_link_libraries(${PROJECT_NAME} PRIVATE ${CMAKE_JS_LIB})
endif()

target_link_libraries(${PROJECT_NAME} PRIVATE ffi_static)
target_compile_definitions(${PROJECT_NAME} PRIVATE FFI_STATIC_BUILD)

if(MSVC)
    target_compile_options(${PROJECT_NAME} PRIVATE /utf-8)
    target_compile_options(${PROJECT_NAME} PRIVATE /bigobj)
    if(CMAKE_JS_NODELIB_DEF AND CMAKE_JS_NODELIB_TARGET)
        execute_process(COMMAND ${CMAKE_AR} /def:${CMAKE_JS_NODELIB_DEF} /out:${CMAKE_JS_NODELIB_TARGET} ${CMAKE_STATIC_LINKER_FLAGS})
    endif()
endif()

# ============================================================================
# Test fixture (tests/fixtures): libreria C per i test, fuori dalla build
# normale (EXCLUDE_FROM_ALL). `npm run build:test-fixture` la compila in
# build/fixture/ctypes_test_fixture.{dll,dylib,so}.
# ============================================================================

add_library(ctypes_test_fixture SHARED EXCLUDE_FROM_ALL ${CMAKE_SOURCE_DIR}/tests/fixtures/ctypes_test_fixture.c)
set_target_properties(ctypes_test_fixture PROPERTIES
    PREFIX ""
    C_STANDARD 11
    C_STANDARD_REQUIRED ON
    C_VISIBILITY_PRESET hidden
    # $<1:...>: nessuna sottocartella per configurazione (generatori multi-config)
    LIBRARY_OUTPUT_DIRECTORY "$<1:${CMAKE_BINARY_DIR}/fixture>"
    RUNTIME_OUTPUT_DIRECTORY "$<1:${CMAKE_BINARY_DIR}/fixture>")

# ============================================================================
# Info
# ============================================================================

message(STATUS "")
message(STATUS "=== node-ctypes ===")
message(STATUS "  Platform: ${CMAKE_SYSTEM_NAME}")
message(STATUS "  Architecture: ${FFI_ARCH}")
message(STATUS "  libffi: static (from source)")
message(STATUS "===================")
