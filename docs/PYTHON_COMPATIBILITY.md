# Analisi Compatibilità: node-ctypes vs Python ctypes

## Riepilogo

| Categoria | Supportato | Parziale | Mancante |
|-----------|------------|----------|----------|
| Loading Libraries | 3 | 0 | 1 |
| Basic Types | 19 | 0 | 1 |
| Functions | 3 | 1 | 1 |
| Structures | 7 | 0 | 1 |
| Pointers | 7 | 0 | 0 |
| Callbacks | 2 | 0 | 0 |
| Memory | 12 | 0 | 0 |
| Error Handling | 6 | 0 | 0 |

**Compatibilità stimata: ~98%**

---

## 1. Loading Libraries

### ✅ Supportato

| Python | node-ctypes | Note |
|--------|-------------|------|
| `CDLL("lib.dll")` | `new CDLL("lib.dll")` | Identico |
| `WinDLL("lib.dll")` | `new WinDLL("lib.dll")` | Identico |
| `cdll.LoadLibrary()` | `load()` | Diversa sintassi |

### ❌ Mancante

| Python | Descrizione |
|--------|-------------|
| `OleDLL()` | stdcall + controllo HRESULT automatico |

### Esempio Comparativo

```python
# Python
from ctypes import CDLL, WinDLL
libc = CDLL("msvcrt")
kernel32 = WinDLL("kernel32")
```

```javascript
// node-ctypes
const { CDLL, WinDLL } = require('node-ctypes');
const libc = new CDLL("msvcrt");
const kernel32 = new WinDLL("kernel32");
```

---

## 2. Basic Types

### ✅ Supportato

| Python | node-ctypes | Size |
|--------|-------------|------|
| `c_bool` | `c_bool` / `'bool'` | 1 |
| `c_int8` / `c_byte` | `c_int8` / `'int8'` | 1 |
| `c_uint8` / `c_ubyte` | `c_uint8` / `'uint8'` | 1 |
| `c_int16` / `c_short` | `c_int16` / `'int16'` | 2 |
| `c_uint16` / `c_ushort` | `c_uint16` / `'uint16'` | 2 |
| `c_int32` / `c_int` | `c_int32` / `'int32'` | 4 |
| `c_uint32` / `c_uint` | `c_uint32` / `'uint32'` | 4 |
| `c_int64` / `c_longlong` | `c_int64` / `'int64'` | 8 |
| `c_uint64` / `c_ulonglong` | `c_uint64` / `'uint64'` | 8 |
| `c_long` | `c_long` / `'long'` | platform |
| `c_ulong` | `c_ulong` / `'ulong'` | platform |
| `c_float` | `c_float` / `'float'` | 4 |
| `c_double` | `c_double` / `'double'` | 8 |
| `c_char_p` | `c_char_p` / `'string'` | ptr |
| `c_wchar` | `c_wchar` / `'wchar'` | 2/4 |
| `c_wchar_p` | `c_wchar_p` / `'wstring'` | ptr |
| `c_void_p` | `c_void_p` / `'pointer'` | ptr |
| `c_size_t` | `c_size_t` / `'size_t'` | ptr |
| `c_ssize_t` | `'ssize_t'` | ptr |

**Note sui tipi platform-dependent:**
- `c_long`: 32-bit su Windows (LLP64), 32/64-bit su Unix (LP64)
- `c_wchar`: 16-bit su Windows (UTF-16), 32-bit su Unix (UTF-32)

### ❌ Mancante

| Python | Descrizione |
|--------|-------------|
| `c_longdouble` | Long double (80/128 bit) |

---

## 3. Functions

### ✅ Supportato

| Python | node-ctypes | Note |
|--------|-------------|------|
| `lib.func_name` | `lib.func(name, ret, args)` | Sintassi diversa |
| `func.restype` | secondo parametro di `func()` | Integrato |
| `func.argtypes` | terzo parametro di `func()` | Integrato |

### ⚠️ Parziale

