---
title: Structures, unions and arrays
---

# Structures, unions and arrays

## Structs, unions, bit fields, arrays

```javascript
import { Structure, Union, array, c_int32, c_uint32, c_float, c_char } from "node-ctypes";

class Rect extends Structure {
  static _fields_ = [
    ["x", c_int32],
    ["y", c_int32],
    ["w", c_int32],
    ["h", c_int32],
  ];
}

class Value extends Union {
  static _fields_ = [
    ["i", c_int32],
    ["f", c_float],
  ];
}

// Bit fields: [name, type, bitCount]
class Flags extends Structure {
  static _fields_ = [
    ["enabled", c_uint32, 1],
    ["mode", c_uint32, 3],
    ["priority", c_uint32, 4],
  ];
}

// Arrays: elementType * count (Python: `c_int32 * 5`)
const IntArr5 = array(c_int32, 5);
const arr = IntArr5(1, 2, 3, 4, 5); // Python: (c_int32 * 5)(1, 2, 3, 4, 5)

// char arrays read and write as strings (Python: bytes)
const name = array(c_char, 16)();
name.value = "node"; // .value / .raw as in Python
```

`array(type, n)` reuses the same type while it is alive. Instances, function
signatures and containing types keep their array types alive; the cache itself
does not. Unused array types and their length entries can be garbage-collected,
including arrays of builtin element types.

An array type in `argtypes` is passed by address, as in C and Python
(`fill.argtypes = [c_int32 * 4]`). As in Python, the argument must be an
instance of an array with the same element type and length; a Buffer or a
typed array is also accepted as its memory. Other values raise
`ArgumentError`.

Builtin numeric scalars accept numbers, booleans and BigInt; integers wrap to
their C width, but reject non-integral or non-finite numbers. Use BigInt when
the original integer needs more precision than a JS number can represent.
No argument, or `undefined` in a constructor, initializes zero. Explicit
`null`, strings and arbitrary objects are not implicit numeric conversions.
Assigning a scalar instance to a field or passing it to a declared numeric
argument requires a compatible type. The documented numeric-pointer argument
extensions below are unchanged.

`c_bool` and `wintypes.VARIANT_BOOL` use JavaScript truthiness, using `.value`
for scalar instances rather than treating every instance as true.
`VARIANT_BOOL` stores true as `-1`, and its results and callback arguments
are booleans. Boolean bitfields normalize before masking and read as booleans.

Nested structs, anonymous fields (`static _anonymous_ = ["data"]`),
explicit packing (`static _pack_ = 1`), minimum alignment
(`static _align_ = 16`), self-referential pointers (`POINTER(() => Node)`)
and subclasses that add fields to their base class all work identically to
Python. The layout of bit fields follows Python's `_layout_`: `"gcc-sysv"`
by default, `"ms"` on Windows or with `_pack_`. Bit fields wider than 53
bits read as BigInt.

`_pack_` follows Python's integer conversion and permits zero and non-powers
of two (for example `3`) with the MS layout. An explicit `_pack_`, including
zero, is incompatible with `"gcc-sysv"`. Layouts with non-power-of-two
alignment can be used for memory serialization but are rejected as native
by-value signatures: they do not describe a valid C ABI alignment.

Structures and unions passed or returned by value keep this layout, also
with `_pack_`: as with GCC and clang, a structure with misaligned fields is
passed in memory on x86-64 System V (Linux, macOS Intel), where Python
ctypes passes it in registers and the called function reads wrong values.

Each returned structure or union owns a snapshot of its value, including
results declared with functional `struct()` / `union()` definitions. Array
views, nested composites and union getters remain valid after later calls,
reentrant conversion or `errcheck`, and concurrent `callAsync()` jobs.
Mutating one result does not modify another result's value storage.

This is not a deep copy through pointers: pointer fields can still refer to
the same external memory. Explicit `definition.toObject(buffer)` keeps its
existing buffer-view behavior. Synchronous low-level native `struct_buffer`
results are borrowed, reusable storage; public callables snapshot their
results before any JavaScript result conversion.

Low-level native `StructType` descriptors are builders only until consumed.
Adding a descriptor as a field, constructing an `ArrayType` from it (even at
length zero), preparing a function/callback signature, or creating/reading a
native value finalizes the captured layout and its dependencies.
`addField()` then throws instead of changing sizes, offsets or FFI metadata
already in use. Build a new descriptor for a different layout.
`getSize()` and `getAlignment()` alone leave an unused builder open; an
outer builder can still receive fields after it captures a finalized child.
Direct by-value self-reference is rejected. Pointers do not capture or
finalize the pointed-to layout.

## Big-endian structures

```javascript
class NetHeader extends BigEndianStructure {
  static _fields_ = [
    ["magic", c_uint32],
    ["length", c_uint32],
  ];
}
const h = new NetHeader();
h.magic = 0x12345678; // stored as 12 34 56 78 on the wire
```

`LittleEndianStructure`, `BigEndianUnion`, `LittleEndianUnion` work the
same way. Byte order is per-class — nested structs keep their own.

Primitive arrays also follow their containing class's byte order, recursively
for multidimensional arrays, including floats and wide-character arrays.
Arrays of structures keep the element structure's own byte order. The same
array type can be shared with native/little-endian containers without being
modified. Raw Buffer and typed-memory copies still copy bytes, not values
converted between byte orders.

## Type constructors

- `struct({...})` / `class extends Structure` — composite struct types
- `class extends Union` — union types
- `array(type, n)` / `ARRAY(type, n)` — Python's `type * n`; callable: `array(c_int, 3)(1, 2, 3)`; elements can be simple types, structures, arrays, `POINTER(T)` and `CFUNCTYPE` types
- `POINTER(type)` — pointer-to-type; accepts a thunk `POINTER(() => T)`
- `pointer(instance)` — pointer to an existing c-data instance
- `CFUNCTYPE(restype, ...argtypes)` — function pointer type: `proto(jsFn)` (callback), `proto(address)`, `proto([name, lib], paramflags?)` (Python: `proto((name, dll), paramflags)`)
- `WINFUNCTYPE(restype, ...argtypes)` — `__stdcall` callback type
- `defineStruct({...})` — typed-TS variant of `struct`

## Structure helpers

- `T.from_buffer(buf, offset?)` — zero-copy view
- `T.from_buffer_copy(buf, offset?)` — independent copy
- `T.from_address(addr)` — wrap raw pointer
- `T.in_dll(lib, name)` — bind to exported global
- `T._as_parameter_` / `T.from_param(v)` — adapter protocols
