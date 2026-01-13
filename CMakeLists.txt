cmake_minimum_required(VERSION 3.15 FATAL_ERROR)

project(ctypes)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS TRUE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_definitions(-DNAPI_VERSION=9)
add_definitions(-DNAPI_CPP_EXCEPTIONS)

include(FetchContent)

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
# Trova/Scarica libffi
# ============================================================================

set(FFI_FOUND FALSE)

if(WIN32)
    set(LIBFFI_BIN_DIR ${CMAKE_SOURCE_DIR}/deps/libffi_${FFI_ARCH}-windows-static)
    
    if(EXISTS ${LIBFFI_BIN_DIR})
        message(STATUS "Using libffi from: ${LIBFFI_BIN_DIR}")
        
        set(FFI_FOUND TRUE)
        set(FFI_INCLUDE_DIRS ${LIBFFI_BIN_DIR}/include)
        set(FFI_LIBRARIES ${LIBFFI_BIN_DIR}/lib/ffi.lib)
        
        message(STATUS "libffi library: ${FFI_LIBRARIES}")
        message(STATUS "libffi includes: ${FFI_INCLUDE_DIRS}")
        if(EXISTS ${LIBFFI_BIN_DIR}/bin/ffi-8.dll)
            set(FFI_DLL_FILE ${LIBFFI_BIN_DIR}/bin/ffi-8.dll)
            message(STATUS "libffi DLL: ${FFI_DLL_FILE}")
        endif()
    endif()
else()
    # Su Linux/macOS, usa pkg-config
    find_package(PkgConfig QUIET)
    if(PkgConfig_FOUND)
        pkg_check_modules(FFI QUIET libffi)
        if(FFI_FOUND)
            message(STATUS "Found libffi via pkg-config")
        endif()
    endif()
    
    # Fallback: cerca manualmente
    if(NOT FFI_FOUND)
        find_path(FFI_INCLUDE_DIR ffi.h
            PATHS /usr/include /usr/local/include /opt/homebrew/include
        )
        find_library(FFI_LIBRARY NAMES ffi
            PATHS /usr/lib /usr/local/lib /opt/homebrew/lib
        )
        if(FFI_INCLUDE_DIR AND FFI_LIBRARY)
            set(FFI_FOUND TRUE)
            set(FFI_INCLUDE_DIRS ${FFI_INCLUDE_DIR})
            set(FFI_LIBRARIES ${FFI_LIBRARY})
        endif()
    endif()
endif()

if(NOT FFI_FOUND)
    message(FATAL_ERROR "libffi not found!")
endif()

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

if(NODE_ADDON_API_DIR)
    string(REGEX REPLACE "[\r\n\"]" "" NODE_ADDON_API_DIR "${NODE_ADDON_API_DIR}")
    target_include_directories(${PROJECT_NAME} PRIVATE ${NODE_ADDON_API_DIR})
endif()

# Include directories
if(CMAKE_JS_INC)
    target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_JS_INC})
endif()

# third-party
target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/third-party)

# libffi
target_include_directories(${PROJECT_NAME} PRIVATE ${FFI_INCLUDE_DIRS})
target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/src)

# Link
if(CMAKE_JS_LIB)
    target_link_libraries(${PROJECT_NAME} PRIVATE ${CMAKE_JS_LIB})
endif()

target_link_libraries(${PROJECT_NAME} PRIVATE ${FFI_LIBRARIES})

# Windows specifiche
if(WIN32)    
    # Copia DLL nella directory di output
    if(FFI_DLL_FILE)
        add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${FFI_DLL_FILE}"
                "$<TARGET_FILE_DIR:${PROJECT_NAME}>"
            COMMENT "Copying libffi DLL..."
        )
    endif()
endif()

if(MSVC)
    target_compile_options(${PROJECT_NAME} PRIVATE /utf-8)
    target_compile_options(${PROJECT_NAME} PRIVATE /bigobj)
    if(CMAKE_JS_NODELIB_DEF AND CMAKE_JS_NODELIB_TARGET)
        execute_process(COMMAND ${CMAKE_AR} /def:${CMAKE_JS_NODELIB_DEF} /out:${CMAKE_JS_NODELIB_TARGET} ${CMAKE_STATIC_LINKER_FLAGS})
    endif()
endif()

# ============================================================================
# Info
# ============================================================================

message(STATUS "")
message(STATUS "=== node-ctypes ===")
message(STATUS "  Platform: ${CMAKE_SYSTEM_NAME}")
message(STATUS "  Architecture: ${FFI_ARCH}")
message(STATUS "  libffi: ${FFI_LIBRARIES}")
message(STATUS "===================")
