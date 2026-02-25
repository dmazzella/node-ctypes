/**
 * node-ctypes - Python ctypes-like FFI for Node.js
 *
 * A foreign function interface library that mirrors the Python ctypes API,
 * built on libffi and N-API.
 *
 * @example Loading a library and calling a function
 * ```javascript
 * import { CDLL, c_int } from 'node-ctypes';
 *
 * const libc = new CDLL('libc.so.6');  // Linux
 * // const libc = new CDLL('msvcrt.dll');  // Windows
 * // const libc = new CDLL('libc.dylib');  // macOS
 * const abs_func = libc.abs;
 * abs_func.argtypes = [c_int];
 * abs_func.restype = c_int;
 * console.log(abs_func(-42));  // 42
 * ```
 *
 * @example Defining a struct
 * ```javascript
 * import { Structure, c_int } from 'node-ctypes';
 *
 * class Point extends Structure {
 *     static _fields_ = [["x", c_int], ["y", c_int]];
 * }
 *
 * const p = new Point(10, 20);
 * console.log(p.x, p.y);  // 10 20
 * ```
 *
 * @example Callbacks
 * ```javascript
 * import { callback, c_int32, c_void_p, readValue } from 'node-ctypes';
 *
 * const compare = callback(
 *     (a, b) => readValue(a, c_int32) - readValue(b, c_int32),
 *     c_int32, [c_void_p, c_void_p]
 * );
 * // Pass compare.pointer to native functions
 * compare.release();  // Release when done
 * ```
 *
 * @example Pointers
 * ```javascript
 * import { POINTER, pointer, c_int32 } from 'node-ctypes';
 *
 * const x = new c_int32(42);
 * const p = pointer(x);
 * console.log(p.contents);  // 42
 * ```
 *
 * @packageDocumentation
 */

/// <reference types="node" />

// =============================================================================
// Basic Types
// =============================================================================

/**
 * Numeric type identifiers used internally by the native module.
 *
 * These constants identify C data types and are the single source of truth
 * for type values throughout the library.
 *
 * @category Types
 */
export interface CTypeValues {
  readonly VOID: number;
  readonly INT8: number;
  readonly UINT8: number;
  readonly INT16: number;
  readonly UINT16: number;
  readonly INT32: number;
  readonly UINT32: number;
  readonly INT64: number;
  readonly UINT64: number;
  readonly FLOAT: number;
  readonly DOUBLE: number;
  readonly POINTER: number;
  readonly STRING: number;
  readonly WSTRING: number;
  readonly WCHAR: number;
  readonly BOOL: number;
  readonly SIZE_T: number;
  readonly SSIZE_T: number;
  readonly LONG: number;
  readonly ULONG: number;
  readonly STRUCT: number;
  readonly UNION: number;
  readonly ARRAY: number;
  readonly COUNT: number;
}

/**
 * CType enum with numeric type identifiers.
 * @category Types
 */
export const CType: CTypeValues;

/**
 * Any accepted type specification — a SimpleCData class, CType numeric value, or struct/union definition.
 * @category Types
 */
export type AnyType = SimpleCDataConstructor | number | StructDef | UnionDef;

// =============================================================================
// Library & Function
// =============================================================================

/**
 * Version information for the native module.
 *
 * @example
 * ```javascript
 * import { Version } from 'node-ctypes';
 * console.log(Version.toString());  // "1.5.0"
 * ```
 *
 * @category Library Loading
 */
export class Version {
  static get major(): number;
  static get minor(): number;
  static get patch(): number;
  static toString(): string;
}

/**
 * Low-level native library handle.
 *
 * For most use cases, prefer {@link CDLL} or {@link WinDLL} instead.
 *
 * @category Library Loading
 */
export class Library {
  constructor(path: string | null);
  func(name: string, returnType: AnyType, argTypes?: AnyType[], options?: FunctionOptions): FFIFunction;

  /**
   * Get the address of a symbol in the library.
   * @param name - Symbol name
   * @returns Address as BigInt
   */
  symbol(name: string): bigint;

  /** Close the library and release resources. */
  close(): void;

  /** Library file path. */
  readonly path: string;

  /** Whether the library is currently loaded. */
  readonly loaded: boolean;
}

/**
 * Options for FFI function calls.
 * @category Library Loading
 */
export interface FunctionOptions {
  /** Calling convention. Defaults to `"cdecl"` for CDLL, `"stdcall"` for WinDLL. */
  abi?: "cdecl" | "stdcall" | "fastcall" | "thiscall" | "default";
}

/**
 * Callback for intercepting function return values.
 *
 * Python equivalent: `func.errcheck`
 *
 * @param result - The raw return value
 * @param func - The function that was called
 * @param args - The arguments that were passed
 * @returns The (possibly transformed) return value
 *
 * @category Library Loading
 */
export type ErrcheckCallback = (result: any, func: CallableFunction, args: any[]) => any;

