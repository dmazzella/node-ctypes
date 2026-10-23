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
#include <stddef.h>
#include <stdint.h>

#ifdef _WIN32
#define FIXTURE_API __declspec(dllexport)
#else
#define FIXTURE_API __attribute__((visibility("default")))
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

struct FixturePolyline {
  int32_t count;
  struct FixturePoint points[2];
};

FIXTURE_API int32_t fixture_polyline_last_y(struct FixturePolyline value) {
  return value.points[value.count - 1].y;
}

/* Output parameter (paramflags). */
FIXTURE_API int32_t fixture_divmod(int32_t a, int32_t b, int32_t* remainder) {
  *remainder = a % b;
  return a / b;
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
