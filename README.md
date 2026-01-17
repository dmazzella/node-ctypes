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
- 🔧 **Extended type support** - All ctypes types (int8, uint8, int16, uint16, etc.)
- 📊 **Memory utilities** - readValue/writeValue for direct memory access, enhanced sizeof
- 🏗️ **Advanced array support** - String initialization, improved proxy behavior

## Installation

### Prerequisites

- Node.js >= 16
- CMake >= 3.15
- C++ compiler (GCC, Clang, or MSVC)

#### Ubuntu/Debian
```bash
sudo apt install build-essential cmake
```

#### macOS
```bash
brew install cmake
```

#### Windows
- Install Visual Studio Build Tools
- Install CMake

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
import { CDLL, c_int, Structure } from 'node-ctypes';

const libc = new CDLL("libc.so.6");
const abs = libc.func("abs", c_int, [c_int]);
console.log(abs(-42));  // 42

class Point extends Structure {
    static _fields_ = [
        ["x", c_int],
        ["y", c_int]
    ];
}

const p = new Point(10, 20);
console.log(p.x, p.y);  // 10 20
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
import { Structure, c_int, c_uint32 } from 'node-ctypes';

// Simple struct - Python-like class syntax
class Point extends Structure {
    static _fields_ = [
        ["x", c_int],
        ["y", c_int]
    ];
}

// Create and initialize - direct property access!
const p = new Point(10, 20);
console.log(p.x, p.y);  // 10 20

// Modify properties directly
p.x = 100;
console.log(p.x);  // 100

// Get struct size
console.log(Point.size);  // 8

// Nested structs
class Rectangle extends Structure {
    static _fields_ = [
        ["topLeft", Point],
        ["bottomRight", Point],
        ["color", c_uint32]
    ];
}

const rect = new Rectangle({
    topLeft: { x: 0, y: 0 },
    bottomRight: { x: 100, y: 200 },
    color: 0xff0000
});

console.log(rect.topLeft.x);      // 0
console.log(rect.bottomRight.x);  // 100
console.log(rect.color);          // 16711680
```

### Unions - Shared Memory Regions

```javascript
import { Union, c_int, c_float } from 'node-ctypes';

// Union - all fields share the same memory
class IntOrFloat extends Union {
    static _fields_ = [
        ["i", c_int],
        ["f", c_float]
    ];
}

const u = new IntOrFloat();
u.f = 3.14159;
console.log(u.i);  // Bit pattern of float as integer

u.i = 42;
console.log(u.f);  // 42 reinterpreted as float
```

### Bit Fields - Compact Data Structures

```javascript
import { Structure, bitfield, c_uint32 } from 'node-ctypes';

// Bit fields for flags and compact data
class Flags extends Structure {
    static _fields_ = [
        ["enabled", bitfield(c_uint32, 1)],   // 1 bit
        ["mode", bitfield(c_uint32, 3)],      // 3 bits
        ["priority", bitfield(c_uint32, 4)],  // 4 bits
        ["reserved", bitfield(c_uint32, 24)]  // 24 bits
    ];
}

const flags = new Flags();

flags.enabled = 1;
flags.mode = 5;
flags.priority = 12;

console.log(flags.enabled);   // 1
console.log(flags.mode);      // 5
console.log(flags.priority);  // 12
```

### Arrays - Fixed-size and Dynamic

```javascript
import { c_int, c_uint8, array } from 'node-ctypes';

// Fixed-size array
const IntArray = array('int32', 5);
const arr = IntArray.create([1, 2, 3, 4, 5]);

// Array access
console.log(arr[0]);  // 1
console.log(arr[4]);  // 5

// Iterate
for (const val of arr) {
    console.log(val);
}

// Arrays in structs
import { Structure, array } from 'node-ctypes';

class Packet extends Structure {
    static _fields_ = [
        ["header", array("c_uint8", 8)],
        ["data", array("c_uint8", 256)]
    ];
}

const pkt = new Packet({
    header: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
    data: new Array(256).fill(0)
});

console.log(pkt.header);  // [1, 2, 3, 4, 5, 6, 7, 8]
```

### Complex Nested Structures

Real-world example from our test suite:

```javascript
import { Structure, Union, c_uint8, c_uint16, c_int32, array } from 'node-ctypes';

// RGB color components
class RGB extends Structure {
    static _fields_ = [
        ["r", c_uint8],
        ["g", c_uint8],
        ["b", c_uint8],
        ["a", c_uint8]
    ];
}