/**
 * A callable FFI function returned by {@link Library.func} or {@link CDLL.func}.
 * @category Library Loading
 */
export interface FFIFunction {
  /** Call the native function synchronously. */
  (...args: any[]): any;

  /** Call the native function asynchronously on a worker thread. */
  callAsync(...args: any[]): Promise<any>;

  /** The function name in the native library. */
  readonly funcName: string;

  /** The function address as BigInt. */
  readonly address: bigint;

  /**
   * Error checking callback, called after every invocation.
   * @see {@link ErrcheckCallback}
   */
  errcheck: ErrcheckCallback | null;
}

/**
 * Load a shared library using the C calling convention (cdecl).
 *
 * This is the primary way to load and call functions from shared libraries.
 * Supports both a traditional syntax and a Python ctypes-compatible syntax.
 *
 * Python equivalent: `ctypes.CDLL`
 *
 * @example Traditional syntax
 * ```javascript
 * import { CDLL, c_int } from 'node-ctypes';
 *
 * const libc = new CDLL('libc.so.6');  // Linux
 * const abs = libc.func('abs', c_int, [c_int]);
 * console.log(abs(-42));  // 42
 * ```
 *
 * @example Python ctypes-like syntax
 * ```javascript
 * const libc = new CDLL('msvcrt.dll');  // Windows
 * const abs_func = libc.abs;
 * abs_func.argtypes = [c_int];
 * abs_func.restype = c_int;
 * console.log(abs_func(-42));  // 42
 * ```
 *
 * @category Library Loading
 */
export class CDLL {
  /**
   * @param path - Path to the shared library, or `null` to load the current process
   */
  constructor(path: string | null);

  /**
   * Get a callable function from the library.
   *
   * @param name - Function name in the library
   * @param returnType - Return type (e.g. `c_int`, `c_double`, `c_void`)
   * @param argTypes - Argument types array
   * @param options - Calling convention options
   * @returns A callable function
   */
  func(name: string, returnType: AnyType, argTypes?: AnyType[], options?: FunctionOptions): CallableFunction & { callAsync(...args: any[]): Promise<any>; errcheck: ErrcheckCallback | null };

  /**
   * Get the address of a symbol.
   * @param name - Symbol name
   * @returns Address as BigInt
   */
  symbol(name: string): bigint;

  /** Close the library and clear the function cache. */
  close(): void;

  /** Library file path. */
  readonly path: string;

  /** Whether the library is loaded. */
  readonly loaded: boolean;

  /**
   * Python-like function access. Accessing any property returns a {@link FunctionWrapper}
   * that supports `argtypes`/`restype` assignment.
   */
  [funcName: string]: FunctionWrapper | any;
}

/**
 * Wrapper returned by Python-like property access on {@link CDLL}.
 *
 * Supports the `argtypes`/`restype` pattern from Python ctypes.
 *
 * @example
 * ```javascript
 * const abs_func = libc.abs;
 * abs_func.argtypes = [c_int];
 * abs_func.restype = c_int;
 * console.log(abs_func(-42));  // 42
 * ```
 *
 * @category Library Loading
 */
export interface FunctionWrapper {
  /** Call the function. */
  (...args: any[]): any;

  /** Call the function asynchronously on a worker thread. */
  callAsync(...args: any[]): Promise<any>;

  /** Argument types. Set before calling. */
  argtypes: AnyType[];

  /** Return type. Set before calling. */
  restype: AnyType;

  /** Optional error checking callback. */
  errcheck: ErrcheckCallback | null;
}

/**
 * Load a shared library using the stdcall calling convention.
 *
 * Used for Windows API functions (kernel32, user32, etc.).
 *
 * Python equivalent: `ctypes.WinDLL`
 *
 * @example
 * ```javascript
 * import { WinDLL, c_void, c_void_p } from 'node-ctypes';
 *
 * const kernel32 = new WinDLL('kernel32.dll');
 * const GetLocalTime = kernel32.func('GetLocalTime', c_void, [c_void_p]);
 * ```
 *
 * @category Library Loading
 */
export class WinDLL extends CDLL {
  constructor(path: string);
}

// =============================================================================
// Callbacks
// =============================================================================

/**
 * Wrapper around a native callback.
 *
 * **Important:** Always call {@link CallbackWrapper.release | release()} when the callback
 * is no longer needed to prevent memory leaks.
 *
 * @category Callbacks
 */
export interface CallbackWrapper {
  /** The callback function pointer, passable to native functions. */
  readonly pointer: bigint;

  /** Release the callback and free native resources. Must be called when done. */
  release(): void;
}

/**
 * Native callback class for main-thread callbacks.
 * @category Callbacks
 */
export class Callback {
  constructor(fn: Function, returnType: AnyType, argTypes?: AnyType[]);
  readonly pointer: bigint;
  release(): void;
}

