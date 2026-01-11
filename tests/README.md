# Test Suite for node-ctypes

Comprehensive test suite comparing node-ctypes with Python ctypes.

## Structure

```
tests/
├── common/          # Cross-platform tests
│   ├── test_basic_types.js/.py
│   ├── test_structs.js/.py
│   ├── test_arrays.js/.py
│   └── test_functions.js/.py
├── windows/         # Windows-specific tests
│   └── test_winapi.js/.py
└── unix/           # Unix-specific tests
    └── test_unixapi.js/.py
```

## Running Tests

### Node.js Tests (Mocha)

```bash
# All tests
cd tests
npm test

# Cross-platform tests only
npm run test:common

# Windows-specific tests
npm run test:windows

# Unix-specific tests
npm run test:unix
```

### Python Tests (pytest)

```bash
# All tests
cd tests
npm run test:python

# Or directly with pytest
python -m pytest tests/ -v

# Common tests only
python -m pytest tests/common/ -v

# Windows tests only
python -m pytest tests/windows/ -v
```

## Test Coverage

### Common Tests (Cross-Platform)

#### Basic Types (`test_basic_types`)
- ✅ All integer types (int8, uint8, int16, uint16, int32, uint32, int64, uint64)
- ✅ Floating point types (float, double)
- ✅ Boolean type
- ✅ Pointer types (c_void_p, c_size_t)
- ✅ Platform-dependent types (c_long, c_ulong)
- ✅ sizeof() for all types

#### Structs and Unions (`test_structs`)
- ✅ Basic struct creation and usage
- ✅ Nested structs with dot notation access
- ✅ Unions
- ✅ Bit fields
- ✅ Anonymous fields (_anonymous_)
- ✅ Packed structs (_pack_)
- ✅ Arrays in struct fields
- ✅ toObject() / fromObject()

#### Arrays (`test_arrays`)
- ✅ Fixed-size array creation
- ✅ Array initialization with values
- ✅ Partial initialization
- ✅ Python-like indexing (arr[i])
- ✅ Array element assignment (arr[i] = value)
- ✅ for...of iteration
- ✅ Arrays in struct fields
- ✅ Different array types (int, float, double, uint8)
- ✅ String as byte arrays

#### Functions and Callbacks (`test_functions`)
- ✅ Basic function calls (abs, strlen)
- ✅ Functions with multiple arguments (memcpy)
- ✅ **errcheck callback** - automatic error checking
- ✅ errcheck can modify return values
- ✅ errcheck can throw exceptions
- ✅ Clearing errcheck with null
- ✅ Callbacks (qsort example)
- ✅ Different callback signatures
- ✅ Pointer return values (malloc/free)
- ✅ Function address access

### Windows Tests (`test_winapi`)

- ✅ GetLastError / SetLastError
- ✅ GetModuleHandleW (module handles)
- ✅ GetCurrentProcessId / GetCurrentThreadId
- ✅ GetTickCount (system uptime)
- ✅ SYSTEMTIME structure with GetLocalTime
- ✅ VirtualAlloc / VirtualFree (memory management)
- ✅ Wide strings (GetEnvironmentVariableW)
- ✅ GetComputerNameW
- ✅ errcheck with Windows API

### Unix Tests (`test_unixapi`)

- ⏳ TODO: getpid, getuid, geteuid
- ⏳ TODO: Unix-specific structs (stat, timeval)
- ⏳ TODO: Signal handling

## Comparing with Python ctypes

Each JavaScript test file has a corresponding Python (.py) file that tests the exact same functionality using Python's ctypes. This allows direct comparison of:

1. **Syntax differences** - How the same operation is expressed in both languages
2. **Feature parity** - Ensuring node-ctypes implements all Python ctypes features
3. **Behavior equivalence** - Both implementations should produce identical results

Example comparison:

**JavaScript (node-ctypes):**
```javascript
const strlen = libc.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);
strlen.errcheck = function(result, func, args) {
    if (result === 0n) throw new Error('Empty string');
    return result;
};
const len = strlen("hello");
```

**Python (ctypes):**
```python
strlen = libc.strlen
strlen.argtypes = [c_char_p]
strlen.restype = c_size_t
def check_empty(result, func, args):
    if result == 0:
        raise ValueError('Empty string')
    return result
strlen.errcheck = check_empty
length = strlen(b"hello")
```

## Requirements

### Node.js Tests
- Node.js >= 14
- Mocha test framework (install via `npm install`)

### Python Tests
- Python >= 3.7
- pytest (`pip install pytest`)

## Notes

- Tests automatically skip platform-specific tests on incompatible platforms
- Some tests (like MessageBoxW) define but don't call functions to avoid side effects
- Memory allocation tests verify proper allocation and freeing
- Callback tests demonstrate both simple and complex callback usage