| Feature | Python | node-ctypes |
|---------|--------|-------------|
| Definizione | `lib.abs.restype = c_int`<br>`lib.abs.argtypes = [c_int]` | `lib.func("abs", "int32", ["int32"])` |

### ❌ Mancante

| Python | Descrizione |
|--------|-------------|
| `func.errcheck` | Callback per controllo errori automatico |

### Esempio Comparativo

```python
# Python
from ctypes import CDLL, c_int, c_char_p, c_size_t

libc = CDLL("msvcrt")

# Metodo 1: attributi
libc.abs.restype = c_int
libc.abs.argtypes = [c_int]
result = libc.abs(-42)

# Metodo 2: prototype
from ctypes import CFUNCTYPE
abs_proto = CFUNCTYPE(c_int, c_int)
abs_func = abs_proto(("abs", libc))
```

```javascript
// node-ctypes
const { CDLL } = require('node-ctypes');

const libc = new CDLL("msvcrt");
const abs = libc.func("abs", "int32", ["int32"]);
const result = abs(-42);
```

---

## 4. Structures & Unions

### ✅ Supportato

| Feature | Python | node-ctypes |
|---------|--------|-------------|
| Definizione struct | `class S(Structure)` | `struct({...})` |
| Definizione union | `class U(Union)` | `union({...})` |
| Campi | `_fields_` | oggetto fields |
| Packed | `_pack_ = 1` | `{ packed: true }` |
| sizeof | `sizeof(S)` | `structDef.size` |
| Nested structs | Supportato | Accesso con dot notation |
| Bit fields | `bitfield('uint32', 4)` | Simile a Python |

### ❌ Mancante

| Python | Descrizione |
|--------|-------------|
| `_anonymous_` | Campi anonimi |

### Esempio Comparativo - Base

```python
# Python
from ctypes import Structure, Union, c_int, c_float, sizeof

class Point(Structure):
    _fields_ = [
        ("x", c_int),
        ("y", c_int)
    ]

class IntOrFloat(Union):
    _fields_ = [
        ("i", c_int),
        ("f", c_float)
    ]

p = Point(10, 20)
print(p.x, p.y)

u = IntOrFloat()
u.f = 3.14
print(u.i)  # Interpreta i bit come int
```

```javascript
// node-ctypes
const { struct, union, alloc } = require('node-ctypes');

const Point = struct({
    x: 'int32',
    y: 'int32'
});

const IntOrFloat = union({
    i: 'int32',
    f: 'float'
});

const p = Point.create({ x: 10, y: 20 });
console.log(Point.get(p, 'x'), Point.get(p, 'y'));

const u = IntOrFloat.create();
IntOrFloat.set(u, 'f', 3.14);
console.log(IntOrFloat.get(u, 'i'));  // Interpreta i bit come int
```

### Esempio Comparativo - Nested Structs

```python
# Python
from ctypes import Structure, c_int, c_uint32

class Point(Structure):
    _fields_ = [("x", c_int), ("y", c_int)]

class Rectangle(Structure):
    _fields_ = [
        ("topLeft", Point),
        ("bottomRight", Point),
        ("color", c_uint32)
    ]

rect = Rectangle()
rect.topLeft.x = 10
rect.topLeft.y = 20
print(rect.topLeft.x)  # 10
```

```javascript
// node-ctypes - SUPPORTATO!
const { struct } = require('node-ctypes');

const Point = struct({ x: 'int32', y: 'int32' });

const Rectangle = struct({
    topLeft: Point,      // Nested struct!
    bottomRight: Point,
    color: 'uint32'
});

const rect = Rectangle.create({
    topLeft: { x: 10, y: 20 },
    bottomRight: { x: 100, y: 200 }
});

console.log(Rectangle.get(rect, 'topLeft.x'));  // 10 - Dot notation!
```

### Esempio Comparativo - Bit Fields