/**
 * Thread-safe callback that can be invoked from any thread.
 *
 * Use this when native code may call the callback from a thread other than the main thread.
 *
 * @category Callbacks
 */
export class ThreadSafeCallback extends Callback {}

// =============================================================================
// Structures
// =============================================================================

/**
 * Metadata for a single field in a struct or union.
 * @category Structures
 */
export interface FieldDef {
  name: string;
  type: AnyType | StructDef | ArrayTypeDef | BitFieldDef;
  offset: number;
  size: number;
  alignment: number;
  isNested?: boolean;
  isAnonymous?: boolean;
  isArray?: boolean;
  isBitField?: boolean;
  bitOffset?: number;
  bitSize?: number;
  baseSize?: number;
}

/**
 * A struct type definition created by the {@link struct} function.
 *
 * Provides low-level `create()`, `get()`, `set()`, and `toObject()` methods.
 * For Python-like syntax, use {@link Structure} class instead.
 *
 * @category Structures
 */
export interface StructDef {
  /** Total size of the struct in bytes. */
  readonly size: number;
  /** Alignment requirement in bytes. */
  readonly alignment: number;
  /** Field definitions. */
  readonly fields: FieldDef[];
  /** Whether the struct is packed (no padding). */
  readonly packed: boolean;
  /** @internal */
  readonly _isStructType: true;

  /** Allocate a buffer and optionally initialize field values. */
  create(values?: Record<string, any>): Buffer;
  /** Read a field value from a buffer. */
  get(buf: Buffer, fieldName: string): any;
  /** Write a field value to a buffer. */
  set(buf: Buffer, fieldName: string, value: any): void;
  /** Convert all fields to a plain JavaScript object. */
  toObject(buf: Buffer): Record<string, any>;
  /** Get a view of a nested struct's buffer region. */
  getNestedBuffer(buf: Buffer, fieldName: string): Buffer;
}

/** @category Structures */
export type FieldSpec = AnyType | StructDef | ArrayTypeDef | BitFieldDef | AnonymousField;

type JsFromCType<T> = T extends "int64" | "uint64" | "size_t"
  ? bigint
  : T extends "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int" | "uint" | "short" | "ushort" | "char" | "uchar" | "float" | "double"
    ? number
    : T extends "bool"
      ? boolean
      : T extends "string" | "c_char_p" | "c_char"
        ? string | Buffer
        : T extends "wstring" | "c_wchar_p"
          ? string
          : T extends StructDef
            ? any
            : T extends ArrayTypeDef
              ? any
              : T extends BitFieldDef
                ? number
                : any;

type FieldsToInstance<F extends Record<string, FieldSpec>> = {
  [K in keyof F]: JsFromCType<F[K]>;
};

/**
 * A union type definition created by the {@link union} function.
 *
 * All fields share the same memory region. The total size equals the
 * size of the largest field.
 *
 * @category Structures
 */
export interface UnionDef extends StructDef {
  readonly isUnion: true;
}

/**
 * A bit field definition created by the {@link bitfield} function.
 *
 * @example
 * ```javascript
 * class Flags extends Structure {
 *     static _fields_ = [
 *         ["enabled", bitfield(c_uint32, 1)],
 *         ["mode", bitfield(c_uint32, 3)],
 *     ];
 * }
 * ```
 *
 * @category Structures
 */
export interface BitFieldDef {
  /** @internal */
  readonly _isBitField: true;
  /** The underlying integer type. */
  readonly baseType: AnyType;
  /** Number of bits. */
  readonly bits: number;
  /** Size of the base type in bytes. */
  readonly baseSize: number;
}

/**
 * An array type definition created by the {@link array} function.
 *
 * @example
 * ```javascript
 * const IntArray5 = array(c_int32, 5);
 * const arr = IntArray5.create([1, 2, 3, 4, 5]);
 * console.log(arr[0]);  // 1
 * ```
 *
 * @category Structures
 */
export interface ArrayTypeDef {
  /** Element type. */
  readonly elementType: AnyType;
  /** Number of elements. */
  readonly length: number;
  /** @internal */
  readonly _isArrayType: true;

  /** Total size in bytes (elementSize * length). */
  getSize(): number;
  /** Number of elements. */
  getLength(): number;
  /** Element alignment. */
  getAlignment(): number;
  /** Create a new array, optionally initialized with values. Returns a Proxy with index access. */
  create(values?: any[]): Buffer & ArrayProxy;
  /** Wrap an existing buffer as an array with index access. */
  wrap(buffer: Buffer): Buffer & ArrayProxy;
}

/**
 * Proxy interface for array index access and iteration.
 * @category Structures
 */
export interface ArrayProxy {
  [index: number]: any;
  [Symbol.iterator](): Iterator<any>;
}

/**
 * Options for struct creation.
 * @category Structures
 */
