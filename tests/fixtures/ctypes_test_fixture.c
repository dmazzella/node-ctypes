/*
 * Native fixture for the node-ctypes tests (and their Python ctypes twins):
 * C functions that exercise the cases libc cannot, such as structures by
 * value with bit fields, array parameters and reentrant variadic calls.
 *
 * Built by `npm run build:test-fixture` (run automatically by `npm test` in
 * tests/) into build/fixture/; not part of the published package.
 */

#include <errno.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#define FIXTURE_API __declspec(dllexport)
#else
#include <pthread.h>
#include <time.h>
#define FIXTURE_API __attribute__((visibility("default")))
#endif

FIXTURE_API int32_t fixture_global_value = 42;
FIXTURE_API int32_t* fixture_global_pointer = &fixture_global_value;
struct FixtureGlobalRecord {
  int32_t value;
  int32_t* pointer;
};
FIXTURE_API struct FixtureGlobalRecord fixture_global_record = {7, &fixture_global_value};
FIXTURE_API void fixture_reset_global_pointer(void) {
  fixture_global_record.pointer = &fixture_global_value;
}
FIXTURE_API void fixture_clear_global_pointer(void) {
  fixture_global_record.pointer = NULL;
}
static int32_t fixture_increment(int32_t value) {
  return value + 1;
}

#ifdef _MSC_VER
#define FIXTURE_THREAD_LOCAL __declspec(thread)
#else
#define FIXTURE_THREAD_LOCAL _Thread_local
#endif

static FIXTURE_THREAD_LOCAL intptr_t fixture_context;
static FIXTURE_THREAD_LOCAL intptr_t fixture_native_error;
static FIXTURE_THREAD_LOCAL int fixture_notifications;

FIXTURE_API void fixture_notify_context(void) {
  fixture_notifications += fixture_context == -1 ? 1 : -1000;
}

FIXTURE_API void* fixture_suspend_context(void) {
  intptr_t state = fixture_context;
  fixture_context = -1;
  return (void*)state;
}
FIXTURE_API void fixture_resume_context(void* state) {
  fixture_context = fixture_context == -1 ? (intptr_t)state : -2;
}
FIXTURE_API void fixture_set_native_error(void* error) {
  fixture_native_error = (intptr_t)error;
}
FIXTURE_API intptr_t fixture_current_context(void) {
  return fixture_context;
}
FIXTURE_API int32_t fixture_context_callback(int32_t (*callback)(int32_t), int32_t value) {
  intptr_t previous_context = fixture_context;
  intptr_t previous_error = fixture_native_error;
  fixture_context = value;
  fixture_native_error = 0;
  int32_t result = callback(value);
  if (fixture_context != value) {
    result = -999;
  } else if (fixture_native_error != 0) {
    result = -(int32_t)fixture_native_error;
  }
  fixture_context = previous_context;
  fixture_native_error = previous_error;
  return result;
}
FIXTURE_API int32_t fixture_notified_context_callback(int32_t (*callback)(int32_t), int32_t value) {
  int previous = fixture_notifications;
  fixture_notifications = 0;
  int32_t result = fixture_context_callback(callback, value);
  if (fixture_notifications != 1) {
    result = -998;
  }
  fixture_notifications = previous;
  return result;
}

struct FixtureFunctionRecord {
  int32_t (*function)(int32_t);
};
FIXTURE_API struct FixtureFunctionRecord fixture_global_function = {fixture_increment};

#ifdef _WIN32
static wchar_t fixture_unload_path[4096];
FIXTURE_API int32_t fixture_set_unload_marker(const char* path) {
  return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, fixture_unload_path, 4096) > 0;
}
BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID reserved) {
  (void)module;
  (void)reserved;
  if (reason == DLL_PROCESS_DETACH && fixture_unload_path[0]) {
    HANDLE file = CreateFileW(fixture_unload_path, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, NULL);
    if (file != INVALID_HANDLE_VALUE) {
      DWORD written;
      WriteFile(file, "unloaded", 8, &written, NULL);
      CloseHandle(file);
    }
  }
  return TRUE;
}
#else
static char fixture_unload_path[4096];
FIXTURE_API int32_t fixture_set_unload_marker(const char* path) {
  const size_t size = strlen(path);
  if (size >= sizeof(fixture_unload_path)) {
    return 0;
  }
  memcpy(fixture_unload_path, path, size + 1);
  return 1;
}
__attribute__((destructor)) static void fixture_on_unload(void) {
  if (fixture_unload_path[0]) {
    FILE* file = fopen(fixture_unload_path, "w");
    if (file) {
      fputs("unloaded", file);
      fclose(file);
    }
  }
}
#endif

#if defined(_MSC_VER) && !defined(__clang__)
#define FIXTURE_ALIGN16 __declspec(align(16))
#else
#define FIXTURE_ALIGN16 _Alignas(16)
#endif

/* Array parameters: arrays are passed by address. */

FIXTURE_API uintptr_t fixture_address(const void* pointer) {
  return (uintptr_t)pointer;
}

FIXTURE_API const void* fixture_echo_pointer(const void* pointer) {
  return pointer;
}

FIXTURE_API size_t fixture_echo_size_t(size_t value) {
  return value;
}

FIXTURE_API int32_t fixture_benchmark_zero(void) {
  return 7;
}

/* Monotonic time in microseconds. */
static uint64_t fixture_now_us(void) {
#ifdef _WIN32
  LARGE_INTEGER frequency;
  LARGE_INTEGER counter;
  QueryPerformanceFrequency(&frequency);
  QueryPerformanceCounter(&counter);
  return (uint64_t)(counter.QuadPart / (frequency.QuadPart / 1000000));
#else
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (uint64_t)now.tv_sec * 1000000u + (uint64_t)now.tv_nsec / 1000u;
#endif
}

/* Keeps the calling thread busy for `microseconds` (a native call of known
 * duration, shorter and more precise than a sleep); returns them. */
FIXTURE_API uint32_t fixture_busy_wait_us(uint32_t microseconds) {
  const uint64_t end = fixture_now_us() + microseconds;
  while (fixture_now_us() < end) {
  }
  return microseconds;
}

/* Identity of the thread that runs the call; the argument is ignored (a slot
 * for argument adapters such as from_param). */
