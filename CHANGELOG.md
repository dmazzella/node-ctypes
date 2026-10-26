# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.5.0] - 2026-10-26

### Fixed

- **Portable CI validation**: large BigInt-to-float conversion no longer requires
  the floating-point `from_chars` overload introduced in macOS 26, preserving
  the macOS 13.5 deployment target and integer rounding/overflow checks. Paired
  Linux lookup tests accept musl's `libm` alias to `libc` and verify the resolved
  libraries by calling their correctly declared functions. Windows references
  resolve the explicit `msvcrt` library and accept absolute DLL paths instead of
  assuming CPython implements Node's `"c"` alias or returns bare file names.

### Changed

- **Parity tests**: migrate the complete former `common/` and `windows/`
  suites into domain-based `cpython_parity/` pairs, `node_specific/` regressions
  and genuine `python_specific/` scheduling checks. Paired JS uses Python-shaped
  classes, `ARRAY`, attribute bindings and `CFUNCTYPE`, with corresponding
  class/method IDs, input matrices and actual C signatures. A structural AST
  guard rejects one-sided files/cases, missing discovery markers and convenience
  APIs in the canonical pairs without adding dependencies or replacing either
  test runner. Python 3.15 CI now runs all references.
- **Pointer definitions**: expose Python's `_type_` metadata and defer incomplete
  aggregate pointee layout until an actual memory access, so forward-bound
  `_fields_` and self-referential types do not need manual cache invalidation.
- **Scalar and field conversion**: accept legitimate empty/whitespace field
  names without corrupting constructor/prototype metadata, and convert full-width
  BigInts to floating-point values with CPython rounding and overflow behavior
  rather than an artificial 64-bit integer limit.
- **Function protocols**: `CFUNCTYPE` callbacks are callable, native functions
  can be cast through the public API, and cached prototype conversion/retval
  hooks are captured at type creation. Pointer-to-pointer values use the pointer
  slot rather than the pointee bytes. Declared integer arguments reject nullish
  values, and string-pointer arguments require strings, compatible C-data or an
  explicit cast instead of an untyped integer address.
- **Raw memory and finalization**: explicitly sized `string_at` preserves all
  bytes, including invalid UTF-8 and embedded NUL, as a Latin1 string; unsized
  textual reads retain their UTF-8 representation. Address conversion errors
  retain their causes through `ArgumentError`. Materialized aggregate layouts
  reject `_fields_` reassignment, including previously incomplete types.
- **Typed pointer adapters**: match CPython's distinction between direct and
  adapted arguments. Automatic by-reference conversion, array decay and NULL
  acceptance no longer apply to scalar/array/null `_as_parameter_` results for
  `POINTER(T)`; explicit compatible pointers and `byref` results remain accepted.
- **Parameter resolution**: terminal primitive `_as_parameter_` results avoid
  allocating a cycle-detection Set. Recursive conversion follows CPython:
  stateful getters may revisit an object before terminating, and the fixed
  128-step rejection is removed. Non-terminating recursion uses the host runtime
  stack guard; intermediate owners stay alive and getter errors propagate unchanged.
- **Prototype callers**: eligible synchronous prototype bindings reuse the
  fixed-arity JavaScript wrappers used by library functions. Calls needing
  owners, custom adapters, result conversion or argument-count fallback keep
  the general pipeline. Hook snapshots, original argument arrays, callable
  metadata and prototype asynchronous behavior are preserved. External
  comparisons include explicit already-bound `CFUNCTYPE` caller rows.
- **Callback conversion**: builtin-only signatures skip the generic argument
  conversion dispatcher while preserving invocation and result conversion. Native
  handlers construct fallback error messages only on failure, with unchanged
  diagnostics and thread-safety checks.
- **Long UTF-8 arguments**: synchronous calls encode directly into reusable
  scratch storage when it fits, keeping the ordinary encoder for growth.
  String contents are still encoded on every call; the existing retention
  bound, wide-string alignment and independent reentrant buffers are preserved.
- **Structure argument conversion**: plain-object arguments for functional
  `struct()` definitions containing only builtin non-pointer scalar fields
  skip the transient Proxy and use the same byte initializer as `create()`.
  Field validation, zero defaults, dynamic `create()` / `set()` hooks and
  argument lifetimes are preserved. Classes and complex definitions keep
  their existing conversion paths.

## [2.4.0] - 2026-10-24

### Added

- **Release validation gates**: strict project C++20 compiler checks, Node 26
  functional-parity controls reusing the artifacts and focused Python 3.15
  references are wired into CI.
  The assembler requires every supported binary and includes release docs;
  publish waits for runtime gates, checks the exact version tag and sends
  prereleases to `next`.
- **External performance comparisons**: `npm run bench:koffi` and
  `npm run bench:ffi` compare the same C operations against Koffi and node:ffi.
  Tables show per-case medians, dispersion and time ratios from at least nine
  250 ms samples per library, with matching result representations. Koffi
  additionally covers aggregates, variadic calls and controlled async work.
  Every run generates a standalone responsive HTML report with bar charts,
  operation counts, measured times and environment/source metadata; optional
  JSON output includes all samples.
  The separate self-benchmark command has been removed.
- **Result protocols**: static `_check_retval_` runs on the restype representation
  before `errcheck` for library functions and prototype callers. OUT conversion
  uses `__ctypes_from_outparam__`; INOUT (`dir: "inout"` / flag 3) uses and
  returns the supplied instance without invoking the OUT hook.
- **Asynchronous output bindings**: `CFUNCTYPE` / `WINFUNCTYPE` bindings with
  `paramflags` expose `callAsync()`, `funcName`, `address` and `_ffi`, with
  the same output instances and `errcheck` return-args behavior as sync calls.

### Fixed

- **npm publication path**: explicitly prefix the downloaded tarball path with
  `./` so npm publishes the local package instead of interpreting the path as
  a GitHub repository shorthand and attempting an SSH connection.
- **Windows build diagnostics**: use compile-time guards for disabled floating-point
  direct invokers. Keep the required inline-buffer alignment and scope MSVC padding
  diagnostics to the affected class; waive upstream libffi's intentional unsigned
  alignment-mask negation only in its Windows ARM64 source file.
- **libffi header generation**: recognize `AC_PACKAGE_VERSION` as an Autoconf
  reference instead of reporting a false version mismatch, while retaining checks
  for conflicting literal version assignments.