export interface StructOptions {
  /** If `true`, disables padding between fields. */
  packed?: boolean;
}

/**
 * Wrapper for anonymous fields in structs/unions.
 * @category Structures
 */
export interface AnonymousField {
  type: StructDef;
  anonymous: true;
}

// =============================================================================
// Pointers
// =============================================================================

/**
 * A pointer type created by {@link POINTER}.
 *
 * @example
 * ```javascript
 * const IntPtr = POINTER(c_int32);
 * const p = IntPtr.fromBuffer(buf);
 * console.log(p.contents);  // dereferenced value
 * ```
 *
 * @category Pointers
 */
export interface PointerTypeDef {
  /** The type this pointer points to. */
  readonly _pointerTo: AnyType | StructDef;
  /** Size of the pointed-to type. */
  readonly _baseSize: number;
  /** Pointer size (always 8 on 64-bit). */
  readonly size: number;

  /** Create a NULL pointer. */
  create(): Buffer;
  /** Create a pointer to an existing buffer. */
  fromBuffer(targetBuf: Buffer): Buffer;
  /** Dereference the pointer, returning the target address or null. */
  deref(ptrBuf: Buffer): bigint | null;
  /** Update the pointer target. */
  set(ptrBuf: Buffer, value: Buffer | bigint): void;
  toString(): string;
}

// =============================================================================
// Native Struct/Array Types
// =============================================================================

/**
 * Low-level native struct type. Prefer {@link Structure} for most use cases.
 * @category Structures
 */
export class StructType {
  constructor(isUnion?: boolean);
  addField(name: string, type: AnyType | StructType | ArrayType): this;
  getSize(): number;
  getAlignment(): number;
  create(values?: Record<string, any>): Buffer;
  read(buffer: Buffer): Record<string, any>;
}

/**
 * Low-level native array type. Prefer {@link array} for most use cases.
 * @category Structures
 */
export class ArrayType {
  constructor(elementType: AnyType, count: number);
  getSize(): number;
  getLength(): number;
  getAlignment(): number;
  create(values?: any[]): Buffer;
}

/**
 * Base class for Python-like struct definitions.
 *
 * Subclasses define fields via `static _fields_`. Field access is transparent —
 * `point.x` reads directly from the underlying buffer.
 *
 * Python equivalent: `ctypes.Structure`
 *
 * @example
 * ```javascript
 * import { Structure, c_int } from 'node-ctypes';
 *
 * class Point extends Structure {
 *     static _fields_ = [["x", c_int], ["y", c_int]];
 * }
 *
 * const p = new Point(10, 20);
 * console.log(p.x, p.y);  // 10 20
 *
 * // Nested structs
 * class Rect extends Structure {
 *     static _fields_ = [["topLeft", Point], ["bottomRight", Point]];
 * }
 * ```
 *
 * @category Structures
 */
export class Structure<F extends Record<string, FieldSpec> = Record<string, any>> {
  /**
   * Create a new struct instance.
   * @param args - Positional values matching field order, or a single object with field names as keys
   */
  constructor(...args: any[]);

  /**
   * Field definitions. Array of `[name, type]` tuples, or `[name, type, bits]` for bit fields.
   *
   * @example
   * ```javascript
   * static _fields_ = [
   *     ["x", c_int],
   *     ["y", c_int],
   *     ["flags", c_uint32, 3],  // 3-bit bit field
   * ];
   * ```
   */
  static _fields_?: Array<[string, FieldSpec]> | Record<string, FieldSpec>;

  /** If `true`, disables padding between fields. */
  static _pack_?: boolean;

  /**
   * List of field names whose members are promoted to the parent struct.
   *
   * Python equivalent: `_anonymous_`
   */
  static _anonymous_?: string[];

  /** Create instance with optional initial values. */
  static create<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, values?: Partial<FieldsToInstance<F>> | Buffer): ThisT;

  /** Convert a buffer or instance to a plain object. */
  static toObject<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, bufOrInstance: Buffer | Structure<F>): FieldsToInstance<F>;

  /** The underlying memory buffer. Passed automatically to native functions. */
  _buffer: Buffer;

  /** The struct definition metadata. */
  _structDef: StructDef;

  /** Read a field value by name. */
  get<K extends keyof F & string>(fieldName: K): FieldsToInstance<F>[K];

  /** Write a field value by name. */
  set<K extends keyof F & string>(fieldName: K, value: FieldsToInstance<F>[K]): void;

  /** Convert all fields to a plain JavaScript object (snapshot). */
  toObject(): FieldsToInstance<F>;

  /** Dynamic field access via Proxy. */
  [field: string]: any;
}