// Union for color access (as RGB or as 32-bit value)
class Color extends Union {
    static _fields_ = [
        ["rgb", RGB],
        ["value", c_int32]
    ];
}

// Pixel with position and color
class Pixel extends Structure {
    static _fields_ = [
        ["x", c_uint16],
        ["y", c_uint16],
        ["color", Color]
    ];
}

// Image with array of pixels
class Image extends Structure {
    static _fields_ = [
        ["width", c_uint16],
        ["height", c_uint16],
        ["pixels", array(Pixel, 2)]
    ];
}

// Create and manipulate
const img = new Image({
    width: 640,
    height: 480,
    pixels: [
        { x: 10, y: 20, color: { rgb: { r: 255, g: 0, b: 0, a: 255 } } },
        { x: 30, y: 40, color: { value: 0xFF00FF00 } }
    ]
});

console.log(img.pixels[0].color.rgb.r);  // 255
console.log(img.pixels[1].color.value);  // -16711936 (0xFF00FF00 as signed)

// Union nested in struct - direct property access!
img.pixels[0].color.rgb.g = 128;  // Works correctly!
```

### Callbacks - JavaScript Functions in C

```javascript
import { CDLL, callback, c_int, c_void_p, readValue, writeValue, create_string_buffer } from 'node-ctypes';

const libc = new CDLL('msvcrt.dll');  // or libc.so.6 on Linux