FIXTURE_API uint64_t fixture_current_thread(const void* unused) {
  (void)unused;
#ifdef _WIN32
  return (uint64_t)GetCurrentThreadId();
#else
  return (uint64_t)(uintptr_t)pthread_self();
#endif
}

FIXTURE_API size_t fixture_string_length(const char* value) {
  return strlen(value);
}

FIXTURE_API size_t fixture_wstring_length(const wchar_t* value) {
  return wcslen(value);
}

FIXTURE_API size_t fixture_mixed_string_lengths(const char* first, const wchar_t* middle, const char* last) {
  return strlen(first) + wcslen(middle) + strlen(last);
}

#define FIXTURE_SCALAR(name, type)                                               \
  FIXTURE_API type fixture_scalar_##name(type value) {                           \
    return value;                                                                \
  }                                                                              \
  FIXTURE_API type fixture_scalar_##name##_tail(type value, const char* tail) {  \
    (void)tail;                                                                  \
    return value;                                                                \
  }                                                                              \
  FIXTURE_API type fixture_callback_##name(type (*callback)(type), type value) { \
    return callback(value);                                                      \
  }

FIXTURE_SCALAR(i8, int8_t)
FIXTURE_SCALAR(u8, uint8_t)
FIXTURE_SCALAR(i16, int16_t)
FIXTURE_SCALAR(u16, uint16_t)
FIXTURE_SCALAR(i32, int32_t)
FIXTURE_SCALAR(u32, uint32_t)
FIXTURE_SCALAR(i64, int64_t)
FIXTURE_SCALAR(u64, uint64_t)
FIXTURE_SCALAR(size, size_t)
FIXTURE_SCALAR(ssize, intptr_t)
FIXTURE_SCALAR(long, long)
FIXTURE_SCALAR(ulong, unsigned long)
FIXTURE_SCALAR(float, float)
FIXTURE_SCALAR(double, double)
FIXTURE_SCALAR(char, char)
FIXTURE_SCALAR(wchar, wchar_t)
FIXTURE_SCALAR(bool, bool)

#undef FIXTURE_SCALAR

FIXTURE_API int32_t fixture_callback_zero(int32_t (*callback)(void)) {
  return callback();
}

FIXTURE_API int32_t fixture_callback_void(void (*callback)(void)) {
  callback();
  return 73;
}

FIXTURE_API void* fixture_callback_pointer(void* (*callback)(void*), void* value) {
  return callback(value);
}

FIXTURE_API const char* fixture_callback_string(const char* (*callback)(const char*), const char* value) {
  return callback(value);
}

FIXTURE_API const wchar_t* fixture_callback_wstring(const wchar_t* (*callback)(const wchar_t*), const wchar_t* value) {
  return callback(value);
}

FIXTURE_API int64_t fixture_callback_narrow_stack(int64_t (*callback)(int8_t,
                                                                      uint8_t,
                                                                      int16_t,
                                                                      uint16_t,
                                                                      int8_t,
                                                                      uint8_t,
                                                                      int16_t,
                                                                      uint16_t,
                                                                      int8_t,
                                                                      uint8_t,
                                                                      int16_t,
                                                                      uint16_t,
                                                                      int8_t,
                                                                      uint8_t,
                                                                      int16_t,
                                                                      uint16_t)) {
  return callback(-128, 255, -32768, 65535, -1, 128, -2, 32768, -127, 254, -32767, 65534, -3, 129, -4, 32769);
}

FIXTURE_API double fixture_callback_mixed_stack(double (*callback)(int32_t,
                                                                   float,
                                                                   double,
                                                                   int32_t,
                                                                   float,
                                                                   double,
                                                                   int32_t,
                                                                   float,
                                                                   double,
                                                                   int32_t,
                                                                   float,
                                                                   double,
                                                                   int32_t,
                                                                   float,
                                                                   double,
                                                                   int32_t,
                                                                   float,
                                                                   double,
                                                                   int32_t,
                                                                   float,
                                                                   double,
                                                                   int32_t,
                                                                   float,
                                                                   double,
                                                                   int32_t,
                                                                   float,
                                                                   double)) {
  return callback(-1, 0.25f, 0.5, -2, 1.25f, 1.5, -3, 2.25f, 2.5, -4, 3.25f, 3.5, -5, 4.25f, 4.5, -6, 5.25f, 5.5, -7,
                  6.25f, 6.5, -8, 7.25f, 7.5, -9, 8.25f, 8.5);
}

FIXTURE_API double fixture_callback_narrow_mixed_stack(double (*callback)(int32_t,
                                                                          int32_t,
                                                                          int32_t,
                                                                          int32_t,
                                                                          int32_t,
                                                                          int32_t,
                                                                          int32_t,
                                                                          int32_t,
                                                                          double,
                                                                          double,
                                                                          double,
                                                                          double,
                                                                          double,
                                                                          double,
                                                                          double,
                                                                          double,
                                                                          int8_t,
                                                                          uint8_t,
                                                                          int16_t,
                                                                          uint16_t,
                                                                          int8_t,
                                                                          uint8_t,
                                                                          int16_t,
                                                                          uint16_t,
                                                                          float,
                                                                          double)) {
  return callback(-1, -2, -3, -4, -5, -6, -7, -8, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, -128, 255, -32768, 65535,
                  -127, 254, -32767, 65534, 8.25f, 9.5);
}

#define FIXTURE_CALLBACK_I32_ARGS_32                                                                                   \
  int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, \
    int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t,        \
    int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t
#define FIXTURE_CALLBACK_I32_VALUES_32 \
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32

FIXTURE_API int64_t fixture_callback_i32_32(int64_t (*callback)(FIXTURE_CALLBACK_I32_ARGS_32)) {
  return callback(FIXTURE_CALLBACK_I32_VALUES_32);
}

FIXTURE_API int64_t fixture_callback_i32_33(int64_t (*callback)(FIXTURE_CALLBACK_I32_ARGS_32, int32_t)) {
  return callback(FIXTURE_CALLBACK_I32_VALUES_32, 33);
}

#undef FIXTURE_CALLBACK_I32_ARGS_32
#undef FIXTURE_CALLBACK_I32_VALUES_32

FIXTURE_API int64_t fixture_callback_loop(int32_t (*callback)(int32_t), int32_t count) {
  int64_t result = 0;
  for (int32_t i = 0; i < count; i++) {
    result += callback(i);
  }
  return result;
}

FIXTURE_API int32_t fixture_callback_reenter(int32_t (*callback)(int32_t), int32_t depth) {
  return callback(depth);
}

