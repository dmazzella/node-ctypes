// Type-level tests for lib/index.d.ts, checked by `tsc -p tsconfig.json`.
// Lines marked @ts-expect-error must fail to compile; the rest must compile.

import {
  CDLL,
  Library,
  Structure,
  Union,
  POINTER,
  pointer,
  cast,
  array,
  ARRAY,
  struct,
  union,
  defineStruct,
  defineUnion,
  bitfield,
  writeValue,
  readValue,
  sizeof,
  create_string_buffer,
  create_unicode_buffer,
  c_buffer,
  CFUNCTYPE,
  threadSafeCallback,
  StructType,
  ArrayType,
  memmove,
  memset,
  byref,
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
  type FunctionWrapper,
  type PointerInstance,
  type PointerTypeDef,
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

// Fields are accessors of the class; toObject() / toJSON() give a plain object.
const point = new Point(1, 2);
const pointFields: object = point.toJSON();
void pointFields;

// Structure classes, POINTER and array types are valid argtypes/restype.
libc.func("byValue", c_int32, [Point]);
libc.func("byPointer", c_int32, [POINTER(c_int32), array(c_int32, 4)]);

// An array parameter takes an array instance or memory, not a JS array (as Python).
const fill = libc.func("fill", null, [array(c_int32, 4)]);
fill(array(c_int32, 4)(1, 2, 3, 4));
fill(Buffer.alloc(16));
// @ts-expect-error a JS array is not an array argument
fill([1, 2, 3, 4]);

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
check(expectType<bigint>()(cb.pointer));
check(expectType<string | null>()(cb.getLastError()));
cb.setErrorHandler((message: string) => void message);
check(expectType<bigint>()(cb.getPointer()));
cb.release();
const pointerCallback = callback(
  (value) => {
    check(expectType<PointerInstance<typeof c_int32> | null>()(value));
    return value === null ? 0 : value[0];
  },
  c_int32,
  [POINTER(c_int32)],
);
pointerCallback.release();
const pointerThreadCallback = threadSafeCallback((value) => (value === null ? 0 : value[0]), c_int32, [POINTER(c_int32)]);
const contextCallback = threadSafeCallback((value) => value, c_int32, [c_int32], { abi: "cdecl", nativeContext: { suspend: 1n, resume: 2n, onError: 3n, notify: 4n } });
const attributeHook: FunctionWrapper = libc.restore_context;
check(expectType<bigint>()(attributeHook.address));
check(expectType<bigint>()(attributeHook._as_parameter_));
const functionContextCallback = threadSafeCallback(() => 0, c_int32, [], {
  nativeContext: {
    suspend: libc.func("save_context", c_void_p, []),
    resume: attributeHook,
    onError: new Library(null).func("install_error", CType.VOID, [CType.POINTER]),
    notify: CFUNCTYPE(null)(1n),
  },
});
functionContextCallback.release();
// @ts-expect-error a plain JavaScript function is not a native hook.
threadSafeCallback(() => 0, c_int32, [], { nativeContext: { suspend: () => 1n, resume: 2n, onError: 3n } });
// @ts-expect-error callback wrappers execute JavaScript and are not native hooks.
threadSafeCallback(() => 0, c_int32, [], { nativeContext: { suspend: pointerThreadCallback, resume: 2n, onError: 3n } });
// @ts-expect-error callable callbacks also execute JavaScript.
threadSafeCallback(() => 0, c_int32, [], { nativeContext: { suspend: CFUNCTYPE(c_void_p)(() => null), resume: 2n, onError: 3n } });
// @ts-expect-error object targets must resolve to a BigInt address.
threadSafeCallback(() => 0, c_int32, [], { nativeContext: { suspend: { address: 1 }, resume: 2n, onError: 3n } });
check(expectType<number>()(contextCallback.drain()));
contextCallback.setNativeError(4n);
// @ts-expect-error native error payloads must be pointer BigInts.
contextCallback.setNativeError(4);
// @ts-expect-error every native runtime hook is required.
threadSafeCallback(() => 0, c_int32, [], { nativeContext: { suspend: 1n, resume: 2n } });
// @ts-expect-error invalid calling convention.
threadSafeCallback(() => 0, c_int32, [], { abi: "invalid" });
check(expectType<bigint>()(pointerThreadCallback._callback.getPointer()));
pointerThreadCallback.release();
const callbackFactory = CFUNCTYPE(c_int32, POINTER(c_int32));
const factoryCallback = callbackFactory((value) => (value === null ? 0 : value[0]));
check(expectType<number>()(factoryCallback(null)));
check(expectType<bigint>()(factoryCallback.pointer));
check(expectType<ErrcheckCallback | null>()(factoryCallback.errcheck));
// @ts-expect-error callable callbacks preserve their declared pointer arguments
factoryCallback("bad");
const castCallback = cast(factoryCallback, callbackFactory);
check(expectType<number>()(castCallback(null)));
check(expectType<bigint | null>()(cast(factoryCallback, c_void_p).value));
factoryCallback.release();
const typedPrototype = callbackFactory(1n);
check(expectType<number>()(typedPrototype(null)));
check(expectType<Promise<number>>()(typedPrototype.callAsync(null)));
// @ts-expect-error typed prototype arguments are not strings
typedPrototype("bad");
const castNative = cast(abs, CFUNCTYPE(c_int32, c_int32));
check(expectType<number>()(castNative(-7)));
check(expectType<Promise<number>>()(castNative.callAsync(-7)));
check(expectType<bigint | null>()(cast(abs, c_void_p).value));
// @ts-expect-error casting preserves the target prototype's declared arguments
castNative("bad");
// @ts-expect-error scalar callbacks cannot return strings
callback(() => "bad", c_int32, []);
// @ts-expect-error aggregate returns are unsupported by callbacks
callback(() => new Point(), Point, []);
// @ts-expect-error unsupported aggregate callback through a factory
CFUNCTYPE(Point)(() => new Point());
abs({ _as_parameter_: { _as_parameter_: -7 } });
check(expectType<bigint>()(memmove(Buffer.alloc(4), Buffer.alloc(4), 4)));
check(expectType<bigint>()(memset(Buffer.alloc(4), 0, 4)));
check(expectType<Buffer>()(byref(new c_int32())));
const offsetReference = byref(new c_int32(), 4);
void offsetReference;
check(expectType<PointerInstance<typeof c_int32>>()(cast(offsetReference, POINTER(c_int32))));
const typedDoublePointer = pointer(POINTER(c_int32).fromBuffer(Buffer.alloc(4)));
check(expectType<PointerInstance<PointerTypeDef<typeof c_int32>>>()(typedDoublePointer));
check(expectType<PointerInstance<typeof c_int32> | null>()(typedDoublePointer[0]));
check(expectType<PointerTypeDef<typeof c_int32>>()(typedDoublePointer._pointerType._pointerTo));
check(expectType<typeof c_int32>()(typedDoublePointer._pointerType._type_._type_));
const scalarPointerType = POINTER(c_int32);
check(expectType<typeof c_int32>()(scalarPointerType._pointerTo));
check(expectType<typeof c_int32>()(scalarPointerType._type_));
const lazyScalarPointerType = POINTER(() => c_int32);
check(expectType<PointerTypeDef<typeof c_int32>>()(lazyScalarPointerType));
check(expectType<typeof c_int32>()(lazyScalarPointerType._type_));
const lazyStructurePointerType = POINTER(() => Point);
check(expectType<PointerTypeDef<typeof Point>>()(lazyStructurePointerType));
check(expectType<typeof Point>()(lazyStructurePointerType._pointerTo));
check(expectType<typeof Point>()(lazyStructurePointerType._type_));
// @ts-expect-error the resolved pointee alias remains readonly
scalarPointerType._type_ = c_int32;
const nativeType = new StructType({ union: false, alignment: 4 }).addField("value", CType.INT32);
check(expectType<Buffer>()(nativeType.create({ value: 1 })._buffer));
new ArrayType(nativeType, 2);
// @ts-expect-error native descriptors accept options, not the ignored boolean legacy declaration
new StructType(true);
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
// Arrays on existing memory (Python: from_address / from_buffer / from_buffer_copy).
check(expectType<Buffer>()(array(c_int, 4).from_address(0x1000n)._buffer));
check(expectType<number>()(Int3.from_buffer(Buffer.alloc(12))[0]));
check(expectType<number>()(Int3.from_buffer_copy(i3, 0)[2]));

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
check(expectType<boolean>()(new wintypes.VARIANT_BOOL(false).value));
const variantEcho = libc.func("variant_echo", wintypes.VARIANT_BOOL, [wintypes.VARIANT_BOOL] as const);
check(expectType<boolean>()(variantEcho(false)));
check(expectType<Promise<boolean>>()(variantEcho.callAsync(true)));
class ScalarResult extends c_int32 {
  label() {
    return "result";
  }
}
check(expectType<ScalarResult>()(ScalarResult.from_buffer(Buffer.alloc(4))));
const scalarResult = libc.func("scalar_result", ScalarResult, [c_int32] as const);
check(expectType<ScalarResult>()(scalarResult(7)));
check(expectType<Promise<ScalarResult>>()(scalarResult.callAsync(7)));
class CheckedScalar extends c_int32 {
  static _check_retval_(value: CheckedScalar) {
    return value.value + 100;
  }
}
const checkedScalar = libc.func("checked_scalar", CheckedScalar, [c_int32] as const);
check(expectType<number>()(checkedScalar(7)));
const scalarFields = struct({ value: ScalarResult });
check(expectType<ScalarResult>()(scalarFields.get(scalarFields.create(), "value")));
check(expectType<ScalarResult>()(array(ScalarResult, 2)()[0]));
check(expectType<ScalarResult>()(POINTER(ScalarResult).fromAddress(1n).contents));
const scalarInout = CFUNCTYPE(c_int32, POINTER(ScalarResult)).bind(libc, "scalar_inout", [{ dir: "inout", name: "value" }]);
void scalarInout;
// @ts-expect-error invalid direction
const invalidDirection: import("../../lib/index.js").ParamFlag = { dir: "both", name: "value" };
void invalidDirection;
check(expectType<number>()(wintypes.RGB(1, 2, 3)));
class Derived extends wintypes.POINT {}
void new Derived(1, 2).x;

// prototype((name, dll), paramflags)
const strlenProto = CFUNCTYPE(c_int64, c_char_p)(["strlen", libc]);
strlenProto("x");
check(expectType<Promise<bigint>>()(strlenProto.callAsync("x")));
check(expectType<ErrcheckCallback | null>()(strlenProto.errcheck));
check(expectType<bigint>()(strlenProto.address));
// @ts-expect-error errcheck must be callable or null
strlenProto.errcheck = 123;
const outputProto = CFUNCTYPE(c_int, c_int, POINTER(c_int)).bind(libc, "output", [
  [1, "value"],
  [2, "out"],
]);
check(expectType<Promise<any>>()(outputProto.callAsync(1)));
check(expectType<ErrcheckCallback | null>()(outputProto.errcheck));
raw.setErrcheck((result, func, args) => {
  check(expectType<typeof raw>()(func));
  void func.call(-1);
  void args;
  // @ts-expect-error the native function handle is not directly callable
  func(-1);
  return result;
});
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

// Statics of Structure classes (size, alignment, fields).
class Pt extends Structure {
  static _fields_ = [
    ["x", c_int32],
    ["y", c_int32],
  ];
}
check(expectType<number>()(Pt.size));
check(expectType<number>()(Pt.alignment));
check(expectType<string>()(Pt.fields[0].name));
void Pt.from_buffer(new Int32Array(2));

// Options of struct() / union() / defineUnion().
void struct({ a: c_int32 }, { pack: 2, layout: "ms", align: 8 });
void union({ a: c_int32, d: c_double }, { pack: 1 });
const DS = defineStruct({ x: c_int32, y: c_int32 });
check(expectType<number>()(DS.size));
check(expectType<number>()(new DS(1, 2).x));
void DS.from_address(0x1000n);
const DU = defineUnion({ i: c_int32, d: c_double }, { align: 8 });
check(expectType<number>()(DU.alignment));

// Arrays: element-wise Array methods, Buffer methods on bytes, struct() elements.
const elems = array(c_int32, 3)(1, 2, 3);
check(expectType<number[]>()(elems.slice(0, 2)));
check(expectType<number | undefined>()(elems.at(-1)));
check(expectType<boolean>()(elems.includes(2)));
check(expectType<string[]>()(elems.map((v) => String(v))));
check(expectType<number>()(elems.readInt32LE(0)));
check(expectType<string>()(array(c_char, 4)().slice(0, 2)));
void array(struct({ x: c_int32 }), 3);
// @ts-expect-error a CType number is not an element type
void array(5, 3);
// @ts-expect-error bit fields need a C integer type, not a structure definition
void bitfield(struct({ x: c_int32 }), 3);

// readValue / writeValue / sizeof on typed arrays and addresses.
void readValue(new Uint8Array(4), c_int32);
void writeValue(0x1000n, c_int32, 1);
check(expectType<number>()(sizeof(new Float64Array(2))));