/**
 * Base class for Python-like union definitions.
 *
 * All fields share the same memory. The size equals the largest field.
 *
 * Python equivalent: `ctypes.Union`
 *
 * @example
 * ```javascript
 * import { Union, c_int, c_float } from 'node-ctypes';
 *
 * class IntOrFloat extends Union {
 *     static _fields_ = [["i", c_int], ["f", c_float]];
 * }
 *
 * const u = new IntOrFloat();
 * u.f = 3.14;
 * console.log(u.i);  // bit pattern of 3.14 as integer
 * ```
 *
 * @category Structures
 */
export class Union<F extends Record<string, FieldSpec> = Record<string, any>> extends Structure<F> {}

// =============================================================================
// Functions
// =============================================================================

/**
 * Load a shared library at the lowest level.
 *
 * For most use cases, prefer {@link CDLL} or {@link WinDLL}.
 *
 * @param path - Library path, or `null` for the current process
 * @returns A {@link Library} handle
 *
 * @category Library Loading
 */
export function load(path: string | null): Library;

/**
 * Create a callback that can be passed to native functions.
 *
 * The callback runs on the main thread. For thread-safe callbacks,
 * use {@link threadSafeCallback}.
 *
 * **Important:** Call `.release()` when the callback is no longer needed.
 *
 * Python equivalent: `ctypes.CFUNCTYPE(...)(func)`
 *
 * @param fn - JavaScript function to wrap
 * @param returnType - Return type of the callback
 * @param argTypes - Argument types
 * @returns A wrapper with a `.pointer` property and `.release()` method
 *
 * @example
 * ```javascript
 * import { callback, c_int32, c_void_p, readValue } from 'node-ctypes';
 *
 * const compare = callback(
 *     (a, b) => readValue(a, c_int32) - readValue(b, c_int32),
 *     c_int32, [c_void_p, c_void_p]
 * );
 * // Pass compare.pointer to qsort, etc.
 * compare.release();
 * ```
 *
 * @category Callbacks
 */
export function callback(fn: Function, returnType: AnyType, argTypes?: AnyType[]): CallbackWrapper;

/**
 * Create a thread-safe callback that can be invoked from any thread.
 *
 * **Important:** Call `.release()` when the callback is no longer needed.
 *
 * @param fn - JavaScript function to wrap
 * @param returnType - Return type of the callback
 * @param argTypes - Argument types
 *
 * @category Callbacks
 */
export function threadSafeCallback(fn: Function, returnType: AnyType, argTypes?: AnyType[]): CallbackWrapper;

/**
 * Create a function pointer type with cdecl calling convention.
 *
 * Returns a factory that takes a BigInt address and returns a callable function.
 * Used for COM vtable dispatch and other scenarios with runtime function pointers.
 *
 * Python equivalent: `ctypes.CFUNCTYPE`
 *
 * @param restype - Return type
 * @param argtypes - Argument types
 * @returns A factory function: `(address: bigint) => callable`
 *
 * @example
 * ```javascript
 * import { CDLL, CFUNCTYPE, c_size_t, c_char_p } from 'node-ctypes';
 *
 * const libc = new CDLL('msvcrt.dll');
 * const addr = libc.symbol('strlen');
 * const StrlenType = CFUNCTYPE(c_size_t, c_char_p);
 * const strlen = StrlenType(addr);
 * console.log(strlen('Hello'));  // 5n
 * ```
 *
 * @category Callbacks
 */
export function CFUNCTYPE(restype: AnyType, ...argtypes: AnyType[]): (address: bigint) => (...args: any[]) => any;

/**
 * Create a function pointer type with stdcall calling convention (Windows).
 *
 * Same as {@link CFUNCTYPE} but uses stdcall. Used for Windows API function pointers.
 *
 * Python equivalent: `ctypes.WINFUNCTYPE`
 *
 * @param restype - Return type
 * @param argtypes - Argument types
 * @returns A factory function: `(address: bigint) => callable`
 *
 * @category Callbacks
 */
export function WINFUNCTYPE(restype: AnyType, ...argtypes: AnyType[]): (address: bigint) => (...args: any[]) => any;

/**
 * Create a C string buffer (null-terminated).
 *
 * Python equivalent: `ctypes.create_string_buffer`
 *
 * @param init - Size in bytes, a string to copy, or an existing Buffer
 * @returns A Buffer containing the null-terminated string
 *
 * @example
 * ```javascript
 * const buf = create_string_buffer('Hello');
 * console.log(string_at(buf));  // "Hello"
 *
 * const buf2 = create_string_buffer(256);  // 256-byte zero-filled buffer
 * ```
 *
 * @category Memory
 */
export function create_string_buffer(init: number | string | Buffer): Buffer;

/**
 * Create a wide string buffer (wchar_t, null-terminated).
 *
 * On Windows, this is UTF-16LE. On Unix, UTF-32.
 *
 * Python equivalent: `ctypes.create_unicode_buffer`
 *
 * @param init - Size in characters, or a string to copy
 *
 * @category Memory
 */
export function create_unicode_buffer(init: number | string): Buffer;