#define FIXTURE_CONVERSION(name, result, argument)    \
  FIXTURE_API result fixture_##name(argument value) { \
    return (result)value;                             \
  }

FIXTURE_CONVERSION(promote_i8, int32_t, int8_t)
FIXTURE_CONVERSION(promote_u8, int32_t, uint8_t)
FIXTURE_CONVERSION(promote_i16, int32_t, int16_t)
FIXTURE_CONVERSION(promote_u16, int32_t, uint16_t)
FIXTURE_CONVERSION(promote_bool, int32_t, bool)
FIXTURE_CONVERSION(narrow_i8, int8_t, int32_t)
FIXTURE_CONVERSION(narrow_u8, uint8_t, int32_t)
FIXTURE_CONVERSION(narrow_i16, int16_t, int32_t)
FIXTURE_CONVERSION(narrow_u16, uint16_t, int32_t)
FIXTURE_CONVERSION(narrow_bool, bool, int32_t)

#undef FIXTURE_CONVERSION

FIXTURE_API double fixture_exact_mixed(int32_t a, double b, float c, int32_t d) {
  return a + 2 * b + 3 * c + d;
}

FIXTURE_API uint64_t fixture_exact_u64_four(uint64_t a, uint64_t b, uint64_t c, uint64_t d) {
  return a ^ b ^ c ^ d;
}

FIXTURE_API uint64_t fixture_u64_pair_callback(uint64_t (*callback)(uint64_t, uint64_t),
                                               uint64_t first,
                                               uint64_t second) {
  return callback(first, second);
}

FIXTURE_API int32_t fixture_exact_fallback(int16_t a, int32_t b, uint64_t c) {
  return a + b + (int32_t)c;
}

FIXTURE_API int64_t fixture_abi_i32_stack(int32_t a0,
                                          int32_t a1,
                                          int32_t a2,
                                          int32_t a3,
                                          int32_t a4,
                                          int32_t a5,
                                          int32_t a6,
                                          int32_t a7,
                                          int32_t a8,
                                          int32_t a9) {
  return (int64_t)a0 + 2 * (int64_t)a1 + 3 * (int64_t)a2 + 4 * (int64_t)a3 + 5 * (int64_t)a4 + 6 * (int64_t)a5 +
         7 * (int64_t)a6 + 8 * (int64_t)a7 + 9 * (int64_t)a8 + 10 * (int64_t)a9;
}

FIXTURE_API uint64_t fixture_abi_u64_stack(uint64_t a0,
                                           uint64_t a1,
                                           uint64_t a2,
                                           uint64_t a3,
                                           uint64_t a4,
                                           uint64_t a5,
                                           uint64_t a6,
                                           uint64_t a7,
                                           uint64_t a8,
                                           uint64_t a9) {
  return a0 ^ (a1 << 1) ^ (a2 << 2) ^ (a3 << 3) ^ (a4 << 4) ^ (a5 << 5) ^ (a6 << 6) ^ (a7 << 7) ^ (a8 << 8) ^ (a9 << 9);
}

FIXTURE_API int64_t fixture_abi_narrow_stack(int8_t a0,
                                             uint8_t a1,
                                             int16_t a2,
                                             uint16_t a3,
                                             int8_t a4,
                                             uint8_t a5,
                                             int16_t a6,
                                             uint16_t a7,
                                             int8_t a8,
                                             uint8_t a9,
                                             int16_t a10,
                                             uint16_t a11,
                                             int8_t a12,
                                             uint8_t a13,
                                             int16_t a14,
                                             uint16_t a15) {
  return (int64_t)a0 + 2 * (int64_t)a1 + 3 * (int64_t)a2 + 4 * (int64_t)a3 + 5 * (int64_t)a4 + 6 * (int64_t)a5 +
         7 * (int64_t)a6 + 8 * (int64_t)a7 + 9 * (int64_t)a8 + 10 * (int64_t)a9 + 11 * (int64_t)a10 +
         12 * (int64_t)a11 + 13 * (int64_t)a12 + 14 * (int64_t)a13 + 15 * (int64_t)a14 + 16 * (int64_t)a15;
}

FIXTURE_API double fixture_abi_narrow_mixed_stack(int32_t i0,
                                                  int32_t i1,
                                                  int32_t i2,
                                                  int32_t i3,
                                                  int32_t i4,
                                                  int32_t i5,
                                                  int32_t i6,
                                                  int32_t i7,
                                                  double d0,
                                                  double d1,
                                                  double d2,
                                                  double d3,
                                                  double d4,
                                                  double d5,
                                                  double d6,
                                                  double d7,
                                                  int8_t n0,
                                                  uint8_t n1,
                                                  int16_t n2,
                                                  uint16_t n3,
                                                  int8_t n4,
                                                  uint8_t n5,
                                                  int16_t n6,
                                                  uint16_t n7,
                                                  float f8,
                                                  double d8) {
  return i0 + 2 * i1 + 3 * i2 + 4 * i3 + 5 * i4 + 6 * i5 + 7 * i6 + 8 * i7 + 9 * d0 + 10 * d1 + 11 * d2 + 12 * d3 +
         13 * d4 + 14 * d5 + 15 * d6 + 16 * d7 + 17 * n0 + 18 * n1 + 19 * n2 + 20 * n3 + 21 * n4 + 22 * n5 + 23 * n6 +
         24 * n7 + 25 * f8 + 26 * d8;
}

FIXTURE_API double fixture_abi_mixed_stack(int32_t i0,
                                           float f0,
                                           double d0,
                                           int32_t i1,
                                           float f1,
                                           double d1,
                                           int32_t i2,
                                           float f2,
                                           double d2,
                                           int32_t i3,
                                           float f3,
                                           double d3,
                                           int32_t i4,
                                           float f4,
                                           double d4,
                                           int32_t i5,
                                           float f5,
                                           double d5,
                                           int32_t i6,
                                           float f6,
                                           double d6,
                                           int32_t i7,
                                           float f7,
                                           double d7,
                                           int32_t i8,
                                           float f8,
                                           double d8) {
  return (i0 + (double)f0 + d0) + 2 * (i1 + (double)f1 + d1) + 3 * (i2 + (double)f2 + d2) + 4 * (i3 + (double)f3 + d3) +
         5 * (i4 + (double)f4 + d4) + 6 * (i5 + (double)f5 + d5) + 7 * (i6 + (double)f6 + d6) +
         8 * (i7 + (double)f7 + d7) + 9 * (i8 + (double)f8 + d8);
}

