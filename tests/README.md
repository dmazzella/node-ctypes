# Test suites

```text
cpython_parity/
  scalars/
  aggregates/
  pointers/
  calls/
  lifetime/
  platform/
node_specific/
python_specific/
fixtures/
types/
benchmarks/
check_parity.js
```

- [cpython_parity/](./cpython_parity/) contains neighboring Python/JavaScript
  pairs for public contracts, grouped by domain.
- [node_specific/](./node_specific/) retains additional Node API paths,
  functional definitions, Buffer/TypedArray representations, async scheduling,
  weak caches, resource release and V8 collection checks.
  [manual_windows.js](./node_specific/manual_windows.js) is an interactive
  MessageBox/beep example, not an automated or parity test.
- [python_specific/](./python_specific/) retains genuine CPython-only scheduling
  checks, without pretending that Python has Node's `callAsync`.
- [fixtures/](./fixtures/) contains the shared C library and layout vectors.
  Use its real C signatures in both bindings; do not substitute an unrelated
  system function with a coincidentally similar register layout.
- [types/](./types/) checks declarations. [benchmarks/](./benchmarks/) measures
  performance separately from correctness.

## Paired contracts

Every `test_topic.py` has a neighboring `test_topic.js`. Preserve the Python
TestCase class and method names in JavaScript:

```python
class TestExample(unittest.TestCase):
    def test_value(self):
        self.assertEqual(ctypes.c_int32(7).value, 7)
```

```js
describe("TestExample", function () {
  it("test_value", function () {
    assert.equal(new ctypes.c_int32(7).value, 7);
  });
});
```

Use literal case IDs. Put input matrices inside named cases rather than
generating test names. Keep inputs, actual C entry points, signatures, side
effects, rejection cases and getter order/counts aligned.

[check_parity.js](./check_parity.js) uses the existing TypeScript parser and
Python's `ast` to reject missing file partners, missing Python package markers,
duplicate or one-sided class/method IDs, invalid syntax and Node-only shortcuts
in the canonical suites. Matching IDs are a structural guard, **not proof that
the assertions mean the same thing**. Both suites must execute against their
real runtimes.

Establish the CPython result before correcting Node. A verified divergence
needs a regression case and a producer fix, not a new skip or TODO. Preserve
explicit platform/version/upstream exclusions and explain what remains
unverified. A missing native fixture is an error, not a parity exclusion.

## Python-shaped JavaScript

Prefer the shared API:

- `class Record extends ctypes.Structure` / `Union`, with `_fields_`, `_pack_`,
  `_align_` and `_layout_`.
- `ARRAY(T, n)` for Python's `T * n`; call the resulting array factory normally.
- Library attributes with `argtypes` and `restype`, or `CFUNCTYPE` tuple bindings
  when independent callable signatures are required.
- `pointer`, `byref`, `cast`, `addressof`, `sizeof`, `alignment`, `from_buffer`,
  `from_buffer_copy`, `from_address` and `in_dll`.

Keep `struct()`, `union()`, `array()`, `CDLL.func()`, `callAsync()` and inspection
of private `_buffer`/`_structDef` metadata outside parity. Cleanup of a Node-owned
handle is allowed; testing its Node-only release semantics belongs in the
Node-specific suite.

Required language adaptations are explicit:

| Python                             | JavaScript                                         |
| ---------------------------------- | -------------------------------------------------- |
| `T(value)` for a C-data class      | `new T(value)`                                     |
| `(T * n)(...)`                     | `ARRAY(T, n)(...)`                                 |
| tuples                             | arrays                                             |
| keyword arguments                  | named argument objects                             |
| arbitrary-precision integers       | numbers or BigInt, without loss of precision       |
| byte storage                       | Buffer                                             |
| `None` pointer input / void result | `null` / `undefined`                               |
| `POINTER(T)()`                     | `POINTER(T).create()`                              |
| `bool(pointer)`                    | `!pointer.isNull`, or a NULL-result check          |
| `type(pointer)`                    | the pointer's `_pointerType` descriptor            |
| `T.field.offset`                   | `T.fields.find(f => f.name === "field").offset`    |
| `del fn.errcheck`                  | `fn.errcheck = null`                               |
| `argtypes = None`                  | `argtypes = null`, represented as an empty JS list |
| array slicing / negative indexing  | `slice` / `at`                                     |

Byte-valued character results and UTF-8 `c_char_p` text use the documented JS
string representation. Explicitly sized `string_at` preserves raw bytes as a
Latin1 string; `Buffer.from(result, "latin1")` recovers the exact byte sequence.
The small `bytes(value)` helper in [_support.js](./cpython_parity/_support.js)
implements Python's raw C-data byte observation through public memory APIs.
C-string Buffer inputs must have valid terminators.