/**
 * Read a C string from an address or buffer.
 *
 * Python equivalent: `ctypes.string_at`
 *
 * @param address - Buffer, BigInt address, or numeric address
 * @param size - Maximum bytes to read (optional, reads until null terminator)
 *
 * @category Memory
 */
export function string_at(address: Buffer | bigint | number, size?: number): string | null;

/**
 * Read a wide string from an address or buffer.
 *
 * Python equivalent: `ctypes.wstring_at`
 *
 * @param address - Buffer, BigInt address, or numeric address
 * @param size - Maximum characters to read
 *
 * @category Memory
 */
export function wstring_at(address: Buffer | bigint | number, size?: number): string | null;

/**
 * Get the address of a buffer as BigInt.
 *
 * Python equivalent: `ctypes.addressof`
 *
 * @category Memory
 */
export function addressof(ptr: Buffer | bigint | number): bigint;

/**
 * Copy memory from source to destination.
 *
 * Python equivalent: `ctypes.memmove`
 *
 * @category Memory
 */
export function memmove(dst: Buffer, src: Buffer | bigint, count: number): void;

/**
 * Fill memory with a byte value.
 *
 * Python equivalent: `ctypes.memset`
 *
 * @category Memory
 */
export function memset(dst: Buffer, value: number, count: number): void;

/**
 * Read a typed value from a buffer at a given offset.
 *
 * @param ptr - Buffer to read from
 * @param type - Type to read (e.g. `c_int32`, `c_double`)
 * @param offset - Byte offset (default 0)
 *
 * @example
 * ```javascript
 * const buf = Buffer.alloc(8);
 * buf.writeInt32LE(42, 0);
 * console.log(readValue(buf, c_int32));  // 42
 * ```
 *
 * @category Memory
 */
export function readValue(ptr: Buffer | bigint | number, type: AnyType, offset?: number): any;

/**
 * Write a typed value to a buffer at a given offset.
 *
 * @param ptr - Buffer to write to
 * @param type - Type to write (e.g. `c_int32`, `c_double`)
 * @param value - Value to write
 * @param offset - Byte offset (default 0)
 *
 * @category Memory
 */
export function writeValue(ptr: Buffer | bigint | number, type: AnyType, value: any, offset?: number): number | void;

/**
 * Get the size of a type in bytes.
 *
 * Python equivalent: `ctypes.sizeof`
 *
 * @example
 * ```javascript
 * sizeof(c_int32)   // 4
 * sizeof(c_double)  // 8
 * sizeof(c_void_p)  // 8 (on 64-bit)
 * ```
 *
 * @category Memory
 */
export function sizeof(type: AnyType | StructDef | ArrayTypeDef): number;

/**
 * Create a Buffer view of native memory at a given address.
 *
 * **Warning:** Use with caution — the buffer is not bounds-checked.
 *
 * @param address - Native memory address
 * @param size - Number of bytes
 *
 * @category Memory
 */
export function ptrToBuffer(address: bigint | number, size: number): Buffer;

/**
 * Define a struct using the functional API.
 *
 * For Python-like class syntax, use {@link Structure} instead.
 *
 * @param fields - Object mapping field names to types
 * @param options - Struct options (e.g. `{ packed: true }`)
 *
 * @example
 * ```javascript
 * const PointDef = struct({ x: c_int32, y: c_int32 });
 * const buf = PointDef.create({ x: 10, y: 20 });
 * console.log(PointDef.get(buf, 'x'));  // 10
 * ```
 *
 * @category Structures
 */
export function struct(fields: Record<string, FieldSpec>, options?: StructOptions): StructDef;

/**
 * Define a union using the functional API.
 *
 * For Python-like class syntax, use {@link Union} instead.
 *
 * @param fields - Object mapping field names to types
 *
 * @category Structures
 */
export function union(fields: Record<string, FieldSpec>): UnionDef;

/**
 * Factory that returns a Structure subclass with typed fields.
 *
 * @param fields - Object mapping field names to types
 * @param options - Struct options
 *
 * @category Structures
 */
export function defineStruct<F extends Record<string, FieldSpec>>(fields: F, options?: StructOptions): new (...args: any[]) => Structure<F>;

/**
 * Factory that returns a Union subclass with typed fields.
 *
 * @param fields - Object mapping field names to types
 *
 * @category Structures
 */
export function defineUnion<F extends Record<string, FieldSpec>>(fields: F): new (...args: any[]) => Union<F>;

/**
 * Define a fixed-size array type.
 *
 * Python equivalent: `c_int * 5`
 *
 * @param elementType - Type of each element
 * @param count - Number of elements
 *
 * @example
 * ```javascript
 * const IntArray5 = array(c_int32, 5);
 * const arr = IntArray5.create([1, 2, 3, 4, 5]);
 * console.log(arr[0]);  // 1
 * ```
 *
 * @category Structures
 */