#define FIXTURE_I32_ARGS32                                                                                    \
  int32_t a0, int32_t a1, int32_t a2, int32_t a3, int32_t a4, int32_t a5, int32_t a6, int32_t a7, int32_t a8, \
    int32_t a9, int32_t a10, int32_t a11, int32_t a12, int32_t a13, int32_t a14, int32_t a15, int32_t a16,    \
    int32_t a17, int32_t a18, int32_t a19, int32_t a20, int32_t a21, int32_t a22, int32_t a23, int32_t a24,   \
    int32_t a25, int32_t a26, int32_t a27, int32_t a28, int32_t a29, int32_t a30, int32_t a31
#define FIXTURE_I32_SUM32                                                                                        \
  (a0 + 2 * a1 + 3 * a2 + 4 * a3 + 5 * a4 + 6 * a5 + 7 * a6 + 8 * a7 + 9 * a8 + 10 * a9 + 11 * a10 + 12 * a11 +  \
   13 * a12 + 14 * a13 + 15 * a14 + 16 * a15 + 17 * a16 + 18 * a17 + 19 * a18 + 20 * a19 + 21 * a20 + 22 * a21 + \
   23 * a22 + 24 * a23 + 25 * a24 + 26 * a25 + 27 * a26 + 28 * a27 + 29 * a28 + 30 * a29 + 31 * a30 + 32 * a31)

FIXTURE_API int32_t fixture_abi_i32_32(FIXTURE_I32_ARGS32) {
  return FIXTURE_I32_SUM32;
}

FIXTURE_API int32_t fixture_abi_i32_33(FIXTURE_I32_ARGS32, int32_t a32) {
  return FIXTURE_I32_SUM32 + 33 * a32;
}

#undef FIXTURE_I32_ARGS32
#undef FIXTURE_I32_SUM32

struct FixtureBoolBits {
  bool first : 1;
  bool second : 1;
};

FIXTURE_API uint8_t fixture_bool_bits(int32_t first, int32_t second) {
  struct FixtureBoolBits value = {0};
  value.first = first;
  value.second = second;
  uint8_t bytes = 0;
  memcpy(&bytes, &value, sizeof(bytes));
  return bytes;
}

FIXTURE_API int16_t fixture_variant_callback(int16_t (*callback)(int16_t), int16_t value) {
  return callback(value);
}

FIXTURE_API int32_t fixture_scalar_callback(int32_t (*callback)(int32_t), int32_t value) {
  return callback(value);
}

FIXTURE_API int32_t fixture_owner_check(const void* pointer, int32_t (*check)(void)) {
  (void)pointer;
  return check();
}

FIXTURE_API double fixture_nan_payload(void) {
  const uint64_t bits = UINT64_C(0x7ff8000000001234);
  double value;
  memcpy(&value, &bits, sizeof(value));
  return value;
}

FIXTURE_API uint32_t fixture_variadic_wchar(int32_t unused, ...) {
  (void)unused;
  va_list arguments;
  va_start(arguments, unused);
  const wchar_t* text = va_arg(arguments, const wchar_t*);
  wchar_t first;
  memcpy(&first, text, sizeof(first));
  va_end(arguments);
  return (uint32_t)first;
}

/* Variadic callee that Python code commonly declares with fixed argtypes
   (argtypes = [c_int, c_double, ...]). libffi still sets up the variadic ABI
   on x86-64: floats mirrored into integer registers on Win64, AL on SysV. */
FIXTURE_API double fixture_variadic_double_sum(int32_t count, ...) {
  va_list arguments;
  va_start(arguments, count);
  double total = 0.0;
  for (int32_t i = 0; i < count; i++) {
    total += va_arg(arguments, double);
  }
  va_end(arguments);
  return total;
}

struct FixturePointerValue {
  const void* value;
};

FIXTURE_API uintptr_t fixture_pointer_value(struct FixturePointerValue value) {
  return (uintptr_t)value.value;
}

struct FixturePointerArrayValue {
  const void* values[1];
};

FIXTURE_API uintptr_t fixture_pointer_array_value(struct FixturePointerArrayValue value) {
  return (uintptr_t)value.values[0];
}

FIXTURE_API int32_t fixture_sum_int4(const int32_t values[4]) {
  return values[0] + values[1] + values[2] + values[3];
}

FIXTURE_API void fixture_fill_int4(int32_t values[4], int32_t first) {
  for (int i = 0; i < 4; i++) {
    values[i] = first + i;
  }
}

/* Structures by value. Bit fields of different types follow the layout of
 * the compiler: GCC/Clang ("gcc-sysv") or MSVC ("ms"), as Python ctypes. */

struct FixtureBits {
  uint8_t a : 3;
  uint32_t b : 5;
  uint8_t tail;
};

FIXTURE_API uint32_t fixture_bits_sum(struct FixtureBits value) {
  return value.a * 10000u + value.b * 100u + value.tail;
}

FIXTURE_API struct FixtureBits fixture_bits_make(uint8_t a, uint32_t b, uint8_t tail) {
  struct FixtureBits value = {0};
  value.a = a & 7u;
  value.b = b & 31u;
  value.tail = tail;
  return value;
}

FIXTURE_API size_t fixture_bits_size(void) {
  return sizeof(struct FixtureBits);
}

/* A subclass in Python (class Derived(Base)) is a struct whose first member
 * is the base. */
struct FixtureBase {
  int32_t x;
  int8_t y;
};

struct FixtureDerived {
  struct FixtureBase base;
  int8_t z;
};

FIXTURE_API int32_t fixture_derived_sum(struct FixtureDerived value) {
  return value.base.x * 10000 + value.base.y * 100 + value.z;
}

FIXTURE_API struct FixtureDerived fixture_derived_make(int32_t x, int8_t y, int8_t z) {
  struct FixtureDerived value = {{x, y}, z};
  return value;
}

/* _align_ = 16 */
struct FixtureAligned {
  FIXTURE_ALIGN16 uint8_t a;
  uint32_t b;
};

FIXTURE_API uint32_t fixture_aligned_sum(struct FixtureAligned value) {
  return value.a * 1000u + value.b;
}

