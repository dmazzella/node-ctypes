---
title: TypeScript
---

# TypeScript

## TypeScript

Argument and return types are inferred from declared type classes such as
`c_int32` and `c_size_t`. A literal tuple (`as const`) preserves argument types:

```ts
const libc = new CDLL(null);
const strlen = libc.func("strlen", c_size_t, [c_char_p] as const);
const n: bigint = strlen("hello"); // typed as bigint, not any
```

`static _fields_ = [["x", c_int32]]` compiles as written in Python (no
`as const`). For typed struct fields use `defineStruct` instead of
`extends Structure`:

```ts
class Point extends defineStruct({ x: c_int32, y: c_int32 }) {
  distance() {
    return Math.sqrt(this.x ** 2 + this.y ** 2);
  }
}
const p = new Point({ x: 3, y: 4 }); // p.x, p.y typed as number
```

`struct()` / `union()` fields, `POINTER()` targets and arrays of numeric
types are typed too; a `null` return type is `void`:

```ts
const PointDef = struct({ x: c_int32, y: c_double });
PointDef.get(buf, "y"); // number
POINTER(c_int32).fromAddress(addr)[0]; // number (.contents: c_int32 instance)
array(c_int32, 4).create([1, 2, 3, 4])[0]; // number
libc.func("srand", null, [c_uint32]); // returns undefined
```