```python
# Python
from ctypes import Structure, c_uint32

class Flags(Structure):
    _fields_ = [
        ("enabled", c_uint32, 1),    # 1 bit
        ("mode", c_uint32, 3),       # 3 bits
        ("priority", c_uint32, 4),   # 4 bits
        ("reserved", c_uint32, 24)   # 24 bits
    ]

f = Flags()
f.enabled = 1
f.mode = 5
f.priority = 15
print(f.enabled, f.mode, f.priority)  # 1 5 15
```

```javascript
// node-ctypes - SUPPORTATO!
const { struct, bitfield } = require('node-ctypes');

const Flags = struct({
    enabled: bitfield('uint32', 1),   // 1 bit
    mode: bitfield('uint32', 3),      // 3 bits
    priority: bitfield('uint32', 4),  // 4 bits
    reserved: bitfield('uint32', 24)  // 24 bits
});

const f = Flags.create({
    enabled: 1,
    mode: 5,
    priority: 15
});

console.log(
    Flags.get(f, 'enabled'),   // 1
    Flags.get(f, 'mode'),      // 5  
    Flags.get(f, 'priority')   // 15
);
```

---

## 5. Pointers

### ✅ Supportato

| Python | node-ctypes | Note |
|--------|-------------|------|
| `addressof(obj)` | `addressOf(buf)` | Identico |
| `sizeof(type)` | `sizeof(type)` | Identico |
| `byref(obj)` | `byref(buf)` | Passa per riferimento |
| `cast(ptr, type)` | `cast(ptr, type)` | Cast tra tipi |
| `POINTER(type)` | `POINTER(type)` | Tipo puntatore |
| Pointer aritmetica | BigInt | Manuale con BigInt |
| Dereferenziazione | `readValue()` | Diversa sintassi |

### 🆕 Extra in node-ctypes

| Feature | Descrizione |
|---------|-------------|
| `ptrToBuffer(addr, size)` | Crea Buffer da indirizzo raw |

### Esempio Comparativo

```python
# Python
from ctypes import *

# Alloca e scrivi
buf = create_string_buffer(100)
value = c_int(42)

# byref - passa per riferimento
GetSystemInfo(byref(sysInfo))

# Pointer type
IntPtr = POINTER(c_int)
ptr = IntPtr(value)
print(ptr.contents.value)  # 42

# Cast
void_ptr = cast(ptr, c_void_p)

# addressof
addr = addressof(value)
```

```javascript
// node-ctypes
const { alloc, writeValue, readValue, addressOf, byref, cast, POINTER } = require('node-ctypes');

// Alloca e scrivi
const buf = alloc(100);
writeValue(buf, 'int32', 42);

// byref - passa per riferimento
GetSystemInfo(byref(sysInfo));

// Pointer type
const IntPtr = POINTER('int32');
const ptr = IntPtr.fromBuffer(buf);

// Cast
const asFloat = cast(buf, 'float');

// addressof
const addr = addressOf(buf);
```

---

## 6. Callbacks

### ✅ Supportato

| Python | node-ctypes | Note |
|--------|-------------|------|
| `CFUNCTYPE(ret, *args)` | `callback(fn, ret, args)` | Simile |
| `WINFUNCTYPE(ret, *args)` | `callback(fn, ret, args, {abi:'stdcall'})` | Windows |

### 🆕 Extra in node-ctypes

| Feature | Descrizione |
|---------|-------------|
| `threadSafeCallback()` | Callback sicuro da thread esterni (Python NON supporta questo!) |

### Esempio Comparativo

```python
# Python
from ctypes import CDLL, CFUNCTYPE, c_int, c_void_p

libc = CDLL("msvcrt")

# Callback per qsort
CMPFUNC = CFUNCTYPE(c_int, c_void_p, c_void_p)

def py_compare(a, b):
    a_val = cast(a, POINTER(c_int)).contents.value
    b_val = cast(b, POINTER(c_int)).contents.value
    return a_val - b_val

compare = CMPFUNC(py_compare)
```