export function array(elementType: AnyType | typeof Structure | typeof Union, count: number): ArrayTypeDef;

/**
 * Define a bit field for use in struct `_fields_`.
 *
 * @param baseType - The underlying integer type (e.g. `c_uint32`)
 * @param bits - Number of bits
 *
 * @example
 * ```javascript
 * class Flags extends Structure {
 *     static _fields_ = [
 *         ["enabled", bitfield(c_uint32, 1)],
 *         ["mode", bitfield(c_uint32, 3)],
 *     ];
 * }
 * ```
 *
 * @category Structures
 */
export function bitfield(baseType: AnyType, bits: number): BitFieldDef;

/**
 * Pass an object by reference (returns its underlying buffer).
 *
 * Python equivalent: `ctypes.byref`
 *
 * @param obj - A Buffer, SimpleCData instance, or any object with a `_buffer` property
 *
 * @category Pointers
 */
export function byref(obj: Buffer | SimpleCDataInstance | { _buffer: Buffer }): Buffer;

/**
 * Interpret a pointer as a different type.
 *
 * Python equivalent: `ctypes.cast`
 *
 * @param ptr - Buffer or BigInt address to cast
 * @param targetType - The target type
 *
 * @category Pointers
 */
export function cast(ptr: Buffer | bigint, targetType: AnyType | StructDef): Buffer | { [key: string]: any };

/**
 * Create a pointer type for a given base type.
 *
 * Python equivalent: `ctypes.POINTER`
 *
 * @param baseType - The type to point to
 * @returns A pointer type with `create()`, `fromBuffer()`, etc.
 *
 * @example
 * ```javascript
 * const IntPtr = POINTER(c_int32);
 * const buf = Buffer.alloc(4);
 * buf.writeInt32LE(42, 0);
 *
 * const p = IntPtr.fromBuffer(buf);
 * console.log(p.contents);  // 42
 * console.log(p[0]);         // 42
 * ```
 *
 * @category Pointers
 */
export function POINTER(baseType: AnyType | StructDef): PointerTypeDef;

/**
 * Create a pointer to an existing ctypes object.
 *
 * Python equivalent: `ctypes.pointer`
 *
 * @param obj - A SimpleCData instance or object with `_buffer`
 * @returns A pointer with `.contents` property and index access
 *
 * @example
 * ```javascript
 * const x = new c_int32(42);
 * const p = pointer(x);
 * console.log(p.contents);  // 42
 * p.contents = 100;
 * console.log(x.value);     // 100
 * ```
 *
 * @category Pointers
 */
export function pointer(obj: SimpleCDataInstance | { _buffer: Buffer }): SimpleCDataInstance & { contents: any; [index: number]: any };

/**
 * Get the C library errno value.
 *
 * Python equivalent: `ctypes.get_errno()`
 *
 * @category Error Handling
 */
export function get_errno(): number;

/**
 * Set the C library errno value.
 *
 * Python equivalent: `ctypes.set_errno()`
 *
 * @category Error Handling
 */
export function set_errno(value: number): void;

/**
 * Get the last Windows error code (Windows only).
 *
 * Python equivalent: `ctypes.GetLastError()`
 *
 * @category Error Handling
 */
export function GetLastError(): number;

/**
 * Set the last Windows error code (Windows only).
 *
 * @category Error Handling
 */
export function SetLastError(code: number): void;

/**
 * Format a Windows error code into a human-readable message (Windows only).
 *
 * Python equivalent: `ctypes.FormatError()`
 *
 * @param code - Error code (defaults to `GetLastError()`)
 *
 * @category Error Handling
 */
export function FormatError(code?: number): string;

/**
 * Create an Error object from a Windows error code (Windows only).
 *
 * Python equivalent: `ctypes.WinError()`
 *
 * @param code - Error code (defaults to `GetLastError()`)
 * @returns Error with `.winerror` property
 *
 * @category Error Handling
 */
export function WinError(code?: number): Error & { winerror: number };

// =============================================================================
// SimpleCData - Base class for simple C data types
// =============================================================================

/**
 * Constructor interface for simple C data types (`c_int`, `c_float`, etc.).
 *
 * Each type class has a static `_size` (byte size) and `_type` (CType identifier),
 * and instances hold a value in a buffer.
 *
 * @category Types
 */
export interface SimpleCDataConstructor {
  new (value?: any): SimpleCDataInstance;
  /** Size of this type in bytes. */
  readonly _size: number;
  /** CType numeric identifier. */
  readonly _type: number;
  /** @internal */
  readonly _isSimpleCData: true;
  /** @internal */
  _reader(buf: Buffer, offset: number): any;
  /** @internal */
  _writer(buf: Buffer, offset: number, value: any): void;
}

/**
 * Instance of a simple C data type.
 *
 * @example
 * ```javascript
 * const x = new c_int32(42);
 * console.log(x.value);    // 42
 * console.log(x._buffer);  // <Buffer 2a 00 00 00>
 * ```
 *
 * @category Types
 */