FIXTURE_API uint32_t fixture_aligned_callback(uint32_t (*callback)(struct FixtureAligned), uint8_t a, uint32_t b) {
  struct FixtureAligned value = {a, b};
  return callback(value);
}

FIXTURE_API struct FixtureAligned fixture_aligned_make(uint8_t a, uint32_t b) {
  struct FixtureAligned value = {a, b};
  return value;
}

/* Array of structures inside a structure passed by value. */
struct FixturePoint {
  int32_t x;
  int32_t y;
};

FIXTURE_API struct FixturePoint fixture_point_make(int32_t x, int32_t y) {
  struct FixturePoint value = {x, y};
  return value;
}

FIXTURE_API int32_t fixture_point_sum(struct FixturePoint value) {
  return value.x + value.y;
}

FIXTURE_API int32_t fixture_point_callback(int32_t (*callback)(struct FixturePoint), int32_t x, int32_t y) {
  struct FixturePoint value = {x, y};
  return callback(value);
}

FIXTURE_API int32_t fixture_point_sum_extra(struct FixturePoint value, int32_t count, ...) {
  int32_t result = value.x + value.y;
  va_list arguments;
  va_start(arguments, count);
  for (int32_t i = 0; i < count; i++) {
    result += va_arg(arguments, int32_t);
  }
  va_end(arguments);
  return result;
}

FIXTURE_API struct FixturePoint fixture_point_make_tail(int32_t x, int32_t y, const char* tail) {
  (void)tail;
  return fixture_point_make(x, y);
}

#define FIXTURE_BYTES(count)                                                                                          \
  struct FixtureBytes##count {                                                                                        \
    uint8_t values[count];                                                                                            \
  };                                                                                                                  \
  FIXTURE_API struct FixtureBytes##count fixture_bytes_##count##_echo(struct FixtureBytes##count value) {             \
    return value;                                                                                                     \
  }                                                                                                                   \
  FIXTURE_API int64_t fixture_bytes_##count##_stack(int64_t a, int64_t b, int64_t c, int64_t d, int64_t e, int64_t f, \
                                                    int64_t g, struct FixtureBytes##count value, int8_t tail,         \
                                                    uint16_t last) {                                                  \
    int64_t result = a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 17 * tail + 19 * last;                       \
    for (int i = 0; i < count; i++)                                                                                   \
      result += (i + 1) * value.values[i];                                                                            \
    return result;                                                                                                    \
  }                                                                                                                   \
  FIXTURE_API int64_t fixture_bytes_##count##_stack_full(                                                             \
    int64_t a, int64_t b, int64_t c, int64_t d, int64_t e, int64_t f, int64_t g, int64_t h,                           \
    struct FixtureBytes##count value, int8_t tail, uint16_t last) {                                                   \
    return fixture_bytes_##count##_stack(a, b, c, d, e, f, g, value, tail, last) + 8 * h;                             \
  }                                                                                                                   \
  FIXTURE_API int64_t fixture_bytes_##count##_stack_leading(                                                          \
    int64_t a, int64_t b, int64_t c, int64_t d, int64_t e, int64_t f, int64_t g, int64_t h, int8_t leading,           \
    struct FixtureBytes##count value, int8_t tail, uint16_t last) {                                                   \
    return fixture_bytes_##count##_stack_full(a, b, c, d, e, f, g, h, value, tail, last) + 23 * leading;              \
  }                                                                                                                   \
  FIXTURE_API int64_t fixture_bytes_##count##_callback(int64_t (*callback)(struct FixtureBytes##count)) {             \
    struct FixtureBytes##count value;                                                                                 \
    for (int i = 0; i < count; i++)                                                                                   \
      value.values[i] = (uint8_t)(i + 1);                                                                             \
    return callback(value);                                                                                           \
  }                                                                                                                   \
  FIXTURE_API int64_t fixture_bytes_##count##_callback_stack(int64_t (*callback)(                                     \
    int64_t, int64_t, int64_t, int64_t, int64_t, int64_t, int64_t, struct FixtureBytes##count, int8_t, uint16_t)) {   \
    struct FixtureBytes##count value;                                                                                 \
    for (int i = 0; i < count; i++)                                                                                   \
      value.values[i] = (uint8_t)(i + 1);                                                                             \
    return callback(1, 2, 3, 4, 5, 6, 7, value, -128, 65535);                                                         \
  }                                                                                                                   \
  FIXTURE_API int64_t fixture_bytes_##count##_callback_stack_leading(                                                 \
    int64_t (*callback)(int64_t, int64_t, int64_t, int64_t, int64_t, int64_t, int64_t, int64_t, int8_t,               \
                        struct FixtureBytes##count, int8_t, uint16_t)) {                                              \
    struct FixtureBytes##count value;                                                                                 \
    for (int i = 0; i < count; i++)                                                                                   \
      value.values[i] = (uint8_t)(i + 1);                                                                             \
    return callback(1, 2, 3, 4, 5, 6, 7, 8, -127, value, -128, 65535);                                                \
  }

FIXTURE_BYTES(1)
FIXTURE_BYTES(2)
FIXTURE_BYTES(3)
FIXTURE_BYTES(4)
FIXTURE_BYTES(5)
FIXTURE_BYTES(6)
FIXTURE_BYTES(7)
FIXTURE_BYTES(8)
FIXTURE_BYTES(9)
FIXTURE_BYTES(10)
FIXTURE_BYTES(11)
FIXTURE_BYTES(12)
FIXTURE_BYTES(13)
FIXTURE_BYTES(14)
FIXTURE_BYTES(15)
FIXTURE_BYTES(16)
FIXTURE_BYTES(17)
FIXTURE_BYTES(19)
FIXTURE_BYTES(24)
FIXTURE_BYTES(31)
FIXTURE_BYTES(32)
FIXTURE_BYTES(33)
FIXTURE_BYTES(65)
FIXTURE_BYTES(257)
FIXTURE_BYTES(4097)

#undef FIXTURE_BYTES

/* Inspect stack tags without dereferencing a potentially misplaced indirect pointer. */
FIXTURE_API uint32_t fixture_indirect_stack_tags(int64_t a,
                                                 int64_t b,
                                                 int64_t c,
                                                 int64_t d,
                                                 int64_t e,
                                                 int64_t f,
                                                 int64_t g,
                                                 int64_t h,
                                                 int8_t leading,
                                                 struct FixtureBytes17 value,
                                                 int8_t tail,
                                                 uint16_t last) {
  (void)a;
  (void)b;
  (void)c;
  (void)d;
  (void)e;
  (void)f;
  (void)g;
  (void)h;
  (void)value;
  return (uint8_t)leading | ((uint32_t)(uint8_t)tail << 8) | ((uint32_t)last << 16);
}

