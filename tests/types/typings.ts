// Type-level tests for lib/index.d.ts, checked by `tsc -p tsconfig.json`.
// Lines marked @ts-expect-error must fail to compile; the rest must compile.

import {
  CDLL,
  Library,
  Structure,
  Union,
  POINTER,
  pointer,
  array,
  ARRAY,
  struct,
  union,
  defineStruct,
  readValue,
  sizeof,
  create_string_buffer,
  create_unicode_buffer,
  c_buffer,
  CFUNCTYPE,
  ArgumentError,
  LibraryLoader,
  cdll,
  RTLD_GLOBAL,
  DEFAULT_MODE,
  SIZEOF_TIME_T,
  get_last_error,
  set_last_error,
  c_int,
  c_int32,
  c_int64,
  c_double,
  c_char,
  c_wchar,
  c_void_p,
  c_voidp,
  c_time_t,
  c_char_p,
  CType,
  callback,
  type ErrcheckCallback,
  type PointerInstance,
  type SimpleCDataInstance,
  wintypes,
} from "../../lib/index.js";

// Exact type equality: unlike a plain assignment, `any` does not satisfy it.
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
declare function expectType<Expected>(): <Actual>(value: Actual) => Equal<Actual, Expected>;
function check(result: true): void {
  void result;
}

const libc = new CDLL(null);

class Point extends Structure {
  static _fields_ = [
    ["x", c_int32],
    ["y", c_int32],
  ] as any;
}

// Structure classes, POINTER and array types are valid argtypes/restype.
libc.func("byValue", c_int32, [Point]);
libc.func("byPointer", c_int32, [POINTER(c_int32), array(c_int32, 4)]);

// Typed signatures.
const abs = libc.func("abs", c_int32, [c_int32]);
check(expectType<number>()(abs(-1)));
// @ts-expect-error string is not an int32 argument
abs("1");
const strdup = libc.func("strdup", POINTER(c_int32), [c_char_p]);
check(expectType<PointerInstance<typeof c_int32> | null>()(strdup("x")));
check(expectType<ErrcheckCallback | null>()(abs.errcheck));

// Untyped signatures stay permissive.
const untyped = libc.func("abs", c_int32, [c_int32] as any[]);
untyped("anything", 1, 2);

// Library.func returns a handle invoked through call().
const raw = new Library(null).func("abs", c_int32, [c_int32]);
check(expectType<number>()(raw.call(-1)));
check(expectType<string>()(raw.name));
// @ts-expect-error the native handle is not directly callable
raw(-1);

// `null` restype is void (Python: restype = None).
const srand = libc.func("srand", null, [c_int32]);
check(expectType<undefined>()(srand(1)));

// Callbacks can be passed directly where a pointer is expected.
const qsort = libc.func("qsort", null, [c_void_p, c_int64, c_int64, c_void_p]);
const cmp = callback(() => 0, c_int32, [c_void_p, c_void_p]);
qsort(Buffer.alloc(8), 2, 4, cmp);
cmp.release();

// Callbacks and `using`.
const cb = libc.callback(() => 0, c_int32, [c_void_p, c_void_p]);
check(expectType<bigint>()(cb.getPointer()));
check(expectType<string | null>()(cb.getLastError()));
cb.setErrorHandler((message: string) => void message);
cb.release();
{
  using lib = new CDLL(null);
  void lib;
}

// struct() / union() field typing.
const PointDef = struct({ x: c_int32, big: c_int64, d: c_double });
const buf = PointDef.create({ x: 1, big: 2n });
check(expectType<number>()(PointDef.get(buf, "x")));
check(expectType<bigint>()(PointDef.get(buf, "big")));
PointDef.set(buf, "d", 1.5);
// @ts-expect-error unknown field
PointDef.get(buf, "missing");
// @ts-expect-error wrong value type for an int32 field
PointDef.set(buf, "x", "1");
check(expectType<{ x: number; big: bigint; d: number }>()(PointDef.toObject(buf)));
check(expectType<number>()(union({ i: c_int32, f: c_double }).get(buf, "f")));

// Nested definitions keep their field types.
const Rect = defineStruct({ topLeft: PointDef, w: c_int32 });
check(expectType<number>()(new Rect().topLeft.x));

// Untyped definitions stay `any`.
const anyDef = struct({} as Record<string, any>);
check(expectType<any>()(anyDef.get(buf, "whatever")));

// Arrays: numeric elements are typed, the rest stays `any` (arrays are Buffers).
const ints = array(c_int32, 3).create([1, 2, 3]);
check(expectType<number>()(ints[0]));
// @ts-expect-error int32 elements are numbers
array(c_int32, 3).create(["a"]);
const longs = array(c_int64, 2).create([1n, 2]);
check(expectType<any>()(longs[0]));

// Pointers.
const ip = POINTER(c_int32).fromAddress(0n);
check(expectType<SimpleCDataInstance<number>>()(ip.contents));
ip.contents = 5;
ip.contents = new c_int32(5);
check(expectType<number>()(ip[3]));
check(expectType<number[]>()(ip.slice(0, 2)));
class Node extends Structure {
  static _fields_ = [["next", POINTER(() => Node)]] as any;
}
void Node;
check(expectType<number>()(readValue(buf, c_int32)));