export interface SimpleCDataInstance {
  /** The current value. */
  value: any;
  /** The underlying memory buffer. */
  _buffer: Buffer;
  toString(): string;
  toJSON(): any;
  valueOf(): any;
}

// =============================================================================
// Type Aliases (Python-compatible)
// =============================================================================

/**
 * Void type — use as return type for functions that return nothing.
 *
 * Python equivalent: `None` (as restype)
 *
 * @category Types
 */
export const c_void: SimpleCDataConstructor;

/** 32-bit signed integer. Python: `ctypes.c_int` @category Types */
export const c_int: SimpleCDataConstructor;
/** 32-bit unsigned integer. Python: `ctypes.c_uint` @category Types */
export const c_uint: SimpleCDataConstructor;
/** 8-bit signed integer. Python: `ctypes.c_int8` @category Types */
export const c_int8: SimpleCDataConstructor;
/** 8-bit unsigned integer. Python: `ctypes.c_uint8` @category Types */
export const c_uint8: SimpleCDataConstructor;
/** 16-bit signed integer. Python: `ctypes.c_int16` @category Types */
export const c_int16: SimpleCDataConstructor;
/** 16-bit unsigned integer. Python: `ctypes.c_uint16` @category Types */
export const c_uint16: SimpleCDataConstructor;
/** 32-bit signed integer. Python: `ctypes.c_int32` @category Types */
export const c_int32: SimpleCDataConstructor;
/** 32-bit unsigned integer. Python: `ctypes.c_uint32` @category Types */
export const c_uint32: SimpleCDataConstructor;
/** 64-bit signed integer (BigInt). Python: `ctypes.c_int64` @category Types */
export const c_int64: SimpleCDataConstructor;
/** 64-bit unsigned integer (BigInt). Python: `ctypes.c_uint64` @category Types */
export const c_uint64: SimpleCDataConstructor;
/** 32-bit float. Python: `ctypes.c_float` @category Types */
export const c_float: SimpleCDataConstructor;
/** 64-bit double. Python: `ctypes.c_double` @category Types */
export const c_double: SimpleCDataConstructor;
/** 8-bit character. Python: `ctypes.c_char` @category Types */
export const c_char: SimpleCDataConstructor;
/** Pointer to null-terminated string. Python: `ctypes.c_char_p` @category Types */
export const c_char_p: SimpleCDataConstructor;
/** Wide character. Python: `ctypes.c_wchar` @category Types */
export const c_wchar: SimpleCDataConstructor;
/** Pointer to null-terminated wide string. Python: `ctypes.c_wchar_p` @category Types */
export const c_wchar_p: SimpleCDataConstructor;
/** Void pointer. Python: `ctypes.c_void_p` @category Types */
export const c_void_p: SimpleCDataConstructor;
/** Boolean (1 byte). Python: `ctypes.c_bool` @category Types */
export const c_bool: SimpleCDataConstructor;
/** Platform-dependent size type (BigInt). Python: `ctypes.c_size_t` @category Types */
export const c_size_t: SimpleCDataConstructor;
/** Platform-dependent signed long. Python: `ctypes.c_long` @category Types */
export const c_long: SimpleCDataConstructor;
/** Platform-dependent unsigned long. Python: `ctypes.c_ulong` @category Types */
export const c_ulong: SimpleCDataConstructor;

/** Alias for `c_int8`. Python: `ctypes.c_byte` @category Types */
export const c_byte: SimpleCDataConstructor;
/** Alias for `c_uint8`. Python: `ctypes.c_ubyte` @category Types */
export const c_ubyte: SimpleCDataConstructor;
/** Alias for `c_int16`. Python: `ctypes.c_short` @category Types */
export const c_short: SimpleCDataConstructor;
/** Alias for `c_uint16`. Python: `ctypes.c_ushort` @category Types */
export const c_ushort: SimpleCDataConstructor;
/** Alias for `c_int64`. Python: `ctypes.c_longlong` @category Types */
export const c_longlong: SimpleCDataConstructor;
/** Alias for `c_uint64`. Python: `ctypes.c_ulonglong` @category Types */
export const c_ulonglong: SimpleCDataConstructor;

/**
 * Base class for creating custom simple C data types.
 * @category Types
 */
export const SimpleCData: SimpleCDataConstructor;

// =============================================================================
// Constants
// =============================================================================

/**
 * Size of a pointer in bytes (4 on 32-bit, 8 on 64-bit).
 * @category Constants
 */
export const POINTER_SIZE: number;

/**
 * Size of `wchar_t` in bytes (2 on Windows, 4 on Unix).
 * @category Constants
 */
export const WCHAR_SIZE: number;

/**
 * Null pointer constant.
 * @category Constants
 */
export const NULL: null;