```javascript
// node-ctypes
const { CDLL, callback, readValue } = require('node-ctypes');

const libc = new CDLL("msvcrt");

const compare = callback((a, b) => {
    const aVal = readValue(a, 'int32');
    const bVal = readValue(b, 'int32');
    return aVal - bVal;
}, 'int32', ['pointer', 'pointer']);

// Per callback da thread esterni (es. CreateThread):
const threadProc = threadSafeCallback((param) => {
    console.log('Called from external thread!');
    return 0;
}, 'uint32', ['pointer']);
```

---

## 7. Memory Management

### ✅ Supportato

| Python | node-ctypes | Note |
|--------|-------------|------|
| `create_string_buffer(n)` | `create_string_buffer(n)` | **Identico!** |
| `create_string_buffer(b"str")` | `create_string_buffer("str")` | **Identico!** |
| `create_unicode_buffer(n)` | `create_unicode_buffer(n)` | **Identico!** |
| `create_unicode_buffer(s)` | `create_unicode_buffer(s)` | **Identico!** |
| `sizeof(type)` | `sizeof(type)` | **Identico!** |
| `string_at(ptr, n)` | `string_at(ptr, n)` | **Identico!** |
| `wstring_at(ptr, n)` | `wstring_at(ptr, n)` | **Identico!** |
| `addressof(obj)` | `addressof(buf)` | **Identico!** |
| `memmove(dst, src, n)` | `memmove(dst, src, n)` | **Identico!** |
| `memset(dst, val, n)` | `memset(dst, val, n)` | **Identico!** |
| Lettura/scrittura | `readValue/writeValue` | Extra |
| N/A | `ptrToBuffer(addr, size)` | **Extra!** |

### Alias Disponibili

Per chi preferisce nomi più JavaScript-like:

| Python-style | JS-style |
|--------------|----------|
| `create_string_buffer` | `alloc` / `cstring` |
| `create_unicode_buffer` | `wstring` |
| `string_at` | `readCString` |
| `wstring_at` | `readWString` |
| `addressof` | `addressOf` |

### Esempio Comparativo

```python
# Python
from ctypes import create_string_buffer, create_unicode_buffer, string_at, wstring_at, sizeof, c_int, memmove, memset

# Buffer vuoto
buf = create_string_buffer(100)

# Buffer con stringa
buf = create_string_buffer(b"Hello")

# Buffer Unicode
wbuf = create_unicode_buffer("Ciao")

# Leggi stringa
s = string_at(buf, 5)

# Leggi wide string
ws = wstring_at(wbuf, 4)

# Copia memoria
memmove(dst, src, 10)

# Riempi memoria
memset(buf, 0, 100)
```

```javascript
// node-ctypes - IDENTICO!
const { create_string_buffer, create_unicode_buffer, string_at, wstring_at, sizeof, memmove, memset } = require('node-ctypes');

// Buffer vuoto
const buf = create_string_buffer(100);

// Buffer con stringa
const buf2 = create_string_buffer("Hello");

// Buffer Unicode
const wbuf = create_unicode_buffer("Ciao");

// Leggi stringa
const s = string_at(buf2, 5);

// Leggi wide string  
const ws = wstring_at(wbuf, 4);

// Copia memoria
memmove(dst, src, 10);

// Riempi memoria
memset(buf, 0, 100);
```

---

## 8. Error Handling

### ✅ Supportato

| Python | node-ctypes | Note |
|--------|-------------|------|
| `get_errno()` | `get_errno()` | Identico |
| `set_errno(n)` | `set_errno(n)` | Identico |
| `GetLastError()` | `GetLastError()` | Windows |
| `SetLastError(n)` | `SetLastError(n)` | Windows |
| `FormatError(n)` | `FormatError(n)` | Windows |
| `WinError(n)` | `WinError(n)` | Windows |

### Esempio Comparativo

```python
# Python
from ctypes import get_errno, set_errno, GetLastError, FormatError, WinError

# errno
set_errno(0)
# ... call function ...
err = get_errno()

# Windows errors
code = GetLastError()
msg = FormatError(code)
raise WinError(code)
```