// ---------------------------------------------------------------------------
// Python ctypes parity (2.0)
// ---------------------------------------------------------------------------

// `_fields_` written as in Python, without `as const` / `as any`.
class POINT extends Structure {
  static _fields_ = [
    ["x", c_int],
    ["y", c_int],
  ];
}
class RECT extends Structure {
  static _fields_ = [
    ["upperleft", POINT],
    ["lowerright", POINT],
  ];
  static _pack_ = 1;
}
class Bits extends Structure {
  static _fields_ = [
    ["first", c_int, 16],
    ["second", c_int, 16],
  ];
}
void Bits;
const rc = new RECT(new POINT(1, 2), new POINT(3, 4));
check(expectType<number>()(sizeof(rc)));

// pointer(instance).contents is an instance of the class.
check(expectType<POINT>()(pointer(new POINT()).contents));
check(expectType<POINT>()(POINTER(POINT).fromAddress(0n)[1]));

// c_char / c_wchar values are 1-character strings.
check(expectType<string>()(new c_char("a").value));
check(expectType<string>()(new c_wchar("é").value));
const strchr = libc.func("strchr", c_char_p, [c_char_p, c_char]);
strchr("abc", "b");
strchr("abc", 98);
check(expectType<number>()(CType.CHAR));

// Array types are callable like Python's (c_int * 3)(1, 2, 3).
const Int3 = array(c_int, 3);
const i3 = Int3(1, 2, 3);
check(expectType<number>()(i3[0]));
void new Int3(1);
void ARRAY(c_int, 2);
const chars = array(c_char, 8)("a", "b");
check(expectType<string>()(chars.value));
check(expectType<Buffer>()(chars.raw));
check(expectType<string>()(array(c_wchar, 4)().value));
void array(array(c_int, 2), 3)()[0];
void array(POINTER(POINT), 2)(pointer(new POINT()), null);
void array(CFUNCTYPE(c_int), 2);

// char array fields read as strings.
class Named extends Structure {
  static _fields_ = [["name", array(c_char, 16)]];
}
void Named;
const NamedDef = struct({ name: array(c_char, 16), p: POINTER(c_int) });
check(expectType<string>()(NamedDef.get(buf, "name")));
check(expectType<PointerInstance<typeof c_int> | null>()(NamedDef.get(buf, "p")));

// create_string_buffer(init, size) / create_unicode_buffer with .value/.raw.
const sb = create_string_buffer("hi", 10);
check(expectType<string>()(sb.value));
check(expectType<Buffer>()(sb.raw));
sb.value = "hello";
check(expectType<string>()(create_unicode_buffer(8).value));
check(expectType<string>()(c_buffer(4).value));

// CFUNCTYPE: argtype, restype, struct field, sizeof.
const CMP = CFUNCTYPE(c_int, c_void_p, c_void_p);
const qsort2 = libc.func("qsort", null, [c_void_p, c_int64, c_int64, CMP]);
const cmp2 = CMP(() => 0);
qsort2(Buffer.alloc(8), 2, 4, cmp2);
const getFn = libc.func("getfn", CMP, []);
check(expectType<((...args: any[]) => any) | null>()(getFn()));
class Ops extends Structure {
  static _fields_ = [["compare", CMP]];
}
void Ops;
class IntOrFn extends Union {
  static _fields_ = [
    ["i", c_int],
    ["fn", CMP],
  ];
}
void IntOrFn;
check(expectType<number>()(sizeof(CMP)));

// Library loading names.
const libm = new CDLL(null, RTLD_GLOBAL);
const libm2 = new CDLL(null, { mode: DEFAULT_MODE, use_errno: true });
void libm;
void libm2;
check(expectType<CDLL>()(cdll.LoadLibrary(null)));
check(expectType<CDLL>()(new LibraryLoader(CDLL).LoadLibrary("libc")));
check(expectType<number>()(SIZEOF_TIME_T));
check(expectType<number>()(set_last_error(get_last_error())));
void c_voidp;
void c_time_t;
try {
  abs(1);
} catch (e) {
  if (e instanceof ArgumentError) check(expectType<string>()(e.message));
}

// wintypes as Python's ctypes.wintypes.
const { LPRECT, DWORD, HWND, MSG } = wintypes;
const rect = new wintypes.RECT(1, 2, 3, 4);
check(expectType<bigint>()(rect.left));
check(expectType<bigint | null>()(new MSG().hWnd));
const getRect = libc.func("GetClientRect", wintypes.BOOL, [HWND, LPRECT]);
getRect(null, rect);
check(expectType<bigint>()(new DWORD(1).value));
check(expectType<number>()(wintypes.RGB(1, 2, 3)));
class Derived extends wintypes.POINT {}
void new Derived(1, 2).x;

// prototype((name, dll), paramflags)
const strlenProto = CFUNCTYPE(c_int64, c_char_p)(["strlen", libc]);
strlenProto("x");
void CFUNCTYPE(
  c_double,
  c_double,
  POINTER(c_double),
)(
  ["modf", libc],
  [
    [1, "x"],
    [2, "iptr"],
  ],
);
