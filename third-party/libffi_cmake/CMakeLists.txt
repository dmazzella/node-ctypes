# ============================================================================
# libffi_cmake - CMake build for libffi (node-ctypes)
# ============================================================================
#
# This directory contains CMake configuration to build libffi from source.
# The actual libffi sources are in ../libffi (unmodified upstream).
#
# Structure:
#   third-party/libffi/        - Upstream libffi sources (git submodule)
#   third-party/libffi_cmake/  - CMake build configuration (this directory)
#     CMakeLists.txt           - Build script
#     fficonfig/               - Platform-agnostic configuration headers
#       fficonfig.h            - Replaces autotools-generated config
#       ffi.h                  - Unified public header
#
# To update libffi:
#   1. cd third-party/libffi && git fetch && git checkout vX.Y.Z
#   2. Run: npm run generate-ffi-headers
#   3. Run: npm run rebuild
#
# Supported platforms:
# - Windows x64 (MSVC)
# - Windows ARM64 (MSVC)
# - Linux x64 (GCC, Clang)
# - Linux ARM64 (GCC, Clang)
# - macOS x64 (Clang)
# - macOS ARM64 (Clang)
#
# ============================================================================

cmake_minimum_required(VERSION 3.15)
project(ffi C)

# Path to libffi sources
set(LIBFFI_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../libffi")

if(NOT EXISTS "${LIBFFI_SOURCE_DIR}/src/prep_cif.c")
    message(FATAL_ERROR "[libffi] Source directory not found: ${LIBFFI_SOURCE_DIR}")
endif()

# ============================================================================
# Detect Architecture
# ============================================================================

set(FFI_ARCH "unknown")

if(CMAKE_SYSTEM_PROCESSOR MATCHES "AMD64|x86_64|amd64")
    set(FFI_ARCH "x86_64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|ARM64|arm64")
    set(FFI_ARCH "aarch64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "^arm|armv5l|armv6l|armv7l|armv7hf")
    set(FFI_ARCH "arm")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "i[3-6]86|x86")
    set(FFI_ARCH "x86")
endif()

# Override for cross-compilation
if(DEFINED FFI_ARCHITECTURE)
    set(FFI_ARCH ${FFI_ARCHITECTURE})
endif()

message(STATUS "[libffi] Target architecture: ${FFI_ARCH}")
message(STATUS "[libffi] Target system: ${CMAKE_SYSTEM_NAME}")
message(STATUS "[libffi] Compiler: ${CMAKE_C_COMPILER_ID}")

# ============================================================================
# Common Sources
# ============================================================================

set(FFI_SOURCES
    ${LIBFFI_SOURCE_DIR}/src/prep_cif.c
    ${LIBFFI_SOURCE_DIR}/src/types.c
    ${LIBFFI_SOURCE_DIR}/src/closures.c
    ${LIBFFI_SOURCE_DIR}/src/tramp.c
    ${LIBFFI_SOURCE_DIR}/src/raw_api.c
)

# Architecture directory mapping
if(FFI_ARCH STREQUAL "x86_64" OR FFI_ARCH STREQUAL "x86")
    set(FFI_ARCH_DIR "x86")
elseif(FFI_ARCH STREQUAL "aarch64")
    set(FFI_ARCH_DIR "aarch64")
elseif(FFI_ARCH STREQUAL "arm")
    set(FFI_ARCH_DIR "arm")
else()
    message(FATAL_ERROR "[libffi] Unsupported architecture: ${FFI_ARCH}")
endif()

# ============================================================================
# Include directories (needed for preprocessing)
# ============================================================================

set(FFI_INCLUDE_DIRS_INTERNAL
    ${CMAKE_CURRENT_SOURCE_DIR}/fficonfig
    ${LIBFFI_SOURCE_DIR}/include
    ${LIBFFI_SOURCE_DIR}/src
    ${LIBFFI_SOURCE_DIR}/src/${FFI_ARCH_DIR}
)

# ============================================================================
# Platform-Specific Sources and Assembly Handling
# ============================================================================

if(WIN32 AND MSVC AND NOT CMAKE_C_COMPILER_ID MATCHES "Clang")
    # ========================================================================
    # Windows MSVC: Preprocess .S files then assemble with MASM
    # ========================================================================
    
    enable_language(ASM_MASM)
    
    # Build include flags for preprocessor
    set(FFI_INCLUDE_FLAGS "")
    foreach(dir ${FFI_INCLUDE_DIRS_INTERNAL})
        list(APPEND FFI_INCLUDE_FLAGS "/I${dir}")
    endforeach()
    
    # Function to preprocess a .S file for MASM
    # Runs C preprocessor to expand macros and includes
    function(preprocess_asm_file INPUT_FILE OUTPUT_NAME)
        set(OUTPUT_FILE "${CMAKE_CURRENT_BINARY_DIR}/${OUTPUT_NAME}.asm")
        
        add_custom_command(
            OUTPUT ${OUTPUT_FILE}
            COMMAND ${CMAKE_C_COMPILER} 
                /EP
                /DWIN32
                /D_WIN32
                /DFFI_BUILDING
                /DHAVE_CONFIG_H
                ${FFI_INCLUDE_FLAGS}
                ${INPUT_FILE}
                > ${OUTPUT_FILE}
            DEPENDS ${INPUT_FILE}
            COMMENT "Preprocessing ${INPUT_FILE} for MASM..."
            VERBATIM
        )
        
        set(${OUTPUT_NAME}_ASM ${OUTPUT_FILE} PARENT_SCOPE)
    endfunction()
    
    if(FFI_ARCH STREQUAL "x86_64")
        # Windows x64
        list(APPEND FFI_SOURCES
            ${LIBFFI_SOURCE_DIR}/src/x86/ffiw64.c
        )
        
        # Preprocess win64_intel.S
        preprocess_asm_file(
            ${LIBFFI_SOURCE_DIR}/src/x86/win64_intel.S
            win64_intel
        )
        list(APPEND FFI_SOURCES ${win64_intel_ASM})
        
        set(FFI_TARGET "X86_WIN64")
        
    elseif(FFI_ARCH STREQUAL "aarch64")
        # Windows ARM64
        list(APPEND FFI_SOURCES
            ${LIBFFI_SOURCE_DIR}/src/aarch64/ffi.c
        )
        
        # ARM64 uses armasm
        enable_language(ASM_MARMASM)
        preprocess_asm_file(
            ${LIBFFI_SOURCE_DIR}/src/aarch64/win64_armasm.S
            win64_armasm
        )
        list(APPEND FFI_SOURCES ${win64_armasm_ASM})
        
        set(FFI_TARGET "AARCH64")
        
    elseif(FFI_ARCH STREQUAL "x86")
        # Windows x86 32-bit
        list(APPEND FFI_SOURCES
            ${LIBFFI_SOURCE_DIR}/src/x86/ffi.c
        )

        preprocess_asm_file(
            ${LIBFFI_SOURCE_DIR}/src/x86/sysv_intel.S
            sysv_intel
        )
        list(APPEND FFI_SOURCES ${sysv_intel_ASM})

        set(FFI_TARGET "X86_WIN32")

    elseif(FFI_ARCH STREQUAL "arm")
        # Windows ARM32
        list(APPEND FFI_SOURCES
            ${LIBFFI_SOURCE_DIR}/src/arm/ffi.c
        )

        # ARM32 uses armasm for Windows
        enable_language(ASM_MARMASM)

        # Check if sysv_msvc_arm32.S exists, otherwise use sysv.S
        if(EXISTS ${LIBFFI_SOURCE_DIR}/src/arm/sysv_msvc_arm32.S)
            preprocess_asm_file(
                ${LIBFFI_SOURCE_DIR}/src/arm/sysv_msvc_arm32.S
                sysv_msvc_arm32
            )
            list(APPEND FFI_SOURCES ${sysv_msvc_arm32_ASM})
        else()
            preprocess_asm_file(
                ${LIBFFI_SOURCE_DIR}/src/arm/sysv.S
                sysv_arm
            )
            list(APPEND FFI_SOURCES ${sysv_arm_ASM})
        endif()

        set(FFI_TARGET "ARM")
    endif()

else()
    # ========================================================================
    # Unix (Linux/macOS) or Clang on Windows: Direct assembly compilation
    # ========================================================================
    
    enable_language(ASM)
    
    if(FFI_ARCH STREQUAL "x86_64")
        if(WIN32)
            # Clang on Windows
            list(APPEND FFI_SOURCES
                ${LIBFFI_SOURCE_DIR}/src/x86/ffiw64.c
                ${LIBFFI_SOURCE_DIR}/src/x86/win64.S
            )
            set(FFI_TARGET "X86_WIN64")
        else()
            # Linux/macOS x64
            list(APPEND FFI_SOURCES
                ${LIBFFI_SOURCE_DIR}/src/x86/ffi64.c
                ${LIBFFI_SOURCE_DIR}/src/x86/ffiw64.c
                ${LIBFFI_SOURCE_DIR}/src/x86/unix64.S
                ${LIBFFI_SOURCE_DIR}/src/x86/win64.S
            )
            set(FFI_TARGET "X86_64")
        endif()

    elseif(FFI_ARCH STREQUAL "aarch64")
        list(APPEND FFI_SOURCES
            ${LIBFFI_SOURCE_DIR}/src/aarch64/ffi.c
        )
        if(WIN32)
            list(APPEND FFI_SOURCES
                ${LIBFFI_SOURCE_DIR}/src/aarch64/win64_armasm.S
            )
        else()
            list(APPEND FFI_SOURCES
                ${LIBFFI_SOURCE_DIR}/src/aarch64/sysv.S
            )
        endif()
        set(FFI_TARGET "AARCH64")

    elseif(FFI_ARCH STREQUAL "arm")
        list(APPEND FFI_SOURCES
            ${LIBFFI_SOURCE_DIR}/src/arm/ffi.c
            ${LIBFFI_SOURCE_DIR}/src/arm/sysv.S
        )
        set(FFI_TARGET "ARM")

    elseif(FFI_ARCH STREQUAL "x86")
        list(APPEND FFI_SOURCES
            ${LIBFFI_SOURCE_DIR}/src/x86/ffi.c
            ${LIBFFI_SOURCE_DIR}/src/x86/sysv.S
        )
        if(WIN32)
            set(FFI_TARGET "X86_WIN32")
        else()
            set(FFI_TARGET "X86")
        endif()
    endif()
    
    # For GCC/Clang assembly files - tell compiler to preprocess them
    if(NOT WIN32 OR CMAKE_C_COMPILER_ID MATCHES "Clang")
        file(GLOB ASM_FILES "${LIBFFI_SOURCE_DIR}/src/${FFI_ARCH_DIR}/*.S")
        set_source_files_properties(${ASM_FILES}
            PROPERTIES
            COMPILE_FLAGS "-x assembler-with-cpp"
        )
    endif()
endif()

message(STATUS "[libffi] FFI_TARGET: ${FFI_TARGET}")

# ============================================================================
# Create Static Library
# ============================================================================

add_library(ffi_static STATIC ${FFI_SOURCES})

# ============================================================================
# Include Directories
# ============================================================================

target_include_directories(ffi_static
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/fficonfig  # Our unified headers
        ${LIBFFI_SOURCE_DIR}/include           # Original includes
        ${LIBFFI_SOURCE_DIR}/src               # For arch/ffitarget.h includes
    PRIVATE
        ${LIBFFI_SOURCE_DIR}/src/${FFI_ARCH_DIR}
)

# ============================================================================
# Compile Definitions
# ============================================================================

target_compile_definitions(ffi_static
    PRIVATE
        FFI_BUILDING
        ${FFI_TARGET}
        HAVE_CONFIG_H
    PUBLIC
        FFI_STATIC_BUILD
)

# Platform-specific definitions
if(WIN32)
    target_compile_definitions(ffi_static PRIVATE _WIN32 WIN32)
    if(FFI_ARCH STREQUAL "x86_64")
        target_compile_definitions(ffi_static PRIVATE X86_WIN64)
    elseif(FFI_ARCH STREQUAL "x86")
        target_compile_definitions(ffi_static PRIVATE X86_WIN32)
    endif()
elseif(APPLE)
    target_compile_definitions(ffi_static PRIVATE MACOSX)
    if(FFI_ARCH STREQUAL "x86_64")
        target_compile_definitions(ffi_static PRIVATE X86_DARWIN)
    endif()
endif()

# ============================================================================
# Compiler Flags
# ============================================================================

if(MSVC)
    # Apply warning suppressions only to C files (not ASM_MASM)
    target_compile_options(ffi_static PRIVATE
        $<$<COMPILE_LANGUAGE:C>:/W3>
        $<$<COMPILE_LANGUAGE:C>:/wd4996>   # Deprecation warnings
        $<$<COMPILE_LANGUAGE:C>:/wd4018>   # Signed/unsigned mismatch
        $<$<COMPILE_LANGUAGE:C>:/wd4267>   # size_t to int conversion
    )
else()
    target_compile_options(ffi_static PRIVATE
        -Wall
        -fPIC
    )
endif()

# ============================================================================
# Export the target
# ============================================================================

# Alias for easier use in parent project
add_library(libffi::ffi ALIAS ffi_static)

# Export include directories for consumers
set(FFI_INCLUDE_DIRS 
    ${CMAKE_CURRENT_SOURCE_DIR}/fficonfig
    ${LIBFFI_SOURCE_DIR}/include
    ${LIBFFI_SOURCE_DIR}/src
    PARENT_SCOPE
)

set(FFI_LIBRARIES ffi_static PARENT_SCOPE)

message(STATUS "[libffi] Configuration complete")
