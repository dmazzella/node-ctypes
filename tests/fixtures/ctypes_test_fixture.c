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

FIXTURE_API size_t fixture_echo_size_t(size_t value) {
  return value;
}

FIXTURE_API int32_t fixture_benchmark_zero(void) {
  return 7;
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

FIXTURE_API int32_t fixture_exact_fallback(int16_t a, int32_t b, uint64_t c) {
  return a + b + (int32_t)c;
}

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
