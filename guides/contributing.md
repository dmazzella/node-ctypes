---
title: Building, testing and internals
---

# Building, testing and internals

## Tests & docs

From the repository root, `npm --prefix tests test` first builds a small C library (`tests/fixtures/`, into
`build/fixture/`) used by the tests of structures by value, array parameters
and reentrant calls; `npm run build:test-fixture` builds it alone. Matched
Python/JavaScript contracts live under `tests/cpython_parity/`, divided by domain,
and load the same library. Node-specific async, representation and GC checks
live under `tests/node_specific/`; genuine Python-only scheduling checks live
under `tests/python_specific/`. The former `common/` and `windows/` suites have
been migrated into these domains.

Paired JavaScript uses the Python-shaped API: `Structure`/`Union` classes,
`ARRAY`, library attributes with `argtypes`/`restype`, and `CFUNCTYPE` bindings.
The structural guard checks neighboring files and matching class/method IDs
using the existing TypeScript parser and Python AST; runtime assertions remain
independent checks against CPython, not a claim based on file names alone.

```bash
npm install
npm run build
npm --prefix tests install
npm --prefix tests test                              # functional/parity tests
NODE_CTYPES_NO_EXTERNAL_BUFFERS=1 npm --prefix tests test  # mirrored native memory
npm --prefix tests run test:parity                    # matched CPython and JS contracts
npm --prefix tests run test:parity:check              # paired file/case/discovery/style guard
npm --prefix tests run test:python                    # all Python references
npm run test:types                                   # TypeScript declarations
npm run docs                                         # TypeDoc API site in docs/
npm run docs:serve                                   # preview
```

See the [test suite guide](../tests/README.md) for paired-case conventions,
runtime differences and focused commands.

## Native backends and upstream libffi

For both structures and unions, [fields.js](../lib/structures/helpers/fields.js)
resolves field declarations and records natural alignment before packing.
[layout.js](../lib/structures/helpers/layout.js) computes field positions,
[types.js](../lib/core/types.js) normalizes argument and return declarations,
and [native-aggregate.js](../lib/core/native-aggregate.js) turns the computed
layout into a cached ABI descriptor. Extend the descriptor builder when a new
field representation needs ABI support; do not recalculate offsets in the
call wrappers. An array parameter decays to a pointer; a matrix field stays
inline. Preserve the leaf type (four `float`s can use floating-point registers)
and propagate unaligned members through every nonempty dimension, whether the
element is a class or a `struct()` definition.

To test that last rule on x86-64 System V, keep the natural and packed controls
at or below 16 bytes. The ABI fixture uses `rows[2][2]` of `{uint8_t, uint16_t}`:
the natural matrix uses registers, but the packed matrix must use memory. A
larger integer matrix would use memory either way and could mask a descriptor
bug. Compare arguments and results separately against a typed C caller.

[funcptr.js](../lib/core/funcptr.js) owns prototype caching and binding by
address, symbol or JavaScript callback. Only callbacks own a native trampoline:
[callback.js](../lib/core/callback.js) prevents its release until the callable's
active invocations finish, including result hooks and pending completions.
Bindings with output or named parameters use [paramflags.js](../lib/core/paramflags.js).
Keep shape and pointer checks before symbol lookup, and read names and defaults
after it: getters and the first exception are observable. Plain address calls
do not go through either the release guard or the `paramflags` wrapper.

[conversions.js](../lib/core/conversions.js) selects a converter for each
declared argument type, then captures its optional `from_param` hook. When
a hook returns a value, `marshalAdapted` handles it if the type accepts a
different representation from an unadapted input. Finish converting each
argument before running the next hook. Share the byte decoding of pointer
values, not their acceptance rules: a typed pointer accepts a direct `null`
but rejects an `_as_parameter_` chain that resolves to `null`. Each converter
may retain a temporary in the current call's owner list, but does not manage
that list's lifetime.
[invocation.js](../lib/core/invocation.js) keeps those temporaries alive
through synchronous result handling or asynchronous completion, including
when another call reenters an adapter. For the reverse direction, change
[callback-conversions.js](../lib/core/callback-conversions.js): it presents
C arguments to the JS callback and converts its return value back to C.