- **Koffi installation policy**: explicitly approve only the reviewed Koffi 3.3.3
  install script in the private test package, eliminating the unreviewed-script
  warning without authorizing future dependency versions.
- **Narrow call-conversion tests across ABIs**: use matching C fixture
  signatures for narrow arguments/results instead of declaring `abs(int)`
  with incompatible 8/16-bit or boolean types. Preserve signedness, narrowing
  and boolean coverage without relying on unspecified register bits.
- **Library-view lifetime tests on musl**: preserve view/owner GC and logical
  close checks without assuming that `dlclose()` physically unloads a module.
  Probe the OS loader independently of `Library.close()` and reset fixture
  state between cases, since resident libraries keep their static data.
  Clarify the loader-dependent unloading contract in the API documentation.
- **Canonical test timeout**: test scripts use `--test-timeout=5000` before
  the file selector; the old trailing `--timeout` was not a valid runner
  option. `test:js` allows runtime controls to reuse the native artifacts.
- **Direct-call types**: native fast calls use exact scalar C++ signatures rather
  than treating register-class compatibility as function-type compatibility.
  Unsupported combinations and opaque pointer/string types use the existing
  cached libffi path. The signature set stays bounded and invokers retain
  internal linkage.
- **Callback return ABI and resources**: both callback handlers sign/zero-extend
  narrow integral results to a complete `ffi_arg`, including zero/error paths.
  Closure allocation uses a dedicated RAII deleter; partial thread-safe callback
  construction does not release an absent TSFN. `wchar_t`, `size_t` and `ssize_t`
  FFI descriptors now reflect native signedness and integer width.
- **Native callback types**: declarations include the existing `getPointer()`
  method, which validates that the callback has not been released.
- **Typed pointer arguments**: incompatible ctypes values are rejected before
  C entry, while compatible scalar/structure subclasses, arrays, explicit casts
  and documented raw-memory extensions remain supported. Recursive
  `_as_parameter_` chains retain intermediate owners and report cycles/depth
  limits, including after `from_param`.
- **Function pointer round-trips**: FFI callables can be stored back in pointer
  fields/arrays, passed to native functions and returned by pointer callbacks;
  bare JS functions still require explicit callback creation.
- **Scalar buffer factories and byref**: size/offset checks precede instance
  creation, derived copies bypass application constructors, and typed views
  are accepted. `byref(value, offset)` now applies signed byte offsets while
  preserving the original owner and pointee type.
- **OleDLL defaults and packing**: implicit restypes use HRESULT; explicit
  overrides remain effective. MS layouts accept `_pack_` zero and non-powers
  of two, reject explicit pack with GCC layout, and reject non-ABI alignments
  for by-value calls instead of preparing an invalid FFI description.
- **Scalar subclass representation**: C results and callback arguments preserve
  their bytes in derived scalar instances without calling application constructors
  or writers, including floating-point payload bits. Fields, arrays, pointer
  indexing and typed memory reads expose live derived instances. Builtin scalar
  fast paths retain ordinary JS values.
- **Result checking consistency**: explicit HRESULT validation applies to CDLL,
  WinDLL and prototype callers as well as OleDLL, before `errcheck` and outputs.
  Non-callable hooks and exceptions surface as errors/rejections.
- **Stable ABI descriptors**: captured native struct/union layouts and array
  elements are finalized recursively. FFI types retained by CIFs and call plans
  cannot be invalidated by later `addField()` calls. Open builders and size/
  alignment queries remain supported; finalized children do not prematurely
  finalize their outer builder. Native values use finalized layouts, reject
  short read buffers, and direct by-value recursion is rejected.
- **Independent function results**: returned functional `struct()` / `union()`
  values now own their bytes before JavaScript conversion. Array views, nested
  unions and union getters no longer alias the native function's reused result
  buffer, including during reentrant conversion or `errcheck`. Class results
  retain their single JS snapshot. Sync and async callers, library attributes,
  prototypes and output bindings keep their existing public result shapes.
  Explicit `toObject(buffer)` views and borrowed native result buffers are
  unchanged; pointer targets are not deep-copied.
- **Primitive conversions**: negative unsigned arguments and integers outside
  the signed 64-bit range wrap without adding `2**64` in floating point or
  casting an out-of-range floating value to an integer. Fast, generic, async
  and native slot conversions agree, including boolean and BigInt inputs.
- **Wide-character calls**: `c_wchar` uses the validated wchar converter in
  the simple path, not pointer/string marshalling. Simple argument types are
  explicitly enumerated; unsupported variadic types fall back before use.
- **Endian arrays**: primitive arrays in big-endian structures and unions
  use the correct byte order, including multidimensional, float and wchar
  arrays, serialization and mirrored native memory. Shared native/LE array
  types are unchanged; nested structure elements keep their own byte order.
- **Boolean values**: bool bitfields normalize before masking, return booleans
  and preserve adjacent fields according to C. False scalar instances remain
  false for `c_bool` and `VARIANT_BOOL`; VARIANT_BOOL arguments, fields,
  results and callbacks use the same boolean / `-1` representation.
- **Scalar validation**: constructors, value setters, arrays and bitfields
  no longer coerce numeric strings, arbitrary objects or null to numbers.
  Constructors still default to zero for omitted/undefined values, and
  documented 64-bit numeric pointer/null arguments remain supported.
  Incompatible scalar instances are rejected in declared numeric arguments
  and fields. Floating-point BigInt conversions have the same range checks
  in JS and native code; long and ssize_t bitfields are signed.
- **Array type retention**: array types are weakly interned by element type
  and length, with finalized entries removed from the cache. Builtin element
  types no longer retain every array length ever requested. Live instances,
  signatures and containing types preserve type identity and validity.
  Internal byte-array wrappers used for native layouts follow the same
  policy; live native layouts retain their underlying metadata.
- **Errcheck lifetime and snapshots**: self-referencing hooks no longer keep
  abandoned functions, libraries and callbacks alive. Each invocation captures
  its hook before adapters or getters run, including raw native handles and
  asynchronous jobs; replacing, clearing or adding a hook affects later calls.
  Public prototype hooks receive the public callable, not a native handle.
  Invalid hook assignments preserve the previous valid hook.
- **Output binding isolation**: `paramflags` bindings no longer inherit hooks
  from an unrelated cached function. Adapter temporaries and active-call
  protection extend through `errcheck` and output processing, synchronously
  and asynchronously, while explicit HRESULT validation still runs first.
