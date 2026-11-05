#include <ffi.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#else
#define NOINLINE __attribute__((noinline))
#endif

typedef struct {
  double values[4];
} HFA;

static NOINLINE HFA fixed_hfa(HFA value, int32_t count, double first, double second) {
  const double delta = count == 2 ? first + second : 0;
  for (int i = 0; i < 4; i++) {
    value.values[i] += (i + 1) * delta;
  }
  return value;
}

static NOINLINE HFA variadic_hfa(HFA value, int32_t count, ...) {
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

static NOINLINE double variadic_stack(int32_t a,
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
  const int tail = va_arg(arguments, int);
  const double floating = va_arg(arguments, double);
  const int64_t wide = va_arg(arguments, int64_t);
  va_end(arguments);
  return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h + 11 * tag + 13 * named + 17 * tail + 19 * floating +
         23 * wide;
}

static int check_hfa(HFA value) {
  const double expected[4] = {4, 8.75, 13.5, 18.25};
  printf("HFA result: {%.17g, %.17g, %.17g, %.17g}\n", value.values[0], value.values[1], value.values[2],
         value.values[3]);
  for (int i = 0; i < 4; i++) {
    if (value.values[i] != expected[i]) {
      fprintf(stderr, "HFA member %d: expected %.17g, received %.17g\n", i, expected[i], value.values[i]);
      return EXIT_FAILURE;
    }
  }
  return EXIT_SUCCESS;
}

static int check_stack(double value) {
  const double expected = -115000002233.75;
  printf("Stack result: %.17g\n", value);
  if (value != expected) {
    fprintf(stderr, "Expected %.17g, received %.17g\n", expected, value);
    return EXIT_FAILURE;
  }
  return EXIT_SUCCESS;
}

static int run_reference(void) {
  const HFA input = {{0.25, 1.25, 2.25, 3.25}};
  HFA (*volatile fixed)(HFA, int32_t, double, double) = fixed_hfa;
  HFA (*volatile variadic)(HFA, int32_t, ...) = variadic_hfa;
  double (*volatile stack)(int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t, int8_t, double,
                           ...) = variadic_stack;
  puts("Calling C fixed HFA reference");
  int failed = check_hfa(fixed(input, 2, 1.5, 2.25));
  puts("Calling C variadic HFA reference");
  failed |= check_hfa(variadic(input, 2, 1.5, 2.25));
  puts("Calling C variadic stack reference");
  failed |= check_stack(stack(1, 2, 3, 4, 5, 6, 7, 8, -31, 1.5, -127, 2.25, INT64_C(-5000000000)));
  return failed;
}

static int run_hfa(int variadic) {
  ffi_type* members[] = {&ffi_type_double, &ffi_type_double, &ffi_type_double, &ffi_type_double, NULL};
  ffi_type hfa = {0, 0, FFI_TYPE_STRUCT, members};
  ffi_type* types[] = {&hfa, &ffi_type_sint32, &ffi_type_double, &ffi_type_double};
  HFA input = {{0.25, 1.25, 2.25, 3.25}};
  const HFA original = input;
  int32_t count = 2;
  double first = 1.5;
  double second = 2.25;
  void* values[] = {&input, &count, &first, &second};
  HFA result = {{0}};
  ffi_cif cif = {0};
  const ffi_status status = variadic ? ffi_prep_cif_var(&cif, FFI_DEFAULT_ABI, 2, 4, &hfa, types)
                                     : ffi_prep_cif(&cif, FFI_DEFAULT_ABI, 4, &hfa, types);
  printf("Preparing HFA: variadic=%d, status=%d, ABI=%u, stack bytes=%u, flags=0x%x\n", variadic, (int)status,
         (unsigned)cif.abi, cif.bytes, cif.flags);
  if (status != FFI_OK) {
    fprintf(stderr, "Failed to prepare HFA call: %d\n", (int)status);
    return EXIT_FAILURE;
  }
  puts("Calling HFA through libffi");
  ffi_call(&cif, variadic ? FFI_FN(variadic_hfa) : FFI_FN(fixed_hfa), &result, values);
  if (memcmp(&input, &original, sizeof(input)) != 0) {
    fputs("HFA input was modified\n", stderr);
    return EXIT_FAILURE;
  }
  return check_hfa(result);
}

static int run_stack(void) {
  ffi_type* types[] = {&ffi_type_sint32, &ffi_type_sint32, &ffi_type_sint32, &ffi_type_sint32, &ffi_type_sint32,
                       &ffi_type_sint32, &ffi_type_sint32, &ffi_type_sint32, &ffi_type_sint8,  &ffi_type_double,
                       &ffi_type_sint32, &ffi_type_double, &ffi_type_sint64};
  int32_t prefix[] = {1, 2, 3, 4, 5, 6, 7, 8};
  int8_t tag = -31;
  double named = 1.5;
  int32_t tail = -127;
  double floating = 2.25;
  int64_t wide = INT64_C(-5000000000);
  void* values[] = {&prefix[0], &prefix[1], &prefix[2], &prefix[3], &prefix[4], &prefix[5], &prefix[6],
                    &prefix[7], &tag,       &named,     &tail,      &floating,  &wide};
  double result = 0;
  ffi_cif cif = {0};
  const ffi_status status = ffi_prep_cif_var(&cif, FFI_DEFAULT_ABI, 10, 13, &ffi_type_double, types);
  printf("Preparing stack: status=%d, ABI=%u, stack bytes=%u, flags=0x%x\n", (int)status, (unsigned)cif.abi, cif.bytes,
         cif.flags);
  if (status != FFI_OK) {
    fprintf(stderr, "Failed to prepare variadic stack call: %d\n", (int)status);
    return EXIT_FAILURE;
  }
  puts("Calling variadic stack arguments through libffi");
  ffi_call(&cif, FFI_FN(variadic_stack), &result, values);
  return check_stack(result);
}

int main(int argc, char** argv) {
  if (argc != 2) {
    fprintf(stderr, "Usage: %s reference|fixed-hfa|variadic-stack|variadic-hfa\n", argv[0]);
    return 2;
  }
  if (setvbuf(stdout, NULL, _IONBF, 0) != 0) {
    fputs("Failed to disable stdout buffering\n", stderr);
    return EXIT_FAILURE;
  }
  printf("Mode: %s; sizeof(HFA)=%zu; sizeof(void*)=%zu\n", argv[1], sizeof(HFA), sizeof(void*));
  if (strcmp(argv[1], "reference") == 0) {
    return run_reference();
  }
  if (strcmp(argv[1], "fixed-hfa") == 0) {
    return run_hfa(0);
  }
  if (strcmp(argv[1], "variadic-stack") == 0) {
    return run_stack();
  }
  if (strcmp(argv[1], "variadic-hfa") == 0) {
    return run_hfa(1);
  }
  fprintf(stderr, "Unknown mode: %s\n", argv[1]);
  return 2;
}