Static JS class fields are collected lazily. When testing layout validation or
nested-type finalization, materialize the class through `sizeof(T)` in **both**
languages before observing the contract; do not claim identical metaclass
execution timing. Creating a pointer alone must not materialize its pointee.

Compare pointer NULL/identity/relative offsets within each process, not absolute
addresses across processes. Unbounded recursion uses the host stack guard:
`ArgumentError` wrapping is shared, but error wording and numeric depth differ.
Original JS error identity through `cause`, `undefined`, Symbol and GC schedules
are separate runtime coverage.

The [parameter-adapter pairs](./cpython_parity/calls/test_as_parameter.py)
check `from_param` results with stateful getters, left-to-right conversion,
stopping at the first conversion error and skipping `errcheck` on failure.
The existing `fixture_fill_int4` provides a positive write control and verifies
that rejected conversions leave native output unchanged. Exceptions raised by
`from_param`, including `ArgumentError`, receive the current argument's context;
[Node-specific adapter tests](./node_specific/test_as_parameter.js) additionally
check the original exception's `cause` through sync and async callers.

The [scalar-marshalling pairs](./cpython_parity/calls/test_scalar_marshalling.py)
check that non-pointer scalar arguments read backing storage, not overridden
`.value` getters, and snapshot each value before the next converter runs,
including calls without `argtypes`. They also cover a subclass `from_param`
returning a base CData with the same native scalar kind.
[Node-specific storage tests](./node_specific/test_scalar_marshalling.js)
cover storage getter failures, buffer aliases, native errcheck and callback
reentry, async calls and mirrored memory.

The [call-lifetime](./node_specific/test_call_lifetime_runtime.js) and
[result/error-hook lifetime](./node_specific/test_errcheck_lifetime_runtime.js)
matrices exercise `.func()`, library attributes and library-bound `CFUNCTYPE`
through sync and async calls. They check cleanup and callable reuse after
conversion, result-constructor, `_check_retval_` and `errcheck` failures, plus
owner retention across getter/callback reentry into the same callable.
The synchronous GC probes establish their `WeakRef`s before an event-loop turn
so V8's current-job protection does not mask a lost owner. Queued pointer calls
also check the returned native address, retention while pending and release
after completion. These are Node runtime checks, not CPython GC/scheduling parity.

## Running tests

From the repository root:

```sh
npm --prefix tests test                    # build fixture, then all JS suites
npm --prefix tests run test:python         # structural guard and all Python tests
npm --prefix tests run test:parity         # guard, paired Python, then paired JS
npm --prefix tests run test:parity:check   # file/case/discovery/style drift guard
npm --prefix tests run test:parity:python  # guard and paired Python only
npm --prefix tests run test:parity:js      # paired JS only
npm --prefix tests run test:node           # additional Node paths only
npm --prefix tests run test:windows        # Windows API pairs and Node paths
```

Commands other than `npm --prefix tests test` reuse an existing addon and fixture.
Build them first with `npm run build` and `npm run build:test-fixture`.
No test runner or assertion facade replaces `unittest` or `node:test`.

The guard and Python suites use the **same** `PYTHON` executable, defaulting to
`python` on PATH. They print the selected version/path and reject interpreters
other than CPython 3.14+ before loading ctypes tests. There is no automatic
fallback to a different interpreter. CI selects CPython 3.14 for the baseline
and runs the full references on 3.15 in its Linux control.

From the repository root, select an installed interpreter explicitly when the
default Python is older:

```sh
PYTHON=python3.14 npm --prefix tests run test:parity
```

For direct unittest runs, use a supported interpreter from this directory:

```sh
PYTHON=python3.14 node check_parity.js
python3.14 -B -m unittest discover -s . -p 'test_*.py'
python3.15 -B -m unittest discover -s cpython_parity -t . -p 'test_*.py'
```

Prefix JS commands with `NODE_CTYPES_NO_EXTERNAL_BUFFERS=1` to validate mirrored
native memory. Native operating-system/architecture CI is still needed to
certify those targets; a local run is not a cross-platform result.

## Native backends and ABI regressions