- **Pointer views and typed copies**: pointers read from fields, arrays and
  double indirections retain their known owners. Borrowed views, pointer-slot
  buffers and address-backed aliases share the appropriate ownership, even
  if the original pointer is repointed. Typed structure/union/array copies
  preserve references across overlapping and self-copies; overwriting
  pointer storage releases the replaced references. Raw memory copies do
  not infer or transfer ownership.
- **Exported global lifetime**: `in_dll()` views and their dependent buffers,
  pointers and typed copies keep the native module loaded independently of
  the library wrapper. `close()` immediately closes the logical handle,
  rejects subsequent bound calls and symbol lookups, and defers physical
  unloading until the dependent memory is no longer needed. This also
  makes closing a current-process handle logically effective.
- **Argument conversion lifetime**: objects and temporaries unwrapped by
  `from_param` / `_as_parameter_` remain alive while later arguments are
  converted and through result conversion and `errcheck`, including
  `callAsync()`. The same behavior applies to library attributes and
  `CFUNCTYPE` / `WINFUNCTYPE` callers, without allocating ownership frames
  for ordinary numeric calls.
- **Native asynchronous arguments**: copied structures and arrays,
  values produced by getters, inferred C-data arguments, and buffers passed
  as integer addresses are retained until the worker finishes. Library
  closure is also rejected while native getters materialize the arguments;
  worker setup and queue failures release their resources.

### Changed

- **Prototype identity**: `CFUNCTYPE` / `WINFUNCTYPE` reuse live prototypes by
  complete type identity and calling convention through weak-value interning.
  Live callers/callbacks/output bindings retain their prototype. Public
  metadata is shared but does not mutate the captured native signature or
  cache key. New caller bindings capture fresh adapters/retval hooks and
  retain independent `errcheck` state.
- **Comparison summaries**: Koffi / `node:ffi` scripts no longer
  combine unrelated workloads into an average ratio or winner count.
- **Memory operation results**: `memmove()` / `memset()` return the destination
  address as BigInt instead of undefined. JS-memory clipping is preserved;
  address caching excludes resizable/growable stores and detects detachment.
- **API declarations**: callback arguments include typed pointers and scalar
  instances; unsupported callback return types remain rejected. Prototypes
  retain argument/return types and async metadata, and native descriptor/
  callback declarations now match their runtime members.
- **Derived scalar return types** now produce instances, as Python ctypes does.
  TypeScript infers those instances and `_check_retval_` return types without
  widening builtin values; INOUT directions are included in `ParamFlag`.
- **Native descriptor mutation**: `StructType.addField()` now throws after
  the layout is acquired by a field, array, prepared signature or native
  value. Construct a new descriptor to change its layout. This includes
  aggregate array elements of length zero and descriptors used by callbacks.
- **TypeScript function pointers**: prototype callers and output bindings
  expose the full `FFIFunction` interface. Low-level hooks use
  `NativeErrcheckCallback`, whose `func` argument is a native handle rather
  than a directly callable function. Corrected the output-binding example
  to use the actual `GetWindowThreadProcessId` signature.

## [2.3.0] - 2026-10-23

### Fixed

- **`threadSafeCallback()` called by several native threads at the same
  time**: the calls shared one result slot, so a thread could receive the
  result of another call or wait forever. Each call now waits for its own
  result; a call whose JavaScript function throws returns `0` instead of a
  previous result.
- **Functions keep their library loaded**: a function obtained from a
  `CDLL` (or with `CFUNCTYPE(...)([name, lib])`) no longer crashes when the
  library object is garbage-collected. After `close()` its calls throw
  `Library is closed`, and `close()` throws while a call to one of its
  functions is in progress (from a callback, or a pending `callAsync()`).
- **Reentrant calls**: a function called again from a callback during its
  own call overwrote the string arguments of the outer call.
- **Memory growth**: strings passed to `c_void_p` parameters accumulated in
  an internal buffer that was never cleared.
- **Structure and union layout follows Python ctypes** (`ctypes._layout`):
  bit fields of different types share storage units as with GCC
  (`"gcc-sysv"`, the default except on Windows) or MSVC (`"ms"`, on Windows
  and with `_pack_`); before, a bit field of a different type always started
  a new unit, so mixed bit fields had a different size and offsets than in
  C. Checked byte by byte against Python ctypes.
- **Subclasses of structures and unions**: a subclass with `_fields_` reused
  the layout of its base once the base had been used, so its own fields were
  missing; it now extends the fields of the base, which keep their offsets,
  as in Python. A subclass without `_fields_` has the layout of its base.
- **Bit fields**: 32-bit wide fields read back as 0, and 64-bit fields wider
  than 53 bits lost precision. Fields wider than 53 bits now read as BigInt.
  Bit fields of big-endian structures are laid out from the big end, as in
  Python.
- **`BigEndianStructure` / `BigEndianUnion`**: `get()`, `set()` and
  `toObject()` used little-endian (field access was already correct).
- **Objects assigned to fields of nested structures** (strings, pointers,
  callbacks) were kept alive only by the temporary nested view and could be
  collected while the outer structure still pointed to them; they now live
  with the memory of the outer structure, as Python `_objects`.
- **Structures by value**: structures with bit fields, subclasses, `_align_`
  and arrays of structures (`Cannot assign to read only property '_native'`)
  are passed and returned with the layout of the JS definition.
- **Array parameters** (`argtypes = [c_int32 * 4]`) were passed by value,
  as a structure of N elements, so the C function received the bytes of
  the array as its pointer; they are now passed by address, as in C and
  Python. As in Python, only an array of the same element type and length
  (or a Buffer / typed array) is accepted, other values raise
  `ArgumentError`.
- **`errcheck` of functions with `paramflags`** was never called. It now
  receives `(result, func, args)` with the out-params as instances, and its
  return value is the result unless it returns `args`, as in Python.
- **Invalid native types no longer terminate the process**:
  `StructType.addField()` / `ArrayType` with an invalid type, a negative or
  fractional array length and a zero-length `char` array initialized from a
  string threw uncaught C++ exceptions or crashed; they now throw JS errors
  (and any C++ exception becomes a JS error). Fields of
  `StructType.create()` objects could not be assigned.
- **`use_errno` / `use_last_error`** only read `errno` / `GetLastError()`
  after the call. As in Python, the value set with `set_errno()` /
  `set_last_error()` is now the system value during the call, and the
  system value is restored after it (also with `callAsync()`).