For a new scalar representation, start in
[scalar-protocol.js](../lib/types/scalar-protocol.js): reading an argument and
constructing a view of C-owned bytes must not invoke application constructors.
For `_as_parameter_` chains, change [parameters.js](../lib/core/parameters.js);
it retains intermediate objects while a getter can reenter a call.
Aggregate builders share their identity and conversion hooks with the call
code through [protocol.js](../lib/structures/protocol.js), without adding
properties to user declarations.

Pointer ownership is a separate concern from field layout. In
[ownership.js](../lib/memory/ownership.js), all views of a known memory domain
share registrations keyed by byte position. A typed copy captures the owners
of complete pointer slots **before** overwriting the destination, since the
two views can overlap. A by-value argument keeps those owners even if a
later argument adapter changes the original fields. Copying bytes with
`memmove` does not acquire those owners.

[results.js](../lib/core/results.js) defines how a declared `restype` represents
the native value and applies its captured `_check_retval_`. It has no reference
to the invoked function or its arguments. Those belong to a single invocation:
the checked path in [invocation.js](../lib/core/invocation.js) passes the
converted result, public callable and original arguments to the captured
`errcheck` while any argument owners are still alive. Keep this distinction
when adding a return type or changing how a call completes.

The maintained outgoing paths are the bounded C++ direct invokers, register-frame
calls and libffi. Register-frame calls cover any signature of scalars, pointers
and strings up to 32 arguments on AArch64, x86-64 System V and Win64: each
argument is converted straight into its register or stack word, and one C++
signature per ABI passes the whole frame (on Apple ARM64 the stack arguments
are packed by size and natural alignment, as the platform ABI requires).
libffi remains for aggregates, other calling conventions
and the remaining cases. `CDLL.func()` and prototype calls return the native
function itself when the arguments need no JavaScript conversion (scalars,
`c_char_p` strings), as Koffi does; objects, `errcheck` and the other
signatures are forwarded to the JavaScript converters.
Callbacks use libffi closures and the shared Node-API bridge; up to 64 callbacks
running inside one synchronous call reuse its handle scope instead of opening
their own. The source tree stays flat, with backend-specific files prefixed
where needed:

| Files                                                                                          | Responsibility                                                                              |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [call_abi.h](../src/call_abi.h), [types.h](../src/types.h)                                     | Shared calling conventions, ABI return words and scalar conversions, without libffi headers |
| [direct_call.h](../src/direct_call.h)                                                          | Exact fixed-signature C++ invokers                                                          |
| [frame_call.h](../src/frame_call.h)                                                            | Register-frame calls: argument placement per ABI and one C++ signature per return type      |
| [libffi_types.cc](../src/libffi_types.cc), [libffi_types.h](../src/libffi_types.h)             | Primitive mapping and aggregate descriptor factories                                        |
| [libffi_type_cache.h](../src/libffi_type_cache.h)                                              | Concrete owned aggregate cache used by layout metadata                                      |
| [libffi_call.cc](../src/libffi_call.cc), [libffi_call.h](../src/libffi_call.h)                 | Calling conventions, CIFs, reusable plans and worker-owned extra-call interfaces            |
| [libffi_callback.cc](../src/libffi_callback.cc), [libffi_callback.h](../src/libffi_callback.h) | Closure preparation, allocation and release                                                 |
| [function.cc](../src/function.cc), [function.h](../src/function.h)                             | Node-API call orchestration, marshalling, hooks and sync/async ownership                    |
| [callback.cc](../src/callback.cc), [callback.h](../src/callback.h)                             | Shared callback conversions, TSFN delivery, native-context hooks and lifetime               |

