# node-ctypes

A Python ctypes-like FFI (Foreign Function Interface) for Node.js, built on top of [libffi](https://github.com/libffi/libffi) and [N-API](https://nodejs.org/api/n-api.html).

## Features

- Load shared libraries (.so, .dll, .dylib)
- Call C functions with automatic type conversion
- Support for variadic functions (printf, sprintf, etc.)
- Create callbacks from JavaScript functions callable from C
- Support for basic C types (int, float, double, pointers, strings)
- Simple struct helper for basic structures
- Cross-platform (Linux, macOS, Windows)

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

## Usage

### Basic Example

```javascript
const { CDLL, c_int, c_double, c_char_p } = require('node-ctypes');

// Load libc
const libc = new CDLL('libc.so.6');

// Call abs()
const abs = libc.func('abs', 'int32', ['int32']);
console.log(abs(-42)); // 42

// Call strlen()
const strlen = libc.func('strlen', 'size_t', ['string']);
console.log(strlen('Hello')); // 5n (BigInt)

// Load libm for math functions
const libm = new CDLL('libm.so.6');
const sqrt = libm.func('sqrt', 'double', ['double']);
console.log(sqrt(16.0)); // 4.0
```

### Working with Strings

```javascript
const { cstring, readCString } = require('node-ctypes');

// Create a C string
const str = cstring('Hello, World!');

// Read it back
console.log(readCString(str)); // "Hello, World!"
```

### Memory Operations

```javascript
const { alloc, readValue, writeValue, sizeof } = require('node-ctypes');

// Allocate memory
const buf = alloc(16);

// Write values
writeValue(buf, 'int32', 12345, 0);
writeValue(buf, 'double', 3.14159, 8);

// Read values
console.log(readValue(buf, 'int32', 0));   // 12345
console.log(readValue(buf, 'double', 8));  // 3.14159

// Get type sizes
console.log(sizeof('int32'));   // 4
console.log(sizeof('pointer')); // 8 (on 64-bit)
```

### Simple Structs

```javascript
const { struct } = require('node-ctypes');

// Define a struct
const Point = struct({
    x: 'int32',
    y: 'int32'
});

// Create an instance
const p = Point.create({ x: 10, y: 20 });

// Access fields
console.log(Point.get(p, 'x')); // 10
console.log(Point.get(p, 'y')); // 20

// Modify fields
Point.set(p, 'x', 100);

// Convert to object
console.log(Point.toObject(p)); // { x: 100, y: 20 }
```

### Callbacks

```javascript
const { CDLL, callback } = require('node-ctypes');

// Create a callback for qsort's comparison function
const compare = callback(
    (a, b) => {
        // Compare logic here
        return 0;
    },
    'int32',        // return type
    ['pointer', 'pointer']  // argument types
);

// Use compare.pointer to pass to C functions
console.log(compare.pointer);

// Release when done
compare.release();
```

### Windows DLLs

```javascript
const { WinDLL } = require('node-ctypes');

// WinDLL uses stdcall by default
const user32 = new WinDLL('user32.dll');

const MessageBoxA = user32.func('MessageBoxA', 'int32', [
    'pointer',  // hWnd
    'string',   // lpText
    'string',   // lpCaption
    'uint32'    // uType
]);

MessageBoxA(null, 'Hello!', 'Title', 0);
```

### Variadic Functions

Node-ctypes supports variadic functions (like `printf`, `sprintf`) with automatic detection, just like Python ctypes:

```javascript
const { CDLL, alloc, cstring, readCString } = require('node-ctypes');

const libc = new CDLL('msvcrt.dll'); // Windows

// Define only the fixed parameters
const sprintf = libc.func('sprintf', 'int32', ['pointer', 'pointer']);

const buffer = alloc(256);

// Pass extra arguments - automatically handled as variadic
sprintf(buffer, cstring('Hello %s!'), cstring('World'));
sprintf(buffer, cstring('Number: %d'), 42);
sprintf(buffer, cstring('%s: %d + %d = %d'), cstring('Sum'), 10, 20, 30);
sprintf(buffer, cstring('Pi is approximately %.2f'), 3.14159);

console.log(readCString(buffer)); // Last result: "Pi is approximately 3.14"
```

When you pass more arguments than specified in the function signature, node-ctypes automatically:
- Detects the extra arguments
- Infers their types (string, int32, double, pointer)
- Uses `ffi_prep_cif_var` to prepare the variadic call
- Calls the function with the correct argument types

This matches Python ctypes behavior exactly!

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

### Functions

#### `load(libPath)` → `Library`
Load a shared library.

#### `callback(fn, returnType, argTypes)` → `{pointer, release()}`
Create a callback from a JavaScript function.

#### `alloc(size)` → `Buffer`
Allocate native memory.

#### `cstring(str)` → `Buffer`
Create a null-terminated C string.

#### `readCString(ptr, [maxLen])` → `string`
Read a C string from a pointer.

#### `readValue(ptr, type, [offset])` → `value`
Read a value from memory.

#### `writeValue(ptr, type, value, [offset])` → `bytesWritten`
Write a value to memory.

#### `sizeof(type)` → `number`
Get the size of a type in bytes.

#### `struct(fields)` → `StructDefinition`
Create a simple struct definition.

## Comparison with Python ctypes

| Python ctypes | node-ctypes |
|---------------|-------------|
| `CDLL("lib.so")` | `new CDLL("lib.so")` |
| `lib.func.argtypes = [c_int]` | `lib.func("func", "int32", ["int32"])` |
| `lib.func.restype = c_int` | (included in func() call) |
| `c_char_p(b"hello")` | `cstring("hello")` |
| `POINTER(c_int)` | `"pointer"` |
| `sprintf(buf, b"%d", 42)` | `sprintf(buf, format, 42)` (auto-variadic) |

## Limitations

- No automatic struct alignment (fields are packed)
- Callbacks must be released manually
- No support for unions
- No automatic memory management for returned pointers

## License

MIT

## Credits

Built with:
- [libffi](https://github.com/libffi/libffi) - Foreign Function Interface library
- [node-addon-api](https://github.com/nodejs/node-addon-api) - N-API C++ wrapper
- [cmake-js](https://github.com/cmake-js/cmake-js) - CMake-based build system for Node.js addons