FIXTURE_API struct FixtureBytes33 fixture_large_mutate(struct FixtureBytes33 value, uint8_t mask) {
  volatile uint8_t* bytes = value.values;
  for (int i = 0; i < 33; i++) {
    bytes[i] ^= mask;
  }
  return value;
}

FIXTURE_API struct FixtureBytes33 fixture_large_alias(struct FixtureBytes33 first,
                                                      struct FixtureBytes33 second,
                                                      uint8_t mask) {
  volatile uint8_t* bytes = first.values;
  for (int i = 0; i < 33; i++) {
    bytes[i] ^= mask;
  }
  return second;
}

FIXTURE_API int32_t fixture_callback_large_alias(int32_t (*callback)(struct FixtureBytes33,
                                                                     struct FixtureBytes33,
                                                                     const uint8_t*),
                                                 uint8_t seed) {
  struct FixtureBytes33 value;
  for (int i = 0; i < 33; i++) {
    value.values[i] = (uint8_t)(seed + i);
  }
  const int32_t result = callback(value, value, value.values);
  for (int i = 0; i < 33; i++) {
    if (value.values[i] != (uint8_t)(seed + i)) {
      return -1;
    }
  }
  return result;
}

FIXTURE_API struct FixtureBytes33 fixture_large_variadic(struct FixtureBytes33 value, int32_t count, ...) {
  va_list arguments;
  va_start(arguments, count);
  for (int i = 0; i < count; i++) {
    value.values[32] ^= (uint8_t)va_arg(arguments, int32_t);
  }
  va_end(arguments);
  return value;
}

FIXTURE_API struct FixtureBytes33 fixture_large_reenter(struct FixtureBytes33 value, void (*callback)(void)) {
  if (callback) {
    callback();
  }
  return value;
}

#define FIXTURE_LARGE_PARAMETERS                                                                              \
  int64_t a0, int64_t a1, int64_t a2, int64_t a3, int64_t a4, int64_t a5, int64_t a6, int64_t a7, int64_t a8, \
    int64_t a9, int64_t a10, int64_t a11, int64_t a12, int64_t a13, int64_t a14, int64_t a15, int64_t a16,    \
    int64_t a17, int64_t a18, int64_t a19, int64_t a20, int64_t a21, int64_t a22, int64_t a23, int64_t a24,   \
    int64_t a25, int64_t a26, int64_t a27, int64_t a28, int64_t a29, int64_t a30
#define FIXTURE_LARGE_ARGUMENTS                                                                                      \
  a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, \
    a25, a26, a27, a28, a29, a30

FIXTURE_API struct FixtureBytes33 fixture_large_args31(FIXTURE_LARGE_PARAMETERS) {
  const int64_t values[] = {FIXTURE_LARGE_ARGUMENTS};
  struct FixtureBytes33 result;
  for (int i = 0; i < 33; i++) {
    result.values[i] = (uint8_t)(values[i % 31] * (i + 1));
  }
  return result;
}

FIXTURE_API struct FixtureBytes33 fixture_large_args32(FIXTURE_LARGE_PARAMETERS, int64_t last) {
  struct FixtureBytes33 result = fixture_large_args31(FIXTURE_LARGE_ARGUMENTS);
  result.values[32] ^= (uint8_t)last;
  return result;
}

#undef FIXTURE_LARGE_PARAMETERS
#undef FIXTURE_LARGE_ARGUMENTS

