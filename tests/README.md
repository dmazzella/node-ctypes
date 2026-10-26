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