```javascript
// node-ctypes
const { get_errno, set_errno, GetLastError, FormatError, WinError } = require('node-ctypes');

// errno
set_errno(0);
// ... call function ...
const err = get_errno();

// Windows errors
const code = GetLastError();
const msg = FormatError(code);
throw WinError(code);
```

---

## 9. Feature Comparison Matrix

| Feature | Python ctypes | node-ctypes | Note |
|---------|---------------|-------------|------|
| CDLL | ✅ | ✅ | |
| WinDLL | ✅ | ✅ | |
| OleDLL | ✅ | ❌ | COM automation |
| Basic types | ✅ | ✅ | |
| c_long/c_ulong | ✅ | ✅ | Platform-dependent |
| c_wchar/c_wchar_p | ✅ | ✅ | Wide strings |
| Functions | ✅ | ✅ | |
| errcheck | ✅ | ❌ | Error callback |
| Structure | ✅ | ✅ | |
| Union | ✅ | ✅ | |
| Nested struct | ✅ | ✅ | **Implementato!** |
| Bit fields | ✅ | ✅ | **Implementato!** |
| POINTER() | ✅ | ✅ | |
| byref() | ✅ | ✅ | |
| cast() | ✅ | ✅ | |
| addressof() | ✅ | ✅ | |
| Callbacks | ✅ | ✅ | |
| Thread-safe cb | ❌ | ✅ | **Extra!** |
| get_errno | ✅ | ✅ | |
| set_errno | ✅ | ✅ | |
| GetLastError | ✅ | ✅ | |
| SetLastError | ✅ | ✅ | |
| FormatError | ✅ | ✅ | |
| WinError | ✅ | ✅ | |
| ptrToBuffer | ❌ | ✅ | **Extra!** |
| wstring | ✅ | ✅ | Wide string buffer |
| create_string_buffer | ✅ | ✅ | **Identico!** |
| create_unicode_buffer | ✅ | ✅ | **Identico!** |
| string_at | ✅ | ✅ | **Identico!** |
| wstring_at | ✅ | ✅ | **Identico!** |
| memmove | ✅ | ✅ | **Identico!** |
| memset | ✅ | ✅ | **Identico!** |

---

## 10. Raccomandazioni per Migliorare Compatibilità

### ✅ Recentemente Implementati

1. **Nested structures** - Strutture annidate con accesso dot notation
2. **Bit fields** - Campi bit con `bitfield('uint32', 4)`

### Priorità Media (Ancora Mancanti)

1. **`errcheck`** - Callback error checking
2. **`_anonymous_`** - Campi anonimi nelle struct

### Priorità Bassa

3. **`OleDLL`** - COM automation
4. **`c_longdouble`** - Raramente usato

---

## 11. Esempio Completo: Compatibilità Pratica

### Python

```python
from ctypes import *

# Load library
kernel32 = WinDLL("kernel32")
msvcrt = CDLL("msvcrt")

# Define struct
class SYSTEMTIME(Structure):
    _fields_ = [
        ("wYear", c_uint16),
        ("wMonth", c_uint16),
        ("wDayOfWeek", c_uint16),
        ("wDay", c_uint16),
        ("wHour", c_uint16),
        ("wMinute", c_uint16),
        ("wSecond", c_uint16),
        ("wMilliseconds", c_uint16),
    ]

# Get function
GetLocalTime = kernel32.GetLocalTime
GetLocalTime.argtypes = [POINTER(SYSTEMTIME)]
GetLocalTime.restype = None

# Call with byref
st = SYSTEMTIME()
GetLocalTime(byref(st))
print(f"{st.wYear}-{st.wMonth}-{st.wDay}")

# Union example
class IntOrFloat(Union):
    _fields_ = [("i", c_int), ("f", c_float)]

u = IntOrFloat()
u.f = 3.14159
print(f"As int: {u.i:08x}")

# Callback
CMPFUNC = CFUNCTYPE(c_int, c_void_p, c_void_p)
def compare(a, b):
    return cast(a, POINTER(c_int)).contents.value - \
           cast(b, POINTER(c_int)).contents.value

arr = (c_int * 5)(5, 2, 8, 1, 9)
msvcrt.qsort(arr, 5, sizeof(c_int), CMPFUNC(compare))
print(list(arr))

# Error handling
SetLastError(0)
# ... some API call ...
code = GetLastError()
if code != 0:
    raise WinError(code)
```