#define FIXTURE_HFA(name, type, count)                                                                                \
  struct FixtureHFA_##name {                                                                                          \
    type values[count];                                                                                               \
  };                                                                                                                  \
  FIXTURE_API struct FixtureHFA_##name fixture_hfa_##name##_echo(struct FixtureHFA_##name value) {                    \
    return value;                                                                                                     \
  }                                                                                                                   \
  FIXTURE_API struct FixtureHFA_##name fixture_hfa_##name##_make(type first) {                                        \
    struct FixtureHFA_##name value;                                                                                   \
    for (int i = 0; i < count; i++)                                                                                   \
      value.values[i] = first + (type)i / 4;                                                                          \
    return value;                                                                                                     \
  }                                                                                                                   \
  FIXTURE_API double fixture_hfa_##name##_sum(struct FixtureHFA_##name value) {                                       \
    double result = 0;                                                                                                \
    for (int i = 0; i < count; i++)                                                                                   \
      result += (i + 1) * value.values[i];                                                                            \
    return result;                                                                                                    \
  }                                                                                                                   \
  FIXTURE_API double fixture_hfa_##name##_stack(double a, double b, double c, double d, double e, double f, double g, \
                                                struct FixtureHFA_##name value, float tail, int32_t last) {           \
    return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + fixture_hfa_##name##_sum(value) + 17 * tail +          \
           19 * last;                                                                                                 \
  }                                                                                                                   \
  FIXTURE_API double fixture_hfa_##name##_stack_full(double a, double b, double c, double d, double e, double f,      \
                                                     double g, double h, float leading,                               \
                                                     struct FixtureHFA_##name value, float tail, int32_t last) {      \
    return fixture_hfa_##name##_stack(a, b, c, d, e, f, g, value, tail, last) + 8 * h + 23 * leading;                 \
  }                                                                                                                   \
  FIXTURE_API double fixture_hfa_##name##_callback(double (*callback)(struct FixtureHFA_##name)) {                    \
    return callback(fixture_hfa_##name##_make(1.5));                                                                  \
  }                                                                                                                   \
  FIXTURE_API double fixture_hfa_##name##_callback_stack(double (*callback)(                                          \
    double, double, double, double, double, double, double, struct FixtureHFA_##name, float, int32_t)) {              \
    return callback(1, 2, 3, 4, 5, 6, 7, fixture_hfa_##name##_make(1.5), 8.25f, -9);                                  \
  }                                                                                                                   \
  FIXTURE_API double fixture_hfa_##name##_callback_stack_full(                                                        \
    double (*callback)(double, double, double, double, double, double, double, double, float,                         \
                       struct FixtureHFA_##name, float, int32_t)) {                                                   \
    return callback(1, 2, 3, 4, 5, 6, 7, 8, 0.25f, fixture_hfa_##name##_make(1.5), 8.25f, -9);                        \
  }

FIXTURE_HFA(f32_1, float, 1)
FIXTURE_HFA(f32_2, float, 2)
FIXTURE_HFA(f32_3, float, 3)
FIXTURE_HFA(f32_4, float, 4)
FIXTURE_HFA(f64_1, double, 1)
FIXTURE_HFA(f64_2, double, 2)
FIXTURE_HFA(f64_3, double, 3)
FIXTURE_HFA(f64_4, double, 4)
FIXTURE_HFA(f32_5, float, 5)
FIXTURE_HFA(f64_5, double, 5)

#undef FIXTURE_HFA

FIXTURE_API struct FixtureHFA_f64_4 fixture_variadic_hfa(struct FixtureHFA_f64_4 value, int32_t count, ...) {
  va_list arguments;
  va_start(arguments, count);
  double delta = 0;
  for (int32_t i = 0; i < count; i++) {
    delta += va_arg(arguments, double);
  }
  va_end(arguments);
  for (int i = 0; i < 4; i++) {
    value.values[i] += (i + 1) * delta;
  }
  return value;
}

struct FixtureMixedAggregate {
  float first;
  int32_t second;
  double third;
};

FIXTURE_API struct FixtureMixedAggregate fixture_mixed_aggregate_echo(struct FixtureMixedAggregate value) {
  return value;
}

struct FixtureHFAPair {
  double first;
  double second;
};

struct FixtureNestedHFA {
  struct FixtureHFAPair pairs[2];
};

FIXTURE_API struct FixtureNestedHFA fixture_nested_hfa_echo(struct FixtureNestedHFA value) {
  return value;
}

FIXTURE_API double fixture_nested_hfa_sum(struct FixtureNestedHFA value) {
  return value.pairs[0].first + 2 * value.pairs[0].second + 3 * value.pairs[1].first + 4 * value.pairs[1].second;
}

FIXTURE_API double fixture_nested_hfa_callback(double (*callback)(struct FixtureNestedHFA)) {
  struct FixtureNestedHFA value = {{{1.25, 2.5}, {3.75, 5}}};
  return callback(value);
}

FIXTURE_API double fixture_abi_aggregate_stack(int64_t a,
                                               int64_t b,
                                               int64_t c,
                                               int64_t d,
                                               int64_t e,
                                               int64_t f,
                                               int64_t g,
                                               double h,
                                               double i,
                                               double j,
                                               double k,
                                               double l,
                                               double m,
                                               double n,
                                               struct FixtureBytes15 bytes,
                                               int8_t narrow,
                                               struct FixtureHFA_f32_4 hfa,
                                               uint16_t tail,
                                               float last) {
  double result = (double)(a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g) + 8 * h + 9 * i + 10 * j + 11 * k +
                  12 * l + 13 * m + 14 * n + 17 * narrow + 19 * tail + 23 * last;
  for (int index = 0; index < 15; index++) {
    result += (index + 1) * bytes.values[index];
  }
  for (int index = 0; index < 4; index++) {
    result += (index + 1) * hfa.values[index];
  }
  return result;
}

FIXTURE_API struct FixtureBytes33 fixture_large_aggregate_stack(int64_t a,
                                                                int64_t b,
                                                                int64_t c,
                                                                int64_t d,
                                                                int64_t e,
                                                                int64_t f,
                                                                int64_t g,
                                                                int64_t h,
                                                                double i,
                                                                double j,
                                                                double k,
                                                                double l,
                                                                double m,
                                                                double n,
                                                                double o,
                                                                double p,
                                                                int8_t leading,
                                                                struct FixtureBytes33 first,
                                                                struct FixtureBytes33 second,
                                                                uint16_t tail,
                                                                struct FixtureHFA_f32_4 hfa,
                                                                float last) {
  double total = (double)(a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h) + 9 * i + 10 * j + 11 * k +
                 12 * l + 13 * m + 14 * n + 15 * o + 16 * p + 17 * leading + 19 * tail + 23 * last;
  for (int index = 0; index < 4; index++) {
    total += (index + 1) * hfa.values[index];
  }
  struct FixtureBytes33 result;
  for (int index = 0; index < 33; index++) {
    result.values[index] = (uint8_t)(first.values[index] + 3 * second.values[index] + (int64_t)total + index);
  }
  return result;
}

struct FixturePolyline {
  int32_t count;
  struct FixturePoint points[2];
};

FIXTURE_API int32_t fixture_polyline_last_y(struct FixturePolyline value) {
  return value.points[value.count - 1].y;
}

FIXTURE_API struct FixturePolyline fixture_polyline_make(int32_t seed) {
  struct FixturePolyline value = {2, {{seed, seed + 1}, {seed + 2, seed + 3}}};
  return value;
}

struct FixtureReturnBlock {
  int32_t values[96];
};

FIXTURE_API struct FixtureReturnBlock fixture_return_block_make(int32_t seed) {
  struct FixtureReturnBlock value;
  for (int i = 0; i < 96; i++) {
    value.values[i] = seed + i;
  }
  return value;
}

struct FixtureLargeNested {
  uint16_t tag;
  struct FixturePolyline lines[2];
  struct FixtureReturnBlock block;
  uint8_t tail;
};

FIXTURE_API struct FixtureLargeNested fixture_large_nested_echo(struct FixtureLargeNested value) {
  return value;
}

union FixtureReturnArray {
  int64_t scalar;
  int32_t values[2];
};

FIXTURE_API union FixtureReturnArray fixture_return_union_make(int32_t first, int32_t second) {
  union FixtureReturnArray value;
  value.values[0] = first;
  value.values[1] = second;
  return value;
}

/* Output parameter (paramflags). */
FIXTURE_API int32_t fixture_divmod(int32_t a, int32_t b, int32_t* remainder) {
  *remainder = a % b;
  return a / b;
}

FIXTURE_API int32_t fixture_divmod_pair(int32_t a, int32_t b, int32_t* quotient, int32_t* remainder) {
  *quotient = a / b;
  *remainder = a % b;
  return 0;
}

/* Reentrancy: the callback runs while the arguments are still in use. */

FIXTURE_API int32_t fixture_first_char_after(const char* text, void (*callback)(void)) {
  if (callback != NULL) {
    callback();
  }
  return (unsigned char)text[0];
}

FIXTURE_API int32_t fixture_variadic_sum(void (*callback)(void), int32_t count, ...) {
  if (callback != NULL) {
    callback();
  }
  va_list args;
  va_start(args, count);
  int32_t sum = 0;
  for (int32_t i = 0; i < count; i++) {
    sum += va_arg(args, int32_t);
  }
  va_end(args);
  return sum;
}

FIXTURE_API double fixture_inferred_mixed(int32_t first, double second, int32_t third) {
  return first + 10 * second + 100 * third;
}

FIXTURE_API double fixture_inferred_fp_stack(double a,
                                             double b,
                                             double c,
                                             double d,
                                             double e,
                                             double f,
                                             double g,
                                             double h,
                                             double i,
                                             double j) {
  return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h + 9 * i + 10 * j;
}

FIXTURE_API double fixture_variadic_one(int32_t first, ...) {
  va_list arguments;
  va_start(arguments, first);
  double second = va_arg(arguments, double);
  int32_t third = va_arg(arguments, int32_t);
  va_end(arguments);
  return fixture_inferred_mixed(first, second, third);
}

FIXTURE_API double fixture_variadic_two(int32_t first, double second, ...) {
  va_list arguments;
  va_start(arguments, second);
  int32_t third = va_arg(arguments, int32_t);
  va_end(arguments);
  return fixture_inferred_mixed(first, second, third);
}

FIXTURE_API uint64_t fixture_variadic_types(int32_t seed, ...) {
  va_list arguments;
  va_start(arguments, seed);
  int narrow = va_arg(arguments, int);
  int character = va_arg(arguments, int);
  int wide_character = va_arg(arguments, int);
  int boolean = va_arg(arguments, int);
  double floating = va_arg(arguments, double);
  uint64_t wide = va_arg(arguments, uint64_t);
  const char* text = va_arg(arguments, const char*);
  const wchar_t* wide_text = va_arg(arguments, const wchar_t*);
  const void* pointer = va_arg(arguments, const void*);
  va_end(arguments);
  uint64_t total = (uint64_t)(seed + 3 * narrow + 5 * character + 7 * wide_character + 11 * boolean + 16 * floating);
  total += 17 * strlen(text) + 19 * wcslen(wide_text) + (pointer != NULL ? 23 : 0);
  return wide ^ total;
}

FIXTURE_API double fixture_variadic_stack(int32_t a,
                                          int32_t b,
                                          int32_t c,
                                          int32_t d,
                                          int32_t e,
                                          int32_t f,
                                          int32_t g,
                                          int32_t h,
                                          int8_t tag,
                                          double named,
                                          ...) {
  va_list arguments;
  va_start(arguments, named);
  int tail = va_arg(arguments, int);
  double floating = va_arg(arguments, double);
  int64_t wide = va_arg(arguments, int64_t);
  va_end(arguments);
  return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h + 11 * tag + 13 * named + 17 * tail + 19 * floating +
         23 * wide;
}

FIXTURE_API double fixture_variadic_stack_reference(void) {
  return fixture_variadic_stack(1, 2, 3, 4, 5, 6, 7, 8, -31, 1.5, -127, 2.25, INT64_C(-5000000000));
}

/* Packed structure (_pack_ = 1) by value: misaligned uint32 and double. */

#pragma pack(push, 1)
struct FixturePacked {
  uint8_t a;
  uint32_t b;
  double c;
  uint16_t d;
};
#pragma pack(pop)

FIXTURE_API double fixture_packed_sum(struct FixturePacked value) {
  return value.a + value.b + value.c + value.d;
}

FIXTURE_API struct FixturePacked fixture_packed_make(uint8_t a, uint32_t b, double c, uint16_t d) {
  struct FixturePacked value = {a, b, c, d};
  return value;
}

FIXTURE_API size_t fixture_packed_size(void) {
  return sizeof(struct FixturePacked);
}

/* Bit field in the first eightbyte, float and tail padding in the second: on
   x86-64 SysV the float travels in an SSE register. */

struct FixtureBitsFloat {
  uint64_t bits : 60;
  float f;
};

FIXTURE_API float fixture_bits_float_get(struct FixtureBitsFloat value) {
  return value.f + (float)value.bits;
}

FIXTURE_API struct FixtureBitsFloat fixture_bits_float_make(uint64_t bits, float f) {
  struct FixtureBitsFloat value;
  value.bits = bits;
  value.f = f;
  return value;
}

FIXTURE_API size_t fixture_bits_float_size(void) {
  return sizeof(struct FixtureBitsFloat);
}

/* Pointer output parameter (T**): byref(p) passes the pointer's own memory. */

static int32_t fixture_static_value = 42;

FIXTURE_API void fixture_point_to_static(int32_t** out) {
  *out = &fixture_static_value;
}

/* use_errno: errno as seen by (and left by) the called function. */

FIXTURE_API int32_t fixture_errno_get(void) {
  return errno;
}

FIXTURE_API void fixture_errno_set(int32_t value) {
  errno = value;
}

FIXTURE_API int32_t fixture_errno_exchange(int32_t value, int32_t* previous) {
  *previous = errno;
  errno = value;
  return *previous;
}

/* Unions by value: on x86-64 System V the class of each eightbyte merges all
 * the members (union { double; int64_t; } is INTEGER, not SSE). */

union FixtureNumber {
  double d;
  int64_t i;
};

FIXTURE_API int64_t fixture_number_bits(union FixtureNumber value) {
  return value.i;
}

FIXTURE_API union FixtureNumber fixture_number_from_bits(int64_t bits) {
  union FixtureNumber value;
  value.i = bits;
  return value;
}

union FixtureFloats {
  float f[2];
  double d;
};

FIXTURE_API double fixture_floats_sum(union FixtureFloats value) {
  return (double)value.f[0] + (double)value.f[1];
}

struct FixtureTagged {
  int32_t tag;
  union {
    float f;
    int32_t i;
  } value;
};

FIXTURE_API int32_t fixture_tagged_int(struct FixtureTagged value, double scale) {
  return value.tag == 0 ? value.value.i : (int32_t)(value.value.f * scale);
}

FIXTURE_API struct FixtureTagged fixture_tagged_make(int32_t tag, int32_t i) {
  struct FixtureTagged value;
  value.tag = tag;
  value.value.i = i;
  return value;
}