CMake discovers native files with `file(GLOB_RECURSE ... CONFIGURE_DEPENDS ...)`.
The public layouts retain their physical size/alignment; the libffi descriptor
cache in `layout.h` is intentionally concrete rather than ABI-agnostic.
High-level callback snapshot pooling and cached struct/array readers remain:
slices are never recycled, retained views have independent bytes and identity,
and custom getters, mirrored synchronization and Node-API ownership are preserved.

**libffi dependency.** The unmodified
[libffi submodule](https://github.com/libffi/libffi/tree/v3.8.1) is at the
[v3.8.1](https://github.com/libffi/libffi/releases/tag/v3.8.1) tag. It includes
the Darwin GP-composite stack-slot
[fix](https://github.com/libffi/libffi/commit/2472245a3430b9d24f085b7654e896e074bceb82)
and its [compiler/ABI guard adjustment](https://github.com/libffi/libffi/commit/3365ad8b968a9b742922b6f1188462fe6ce142ec):
small GP composites use aligned, whole-word stack slots in outgoing calls and
closures, without widening ctypes buffers or changing scalar/HFA packing.
This follows the compiler's C ABI rather than reproducing broken padding in
older libffi builds, including those used by some Python installations.
3.8.1 also places the pointer to an indirect aggregate (larger than 16 bytes)
passed after the AArch64 GP registers in an 8-byte, 8-aligned stack slot,
instead of one aligned like the aggregate
([GHSA-h52h-3759-xqm4](https://github.com/libffi/libffi/security/advisories/GHSA-h52h-3759-xqm4),
[libffi/libffi#1057](https://github.com/libffi/libffi/issues/1057)), and fixes
a use-after-free of the Apple trampoline-table closure allocator past 1024 live
closures ([GHSA-23hx-9rxv-9qfp](https://github.com/libffi/libffi/security/advisories/GHSA-23hx-9rxv-9qfp)).
[test_function_abi.js](../tests/node_specific/test_function_abi.js) checks the
stack slots on every target.

After changing the submodule revision, run `npm run generate-ffi-headers`,
rebuild and repeat the ABI/parity tests. Do not patch the vendored libffi
internals.

**Windows ARM64 variadic HFA limitation.** A named HFA argument containing four
doubles (32 bytes) in a variadic call triggers an access violation in upstream
libffi, independently of the Node wrapper. Avoid this signature until an upstream
fix is available. Its regression is temporarily skipped only on Windows ARM64
and still runs on other targets. Native calling behavior is unchanged.

`CTYPES_ENABLE_DIRECT_CALLS` remains a build-time control, default ON, for both
the direct invokers and the register-frame calls. Fixed direct calls and workers
need no CIF; unsupported fixed signatures use libffi,
and async inferred/variadic calls own CIFs prepared on the JavaScript thread.
Workers retain the parent function, metadata and library through completion.
To compare the direct-enabled and libffi-only builds, follow the
[native validation commands](../tests/README.md#native-backends-and-abi-regressions).

## Release validation

The workflow retains the eight Node 24 native build targets (Windows/macOS,
x64/ARM64, and Linux glibc/musl). C++20 conformance is checked with
`-pedantic-errors` on GCC/Clang and `/permissive-` on MSVC; vendor optimization
and the node-addon-api integration remain unchanged.

Three runtime-control jobs reuse the built artifacts on Node 26 without
rebuilding the addon, running the functional parity suite normally and with
mirrored buffers. A Linux job runs the focused Python 3.15
reference tests in addition to the Python 3.14 reference coverage.

The package assembler requires all eight nonempty binaries and includes
declarations, README, changelog and license. It fails on missing/unknown
artifacts or a stale output directory. Publish depends on the runtime gates,
requires a pushed tag matching the manifest version exactly, and uses `next`
for prereleases instead of `latest`. Manual workflow runs never publish.
These are configured gates, not a substitute for a successful native CI run.

`npm --prefix tests test` builds the fixture and runs the suite;
`npm --prefix tests run test:js` reuses an already-built fixture/addon.
Both use the documented `--test-timeout` runner option.