- **Wide strings with characters outside the BMP** (emoji, ...) were passed
  as UTF-16 code units where `wchar_t` is 32-bit (Linux, macOS): `wcslen("a😀b")`
  was 4 instead of 3. Surrogate pairs now become one `wchar_t`; lone
  surrogates are kept, as in Python. `wstring_at()` keeps lone surrogates
  instead of replacing them with U+FFFD.
- **`c_wchar` arguments** accepted any string (using its first code unit);
  as in Python they must be exactly one character.
- **64-bit and pointer-sized integer arguments** (`c_int64`, `c_uint64`,
  `c_size_t`, `c_ssize_t`) silently passed `0` for strings, symbols,
  functions and plain objects; they now raise `ArgumentError`. `null` (0)
  and Buffer / ArrayBuffer (their address) are still accepted.
- **`errcheck` of library attributes** (`libc.abs.errcheck = ...`) was set
  on the function shared by `func()` calls with the same signature, and was
  lost when `argtypes` / `restype` changed. Each attribute now keeps its
  own function and its `errcheck`, as in Python.
- **`func()` cache**: functions with the same signature but different
  options (`abi`, ...) shared one cache entry.
- **`OleDLL`**: each `func()` call returning a cached function added another
  HRESULT check on top of its `errcheck`, and setting `errcheck` removed the
  HRESULT check. As Python `HRESULT._check_retval_`, the check now runs
  before `errcheck` and is not replaced by it.
- **`from_param`** was called after the default conversion of the argument
  (so it received a Buffer instead of the object passed) and was ignored by
  `CFUNCTYPE` prototypes. As in Python it now receives the argument as
  passed, for `CDLL` functions and prototypes, and its errors raise
  `ArgumentError` (`argument 1: RangeError: ...`).
- **`memmove()` / `memset()`** crashed with a `Uint8Array` that is not a
  Buffer and rejected other typed arrays, `DataView` and `ArrayBuffer`;
  these are now accepted as bytes. `memset()` stops at the end of JS memory
  as `memmove()` does, instead of throwing.
- **`find_library()` on Linux** could return the 32-bit library of a
  multiarch system, and never found versioned sonames outside the ldconfig
  cache. As Python it returns the soname of the library with the ABI of the
  process, then the highest version found in the library directories.
- **Integer values wrap to the bits of the type**, as in Python, instead of
  throwing `RangeError`: `new c_uint8(256).value === 0`,
  `new c_uint64(-1).value === 2n ** 64n - 1n`, also for structure fields
  and array elements.
- **Structures with `_pack_` by value**: the native description placed the
  fields at their natural offsets, so the C function received a different
  layout. The fields now keep the offsets of the JS layout (misaligned ones
  as bytes), and on x86-64 System V a structure with misaligned fields is
  passed and returned in memory, as GCC and clang do (Python ctypes uses
  registers there). Padding of structures with bit fields is no longer
  passed as bytes, which moved a `float` that shares an eightbyte with
  padding from an SSE register to an integer register on x86-64.
- **Native types are recognized by their instances**: `StructType`,
  `ArrayType` and `Library` objects were recognized by the names of their
  methods, so a JS object with the same methods reached the native code and
  failed with an unclear error. Their instances are now marked with a
  Node-API type tag; other values raise a `TypeError` (`Type must be a CType
enum value (number), StructType or ArrayType`). Invalid types of
  functions, callbacks, fields and arrays raise `TypeError` everywhere.
- **Arguments of a type that cannot be converted** left their slot
  uninitialized instead of raising `ArgumentError`.
- **Errors of a callback result conversion** no longer cross C frames: the
  callback returns 0 and the error is reported as other callback errors.

- **Callback lifetime**: a `threadSafeCallback()` collected by the GC while
  calls were still queued freed memory that the queued calls used; a
  `callback()` called from another thread (for example by a function run with
  `callAsync`) ran JavaScript off the main thread. The first now keeps its
  state until the last queued call, the second records an error and returns 0
  (use `threadSafeCallback()` for other threads).
- **Pointers** (Python parity): `byref(p)` / `addressof(p)` of a `POINTER`
  instance give the address of the pointer itself (a `T**` output parameter
  wrote past the target); `cast()` and `p.add()` keep the source alive;
  `p.contents = x` rejects an instance smaller than the pointed type;
  `cast(c_char_p(...), POINTER(c_char))` reads the stored address;
  `pointer(array)` points to the array.
- **`cast(x, c_void_p | c_char_p | c_wchar_p)`** read the bytes of `x` as a
  value: it now returns an instance pointing to `x` (kept alive), as Python.
- **Structure arguments**: a plain object is converted to an instance of the
  structure; an array is rejected (Python rejects a tuple).
- **Variadic arguments**: typed instances (`c_int8(1)`, `c_float(1.5)`, ...)
  are passed with the C default promotions; typed arrays as pointers.
- **`_fields_`**: entries keep their order also for integer-like names;
  duplicate names and malformed entries raise `TypeError`. `struct()` accepts
  a Structure/Union class as anonymous field; `Union` supports `_anonymous_`
  (also nested).
- **Callbacks with `c_char_p` / `c_wchar_p` restype** can return a string
  (it is kept alive with the callback, as Python does).
- **Library loading**: on Windows `LoadLibraryExW` (UTF-8 paths) with the
  flags of Python (`LOAD_LIBRARY_SEARCH_DEFAULT_DIRS`, plus the directory of
  the library when the name is a path), without changing the DLL search path
  of the process; `GetProcAddress` errors no longer say `LoadLibraryExA`. On
  POSIX symbols are resolved at load time (`RTLD_NOW`), as Python.
- **`find_library()` on macOS** finds libraries and frameworks in the dyld
  shared cache (`/usr/lib/libc.dylib`, `CoreFoundation.framework`), searching
  Homebrew first as Homebrew's Python.
- **`string_at()` / `wstring_at()`** returned `null` for instances, arrays,
  pointers, `c_char_p`/`c_void_p` and `_as_parameter_`; they read their
  memory as Python. Strings (also `c_char_p.value`) are no longer truncated
  at 1 MiB.
- **`readValue()` / `writeValue()` / `sizeof()`** accept addresses, ctypes
  instances and typed arrays for every type, with bounds checks.
- **`c_void_p` fields** accept pointers created from an address,
  `_as_parameter_` and `c_char_p` instances, and keep assigned memory alive.