The [native source map](../README.md#native-backends-and-upstream-libffi)
separates direct invokers and `libffi_*` descriptors/CIFs/plans/closures from
shared Node-API conversions, sync/async ownership and TSFN delivery. CMake
discovers sources recursively with `GLOB_RECURSE`/`CONFIGURE_DEPENDS`.
Scalar/direct headers do not include libffi; shared return-word widths are
checked against libffi and return-slot tests preserve sign extension and bounds.
Layout metadata intentionally keeps a concrete owned libffi aggregate cache.

[test_function_abi.js](./node_specific/test_function_abi.js) checks scalar
register/stack overflow, 1-16-byte GP aggregates, nested/homogeneous float/double
aggregates, large value copies, inferred signatures and variadic named prefixes
in sync/async calls. [test_callback_abi.js](./node_specific/test_callback_abi.js)
uses independently compiled C callers for scalar aliases, 32/33-argument
signatures, GP/HFA/large arguments and private snapshots, for both ordinary
and thread-safe callbacks. These suites run without any runtime backend opt-in.

Scalar callback assertions check JavaScript representations independently of
native storage widths: `c_long` and `c_ulong` always produce `BigInt`, including
32-bit C longs on Windows. Their 32-bit boundary values are exercised on every
host, with 64-bit extremes added only when the native type supports them.

The libffi submodule is temporarily pinned to upstream
`d02afc25e8ea3aac9e78e227748e1fd7c9f14c82`, including the Darwin GP stack-slot fix.
Its remaining Darwin ARM64 indirect-pointer alignment limitation is documented
in the source map above. One explicit TODO executes a safe C stack-tag probe
for sync/async calls: it observes the incorrect scalar slots without
dereferencing a corrupt pointer. It is not a claim that upstream fixes both
defects. The large-aggregate dereferencing variants after a narrow stack scalar
run only on unaffected targets; all other aggregate positions remain covered.

Validate both build-time routes and both memory models, using the existing
configured source build:

```sh
npx --no-install cmake-js configure --CDCTYPES_ENABLE_DIRECT_CALLS=OFF
cmake --build build --target ctypes ctypes_test_fixture
node --test --test-timeout=5000 tests/node_specific/test_function_abi.js tests/node_specific/test_callback_abi.js
npm --prefix tests run test:js
NODE_CTYPES_NO_EXTERNAL_BUFFERS=1 npm --prefix tests run test:js
npx --no-install cmake-js configure --CDCTYPES_ENABLE_DIRECT_CALLS=ON
cmake --build build --target ctypes ctypes_test_fixture
npm --prefix tests run test:js
NODE_CTYPES_NO_EXTERNAL_BUFFERS=1 npm --prefix tests run test:js
```

Keep the final ordinary build direct-enabled. Run TypeScript declarations,
Python reference parity and TypeDoc validation using the commands above.
Native CI is still required to certify other operating systems/architectures.

### Windows ARM64 variadic diagnostics

If the ordinary test step fails on Windows ARM64, CI builds the standalone
[C reproducer](./fixtures/libffi_variadic_abi_repro.c) against the same
`ffi_static` target as the addon, then runs the
[isolated diagnostic runner](../.github/scripts/diagnose-variadic-abi.mjs).
It compares direct C references, fixed-signature HFA calls, variadic scalar
stack arguments and variadic HFA calls. The two corresponding JavaScript tests
also run separately with the TAP reporter.

Each case runs in its own process with a 30-second limit. A native crash does
not prevent the remaining cases from running; exit codes (including hexadecimal
Windows exception codes) and signals are reported explicitly. Any failing case
keeps the diagnostic step failed, and the original test failure is not suppressed.
No tests are skipped and the vendored libffi is unchanged.

To run the same diagnostics locally after configuring the ordinary source build:

```sh
cmake --build build --config Release --target ctypes_variadic_abi_repro
node .github/scripts/diagnose-variadic-abi.mjs
```

The executable is written to `build/diagnostics/`. Its individual modes are
`reference`, `fixed-hfa`, `variadic-stack` and `variadic-hfa`. Passing on a
different operating system does not certify Windows ARM64.

[benchmark_koffi.js](./benchmarks/benchmark_koffi.js) retains the matched
scalar/CFUNCTYPE, narrow GP/FP stack, struct/HFA/large-value, inferred/variadic
and ordinary/thread-safe callback workloads. The C-loop row performs 64 i32
callbacks per native invocation, checking the int64 sum 2080 in both APIs and
reporting ns/op per batch, not per callback. Async rows include scheduling and
Promise completion at concurrency 1/8; unsupported competitor APIs are reported
as not compared. Run benchmarks serially; use `--filter "C-loop"`,
`--filter "struct,HFA,double5"` or `--filter "async"` to select workloads.
`npm run bench:koffi -- --duration 500 --output comparison.json` keeps at
least nine samples per library and saves JSON plus the HTML report.

[benchmark_node_ffi.js](./benchmarks/benchmark_node_ffi.js) covers 25 workloads:
narrow scalars, GP/FP stack arguments, CFUNCTYPE callers, strings/buffers,
field reads, scalar/C-loop callbacks, host-thread-safe dispatch and inferred
mixed/10-integer calls. Its bool row uses numeric 0/1 input/output; inferred
rows use explicitly typed node:ffi bindings, not automatic inference.
Aggregate values/callbacks, true variadic signatures and async calls remain
not compared rather than emulated. For example,
`npm run bench:ffi -- --filter "narrow,C-loop,inferred" --output node-ffi.json`
selects the stack, C-loop and inferred workloads with the same sampling rules.
