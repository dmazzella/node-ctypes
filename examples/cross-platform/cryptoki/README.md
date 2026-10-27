# Cryptoki / PKCS #11 2.40-3.2

A Python-ctypes-shaped **consumer binding**, not a cryptographic provider.
The binding exposes the complete declarations from the OASIS PKCS #11 3.2
Standard headers, including legacy names. Algorithms, permissions, object
policies, validation and supported operations are implemented by the loaded
provider.

## Contents and sources

Like the other examples, this folder contains only the reusable binding,
a demo, documentation and the supplied native libraries:

- [cryptoki.js](./cryptoki.js): the complete reusable binding in one module,
  including constants, C types, structures, callbacks, function prototypes,
  library loading, interface discovery and calls.
- [demo_softhsm2.js](./demo_softhsm2.js): standalone SoftHSM setup, explicit PKCS #11 calls, cryptographic operations and cleanup.
- [softhsm2.conf](./softhsm2/config/softhsm2.conf): ready-to-use SoftHSM configuration shared by the supplied builds.
- [softhsm2/](./softhsm2/): supplied SoftHSM builds and their build/license notes.

The declarations are adapted from the
[OASIS PKCS #11 3.2 Standard headers](https://docs.oasis-open.org/pkcs11/pkcs11-spec/v3.2/os/include/pkcs11-v3.2/).
Their copyright and distribution notices are retained in the binding source.
No generator, test runner, C compiler or network access is needed to run the demo.

| Declaration                                      | Coverage |
| ------------------------------------------------ | -------: |
| Functions / `CK_C_*` prototypes                  |      104 |
| Structures, including three function lists       |      100 |
| Other typedef aliases, including pointer aliases |      178 |
| Callback prototypes                              |        5 |
| Header constants (`CK*` and version constants)   |    1,050 |
| `CKM_*` names, including aliases / legacy names  |      480 |
| `CKA_*` names                                    |      160 |
| `CKR_*` names                                    |      105 |

The HSS structure `specifiedParams` is included even though its name does not
start with `CK_`. `TRUE`, `FALSE` and `NULL_PTR` are also exported for source
compatibility. Preprocessor declaration macros have no JavaScript equivalent;
their effect is represented by ctypes types and prototypes.

## ABI: choose the provider's layout explicitly

The exported types use **one-byte packing**, as required by specification
section 2.1. `CK_ULONG` maps to native `c_ulong`: 32 bits on Windows x64, normally
64 bits on LP64 Unix. It is not `size_t` or a pointer-sized integer.

Some Unix providers, including the usual SoftHSM ABI, use natural alignment.
For those libraries use a separate type set:

```javascript
import { Cryptoki, createTypes } from "./cryptoki.js";

const types = createTypes({ packing: null }); // Native alignment, explicit ABI compatibility
const module = new Cryptoki("/absolute/path/to/provider.so", { types });
```

`packing: 1` is the specification layout; `packing: null` uses the platform's
natural layout. No layout is guessed from provider memory. Always use
`module.types` to construct arguments when selecting a non-default type set;
do not mix the two sets. The supplied Windows SoftHSM uses packing 1. The demo
selects the conventional SoftHSM layout by operating system, not a universal
ABI rule for third-party providers.

The binding uses the C calling convention (`CDLL` / `CFUNCTYPE`), including on
Windows. A provider with a different vendor ABI requires matching declarations;
it must not be loaded with these prototypes.

## Python-shaped raw API

```javascript
import * as ctypes from "node-ctypes";
import * as ck from "./cryptoki.js";

const module = new ck.Cryptoki("C:\\absolute\\path\\to\\softhsm2.dll", {
  errcheck: (rv, func) => ck.checkRV(rv, func.funcName),
});
let initialized = false;
try {
  module.C_Initialize(null);
  initialized = true;

  const info = new ck.CK_INFO();
  module.C_GetInfo(ctypes.byref(info));
  console.log(info.cryptokiVersion.major, info.cryptokiVersion.minor);
  console.log("Selected function-list surface:", module.version);
} finally {
  if (initialized) module.C_Finalize(null);
  module.close();
}
```

Use the C names without renaming: `CK_MECHANISM`, `CK_ATTRIBUTE`,
`CK_RSA_PKCS_PSS_PARAMS`, `C_SignInit`, etc. All mechanism parameter structures
are exported, including mechanisms not supported by SoftHSM.

| Python ctypes                              | JavaScript                                             |
| ------------------------------------------ | ------------------------------------------------------ |
| `class T(Structure): _fields_ = ...`       | `class T extends Structure { static _fields_ = ...; }` |
| `T(value)`                                 | `new T(value)`                                         |
| `(T * count)(...)`                         | `ctypes.ARRAY(T, count)(...)`                          |
| `POINTER(T)()`                             | `ctypes.POINTER(T).create()`                           |
| `byref(value)` / `cast(value, POINTER(T))` | Same public APIs                                       |
| `None`                                     | `null`                                                 |
| Integer `CK_ULONG` results                 | `BigInt` on every platform                             |
| C byte storage                             | `Buffer` or ctypes byte arrays                         |

`CK_TRUE` / `CK_FALSE` are byte-valued numbers. `CKR_*`, handles, flag masks
and other unsigned-long domains are BigInt. Use `CKF_RW_SESSION |
CKF_SERIAL_SESSION`, not Number bitwise conversions. `CK_UNAVAILABLE_INFORMATION`
is calculated at the actual width of native `unsigned long`.

The raw ctypes function prototypes are available independently:

```javascript
const library = new ctypes.CDLL(providerPath);
const C_GetFunctionList = ck.CK_C_GetFunctionList(["C_GetFunctionList", library]);
// Or declare library.C_GetFunctionList.argtypes / restype in Python style.
```

Direct bindings require the usual ctypes memory/library lifetime discipline;
only calls made through `Cryptoki` receive its lifecycle guards. Function
tables and interface names returned by a provider are borrowed and must never
be modified or used after unloading it.

## Discovery and version compatibility

```javascript
const module = new ck.Cryptoki(providerPath); // auto
const legacy = new ck.Cryptoki(providerPath, { version: "2.40" }); // legacy only
const modern = new ck.Cryptoki(providerPath, { version: "3.2" }); // exact, or error
```

- Minimum supported function-list surface: **2.40**.
- Auto discovery chooses the highest known `"PKCS 11"` interface offered by
  `C_GetInterfaceList`, up to 3.2. Vendor interfaces are not substituted.
- If only `C_GetInterface` exists, its default standard interface is validated.
- A provider with only `C_GetFunctionList` remains usable.
- An explicit version request never silently downgrades.
- 2.40, 3.0/3.1 and 3.2 use their respective function-list layouts.
- `C_GetFunctionList` supplies the **legacy layout**, even when the version
  in its header advertises a newer specification. It must not be read as a
  longer 3.x table.
- Unknown / pre-2.40 versions and NULL interface pointers are rejected.

`module.version` describes the selected **table surface**, not necessarily
`CK_INFO.cryptokiVersion`. `module.interfaces` lists discovery results;
`module.interfaceFlags` records the selected flags.

`module.supports("C_EncapsulateKey")` means that a non-NULL entry exists in the
selected table. It does **not** promise that a token supports a mechanism or
operation. Query `C_GetMechanismList` / `C_GetMechanismInfo` and handle provider
return codes. Missing entries throw `UnavailableFunctionError`; an available
entry returning `CKR_FUNCTION_NOT_SUPPORTED` returns that original code unless
an installed `errcheck` hook transforms it or throws.

## Return values, buffers and attributes

By default, functions return the original `CK_RV` without automatic exceptions.
`checkRV(rv, functionName, acceptedCodes)` is opt-in and throws `CryptokiError`
with `rv` and `functionName` on an unaccepted return code.

Set `errcheck` in the constructor, as above, to apply a common
`errcheck(rv, callable, args)` hook to every exposed native function. It can
also be changed later:

```javascript
module.errcheck = (rv, func) => ck.checkRV(rv, func.funcName);
module.C_Initialize(null); // CKR_OK, or CryptokiError on an unaccepted code
```

The hook receives the original `CK_RV`, the callable (including `funcName`),
and the original argument references. Its return value becomes the call's
result; exceptions propagate to the caller. Do not log arguments indiscriminately:
they can contain PINs, keys or other sensitive data.
The instance setting accepts a function or `null` (the default).

Individual functions can override the common policy:

```javascript
module.C_Verify.errcheck = (rv, func) => ck.checkRV(rv, func.funcName, [ck.CKR_SIGNATURE_INVALID]);
module.C_GetAttributeValue.errcheck = null; // Return raw CK_RV to inspect partial results
module.C_GetAttributeValue.errcheck = undefined; // Restore inheritance from module.errcheck
```

| Per-function setting        | Effective policy                                   |
| --------------------------- | -------------------------------------------------- |
| `undefined` (initial state) | Inherit the current instance hook                  |
| A function                  | Use that hook instead of the instance hook         |
| `null`                      | Return the original `CK_RV`, without an error hook |

Reading a function's `errcheck` returns its effective hook. Setting
`module.errcheck = null` disables only the instance policy; explicit
per-function hooks remain active. No non-OK return codes are accepted globally:
allow expected outcomes explicitly where needed, including `CKR_BUFFER_TOO_SMALL`,
partial attribute results or `CKR_PENDING` for native asynchronous operations.

Synchronous calls and `.callAsync()` use the same policy. The effective hook
is captured when each call starts, so changing either setting does not affect
in-flight calls. An exception raised by the hook at asynchronous completion
rejects the promise. Internal lifecycle accounting observes the original result
before the hook runs, even if it transforms the result or throws; for example,
a successful `C_Initialize` still requires finalization if a custom hook throws.
Constructor discovery and pre-call errors such as unavailable functions are
not intercepted by this hook.

Signature metadata (`argtypes`, `restype`) is exposed read-only: request another
ctypes prototype rather than mutating a captured native signature.

Follow specification section 5.2 for variable-length output:

1. Query the required size with a NULL output pointer where the function permits it.
2. Allocate byte storage / arrays of that size.
3. Call again; handle `CKR_BUFFER_TOO_SMALL` if the size changed.
4. Read only the returned length; distinguish element counts from byte lengths.
5. Do not retry state-changing operations indiscriminately.

`C_GetAttributeValue` can return `CKR_ATTRIBUTE_SENSITIVE`,
`CKR_ATTRIBUTE_TYPE_INVALID` or `CKR_BUFFER_TOO_SMALL` while filling other
attributes. Inspect each `ulValueLen`, including `CK_UNAVAILABLE_INFORMATION`.
Keep attribute backing memory, nested templates and parameter buffers alive:

```javascript
const label = Buffer.from("example", "utf8");
const attributes = ctypes.ARRAY(ck.CK_ATTRIBUTE, 1)(new ck.CK_ATTRIBUTE(ck.CKA_LABEL, ctypes.cast(label, ctypes.c_void_p), BigInt(label.length)));
```

Use byte pointers plus explicit lengths, not `c_char_p`, for PINs, keys,
signatures and binary data. Fixed-width labels are byte arrays with space
padding, not necessarily NUL-terminated strings. The binding does not
implicitly decode DER, EC points, certificate values or provider-defined data.

## Lifecycle, callbacks and native asynchronous operations

Call `C_Finalize` before `module.close()`. Close is idempotent, but refuses to
unload during active calls, owned initialization, owned sessions or retained
pending work. Keep the `Cryptoki` instance alive until its sessions and pending
operations are finished and finalization is complete.
Saved callables check the module state, including `.callAsync()`.
`Symbol.dispose` invokes `close()`; it does not silently finalize the provider.
Do not unload / finalize through another raw binding while this wrapper has
active calls. Initialization and finalization are process/provider-wide:
`CKR_CRYPTOKI_ALREADY_INITIALIZED` does not transfer ownership to this wrapper.
If another consumer has already finalized, an explicit `C_Finalize` returning
`CKR_CRYPTOKI_NOT_INITIALIZED` also releases this wrapper's stale ownership.

The binding retains initialization arguments and successful `C_OpenSession`
arguments until finalization / session close. For other provider-retained
memory, `module.retain(owner)` and `module.release(owner)` provide explicit
ownership. Ownership of raw addresses cannot be reconstructed: retain their
actual backing objects, not just integer addresses.

All five official callback prototypes are exported:
`CK_NOTIFY`, `CK_CREATEMUTEX`, `CK_DESTROYMUTEX`, `CK_LOCKMUTEX`,
`CK_UNLOCKMUTEX`. Release callback trampolines only after the provider can no
longer call them. Exceptions in callbacks must be handled explicitly by the
application and translated to an appropriate `CK_RV`; do not rely on the FFI's
generic exception fallback. For callbacks from native threads, use
`ctypes.threadSafeCallback()` with the matching signature and use
`.callAsync()` for calls that would otherwise block the JavaScript thread
needed to service those callbacks.

**PKCS #11 asynchronous execution is not node-ctypes `callAsync()`.**

- `CKR_PENDING` starts / continues provider-side work.
- The wrapper retains the original arguments while that operation is pending.
- `C_AsyncComplete` checks completion; pending polls do not accumulate owners.
- Successful `C_AsyncGetID` detaches the original memory ownership.
- Successful / pending `C_AsyncJoin` retains the replacement buffers.
- Finalization and successful session closure clear their retained state.

Input/output buffers still belong to the caller. Keep them alive while reading
completed results: `CK_ASYNC_DATA.pValue` is not a new owning allocation.
Use explicit ownership for any vendor retention not covered by the standard
calls. Callers remain responsible for synchronization, callback locks,
session state and provider-specific threading restrictions.

## Standalone SoftHSM demo

The repository includes [Windows x64](./softhsm2/win32-x64/BUILD.md) and
[macOS ARM64](./softhsm2/darwin-arm64/BUILD.md) builds and their licenses.
They are not rebuilt or replaced by this example.

Run the demo directly from the repository root; no configuration is required:

```powershell
node examples\cross-platform\cryptoki\demo_softhsm2.js
```

This is a dedicated SoftHSM example, not a generic provider launcher. It imports
only the binding and Node built-ins; the initialization, session and login
calls are visible directly in the demo instead of hidden in a provider class.
It accepts no arguments and does not read `.env`, `PIN`, `SO_PIN` or
`PKCS11_*` settings.

The demo sets `SOFTHSM2_CONF` to the supplied
[softhsm2.conf](./softhsm2/config/softhsm2.conf) before loading the bundled
library. This file is reused unchanged, not generated or deleted on each run.
The bundled `softhsm2-util` prepares a fresh token labeled `node-ctypes-demo`
in a temporary store. This keeps administrative setup out of the cryptographic
example without adding a provider abstraction or shipping token data.
The utility uses public example PINs (`1234` for USER, `12345678` for SO), not
production credentials. Never reuse these PINs or this setup for real secrets.

The configuration uses `directories.tokendir = tokens`. SoftHSM resolves this
relative to the process working directory, not the configuration file.
The standalone demo therefore temporarily changes its working directory to
its fresh temporary directory, independently of where it is launched.
On exit, including an error, it restores the original working directory and
`SOFTHSM2_CONF`, then removes the temporary token store. No initialized token
is included in the repository or kept between runs.
The supplied native library must match the current platform and architecture;
no Linux build is bundled.

The demo then:

1. Prepares the temporary token with `softhsm2-util`, calls `C_Initialize`
   and finds the token by label without hardcoding its slot ID. Displays slot
   and token information using every field of `CK_SLOT_INFO` and `CK_TOKEN_INFO`,
   with the specification's field names, decoded strings and hexadecimal flags.
   Session counts/limits, PIN lengths and public/private memory values are included.
   Special numeric values are labeled `CK_UNAVAILABLE_INFORMATION` and
   `CK_EFFECTIVELY_INFINITE` (the latter only for maximum session counts).
   `utcTime` is meaningful only when `CKF_CLOCK_ON_TOKEN` is set; otherwise the
   demo explicitly reports it as unavailable.
2. Opens a read-only token session and logs in as USER with the public demo PIN.
3. Generates an RSA-2048 keypair, signs binary data with SHA-256/RSA and verifies
   the signature.
4. Generates an EC P-256 keypair and signs/verifies a SHA-256 digest with ECDSA.
   The curve parameters are a DER-encoded OID; the 64-byte signature is raw
   `r || s`, not an ASN.1 DER sequence.
5. Generates an AES-128 key and checks an AES-CBC-PAD encrypt/decrypt round trip
   with a fresh random IV, including the original embedded NUL byte.
6. Computes a SHA-256 digest and compares it with Node.js.
7. Obtains random bytes from the token.
8. Finds each of the five generated keys by its unique `CKA_LABEL` using
   `C_FindObjectsInit`, `C_FindObjects` and `C_FindObjectsFinal`, checking the
   returned handle and rejecting duplicate labels. Each search is finalized
   even when inspection fails.
9. Reads the found keys with `C_GetAttributeValue`: first queries attribute
   lengths, then supplies typed scalars and buffers. Displays the label, object
   class, key type and session-only flag, RSA public-key size, DER EC curve
   parameters, AES key length, and private/secret-key sensitivity and
   extractability. Secret key material is never requested or printed.
10. Logs out, closes the session (releasing its session keys), calls `C_Finalize`,
    unloads the library and removes the temporary token store.

The example follows these calls directly, without a mechanism inventory or
generic enumeration helpers. A small shared routine prints key attributes.
Cryptographic output buffers use the known RSA-2048/ECDSA-P-256/SHA-256 sizes
and the AES-CBC-PAD size bound. One instance-level `errcheck` checks every native
result, including cleanup calls, without repeated manual `checkRV` wrappers.

Keys are session objects (`CKA_TOKEN = false`), which can be created even in a
read-only token session; no application keys are persisted. Private and secret
keys are sensitive and non-extractable. The USER PIN buffer is cleared on cleanup.
`DisposableStack` runs registered cleanup steps in reverse order, including on
failure, without discarding cleanup errors.

**Safety:** an external library cannot be passed to this demo. Token initialization
is confined to its fresh temporary store, and utility failures are reported
explicitly. Existing configurations and token stores are not used. The AES-CBC-PAD
example demonstrates this mechanism's interface; it is not authenticated
encryption.

Applications using the binding directly must provide their own SoftHSM
configuration and token store; the automatic temporary setup belongs only to
this demo.

The supplied Windows DLL was observed to report Cryptoki **3.2** in
`C_GetInfo`, while not exporting the 3.x discovery entry points. Accordingly,
the wrapper selects its legacy **2.40** function-list surface. This is not
evidence that its 3.2 operations are available. The macOS build must be verified
on macOS, not inferred from the Windows result.

## Specification coverage versus conformance

| Specification section  | Consumer binding surface                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 2: platform directives | Explicit packing and native C scalar widths                                                                                 |
| 3: types               | Complete typedefs, structures, pointers, callbacks and versioned tables                                                     |
| 4: objects             | All object/attribute identifiers; raw templates and partial attribute results                                               |
| 5: functions           | All 104 prototypes; version-aware dispatch; original return codes                                                           |
| 6: mechanisms          | All 480 header identifiers and every declared parameter structure; raw parameter buffers for mechanisms without a structure |
| 7: conformance         | No certification claim; consumer profiles must be assessed separately                                                       |

Object mutability, allowed attributes, mechanism parameter constraints,
cryptographic algorithms, validation claims and device errors are enforced by
the provider, not reimplemented in JavaScript. Unknown vendor identifiers and
opaque parameters can be passed through their standard scalar/pointer types;
vendor-specific ABI declarations are outside this standard binding.

Declarations alone do not prove ML-KEM, ML-DSA, SLH-DSA, HSS, XMSS, message APIs
or authenticated wrapping against a real provider. Such integration remains
capability-dependent and must not be reported as supported merely because
those declarations exist.

Native validation performed during development: **Windows x64, Node 24, MSVC**.
macOS / Linux and ARM64 require their own native runs.
Formal consumer conformance requires the applicable
[PKCS #11 Profiles 3.2](https://docs.oasis-open.org/pkcs11/pkcs11-profiles/v3.2/pkcs11-profiles-v3.2.html)
requirements and profile tests; complete API declarations alone are not a
conformance certificate.