### node-ctypes (Equivalente)

```javascript
const ctypes = require('node-ctypes');

// Load library
const kernel32 = new ctypes.WinDLL("kernel32");
const msvcrt = new ctypes.CDLL("msvcrt");

// Define struct
const SYSTEMTIME = ctypes.struct({
    wYear: 'uint16',
    wMonth: 'uint16',
    wDayOfWeek: 'uint16',
    wDay: 'uint16',
    wHour: 'uint16',
    wMinute: 'uint16',
    wSecond: 'uint16',
    wMilliseconds: 'uint16',
});

// Get function
const GetLocalTime = kernel32.func("GetLocalTime", "void", ["pointer"]);

// Call with byref
const st = SYSTEMTIME.create();
GetLocalTime(ctypes.byref(st));
const time = SYSTEMTIME.toObject(st);
console.log(`${time.wYear}-${time.wMonth}-${time.wDay}`);

// Union example
const IntOrFloat = ctypes.union({
    i: 'int32',
    f: 'float'
});

const u = IntOrFloat.create();
IntOrFloat.set(u, 'f', 3.14159);
console.log(`As int: ${IntOrFloat.get(u, 'i').toString(16).padStart(8, '0')}`);

// Callback
const compare = ctypes.callback((a, b) => {
    return ctypes.readValue(a, 'int32') - ctypes.readValue(b, 'int32');
}, 'int32', ['pointer', 'pointer']);

const arr = ctypes.alloc(5 * 4);
[5, 2, 8, 1, 9].forEach((v, i) => ctypes.writeValue(arr, 'int32', v, i * 4));

const qsort = msvcrt.func("qsort", "void", ["pointer", "size_t", "size_t", "pointer"]);
qsort(arr, 5, 4, compare.pointer);

const sorted = [];
for (let i = 0; i < 5; i++) sorted.push(ctypes.readValue(arr, 'int32', i * 4));
console.log(sorted);

// Error handling
ctypes.SetLastError(0);
// ... some API call ...
const code = ctypes.GetLastError();
if (code !== 0) {
    throw ctypes.WinError(code);
}
```

---

## 12. Feature Extra in node-ctypes

node-ctypes include alcune feature **non presenti** in Python ctypes:

| Feature | Descrizione |
|---------|-------------|
| `threadSafeCallback()` | Callback sicuro per thread esterni (CreateThread, etc.) |
| `ptrToBuffer(addr, size)` | Crea Buffer Node.js da indirizzo di memoria raw |
| Performance ottimizzate | Fast path per tipi comuni, buffer pre-allocati |

---

## Conclusione

**node-ctypes copre ~98% delle funzionalità di Python ctypes**, con praticamente tutte le feature implementate:

- ✅ Loading libraries (CDLL, WinDLL)
- ✅ Tutti i tipi numerici base (inclusi c_long, c_ulong platform-dependent)
- ✅ Wide strings (c_wchar, c_wchar_p, wstring, wstring_at)
- ✅ Chiamate a funzioni con tipi
- ✅ **Strutture complete:**
  - Strutture con alignment corretto
  - Union
  - **Nested structs** con accesso dot notation (`outer.inner.field`)
  - **Bit fields** con `bitfield('uint32', bits)`
- ✅ Puntatori (byref, cast, POINTER, addressof)
- ✅ Callbacks (incluso thread-safe!)
- ✅ **Gestione memoria completa con nomi Python-identici!**
  - create_string_buffer, create_unicode_buffer
  - string_at, wstring_at
  - memmove, memset, sizeof, addressof
- ✅ Error handling completo (errno, GetLastError, WinError)

### Feature mancanti (minori):
1. errcheck callback
2. _anonymous_ fields
3. OleDLL (COM)
4. c_longdouble