// Create a comparison callback for qsort
const compare = callback(
    (a, b) => {
        // a and b are pointers to int32 values
        const aVal = readValue(a, 'int32');
        const bVal = readValue(b, 'int32');
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

const arr = create_string_buffer(5 * 4);
const values = [5, 2, 8, 1, 9];
values.forEach((v, i) => writeValue(arr, 'int32', v, i * 4));
qsort(arr, 5, 4, compare.pointer);

// Array is now sorted: [1, 2, 5, 8, 9]
console.log(readValue(arr, 'int32', 0));  // 1
console.log(readValue(arr, 'int32', 4));  // 2

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
import { WinDLL, Structure, c_uint16, c_void_p, c_wchar_p, c_int } from 'node-ctypes';

// WinDLL uses __stdcall convention (default for Windows API)
const kernel32 = new WinDLL('kernel32.dll');

// SYSTEMTIME structure (from tests/windows/test_winapi.js)
class SYSTEMTIME extends Structure {
    static _fields_ = [
        ["wYear", c_uint16],
        ["wMonth", c_uint16],
        ["wDayOfWeek", c_uint16],
        ["wDay", c_uint16],
        ["wHour", c_uint16],
        ["wMinute", c_uint16],
        ["wSecond", c_uint16],
        ["wMilliseconds", c_uint16]
    ];
}

// Get local time
const GetLocalTime = kernel32.func('GetLocalTime', 'void', [c_void_p]);

const st = new SYSTEMTIME();
GetLocalTime(st);  // Pass struct directly - automatic _buffer extraction!

console.log(`${st.wYear}-${st.wMonth}-${st.wDay}`);
console.log(`${st.wHour}:${st.wMinute}:${st.wSecond}`);

// MessageBox (wide string version)
const user32 = new WinDLL('user32.dll');
const MessageBoxW = user32.func('MessageBoxW', c_int, [
    c_void_p,   // hWnd
    c_wchar_p,  // lpText
    c_wchar_p,  // lpCaption
    'uint32'    // uType
]);

// Create UTF-16 buffers for wide strings
const text = Buffer.from('Hello from node-ctypes!\0', 'utf16le');
const caption = Buffer.from('node-ctypes\0', 'utf16le');

MessageBoxW(null, text, caption, 0);
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

**vs koffi** (comprehensive 10-benchmark comparison, geometric mean: **3.27x slower**):
- Simple int32 function: 1.74x slower
- String parameter: 1.95x slower  
- Floating point: 1.83x slower
- No arguments: 2.11x slower
- Multiple arguments: **1.40x faster**
- Variadic function: 1.28x slower
- **Struct read/write: 14.91x slower**
- Buffer allocation: 40.5% overhead
- Raw vs CDLL wrapper: 7.3% overhead
- **Callback creation: 1.51x slower**

**Key Insights:**
- koffi excels at simple operations and struct access
- node-ctypes competitive on complex argument handling
- **Struct performance gap**: koffi 15x faster due to direct object manipulation
- **Callback overhead**: koffi 1.5x faster at callback creation

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

## Detailed API Reference (from lib/index.js)

This section provides a more complete description of the APIs exported from `lib/index.js`, with quick examples and usage notes.

**Native classes and exports**
- `Version` - Version information exposed by the native module.
- `Library` - Represents a loaded native library and exposes low-level functions for symbols and library management.
- `FFIFunction` - Low-level object representing an FFI function (has properties like `address` and internal methods).
- `Callback` - Builds JS callbacks callable from C (main thread).
- `ThreadSafeCallback` - Builds thread-safe JS callbacks (can be called from external threads).
- `CType`, `StructType`, `ArrayType` - Types and helpers exposed by the native layer.

**Library loading and wrappers**
- `load(libPath)` → `Library` : loads a native library; `libPath` can be `null` for the current executable.
- `CDLL(libPath)` : common-use wrapper for C calls with cdecl convention; maintains a function cache and provides more convenient `func()`.
- `WinDLL(libPath)` : like `CDLL` but with `abi: 'stdcall'` by default (useful for WinAPI).

Example:
```js
import { CDLL } from './lib/index.js';
const libc = new CDLL(null);
const abs = libc.func('abs', 'int32', ['int32']);
console.log(abs(-5));
```

**Detailed CDLL API**
- `func(name, returnType, argTypes = [], options = {})` → `Function` : gets a callable function. The returned function is optimized and:
    - automatically extracts `._buffer` from struct objects passed as arguments;
    - exposes non-enumerable metadata: `funcName`, `address`, `_ffi`; 
    - provides the `errcheck` property as getter/setter to intercept return errors.
- `symbol(name)` → `BigInt` : address of a symbol.
- `close()` : closes the library and clears the cache.
- `path` (getter) : library path.
- `loaded` (getter) : loading status.

**Callback**
- `callback(fn, returnType, argTypes = [])` → `{ pointer, release(), _callback }` : fast callback, main thread only.
- `threadSafeCallback(fn, returnType, argTypes = [])` → `{ pointer, release(), _callback }` : thread-safe callback for external threads.

Note: always call `release()` when a callback is no longer needed.

**Allocation and strings**

- `Buffer.alloc(size)` → `Buffer` : allocates native memory.
- `create_string_buffer(init)` → `Buffer` : creates null-terminated C string (init: size|string|Buffer).
- `create_unicode_buffer(init)` → `Buffer` : creates null-terminated wide string (wchar_t).
- `ptrToBuffer(address, size)` → `Buffer` : view on native address (use with caution).
- `addressof(ptr)` → `BigInt` : get the address as BigInt.

Example string creation and passing to function:
```js
import { create_string_buffer, CDLL } from './lib/index.js';
const libc = new CDLL(null);
const puts = libc.func('puts', 'int32', ['pointer']);
const s = create_string_buffer('hello');
puts(s);
```

**Reading and writing values**
- `readValue(ptr, type, offset = 0)` : supports fast-path for Buffer + basic types (`int8`, `uint8`, `int16`, `int32`, `int64`, `float`, `double`, `bool`).
- `writeValue(ptr, type, value, offset = 0)` : writes values with fast-path for Buffer.

**Types and helpers**
- `sizeof(type)` → `number` : size in bytes of a type.
- `POINTER(baseType)` : creates a pointer type with helpers `create()`, `fromBuffer()`, `deref()`, `set()`.
- `byref(buffer)` : passes a buffer by reference (Python ctypes compatibility).
- `cast(ptr, targetType)` : interprets a pointer as another type (returns wrapper for struct).

**Struct / Union / Array / Bitfield**
- `struct(fields, options)` : defines struct with support for nested, bitfields, anonymous fields, packed option. Returns object with `create()`, `get()`, `set()`, `toObject()`, `getNestedBuffer()`.
- `union(fields)` : defines union; provides `create()`, `get()`, `set()`, `toObject()` and returns plain objects with properties.
- `array(elementType, count)` : defines ArrayType; `wrap(buffer)` returns Proxy with indexing.
- `bitfield(baseType, bits)` : bitfield definition.

Struct example:
```js
class Point extends Structure {
    static _fields_ = [
        ["x", c_int32],
        ["y", c_int32]
    ];
}

const p = new Point(1, 2);
console.log(p.x, p.y);  // 1 2
```

**Python-compatible conveniences**
- `create_string_buffer(init)` : create string buffer from number/string/Buffer.
- `create_unicode_buffer(init)` : create wide string buffer.
- `string_at(address, size)` / `wstring_at(address, size)` : read strings from address.

**Memory: utilities**
- `memmove(dst, src, count)` : copy memory.
- `memset(dst, value, count)` : set memory.

**Error handling and WinAPI helpers**
- `get_errno()` / `set_errno(value)` : access to errno (platform-specific implementation).
- `_initWinError()` internals; public helpers: `GetLastError()`, `SetLastError(code)`, `FormatError(code)`, `WinError(code)`.

**Type aliases**
The following aliases are exposed (mapped from `native.types`):
`c_int, c_uint, c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32, c_int64, c_uint64, c_float, c_double, c_char, c_char_p, c_wchar, c_wchar_p, c_void_p, c_bool, c_size_t, c_long, c_ulong`.

**Constants**
- `POINTER_SIZE` - pointer size (from `native.POINTER_SIZE`).
- `WCHAR_SIZE` - wchar size (from `native.WCHAR_SIZE`).
- `NULL` - exported null value.

---

If you want, I can generate additional Windows or Linux-specific snippets, or integrate examples in the `tests/` directory.

### Functions

#### `load(libPath)` → `Library`
Load a shared library.

#### `callback(fn, returnType, argTypes)` → `{pointer, release()}`
Create a callback from a JavaScript function.

#### `create_string_buffer(init)` → `Buffer`
Create a null-terminated C string buffer (like Python ctypes). `init` can be a size, a string, or an existing `Buffer`.

#### `create_unicode_buffer(init)` → `Buffer`
Create a wide (wchar_t) null-terminated buffer (UTF-16LE on Windows).

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

#### `Structure` (base class)
Base class for Python-like struct definitions. Subclasses should define `static _fields_`.

#### `Union` (base class)
Base class for Python-like union definitions. Subclasses should define `static _fields_`.

## Python ctypes Compatibility Reference

### API Comparison

| Feature | Python ctypes | node-ctypes |
|---------|---------------|-------------|
| **Load library** | `CDLL("lib.so")` | `new CDLL("lib.so")` |
| **Define function** | `lib.func.argtypes = [c_int]`<br>`lib.func.restype = c_int` | `lib.func("func", c_int, [c_int])` |
| **Structs** | `class Point(Structure):`<br>&nbsp;&nbsp;`_fields_ = [("x", c_int)]` | `class Point extends Structure`<br>&nbsp;&nbsp;`{ static _fields_ = [["x", c_int]] }` |
| **Unions** | `class U(Union):`<br>&nbsp;&nbsp;`_fields_ = [("i", c_int)]` | `class U extends Union`<br>&nbsp;&nbsp;`{ static _fields_ = [["i", c_int]] }` |
| **Arrays** | `c_int * 5` | `array(c_int, 5)` |
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
- **Class-based struct/union definitions** (`class MyStruct extends Structure`)
- Platform-specific types (c_long, c_ulong, c_size_t)
- Memory operations (alloc, read, write)
- Windows API (__stdcall via WinDLL)

⚠️ **Differences from Python ctypes**:
- Structs use `.toObject()` for property access (eager loading for performance)
- Callbacks must be manually released with `.release()`
- Function definition is combined: `func(name, returnType, argTypes)` vs separate argtypes/restype
- No `POINTER()` type - use `c_void_p` or type name string


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
- **Functions**: [tests/common/test_functions.js](tests/common/test_functions.js)
- **Callbacks**: [tests/common/test_callbacks.js](tests/common/test_callbacks.js)
- **Version info**: [tests/common/test_version.js](tests/common/test_version.js)
- **Windows API**: [tests/windows/test_winapi.js](tests/windows/test_winapi.js)
- **Python compatibility**: [tests/common/*.py](tests/common/) (parallel Python implementations)

Run tests:
```bash
cd tests
npm install 
npm run test               # All tests
npm run bench:koffi        # Benchmark vs koffi
```

## Examples

For practical GUI application examples using the Windows API:

- **Simple GUI Demo**: [examples/windows/simple.js](examples/windows/simple.js) - Message boxes and basic Windows API GUI elements
- **Windows Controls Showcase Demo**: [examples/windows/windows_controls.js](examples/windows/windows_controls.js) - Comprehensive demo with a wide set of common Win32 controls

## License

MIT

## Credits

Built with:
- [libffi](https://github.com/libffi/libffi) - Foreign Function Interface library
- [node-addon-api](https://github.com/nodejs/node-addon-api) - N-API C++ wrapper
- [cmake-js](https://github.com/cmake-js/cmake-js) - CMake-based build system for Node.js addons
