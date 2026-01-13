# node-ctypes

**Python ctypes for Node.js** - A high-performance FFI (Foreign Function Interface) library with full Python ctypes compatibility, built on [libffi](https://github.com/libffi/libffi) and [N-API](https://nodejs.org/api/n-api.html).

## Why node-ctypes?

- ✨ **Python ctypes API Compatibility** - If you know Python ctypes, you already know node-ctypes! Same syntax, same patterns.
- 🚀 **High Performance** - Up to **50x faster** than ffi-napi, with struct operations matching or exceeding koffi performance.
- 🔧 **Complete FFI Support** - Structs, unions, bit fields, nested structures, arrays, callbacks, variadic functions, and more.
- 🌍 **Cross-platform** - Works seamlessly on Linux, macOS, and Windows with identical API.

## Features

- 🐍 **Full Python ctypes compatibility** - Struct definitions, unions, bit fields, anonymous fields
- 📚 **Load shared libraries** (.so, .dll, .dylib) with CDLL and WinDLL
- 🔄 **Variadic functions** (printf, sprintf) with automatic detection
- 📞 **Callbacks** - JavaScript functions callable from C code
- 🏗️ **Complex data structures** - Nested structs, unions in structs, arrays in structs
- ⚡ **High performance** - Eager loading for struct properties, optimized FFI wrapper
- 🔍 **Transparent API** - Pass struct objects directly to FFI functions

## Installation

### Prerequisites

- Node.js >= 16
- CMake >= 3.15
- C++ compiler (GCC, Clang, or MSVC)
- libffi development files

#### Ubuntu/Debian
```bash
sudo apt install build-essential cmake libffi-dev
```

#### macOS
```bash
brew install cmake libffi
```

#### Windows
- Install Visual Studio Build Tools
- Install CMake
- libffi can be built from source or obtained via vcpkg

### Install
```bash
npm install
npm run build
```

## Quick Start - Python ctypes Users

If you're familiar with Python ctypes, you'll feel right at home:

**Python ctypes:**
```python
from ctypes import CDLL, c_int, Structure

libc = CDLL("libc.so.6")
abs_func = libc.abs
abs_func.argtypes = [c_int]
abs_func.restype = c_int
print(abs_func(-42))  # 42

class Point(Structure):
    _fields_ = [("x", c_int), ("y", c_int)]

p = Point(10, 20)
print(p.x, p.y)  # 10 20
```

**node-ctypes (identical patterns!):**
```javascript
import { CDLL, c_int, struct } from 'node-ctypes';

const libc = new CDLL("libc.so.6");
const abs = libc.func("abs", c_int, [c_int]);
console.log(abs(-42));  // 42

const Point = struct({
    x: c_int,
    y: c_int
});

const p = Point.create({ x: 10, y: 20 });
const obj = Point.toObject(p);
console.log(obj.x, obj.y);  // 10 20
```

## Usage

### Basic FFI - Calling C Functions

```javascript
import { CDLL, c_int, c_double, c_char_p } from 'node-ctypes';

// Load libc
const libc = new CDLL('libc.so.6');  // Linux
// const libc = new CDLL('msvcrt.dll');  // Windows
// const libc = new CDLL('libc.dylib');  // macOS

// Call abs() - integer absolute value
const abs = libc.func('abs', c_int, [c_int]);
console.log(abs(-42));  // 42

// Call strlen() - string length
const strlen = libc.func('strlen', 'size_t', [c_char_p]);
console.log(strlen('Hello'));  // 5n (BigInt)

// Load libm for math functions
const libm = new CDLL('libm.so.6');
const sqrt = libm.func('sqrt', c_double, [c_double]);
console.log(sqrt(16.0));  // 4.0
```

### Structs - Full Python ctypes Compatibility

```javascript
import { struct, c_int, c_uint32 } from 'node-ctypes';

// Simple struct
const Point = struct({
    x: c_int,
    y: c_int
});

// Create and initialize
const p = Point.create({ x: 10, y: 20 });

// Convert to JavaScript object (eager loading - high performance!)
const obj = Point.toObject(p);
console.log(obj.x, obj.y);  // 10 20

// Modify and sync back to buffer
obj.x = 100;
obj._sync();  // Write changes back to buffer

// Get struct size
console.log(Point.size);  // 8

// Nested structs
const Rectangle = struct({
    topLeft: Point,
    bottomRight: Point,
    color: c_uint32
});

const rect = Rectangle.create({
    topLeft: { x: 0, y: 0 },
    bottomRight: { x: 100, y: 200 },
    color: 0xff0000
});

const rectObj = Rectangle.toObject(rect);
console.log(rectObj.topLeft.x);      // 0
console.log(rectObj.bottomRight.x);  // 100
console.log(rectObj.color);          // 16711680
```

### Unions - Shared Memory Regions

```javascript
import { union, c_int, c_float } from 'node-ctypes';

// Union - all fields share the same memory
const IntOrFloat = union({
    i: c_int,
    f: c_float
});

const u = IntOrFloat.create();
const obj = IntOrFloat.toObject(u);

obj.f = 3.14159;
console.log(obj.i);  // Bit pattern of float as integer

obj.i = 42;
console.log(obj.f);  // 42 reinterpreted as float
```

### Bit Fields - Compact Data Structures

```javascript
import { struct, bitfield, c_uint32 } from 'node-ctypes';

// Bit fields for flags and compact data
const Flags = struct({
    enabled: bitfield(c_uint32, 1),   // 1 bit
    mode: bitfield(c_uint32, 3),      // 3 bits
    priority: bitfield(c_uint32, 4),  // 4 bits
    reserved: bitfield(c_uint32, 24)  // 24 bits
});

const flags = Flags.create();
const obj = Flags.toObject(flags);

obj.enabled = 1;
obj.mode = 5;
obj.priority = 12;

console.log(obj.enabled);   // 1
console.log(obj.mode);      // 5
console.log(obj.priority);  // 12
```

### Arrays - Fixed-size and Dynamic

```javascript
import { c_int, c_uint8 } from 'node-ctypes';

// Fixed-size array
const IntArray = c_int * 5;
const arr = IntArray.create([1, 2, 3, 4, 5]);

// Array access
console.log(arr[0]);  // 1
console.log(arr[4]);  // 5

// Iterate
for (const val of arr) {
    console.log(val);
}

// Arrays in structs
import { struct } from 'node-ctypes';

const Packet = struct({
    header: c_uint8 * 8,
    data: c_uint8 * 256
});

const pkt = Packet.create({
    header: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
    data: new Array(256).fill(0)
});

const pktObj = Packet.toObject(pkt);
console.log(pktObj.header);  // [1, 2, 3, 4, 5, 6, 7, 8]
```

### Complex Nested Structures

Real-world example from our test suite:

```javascript
import { struct, union, c_uint8, c_uint16, c_int32 } from 'node-ctypes';

// RGB color components
const RGB = struct({
    r: c_uint8,
    g: c_uint8,
    b: c_uint8,
    a: c_uint8
});

// Union for color access (as RGB or as 32-bit value)
const Color = union({
    rgb: RGB,
    value: c_int32
});

// Pixel with position and color
const Pixel = struct({
    x: c_uint16,
    y: c_uint16,
    color: Color
});

// Image with array of pixels
const Image = struct({
    width: c_uint16,
    height: c_uint16,
    pixels: Pixel * 2
});

// Create and manipulate
const img = Image.create({
    width: 640,
    height: 480,
    pixels: [
        { x: 10, y: 20, color: { rgb: { r: 255, g: 0, b: 0, a: 255 } } },
        { x: 30, y: 40, color: { value: 0xFF00FF00 } }
    ]
});

const imgObj = Image.toObject(img);
console.log(imgObj.pixels[0].color.rgb.r);  // 255
console.log(imgObj.pixels[1].color.value);  // -16711936 (0xFF00FF00 as signed)

// Union nested in struct - automatic caching!
imgObj.pixels[0].color.rgb.g = 128;  // Works correctly!
```

### Callbacks - JavaScript Functions in C

```javascript
import { CDLL, callback, c_int, c_void_p } from 'node-ctypes';

const libc = new CDLL('msvcrt.dll');  // or libc.so.6 on Linux

// Create a comparison callback for qsort
const compare = callback(
    (a, b) => {
        // a and b are pointers to int32 values
        const aVal = a.readInt32LE(0);
        const bVal = b.readInt32LE(0);
        return aVal - bVal;
    },
    c_int,              // return type
    [c_void_p, c_void_p]  // argument types: two pointers
);

// Sort an array using qsort
const qsort = libc.func('qsort', 'void', [
    c_void_p,  // array pointer
    'size_t',  // number of elements
    'size_t',  // element size
    c_void_p   // comparison function
]);

const arr = Buffer.from([5, 2, 8, 1, 9].flatMap(n => [n, 0, 0, 0]));
qsort(arr, 5n, 4n, compare.pointer);

// Array is now sorted: [1, 2, 5, 8, 9]
console.log(arr.readInt32LE(0));  // 1
console.log(arr.readInt32LE(4));  // 2

// IMPORTANT: Release callback when done
compare.release();
```

### Variadic Functions - printf, sprintf

```javascript
import { CDLL, create_string_buffer, string_at, c_int, c_void_p, c_char_p } from 'node-ctypes';

const libc = new CDLL('msvcrt.dll');  // Windows
// const libc = new CDLL('libc.so.6');  // Linux

// Define only the fixed parameters - variadic args detected automatically!
const sprintf = libc.func('sprintf', c_int, [c_void_p, c_char_p]);

const buffer = Buffer.alloc(256);

// Pass extra arguments - automatically handled as variadic
sprintf(buffer, create_string_buffer('Hello %s!'), create_string_buffer('World'));
console.log(string_at(buffer));  // "Hello World!"

sprintf(buffer, create_string_buffer('Number: %d'), 42);
console.log(string_at(buffer));  // "Number: 42"

sprintf(buffer, create_string_buffer('%s: %d + %d = %d'), create_string_buffer('Sum'), 10, 20, 30);
console.log(string_at(buffer));  // "Sum: 10 + 20 = 30"

sprintf(buffer, create_string_buffer('Pi ≈ %.2f'), 3.14159);
console.log(string_at(buffer));  // "Pi ≈ 3.14"
```

**Automatic variadic detection** - When you pass more arguments than specified, node-ctypes:
- ✅ Detects the extra arguments
- ✅ Infers their types (string → char*, number → int32/double, Buffer → pointer)
- ✅ Uses `ffi_prep_cif_var` for variadic call preparation
- ✅ Calls the function with correct argument marshalling

**This matches Python ctypes behavior exactly!**

### Windows API - Full Support

```javascript
import { WinDLL, struct, c_uint16, c_void_p, c_wchar_p, c_int } from 'node-ctypes';

// WinDLL uses __stdcall convention (default for Windows API)
const kernel32 = new WinDLL('kernel32.dll');

// SYSTEMTIME structure (from tests/windows/test_winapi.js)
const SYSTEMTIME = struct({
    wYear: c_uint16,
    wMonth: c_uint16,
    wDayOfWeek: c_uint16,
    wDay: c_uint16,
    wHour: c_uint16,
    wMinute: c_uint16,
    wSecond: c_uint16,
    wMilliseconds: c_uint16
});

// Get local time
const GetLocalTime = kernel32.func('GetLocalTime', 'void', [c_void_p]);

const st = SYSTEMTIME.create();
GetLocalTime(st);  // Pass struct directly - automatic _buffer extraction!

const time = SYSTEMTIME.toObject(st);
console.log(`${time.wYear}-${time.wMonth}-${time.wDay}`);
console.log(`${time.wHour}:${time.wMinute}:${time.wSecond}`);

// MessageBox (wide string version)
const user32 = new WinDLL('user32.dll');
const MessageBoxW = user32.func('MessageBoxW', c_int, [
    c_void_p,   // hWnd
    c_wchar_p,  // lpText
    c_wchar_p,  // lpCaption
    'uint32'    // uType
]);

// MessageBoxW(null, 'Hello from node-ctypes!', 'node-ctypes', 0);
```

### Memory Operations - Low-level Control

```javascript
import { readValue, writeValue, sizeof, create_string_buffer, string_at, c_int, c_double, c_void_p } from 'node-ctypes';

// Allocate memory
const buf = Buffer.alloc(16);

// Write values at specific offsets
writeValue(buf, c_int, 12345, 0);
writeValue(buf, c_double, 3.14159, 8);

// Read values back
console.log(readValue(buf, c_int, 0));     // 12345
console.log(readValue(buf, c_double, 8));  // 3.14159

// Get type sizes
console.log(sizeof(c_int));      // 4
console.log(sizeof(c_double));   // 8
console.log(sizeof(c_void_p));   // 8 (on 64-bit)

// String handling
const str = create_string_buffer('Hello, World!');
console.log(string_at(str));  // "Hello, World!"
```

## Performance Benchmarks

Benchmarked on Windows with Node.js v24.11.0:

**vs ffi-napi** (geometric mean: **36.92x faster**):
- Simple int32 function: **50.32x faster**
- String parameter: **49.32x faster**
- Floating point: **48.97x faster**
- Multiple arguments: **153.47x faster**
- Struct read/write: **5.22x faster**

**vs koffi** (competitive performance):
- Simple calls: 1.44x slower (koffi uses highly optimized assembly)
- **Struct read/write: 1.29x faster** (eager loading architecture)
- Multiple arguments: **1.75x faster**

**Transparent API overhead**: Only **3.5%** for auto `._buffer` extraction!

*See `tests/benchmarks/` for full benchmark suite.*

## Supported Types

| Type Name | Aliases | Size |
|-----------|---------|------|
| `void` | - | 0 |
| `int8` | `c_int8`, `char` | 1 |
| `uint8` | `c_uint8`, `uchar` | 1 |
| `int16` | `c_int16`, `short` | 2 |
| `uint16` | `c_uint16`, `ushort` | 2 |
| `int32` | `c_int32`, `int`, `c_int` | 4 |
| `uint32` | `c_uint32`, `uint`, `c_uint` | 4 |
| `int64` | `c_int64`, `long long` | 8 |
| `uint64` | `c_uint64` | 8 |
| `float` | `c_float` | 4 |
| `double` | `c_double` | 8 |
| `pointer` | `c_void_p`, `void*`, `ptr` | 8 (64-bit) |
| `string` | `c_char_p`, `char*` | pointer |
| `bool` | `c_bool` | 1 |
| `size_t` | `c_size_t` | pointer |

## API Reference

### Classes

#### `CDLL(libPath)`
Load a shared library using default (cdecl) calling convention.

#### `WinDLL(libPath)`
Load a shared library using stdcall calling convention (Windows).

#### `Library(libPath)`
Low-level library wrapper.

---

## Reference API dettagliata (da lib/index.js)

Questa sezione fornisce una descrizione più completa delle API esportate da `lib/index.js`, con esempi rapidi e note di utilizzo.

**Classi ed esportazioni native**
- `Version` - Informazioni di versione esposte dal modulo nativo.
- `Library` - Rappresenta una libreria nativa caricata ed espone funzioni low-level per simboli e gestione della libreria.
- `FFIFunction` - Oggetto a basso livello che rappresenta una funzione FFI (ha proprietà come `address` e metodi interni).
- `Callback` - Costruisce callback JS invocabili da C (main thread).
- `ThreadSafeCallback` - Costruisce callback JS thread-safe (può essere chiamato da thread esterni).
- `CType`, `StructType`, `ArrayType` - Tipi e helper esposti dal layer nativo.

**Caricamento librerie e wrapper**
- `load(libPath)` → `Library` : carica una libreria nativa; `libPath` può essere `null` per l'eseguibile corrente.
- `CDLL(libPath)` : wrapper ad uso comune per chiamate C con convenzione cdecl; mantiene una cache di funzioni e fornisce `func()` più comodo.
- `WinDLL(libPath)` : come `CDLL` ma con `abi: 'stdcall'` di default (utile per WinAPI).

Esempio:
```js
import { CDLL } from './lib/index.js';
const libc = new CDLL(null);
const abs = libc.func('abs', 'int32', ['int32']);
console.log(abs(-5));
```

**CDLL API dettagliata**
- `func(name, returnType, argTypes = [], options = {})` → `Function` : ottiene una funzione callable. La funzione restituita è ottimizzata e:
    - estrae automaticamente `._buffer` dagli oggetti struct passati come argomenti;
    - espone metadati non-enumerabili: `funcName`, `address`, `_ffi`; 
    - fornisce la proprietà `errcheck` come getter/setter per intercettare errori di ritorno.
- `symbol(name)` → `BigInt` : indirizzo di un simbolo.
- `close()` : chiude la libreria e svuota la cache.
- `path` (getter) : percorso della libreria.
- `loaded` (getter) : stato di caricamento.

**Callback**
- `callback(fn, returnType, argTypes = [])` → `{ pointer, release(), _callback }` : callback veloce, solo main thread.
- `threadSafeCallback(fn, returnType, argTypes = [])` → `{ pointer, release(), _callback }` : callback sicuro per thread esterni.

Nota: chiamare sempre `release()` quando un callback non è più necessario.

**Allocazione e stringhe**

- `Buffer.alloc(size)` → `Buffer` : alloca memoria nativa.
- `create_string_buffer(init)` → `Buffer` : crea stringa C null-terminated (init: size|string|Buffer).
- `create_unicode_buffer(init)` → `Buffer` : crea stringa wide (wchar_t) null-terminated.
- `ptrToBuffer(address, size)` → `Buffer` : vista su indirizzo nativo (usa con cautela).
- `addressof(ptr)` → `BigInt` : ottieni l'indirizzo come BigInt.

Esempio creazione stringa e passaggio a funzione:
```js
import { create_string_buffer, CDLL } from './lib/index.js';
const libc = new CDLL(null);
const puts = libc.func('puts', 'int32', ['pointer']);
const s = create_string_buffer('hello');
puts(s);
```

**Lettura e scrittura di valori**
- `readValue(ptr, type, offset = 0)` : supporta fast-path per Buffer + tipi base (`int8`, `uint8`, `int16`, `int32`, `int64`, `float`, `double`, `bool`).
- `writeValue(ptr, type, value, offset = 0)` : scrive valori con fast-path per Buffer.

**Tipi e helper**
- `sizeof(type)` → `number` : dimensione in bytes di un tipo.
- `POINTER(baseType)` : crea un tipo puntatore con helper `create()`, `fromBuffer()`, `deref()`, `set()`.
- `byref(buffer)` : passa un buffer per riferimento (compatibilità Python ctypes).
- `cast(ptr, targetType)` : interpreta un puntatore come un altro tipo (restituisce wrapper per struct).

**Struct / Union / Array / Bitfield**
- `struct(fields, options)` : definisce struct con supporto per nested, bitfields, anonymous fields, packed option. Ritorna un object con `create()`, `get()`, `set()`, `toObject()`, `getNestedBuffer()`.
- `union(fields)` : definisce union; fornisce `create()`, `get()`, `set()`, `toObject()` e ritorna oggetti plain con proprietà.
- `array(elementType, count)` : definisce ArrayType; `wrap(buffer)` ritorna Proxy con indexing.
- `bitfield(baseType, bits)` : definizione di bitfield.

Esempio struct:
```js
const Point = struct({ x: 'int32', y: 'int32' });
const p = Point.create({ x: 1, y: 2 });
console.log(Point.toObject(p));
```

**Convenienze Python-compatibili**
- `create_string_buffer(init)` : create string buffer da numero/string/Buffer.
- `create_unicode_buffer(init)` : create wide string buffer.
- `string_at(address, size)` / `wstring_at(address, size)` : leggere stringhe da indirizzo.

**Memoria: utilità**
- `memmove(dst, src, count)` : copia memoria.
- `memset(dst, value, count)` : setta memoria.

**Error handling e WinAPI helpers**
- `get_errno()` / `set_errno(value)` : accesso ad errno (implementazione platform-specific).
- `_initWinError()` internals; helpers pubblici: `GetLastError()`, `SetLastError(code)`, `FormatError(code)`, `WinError(code)`.

**Alias tipi**
I seguenti alias sono esposti (mappati da `native.types`):
`c_int, c_uint, c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32, c_int64, c_uint64, c_float, c_double, c_char, c_char_p, c_wchar, c_wchar_p, c_void_p, c_bool, c_size_t, c_long, c_ulong`.

**Costanti**
- `POINTER_SIZE` - dimensione puntatore (da `native.POINTER_SIZE`).
- `WCHAR_SIZE` - dimensione wchar (da `native.WCHAR_SIZE`).
- `NULL` - valore null esportato.

---

Se vuoi, posso generare snippet aggiuntivi specifici per Windows o Linux, oppure integrare esempi nel directory `tests/`.

### Functions

#### `load(libPath)` → `Library`
Load a shared library.

#### `callback(fn, returnType, argTypes)` → `{pointer, release()}`
Create a callback from a JavaScript function.

#### `create_string_buffer(init)` → `Buffer`
Create a null-terminated C string buffer (like Python ctypes). `init` può essere una dimensione, una stringa o un existing `Buffer`.

#### `create_unicode_buffer(init)` → `Buffer`
Create a wide (wchar_t) null-terminated buffer (UTF-16LE su Windows).

#### `string_at(address, [size])` → `string`
Read a C string from an address or buffer.

#### `readValue(ptr, type, [offset])` → `value`
Read a value from memory.

#### `writeValue(ptr, type, value, [offset])` → `bytesWritten`
Write a value to memory.

#### `sizeof(type)` → `number`
Get the size of a type in bytes.

#### `struct(fields)` → `StructDefinition`
Create a simple struct definition.

## Python ctypes Compatibility Reference

### API Comparison

| Feature | Python ctypes | node-ctypes |
|---------|---------------|-------------|
| **Load library** | `CDLL("lib.so")` | `new CDLL("lib.so")` |
| **Define function** | `lib.func.argtypes = [c_int]`<br>`lib.func.restype = c_int` | `lib.func("func", c_int, [c_int])` |
| **Structs** | `class Point(Structure):`<br>&nbsp;&nbsp;`_fields_ = [("x", c_int)]` | `const Point = struct({x: c_int})` |
| **Unions** | `class U(Union):`<br>&nbsp;&nbsp;`_fields_ = [("i", c_int)]` | `const U = union({i: c_int})` |
| **Arrays** | `c_int * 5` | `c_int * 5` |
| **Bit fields** | `("flags", c_uint, 3)` | `bitfield(c_uint32, 3)` |
| **Callbacks** | `CFUNCTYPE(c_int, c_int)` | `callback(fn, c_int, [c_int])` |
| **Strings** | `c_char_p(b"hello")` | `create_string_buffer("hello")` |
| **Pointers** | `POINTER(c_int)` | `c_void_p` or `"pointer"` |
| **Variadic** | `sprintf(buf, b"%d", 42)` | `sprintf(buf, fmt, 42)` (auto) |
| **Sizeof** | `sizeof(c_int)` | `sizeof(c_int)` |

### What's Supported

✅ **Fully Compatible**:
- All basic types (int8-64, uint8-64, float, double, bool, pointer, string)
- Structs with nested structures
- Unions (including nested in structs)
- Bit fields
- Arrays (fixed-size)
- Callbacks (with manual release)
- Variadic functions (automatic detection)
- Anonymous fields in structs/unions
- Platform-specific types (c_long, c_ulong, c_size_t)
- Memory operations (alloc, read, write)
- Windows API (__stdcall via WinDLL)

⚠️ **Differences from Python ctypes**:
- Structs use `.toObject()` for property access (eager loading for performance)
- Callbacks must be manually released with `.release()`
- Function definition is combined: `func(name, returnType, argTypes)` vs separate argtypes/restype
- No `POINTER()` type - use `c_void_p` or type name string

### Migration Examples

**Python ctypes:**
```python
from ctypes import *

class POINT(Structure):
    _fields_ = [("x", c_int), ("y", c_int)]

libc = CDLL("libc.so.6")
abs_func = libc.abs
abs_func.argtypes = [c_int]
abs_func.restype = c_int
result = abs_func(-42)

p = POINT(10, 20)
print(p.x, p.y)
```

**node-ctypes (equivalent):**
```javascript
import { CDLL, c_int, struct } from 'node-ctypes';

const POINT = struct({
    x: c_int,
    y: c_int
});

const libc = new CDLL("libc.so.6");
const abs_func = libc.func("abs", c_int, [c_int]);
const result = abs_func(-42);

const p = POINT.create({ x: 10, y: 20 });
const obj = POINT.toObject(p);
console.log(obj.x, obj.y);
```

## Limitations & Known Issues

- ⚠️ Callbacks must be released manually with `.release()` to prevent memory leaks
- ⚠️ No automatic memory management for returned pointers (manual `free()` required)
- ⚠️ Struct alignment follows platform defaults (not customizable per-field)
- ℹ️ Nested union access uses getter caching (slight behavior difference from Python)
- ℹ️ Struct property access via `.toObject()` instead of direct field access (performance optimization)

## Examples in Test Suite

For complete, working examples, see the test suite:

- **Basic types**: [tests/common/test_basic_types.js](tests/common/test_basic_types.js)
- **Structs & unions**: [tests/common/test_structs.js](tests/common/test_structs.js)
- **Nested structures**: [tests/common/test_nested_structs.js](tests/common/test_nested_structs.js)
- **Arrays**: [tests/common/test_arrays.js](tests/common/test_arrays.js)
- **Functions & callbacks**: [tests/common/test_functions.js](tests/common/test_functions.js)
- **Windows API**: [tests/windows/test_winapi.js](tests/windows/test_winapi.js)
- **Python compatibility**: [tests/common/*.py](tests/common/) (parallel Python implementations)

Run tests:
```bash
cd tests
npm install 
npm run test               # All tests
npm run bench:koffi        # Benchmark vs koffi
npm run bench:ffi-napi     # Benchmark vs ffi-napi
```

## License

MIT

## Credits

Built with:
- [libffi](https://github.com/libffi/libffi) - Foreign Function Interface library
- [node-addon-api](https://github.com/nodejs/node-addon-api) - N-API C++ wrapper
- [cmake-js](https://github.com/cmake-js/cmake-js) - CMake-based build system for Node.js addons