- **`array(struct({...}), n)`** (and `union()`) failed in the native layer.
- **`Structure.from_buffer()`** accepted negative offsets; it now validates
  them as Python and accepts typed arrays and ctypes instances.
- **`String(cdll)`, `JSON.stringify` and other probes** of the lazy loaders
  tried to load a library named `toString`, `toJSON`, ...; names starting
  with `_` are not libraries, as in Python.
- **`f.argtypes = null`** and **`f.errcheck = undefined`** threw.
- **Unions by value on x86-64 System V** were passed in the wrong registers
  (libffi has no union type, libffi#33; CPython has the same bug): each
  eightbyte now gets the class of all the members that cover it.
- **Silent acceptances where Python raises**: too many positional
  initializers (`TypeError: too many initializers`), an instance of another
  type assigned to a field (`incompatible types`), a Buffer too long for a
  `c_char * n` field (`bytes too long`), bit fields of non-integer types
  (`bit fields not allowed for type c_float`). A `SimpleCData` instance is a
  positional initializer (`P(c_int(5))`). `array(c_char, n).create("héllo")`
  encodes UTF-8 as `.value`.

### Added

- **`_layout_` and `_align_`** on structures and unions, as in Python ctypes.

- **Structures and unions by value as callback arguments**, as in Python;
  a structure restype of a callback raises `TypeError: invalid result type
for callback function` at creation, as in Python.
- **`winmode`** option of `CDLL` (Windows `LoadLibraryExW` flags), as Python.
- **`pack`, `layout`, `align` options** of `struct()` / `union()`;
  `union()` and `defineUnion()` accept options.
- **`WinError(code, descr)`** has `errno` (mapped from the Windows code as
  Python's `OSError`) and `strerror`.

### Changed

- **Non-integral numbers for integer types raise `TypeError`** (`'float'
object cannot be interpreted as an integer`), as Python does for floats:
  arguments (`ArgumentError`), constructors, fields, bit fields and callback
  results. Integral numbers outside the range of the type wrap as before
  (64-bit values no longer saturate).
- **Array methods work on the elements**: `slice`, `at`, `indexOf`,
  `includes`, `forEach`, `map`, `fill`, `join`, `entries`, ... on an array
  instance use the elements (Python sequence operations), not the bytes of
  the Buffer; slices of `c_char`/`c_wchar` arrays are strings and
  `JSON.stringify` gives the elements. Buffer methods (`readInt32LE`,
  `subarray`, ...) still work on the bytes.
- **`POINTER(T)` and `array(T, n)` are cached**: the same type object for
  the same arguments, as in Python.
- **`errcheck` receives the function itself** (`func === lib.abs`) for every
  restype, as in Python; it was the native wrapper for simple restypes.
- **Typings**: statics `size` / `alignment` / `fields` of Structure classes,
  classes returned by `defineStruct()` / `defineUnion()` with their statics,
  element-wise array methods, narrower element types of `array()` /
  `bitfield()`, typed arrays and addresses in `readValue()` / `writeValue()`.

- **Structure/Union fields are accessors of the class** instead of a
  `Proxy` around each instance (Python: fields are descriptors of the
  class). Field reads and writes are about 5 times faster (about 4 ns
  instead of 20-25 ns). `Object.keys(s)` and `{ ...s }` no longer list the
  fields: use `s.toObject()`; `JSON.stringify(s)` (new `toJSON()`) and
  `console.log(s)` show them.
- **A nested structure or union field is an instance of its class**
  (Python parity) on the memory of the outer instance, instead of a
  `Proxy` view: `rect.a instanceof POINT`, and its methods and `toObject()`
  are available. The instance is created on the first access and reused
  (`rect.a === rect.a`), so `rect.a.x` takes about 6 ns instead of 170 ns.
- **Faster calls** (measured on macOS arm64 against the previous version):
  - functions with fixed numeric, pointer or string arguments and a result
    that is not an array go through a dedicated path without the general
    call state: `abs` / `sqrt` about 25% faster, `memset` with a Buffer
    about 40%;
  - numeric arguments take one Node-API call instead of two, and a Buffer
    or typed array passed as a pointer one instead of three;
  - variadic calls (`sprintf`) about 15% faster;
  - structures returned by value about 2 times faster: the bytes are
    returned in a Buffer reused by the function instead of a new one per
    call;
  - writes of 64-bit integer values given as numbers (`c_int64`,
    `c_uint64`, `c_size_t`, `c_long` fields and `.value`) about 4 times
    faster.
- **Benchmark 7** (`tests/benchmarks/benchmark_koffi.js`) measured reads of
  two plain JS objects; it now measures structure fields in memory and a
  structure returned by value.
- **Error messages follow Python 3.14+ ctypes**: `c_char` / `c_wchar`
  values (`one character bytes, bytearray, or an integer in range(256)
expected, not a string of length 2`, `a unicode character expected, ...`),
  pointer arguments (`'function' object cannot be interpreted as
ctypes.c_void_p` instead of `wrong type`) and numeric arguments
  (`'string' object cannot be interpreted as an integer`, `must be real
number, not string`).
- **`ArgumentError`** accepts the `options` of `Error` (`{ cause }`).
- **Python reference tests run in CI** (Python 3.14, with `unittest`; no
  longer `pytest`).
- **A Structure/Union `restype` returns an instance of the class** (Python
  parity) instead of a plain object; `errcheck` receives the instance. A
  `struct()` definition as `restype` still returns a plain object.
- **Tests**: `npm test` builds a C test library (`tests/fixtures/`) for
  structures by value, array parameters and reentrant calls; its Python
  twin tests check the same behavior with Python ctypes.
- **C++20 cleanup of the native module**: concepts for the wrapper classes
  and the direct-call invokers, `constexpr` type helpers, `[[nodiscard]]`
  results, one parser for native types and one for callback signatures.
  Values in raw memory (libffi results, C memory) are read with one
  `LoadAs<T>` helper instead of a union whose inactive members were read
  (undefined behavior in C++); buffers are passed as `std::span` /
  `std::wstring_view` with their size.
  The descriptors of structures, unions and arrays (`StructInfo`,
  `ArrayInfo`) are in `src/layout.h` / `layout.cc`, separate from their JS
  wrappers (`StructType` in `struct.h`, `ArrayType` in `array.h`).
- **Build**: the native module is compiled as standard C++20 without
  compiler extensions (`-std=c++20` instead of `-std=gnu++20`) and with
  warnings enabled (`-Wall -Wextra`, `/W4`); it builds without warnings.

## [2.2.0] - 2026-10-22

### Added

- **Embedded Python example**: `demo_python_cryptography.js` uses
  pyca/cryptography (hashes, HMAC, RSA, EC and DSA keys and signatures, an
  X.509 CSR and a self-signed certificate) and checks every result with
  `node:crypto`.
- **Embedded Python example**: `Python.initialize({ stdout, stderr })` writes
  Python's output through `process.stdout` / `process.stderr` (`"node"`, in
  order with `console.log`) or captures it with a function; in Electron,
  `toTypedArray()` falls back to a copy.
- **`EXTERNAL_BUFFERS`**: `false` where the runtime does not allow Buffers
  over native memory (Electron). Detected when the native module loads
  (`napi_no_external_buffers_allowed`), not from the runtime name;
  `NODE_CTYPES_NO_EXTERNAL_BUFFERS=1` forces the mode on Node.js.
- **`from_buffer()`, `from_buffer_copy()` and `from_address()` on array
  types**, as in Python: `array(c_uint8, n).from_address(addr)` is an
  array on the memory at `addr`, and its `_buffer` a Buffer over it (the
  equivalent of `memoryview((c_ubyte * n).from_address(addr))`).

### Removed

- **`ptrToBuffer()`** is no longer exported. Python ctypes has no
  such function, and the same view is
  `array(c_uint8, size).from_address(address)._buffer`. To read or write a
  value at an address use `T.from_address(address)` or a `POINTER(T)`; to
  copy bytes, `memmove(Buffer.alloc(n), address, n)`.

### Fixed

- **Electron**: `from_address`, `in_dll`, `pointer.contents`, `p[i]`,
  `cast` and `memmove` / `memset` with addresses failed with "External
  buffers are not allowed". Without external buffers, instances on native
  memory now work on a copy: each read refreshes the bytes of the field and
  each write copies them back, with one native call (about 50 ns);
  instances on ordinary Buffers have no extra cost. Passed to C functions,
  `addressof()`, `pointer()` and `memmove()` / `memset()` they use the
  original address. On Node.js nothing changes.
- **`memmove()` / `memset()` with addresses** copy through the native module
  instead of creating a Buffer over the memory.

### Performance

- **Writes through a pointer to an address** (`p[i] = v`,
  `p.contents = v` for simple types) copy the value with the native module
  instead of creating an external Buffer at each write: `p[i]` read + write
  goes from ~715 ns to ~350 ns.
- **Nested structures and arrays** reuse their Proxy handler instead of
  creating one at each field access.

## [2.1.1] - 2026-10-22

### Fixed

- **`callAsync()` with `use_errno` / `use_last_error`**: the call runs on a
  worker thread and its `errno` / `GetLastError()` were not captured, so
  `get_errno()` / `get_last_error()` returned a previous value. They are now
  read on the worker thread right after the call and published before
  `errcheck` runs, as for synchronous calls.
- **`errcheck` with `callAsync()`** received an empty `args` array; it now
  receives the arguments of the call, as for synchronous calls.

### Changed

- **Embedded Python example requires Python 3.12+** (was 3.8+): it uses only
  the stable C API of Python (`Py_CompileString` / `PyEval_EvalCode` instead
  of `PyRun_String`, `PyErr_GetRaisedException` / `PyErr_SetRaisedException`
  instead of the deprecated `PyErr_Fetch` triple), and older interpreters get
  a clear error.

## [2.1.0] - 2026-10-22

### Added

- **`threadSafeCallback().ref()` / `.unref()`**: like a timer, a thread-safe
  callback keeps the event loop alive until released; `.unref()` lets the
  process exit when nothing else is pending, while calls from other threads
  are still delivered. Both return the wrapper.
- **Embedded Python example** (`examples/cross-platform/python`): CPython
  driven through its C API with node-ctypes, on Windows, macOS and Linux
  (glibc and musl), Python 3.8+ including free-threaded builds, hosted by
  the main thread or by a worker thread. It runs code and imports modules
  and packages (local `.py` files and numpy too), converts values both ways
  (dict keys as properties, `Tuple`, `Date` ↔ `datetime`, `Temporal` types
  on Node.js 26+), uses JavaScript objects from Python by reference
  (`JsProxy`, `byReference()`), shares memory between typed arrays and
  Python buffers without copies, and implements `with` / `async with` and
  time limits. asyncio is connected to the Node.js event loop with an
  unreferenced `threadSafeCallback`: coroutines are awaitable from
  JavaScript, coroutines and Python threads call JavaScript functions (also
  while synchronous Python code waits for them, without deadlocks), and
  async iterators and cancellation work in both directions. `stats()`
  counts the objects shared by the two languages.
- **A README for every example**, published as child pages of the Examples
  document in the API documentation.

### Changed

- **Examples are organized by platform and example**
  (`examples/cross-platform/`, `examples/macos/`, `examples/windows/`), one
  folder per example with its library, demos and README;
  `examples/README.md` is an index. The COM demos are renamed
  `windows/com/demo_com_shortcut.js` and
  `windows/com/demo_com_active_directory.js`.

### Fixed

- **Smart card example on Linux**: `libpcsclite.so.1` is loaded by soname
  (the library is in the multiarch directory), `SCardError` codes are
  unsigned 32-bit numbers (`c_long` results are BigInt), and listing readers
  returns `[]` when none is connected (`SCARD_E_NO_READERS_AVAILABLE`).

## [2.0.0] - 2026-10-21

2.0 aligns node-ctypes with Python ctypes as closely as the language allows,
so that Python code can be ported with only the changes JavaScript requires.
It contains breaking changes: see [Migrating from 1.x](README.md#migrating-from-1x).

### Breaking changes

- **`pointer.contents` returns a live instance** on the pointed memory, as in
  Python: `p.contents.value` for simple types, `p.contents.x` for structures.
  Assigning an instance re-points the pointer; assigning a plain value writes
  it. `p[i]` still returns the value (a live instance for structures).
- **`POINTER(T)` restype returns a pointer object** (`null` for NULL) instead
  of a `bigint` address; use `.address` for the number. A `CFUNCTYPE` restype
  returns a callable function.
- **NULL `POINTER` fields of structures and unions read as `null`.**
- **`c_char` values are 1-character strings** (Python `bytes` of length 1)
  instead of numbers; `c_wchar` values are 1-character strings.
  `c_char * n` / `c_wchar * n` fields read and write as strings.
- **Invalid `c_char` / `c_wchar` values raise `TypeError`**
  (`"one character bytes, bytearray or integer expected"`,
  `"one character unicode string expected"`) instead of being truncated.
- **Argument conversion errors raise `ArgumentError`** (a `TypeError`
  subclass) with the Python message `"argument N: TypeError: ..."`. Numeric
  arguments accept numbers, booleans and BigInt (truncated to the type, as
  Python masks integers) and reject strings, `null` and objects.
- **Values that are not pointers raise `ArgumentError` (`"wrong type"`)** for
  pointer parameters instead of passing NULL (JS functions, plain objects,
  symbols). Invalid values assigned to pointer fields raise `TypeError`
  instead of writing 0.
- **Functions without `restype` return `c_int`**, and calls without
  `argtypes` use the fixed-argument ABI with Python's default conversions
  (e.g. a `c_int(5)` instance is passed by value).
- **`c_long` / `c_ulong` are `BigInt` on every platform**: fields and
  `.value` on Windows (where `long` is 32-bit) were numbers, while function
  results were already `BigInt`. This includes `wintypes.BOOL`, `LONG`,
  `DWORD`, `ULONG`, `LSTATUS`, `COLORREF`. Writes accept numbers and BigInt.
- **`wintypes` follows Python's `ctypes.wintypes`**: `CHAR` is `c_char`
  (was `c_ubyte`); `LPDWORD`, `PDWORD`, `LPBYTE`, `PBYTE`, `PHKEY` are
  `POINTER(T)` (were `c_void_p`), so fields and results of these types are
  pointer objects.
- **`string_at(addr, n)` / `wstring_at(addr, n)` read exactly `n` units**,
  embedded NULs included, instead of stopping at the first NUL.
- **`create_string_buffer(init, size)` / `create_unicode_buffer(init, size)`**
  honor `size` (`RangeError` if `init` does not fit) and return Buffers with
  `.value` (and `.raw` for char buffers).
- **`array(type, n)` returns a callable type** (a function, as Python's
  `type * n`) instead of a plain object.
- **Structure/union instances assigned to nested fields are copied
  bytewise**, as in Python, instead of field by field.
- **TypeScript declarations** follow the new runtime types (see below).

### Added

- Prebuilt binaries for Linux with musl (Alpine), x64 and ARM64
  (`ctypes-linux-<arch>-musl.node`), selected automatically.
- Python names: `ArgumentError`, `ARRAY`, `c_buffer`, `c_voidp`, `c_time_t`,
  `SIZEOF_TIME_T`, `RTLD_GLOBAL`, `RTLD_LOCAL`, `DEFAULT_MODE`,
  `LibraryLoader`, `cdll.LoadLibrary()` (and `windll` / `oledll`),
  `get_last_error()` / `set_last_error()` (on every platform), `CType.CHAR`.
- `CDLL(name, mode)` and `CDLL(name, { mode })` with the `dlopen` flags.
- Array types are callable like Python's: `array(c_int, 3)(1, 2, 3)` (also
  with `new`); arrays of arrays, of `POINTER(T)` and of `CFUNCTYPE` types;
  `.value` / `.raw` on `c_char` arrays and `.value` on `c_wchar` arrays.
- `CFUNCTYPE` types as `argtypes`, `restype` and structure/union fields (read
  back as callables); `sizeof` / `alignment` of `CFUNCTYPE` and `alignment` of
  `POINTER` types.
- `POINTER(POINTER(T))` and `POINTER(CFUNCTYPE)` element access
  (`pp[i].contents`, `pp[i] = pointer(x)`).
- `prototype([name, library])` and `prototype([name, library], paramflags)`,
  as Python's `prototype((name, dll), paramflags)`; `paramflags` also accept
  Python tuples `[flag, name, default]`.
- A structure instance as the single positional initializer
  (`new RECT(point)`).
- `memmove` / `memset` accept addresses, ctypes instances and pointers, not
  only Buffers.
- `c_void_p` parameters accept strings (passed as `char *`) and any
  TypedArray, DataView or ArrayBuffer.
- Objects assigned to pointer / `CFUNCTYPE` fields and array elements are
  kept alive with the structure, as Python's `_objects`.
- `POINTER(T)` arguments of callbacks are pointer objects; objects returned by
  callbacks are converted like arguments.
- `readValue` / `writeValue` accept pointer objects.
- `wintypes` matches Python's `ctypes.wintypes` on all its names: structures
  (`RECT`, `POINT`, `SIZE`, `MSG`, `FILETIME`, `SMALL_RECT`, `_COORD`,
  `WIN32_FIND_DATAA/W`), pointer types (`LPRECT`, `PHANDLE`, `LPMSG`, ...),
  `RGB()`, `MAX_PATH`, `VARIANT_BOOL` and the missing handle types.
- TypeScript: `wintypes` declarations; `static _fields_ = [["x", c_int]]`
  compiles without `as const`; `_pack_` as a number; typed `contents`,
  callable array types, buffer `.value` / `.raw`, pointer and function-pointer
  results; `StructureOf`, `ArrayInstance`, `CharBufferValue`,
  `WideBufferValue`, `MemoryTarget`.
- Type tests in `tests/types` (`npm run test:types`) and Python parity tests
  (`tests/common/test_python_parity.js` with its Python twin).

### Fixed

- Segmentation fault when passing a JS function or a plain object to a
  pointer parameter (e.g. a function to `qsort` instead of a callback).
- Segmentation fault when assigning a union instance with a pointer member
  (e.g. `c_wchar_p`) to a structure field.
- Segmentation fault when passing pointers created with `fromAddress()` and
  callback wrappers as arguments.
- `addressof()` of an array instance threw a "requires a Buffer" error.
- `wstring_at(addr)` truncated strings at 256 characters (512 on Windows), and
  so did long `c_wchar_p` fields; `wstring_at(addr, n)` behaved differently on
  Windows and Unix; invalid code points threw `RangeError` (now U+FFFD).
- `string_at(buffer)` could read past the end of the Buffer.
- `c_long` / `c_ulong` fields threw when assigned a BigInt on Windows, and so
  did 32-bit bit fields.
- `wchar_t` alignment in arrays and structures (`alignof(wchar_t)`).
- The function cache could return a function declared with other types of the
  same name (now keyed by type identity).
- `pointer(structInstance).contents` was not an instance of the structure
  class; `.constructor` of structure instances returned a bound function.
- `restype = null` (Python's `None`) threw `Invalid return type`; it now
  means `void`.
- The native module was looked up from `process.cwd()`: applications started
  from another directory, and nested installs, failed with "Native module not
  found". It is now located from the package itself (the previous locations
  remain as a fallback).
- macOS prebuilt binaries required the macOS version of the CI runner
  (26.0 on arm64, 15.0 on x64); they now target macOS 13.5, like Node 24.

### Performance

- Faster calls: per-function `call` without wrapper unwrapping, direct-call
  invokers for common signatures and lighter argument marshalling. In
  `tests/benchmarks/benchmark_koffi.js` the average gap with koffi dropped
  from 2.56x to about 1.45x (Apple Silicon).
- Faster JS paths: `readValue` at an address, array element access,
  `create_string_buffer`, structure instances sharing one Proxy handler.

### Changed

- Native code uses node-addon-api only; raw N-API is confined to
  `src/napi_fast.h` and all system headers are included from `src/shared.h`.
- `typescript` is a devDependency; CI type-checks `lib/index.d.ts` in a
  dedicated job and packaging depends on it.
- Linux binaries are built in `manylinux_2_28` containers: they require glibc
  2.28 (like Node 24) and the system libstdc++, instead of glibc 2.34 and the
  libstdc++ of GCC 13 (Ubuntu 22.04 and Debian 11/12 could not load them).
  CI fails if a build raises these requirements.
- Examples rewritten in Python ctypes style (`wintypes` structures,
  `DWORD()` / `HKEY()` with `byref` and `.value`, `in_dll`, `buf.value`,
  typed prototypes instead of raw Buffers and offsets).

## [1.14.0] - 2026-10-21

### Changed

- libffi updated to 3.8.0 (through 3.7.0 and 3.7.1), with `ffi_call_plan`
  support.
- Dependencies updated to their latest versions.

### Added

- Benchmark of node-ctypes against `node:ffi`.

## [1.13.0] - 2026-06-22

### Added

- `Symbol.dispose` support for callbacks and libraries (`using`).

### Changed

- `node:` prefix for built-in imports; koffi updated to 3.x in benchmarks.

## [1.12.0] - 2026-04-24

### Changed

- Library restructured for Python ctypes parity and maintainability.

### Performance

- No array allocations in the slow path of `func()` call wrappers; branch
  hints on the FFI hot path.

## [1.11.1] - 2026-04-22

### Fixed

- LDAP example: binary attributes preserved when `ensureSchema` inherits the
  caller options.

## [1.11.0] - 2026-04-22

### Changed

- `GetLastError` / `errno` API unified with Python ctypes semantics.

## [1.10.1] - 2026-04-22

### Performance

- Lower per-call overhead in the hot path.

### Fixed

- Documentation of the lazy library loaders.

## [1.10.0] - 2026-04-20

### Added

- Broader Python ctypes parity.

### Changed

- LTO/IPO enabled for Release builds.

## [1.9.0] - 2026-04-18

### Added

- Typed API and callback leak guard.

### Performance

- Faster structures.

### Fixed

- ESM import in tests on Windows (`pathToFileURL`).

## [1.8.0] - 2026-03-14

### Added

- `POINTER()` fields in unions; more tests and Python compatibility.

### Fixed

- Pointer size.

## [1.7.0] - 2026-03-11

### Added

- `PointerTypeDef` and `alignment()`; better pointer handling in structures
  and unions.

## [1.6.0] - 2026-03-09

### Added

- Documentation and examples.

### Fixed

- SID interpretation (`objectsid`) in the LDAP example.

## [1.5.0] - 2026-02-20

### Added

- Function pointer type factories (`CFUNCTYPE` / `WINFUNCTYPE`), callbacks
  with optional ABI.
- COM automation example (`IShellLinkW`, `IPersistFile`) and LDAP wrapper
  example (`wldap32.dll`).

## [1.4.0] - 2026-02-10

### Added

- Asynchronous function calls; simpler variadic calls.

### Changed

- Better error messages.

## [1.3.0] - 2026-02-05

### Added

- Inline string buffers and pointer support; cross-platform C library
  loading in tests.

## [1.2.0] - 2026-02-01

### Changed

- CType internals reworked; spdlog and dotenv removed.

## [1.1.0] - 2026-01-28

### Added

- PC/SC smart card example.

### Changed

- `long` / `ulong` alignment handling; values returned as BigInt.

## [1.0.2] - 2026-01-24

### Fixed

- `wchar` and pointer handling in primitive types.

## [1.0.1] - 2026-01-24

### Fixed

- Buffer handling in primitive type writers.

## [1.0.0] - 2026-01-24

### Changed

- Security and cross-platform improvements; JS files restructured.

## 0.1.x - 2026-01-17 to 2026-01-23

Initial releases.

[Unreleased]: https://github.com/dmazzella/node-ctypes/compare/v2.5.0...HEAD
[2.5.0]: https://github.com/dmazzella/node-ctypes/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/dmazzella/node-ctypes/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/dmazzella/node-ctypes/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/dmazzella/node-ctypes/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/dmazzella/node-ctypes/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/dmazzella/node-ctypes/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/dmazzella/node-ctypes/compare/v1.14.0...v2.0.0
[1.14.0]: https://github.com/dmazzella/node-ctypes/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/dmazzella/node-ctypes/compare/v1.12.1...v1.13.0
[1.12.0]: https://github.com/dmazzella/node-ctypes/compare/v1.11.1...v1.12.1
[1.11.1]: https://github.com/dmazzella/node-ctypes/compare/v1.11.0...v1.11.1
[1.11.0]: https://github.com/dmazzella/node-ctypes/compare/v1.10.1...v1.11.0
[1.10.1]: https://github.com/dmazzella/node-ctypes/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/dmazzella/node-ctypes/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/dmazzella/node-ctypes/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/dmazzella/node-ctypes/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/dmazzella/node-ctypes/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/dmazzella/node-ctypes/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/dmazzella/node-ctypes/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/dmazzella/node-ctypes/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/dmazzella/node-ctypes/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/dmazzella/node-ctypes/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dmazzella/node-ctypes/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/dmazzella/node-ctypes/compare/dbbb592...v1.0.2
[1.0.1]: https://github.com/dmazzella/node-ctypes/compare/78acf28...dbbb592
[1.0.0]: https://github.com/dmazzella/node-ctypes/compare/v0.1.7...78acf28
