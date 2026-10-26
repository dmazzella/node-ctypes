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
 * console.log(p.contents.value);  // 42
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
  /** `char` as a 1-byte character (Python `c_char`). */
  readonly CHAR: number;
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

/**
 * A {@link Structure} or {@link Union} subclass used as a type
 * (e.g. `class Point extends Structure { ... }` passed as `Point`).
 * @category Types
 */
export type StructureClass = abstract new (...args: any[]) => Structure<any>;

/**
 * Any type accepted in a function signature (`argtypes` / `restype`):
 * {@link AnyType}, a Structure/Union class (struct by value), a
 * {@link POINTER} type, an {@link array} type or a {@link CFUNCTYPE} prototype
 * (function pointer).
 * @category Types
 */
export type FFIType = AnyType | StructureClass | PointerTypeDef | ArrayTypeDef | FuncPtrFactory;

// =============================================================================
// Library & Function
// =============================================================================

/**
 * Version information for the native module.
 *
 * @example
 * ```javascript
 * import { Version } from 'node-ctypes';
 * console.log(Version.toString());  // "2.4.0"
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
  /** Typed overload: narrows args/return when argTypes is a literal tuple. */
  func<TRet extends FFIType | null, const TArgs extends readonly FFIType[]>(name: string, returnType: TRet, argTypes: TArgs, options?: FunctionOptions): NativeFFIFunction<TArgs, TRet>;
  func(name: string, returnType: FFIType | null, argTypes?: FFIType[], options?: FunctionOptions): NativeFFIFunction;

  /**
   * Create a native callback. Note the argument order (return type, argument
   * types, function), which differs from {@link callback} and {@link CDLL.callback}.
   */
  callback(returnType: AnyType, argTypes: AnyType[], fn: Function): Callback;

  /**
   * Get the address of a symbol in the library.
   * @param name - Symbol name
   * @returns Address as BigInt
   */
  symbol(name: string): bigint;

  /**
   * Logically close the library. Functions obtained from it
   * throw when called afterwards. Throws while a call to one of its
   * functions is in progress (from a callback, or a pending `callAsync()`).
   * Existing `in_dll()` views and dependent memory remain valid and defer
   * native handle release until their last owner is collected.
   * Physical unloading depends on the OS loader; musl keeps modules resident.
   */
  close(): void;

  /** Library file path. */
  readonly path: string;

  /** Whether the logical library handle is open (not a physical-unload probe). */
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
 * A callable FFI function returned by {@link CDLL.func}.
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
  readonly _as_parameter_: bigint;

  /**
   * Error checking callback, called after every invocation (`null` when not set).
   * @see {@link ErrcheckCallback}
   */
  errcheck: ErrcheckCallback | null;
}

/**
 * Low-level native function handle returned by {@link Library.func}.
 *
 * Unlike the functions returned by {@link CDLL.func}, it is not directly
 * callable: invoke it with {@link NativeFFIFunction.call | call()}.
 *
 * @category Library Loading
 */
export interface NativeFFIFunction<TArgs extends readonly FFIType[] = FFIType[], TRet extends FFIType | null = FFIType> {
  /** Call the native function synchronously. */
  call(...args: FFIArgs<TArgs>): FFIReturn<TRet>;

  /** Call the native function asynchronously on a worker thread. */
  callAsync(...args: FFIArgs<TArgs>): Promise<FFIReturn<TRet>>;

  /** Set (or clear with `null`) the hook captured at each call's entry, including async calls. */
  setErrcheck(callback: NativeErrcheckCallback<TArgs, TRet> | null): void;

  /** `GetLastError()` (Windows) or `errno` captured after the last call, with `use_last_error`. */
  getCapturedLastError(): number;

  /** `errno` captured after the last call, with `use_errno`. */
  getCapturedErrno(): number;

  /** The function name, or its hex address for raw function pointers. */
  readonly name: string;

  /** The function address as BigInt. */
  readonly address: bigint;
}

/**
 * Low-level errcheck: `func` is the native handle, invoked with `.call()`,
 * not a directly callable JavaScript function.
 * @category Library Loading
 */
export type NativeErrcheckCallback<TArgs extends readonly FFIType[] = FFIType[], TRet extends FFIType | null = FFIType> = (result: any, func: NativeFFIFunction<TArgs, TRet>, args: any[]) => any;

/**
 * Strongly-typed FFI function returned by `CDLL.func` when the
 * argument types and return type are given as a literal tuple and constant respectively.
 *
 * Args and return are narrowed from the supplied CType constructors.
 * Falls back to the untyped `FFIFunction` when types cannot be inferred.
 *
 * @category Library Loading
 */
export interface TypedFFIFunction<TArgs extends readonly FFIType[], TRet extends FFIType | null> {
  (...args: FFIArgs<TArgs>): FFIReturn<TRet>;
  callAsync(...args: FFIArgs<TArgs>): Promise<FFIReturn<TRet>>;
  readonly funcName: string;
  readonly address: bigint;
  readonly _as_parameter_: bigint;
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
/**
 * Options passed to the CDLL/WinDLL/OleDLL constructor.
 *
 * @category Library Loading
 */
export interface LibraryOptions {
  /**
   * `dlopen` flags combined with `RTLD_NOW` (e.g. {@link RTLD_GLOBAL}).
   * Ignored on Windows. Default: {@link DEFAULT_MODE}.
   *
   * Python ctypes parity: the `mode` argument of `CDLL(name, mode)`.
   */
  mode?: number;

  /**
   * `LoadLibraryExW` flags (Windows only). Default: `LOAD_LIBRARY_SEARCH_DEFAULT_DIRS`,
   * plus `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR` (with the path made absolute) when the
   * name contains a path separator.
   *
   * Python ctypes parity: the `winmode` argument of `CDLL(name, winmode=...)`.
   */
  winmode?: number;

  /**
   * Maximum size of the internal function cache. Default: 1000.
   */
  cacheSize?: number;

  /**
   * If true, each call through this library snapshots `GetLastError()`
   * immediately after `ffi_call` returns, so subsequent JS code cannot
   * clobber it before the user reads it via {@link CDLL.get_last_error}.
   *
   * Python ctypes parity: `use_last_error=True` on CDLL/WinDLL.
   */
  use_last_error?: boolean;

  /**
   * If true, each call through this library snapshots `errno` immediately
   * after `ffi_call` returns. Read back via {@link CDLL.get_errno}.
   *
   * Python ctypes parity: `use_errno=True` on CDLL.
   */
  use_errno?: boolean;
}

export class CDLL {
  /**
   * @param path - Path to the shared library, or `null` to load the current process
   * @param options - `dlopen` mode (as Python's `CDLL(name, mode)`) or library
   *   settings (mode, cache size, use_last_error, use_errno)
   */
  constructor(path: string | null, options?: number | LibraryOptions);

  /**
   * Get a callable function from the library.
   *
   * @param name - Function name in the library
   * @param returnType - Return type (e.g. `c_int`, `c_double`, `c_void`)
   * @param argTypes - Argument types array
   * @param options - Calling convention options
   * @returns A callable function
   */
  /** Typed overload: narrows args/return when argTypes is a literal tuple. */
  func<TRet extends FFIType | null, const TArgs extends readonly FFIType[]>(name: string, returnType: TRet, argTypes: TArgs, options?: FunctionOptions): TypedFFIFunction<TArgs, TRet>;
  func(name: string): TypedFFIFunction<readonly FFIType[], typeof c_int32>;
  func(name: string, returnType: FFIType | null, argTypes?: FFIType[], options?: FunctionOptions): FFIFunction;

  /**
   * Get the address of a symbol.
   * @param name - Symbol name
   * @returns Address as BigInt
   */
  symbol(name: string): bigint;

  /**
   * Close the library and clear the function cache. Functions obtained from
   * it throw when called afterwards. Throws while a call to one of its
   * functions is in progress (from a callback, or a pending `callAsync()`).
   * Existing `in_dll()` views defer native handle release until their dependent
   * memory is collected, but new calls and symbol lookups are rejected.
   * Physical unloading depends on the OS loader; musl keeps modules resident.
   */
  close(): void;

  /** Close the library at the end of a `using` block. */
  [Symbol.dispose](): void;

  /**
   * Create a native callback bound to this library's context.
   * Call `release()` when it is no longer needed.
   */
  callback<TRet extends CallbackRestype, const TArgs extends readonly FFIType[] = readonly []>(fn: (...args: CallbackArgs<TArgs>) => CallbackResult<TRet>, returnType: TRet, argTypes?: TArgs): Callback;

  /**
   * Read the snapshotted `GetLastError()` (Windows) or `errno` from the most
   * recent call on this library. Requires `use_last_error: true` at
   * construction.
   *
   * Python ctypes parity: `ctypes.get_last_error()` (library-scoped variant).
   */
  get_last_error(): number;

  /**
   * Read the snapshotted `errno` from the most recent call on this library.
   * Requires `use_errno: true` at construction.
   *
   * Python ctypes parity: `ctypes.get_errno()` (library-scoped variant).
   */
  get_errno(): number;

  /** Library file path. */
  readonly path: string;

  /** Whether the logical handle is open, independently of physical module residency. */
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
  argtypes: FFIType[];

  /** Return type (`null` for `void`, as Python's `None`). Set before calling. */
  restype: FFIType | null;

  /** Optional error checking callback (`null` when not set). */
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
  constructor(path: string, options?: number | LibraryOptions);
}

/**
 * Load a Windows library whose functions return `HRESULT`. Any function with
 * `restype = HRESULT` is automatically wrapped so that a negative return value
 * throws an Error with `.hresult` / `.winerror` attached.
 *
 * Python equivalent: `ctypes.OleDLL`
 *
 * @example
 * ```javascript
 * import { OleDLL, HRESULT, c_wchar_p, c_void_p } from 'node-ctypes';
 *
 * const ole32 = new OleDLL('ole32.dll');
 * const CLSIDFromString = ole32.func('CLSIDFromString', HRESULT, [c_wchar_p, c_void_p]);
 * // Throws automatically on HRESULT < 0
 * CLSIDFromString('{00000000-0000-0000-0000-000000000000}', Buffer.alloc(16));
 * ```
 *
 * @category Library Loading
 */
export class OleDLL extends WinDLL {
  constructor(path: string, options?: LibraryOptions);
}

/**
 * `HRESULT` return type marker. Explicit use as restype enables failure checks
 * for all library loaders and prototype callers, before errcheck.
 *
 * Python equivalent: `ctypes.HRESULT`
 *
 * @category Windows API
 */
export const HRESULT: SimpleCDataConstructor<"int32"> & { _isHResult: true };

/**
 * Lazy-loading namespace for CDLL libraries. Attribute access auto-loads on
 * first use and caches the instance.
 *
 * Python equivalent: `ctypes.cdll`
 *
 * @example
 * ```javascript
 * import { cdll, c_uint32 } from 'node-ctypes';
 * const strlen = cdll.msvcrt.func('strlen', c_uint32, [c_void_p]);
 * ```
 *
 * @category Library Loading
 */
export const cdll: LibraryNamespace<CDLL>;

/**
 * Lazy library namespace: attribute access loads (and caches) the library,
 * `LoadLibrary(name)` always creates a new instance.
 *
 * Python equivalent: `ctypes.LibraryLoader` instances (`cdll`, `windll`, ...)
 *
 * @category Library Loading
 */
export type LibraryNamespace<T extends CDLL> = { [libName: string]: T } & {
  /** Load a library (new instance each time). Python: `cdll.LoadLibrary(name)`. */
  LoadLibrary(name: string | null, options?: number | LibraryOptions): T;
};

/**
 * Create a lazy library namespace for a DLL class.
 *
 * Python equivalent: `ctypes.LibraryLoader(dlltype)`
 *
 * @example
 * ```javascript
 * const mydll = new LibraryLoader(CDLL);
 * const libm = mydll.LoadLibrary(find_library("m"));
 * ```
 *
 * @category Library Loading
 */
export const LibraryLoader: new <T extends CDLL>(dlltype: new (path: string, ...args: any[]) => T) => LibraryNamespace<T>;

/**
 * Lazy-loading namespace for WinDLL libraries (Windows only).
 * Undefined on non-Windows platforms.
 *
 * Python equivalent: `ctypes.windll`
 *
 * @category Library Loading
 */
export const windll: LibraryNamespace<WinDLL> | undefined;

/**
 * Lazy-loading namespace for OleDLL libraries (Windows only).
 * Undefined on non-Windows platforms.
 *
 * Python equivalent: `ctypes.oledll`
 *
 * @category Library Loading
 */
export const oledll: LibraryNamespace<OleDLL> | undefined;

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
  readonly _callback: Callback;
  /** The callback function pointer, passable to native functions. */
  readonly pointer: bigint;

  /** Same as `pointer`: lets the callback be passed directly as an argument. */
  readonly _as_parameter_: bigint;

  /** Release the callback and free native resources. Must be called when done. */
  release(): void;

  /** Release the callback at the end of a `using` block. */
  [Symbol.dispose](): void;
}

/**
 * Wrapper returned by {@link threadSafeCallback}.
 * @category Callbacks
 */
export interface ThreadSafeCallbackWrapper extends CallbackWrapper {
  readonly _callback: ThreadSafeCallback;
  /** Keep the Node.js event loop alive until released (the default). */
  ref(): this;

  /**
   * Do not keep the Node.js event loop alive: the process can exit while the
   * callback exists. Calls from other threads are delivered while it runs.
   */
  unref(): this;
}

/**
 * A CFUNCTYPE/WINFUNCTYPE callback that is also a typed native caller.
 * @category Callbacks
 */
export type CallableCallback<TArgs extends readonly FFIType[], TRet extends FFIType | null> = TypedFFIFunction<TArgs, TRet> & CallbackWrapper;

/**
 * Native callback class for main-thread callbacks.
 * @category Callbacks
 */
export class Callback {
  constructor(fn: Function, returnType: AnyType, argTypes?: AnyType[]);
  /** The callback function pointer, passable to native functions. */
  readonly pointer: bigint;
  /** Return the function pointer, throwing if the callback has been released. */
  getPointer(): bigint;
  /** Release the callback and free native resources. Must be called when done. */
  release(): void;
  /**
   * Handler called with the error message when the JS function throws.
   * Without a handler the error is reported with `process.emitWarning`.
   */
  setErrorHandler(handler: (message: string) => void): void;
  /** Message of the last exception thrown by the JS function, or `null`. */
  getLastError(): string | null;
}

/**
 * Thread-safe callback that can be invoked from any thread.
 *
 * Use this when native code may call the callback from a thread other than the main thread.
 *
 * @category Callbacks
 */
export class ThreadSafeCallback extends Callback {
  /** Keep the Node.js event loop alive until released (the default). */
  ref(): this;
  /** Do not keep the Node.js event loop alive. */
  unref(): this;
}

// =============================================================================
// Structures
// =============================================================================

/**
 * Metadata for a single field in a struct or union.
 * @category Structures
 */
export interface FieldDef {
  name: string;
  type: AnyType | StructDef | ArrayTypeDef | BitFieldDef | PointerTypeDef;
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
export interface StructDef<F extends Record<string, FieldSpec> = Record<string, any>> {
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
  create(values?: FieldsInput<F>): Buffer;
  /** Read a field value from a buffer. */
  get<K extends keyof F & string>(buf: Buffer, fieldName: K): FieldValue<F, K>;
  /** Write a field value to a buffer. */
  set<K extends keyof F & string>(buf: Buffer, fieldName: K, value: FieldArg<F, K>): void;
  /** Convert all fields to a plain JavaScript object. */
  toObject(buf: Buffer): FieldsObject<F>;
  /** Get a view of a nested struct's buffer region. */
  getNestedBuffer(buf: Buffer, fieldName: string): Buffer;
}

/**
 * One entry of `_fields_`: `[name, type]` or `[name, type, bits]` for bit fields.
 * The loose element form lets `static _fields_ = [["x", c_int]]` compile
 * without `as const`, as written in Python.
 * @category Structures
 */
export type FieldEntry = readonly [string, FieldSpec] | readonly [string, FieldSpec, number] | ReadonlyArray<string | number | FieldSpec>;

/** @category Structures */
export type FieldSpec = AnyType | StructDef | ArrayTypeDef | BitFieldDef | AnonymousField | PointerTypeDef | StructureClass | FuncPtrFactory;

/**
 * Map a field/arg type (CType constructor, struct, array, bitfield, pointer) to its
 * JavaScript **return** representation (what a read produces).
 *
 * @category Types
 */
export type JsFromCType<T> =
  T extends SimpleCDataConstructor<infer Tag>
    ? T extends { prototype: infer Instance }
      ? IsAny<Instance> extends true
        ? JsFromTag<Tag>
        : Instance
      : JsFromTag<Tag>
    : T extends BitFieldDef
      ? number
      : T extends PointerTypeDef<infer B>
        ? PointerInstance<B> | null
        : T extends FuncPtrFactory
          ? ((...args: any[]) => any) | null
          : T extends StructureClass
            ? InstanceType<T>
            : T extends StructDef<infer F>
              ? FieldsObject<F>
              : T extends ArrayTypeDef<infer E>
                ? CharArrayValue<E, ArrayInstance<E>>
                : any;

/**
 * Map a field/arg type to accepted JavaScript **input** types (for writes / function args).
 * Superset of `JsFromCType` (e.g. accepts struct-proxy objects with `_buffer`).
 *
 * @category Types
 */
export type JsArgFromCType<T> =
  T extends SimpleCDataConstructor<infer Tag>
    ? JsArgFromTag<Tag>
    : T extends BitFieldDef
      ? number
      : T extends PointerTypeDef
        ? PointerInstance | Buffer | bigint | null | { readonly _buffer: Buffer }
        : T extends FuncPtrFactory
          ? { readonly _as_parameter_: unknown } | bigint | null
          : T extends StructDef
            ? Buffer | { _buffer: Buffer } | Record<string, any>
            : T extends UnionDef
              ? Buffer | { _buffer: Buffer } | Record<string, any>
              : T extends ArrayTypeDef<infer E>
                ? Buffer | ReadonlyArray<any> | CharArrayValue<E, never>
                : any;

type FieldsToInstance<F extends Record<string, FieldSpec>> = {
  [K in keyof F]: JsFromCType<F[K]>;
};

/** `true` when `T` is `any`. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** Field values of a definition; `any` when the fields are not statically known. */
type FieldsObject<F extends Record<string, FieldSpec>> = string extends keyof F ? Record<string, any> : FieldsToInstance<F>;

/** Initial values accepted by `create()`. */
type FieldsInput<F extends Record<string, FieldSpec>> = string extends keyof F ? Record<string, any> : { [K in keyof F]?: JsArgFromCType<F[K]> };

/** Value read from field `K`. */
type FieldValue<F extends Record<string, FieldSpec>, K extends keyof F> = string extends keyof F ? any : JsFromCType<F[K]>;

/** Value accepted when writing field `K`. */
type FieldArg<F extends Record<string, FieldSpec>, K extends keyof F> = string extends keyof F ? any : JsArgFromCType<F[K]>;

/**
 * Numeric elements and scalar subclass instances are typed; other element
 * representations retain the existing permissive array API.
 */
type ArrayElement<E> = IsAny<E> extends true ? any : JsFromCType<E> extends SimpleCDataInstance<unknown> ? JsFromCType<E> : JsFromCType<E> extends number ? number : any;

/** Element accepted when writing an array of `E`. */
type ArrayElementArg<E> = IsAny<E> extends true ? any : E extends StructureClass ? Buffer | Record<string, any> : JsArgFromCType<E>;

/** Value read through a pointer to `T` (`p[i]`): the value for simple types, a live instance for structures. */
type PointerValue<T> = IsAny<T> extends true ? any : T extends StructureClass ? InstanceType<T> : JsFromCType<T>;

/** `p.contents`: a live instance on the pointed memory (Python parity). */
type PointerContents<T> =
  IsAny<T> extends true
    ? any
    : T extends SimpleCDataConstructor<infer Tag>
      ? T extends { prototype: infer Instance }
        ? IsAny<Instance> extends true
          ? SimpleCDataInstance<JsFromTag<Tag>>
          : Instance
        : SimpleCDataInstance<JsFromTag<Tag>>
      : T extends StructureClass
        ? InstanceType<T>
        : JsFromCType<T>;

/** `string` for `c_char`/`c_wchar` arrays (read as text, as Python), otherwise `Else`. */
type CharArrayValue<E, Else> = IsAny<E> extends true ? Else : [E] extends [SimpleCDataConstructor<"char">] ? string : [E] extends [SimpleCDataConstructor<"wchar">] ? string : Else;

/**
 * Array instance: a Buffer with index access; the Array methods (`slice`, `map`,
 * `includes`, ...) work on the elements, as Python's sequence operations.
 * `c_char` arrays also expose `.value`/`.raw` and `c_wchar` arrays `.value`.
 * @category Structures
 */
export type ArrayInstance<E = any> = Omit<Buffer, ElementMethod | "length" | "toJSON" | number> &
  (IsAny<E> extends true
    ? ArrayProxy<any>
    : [E] extends [SimpleCDataConstructor<"char">]
      ? Omit<ArrayProxy<ArrayElement<E>>, "slice"> & CharBufferValue & CharSlice
      : [E] extends [SimpleCDataConstructor<"wchar">]
        ? Omit<ArrayProxy<ArrayElement<E>>, "slice"> & WideBufferValue & CharSlice
        : ArrayProxy<ArrayElement<E>>);

/** Array methods that work on the elements of an array instance; the Buffer methods (`readInt32LE`, `subarray`, ...) work on the bytes. */
type ElementMethod = Exclude<keyof ArrayProxy, number | typeof Symbol.iterator | "length" | "toJSON">;

/** `c_char` / `c_wchar` arrays: a slice is a string (Python: bytes / str). */
interface CharSlice {
  slice(start?: number, end?: number): string;
}

/**
 * Text accessors of `c_char` buffers (arrays, {@link create_string_buffer}).
 * @category Memory
 */
export interface CharBufferValue {
  /** Bytes up to the first NUL, decoded as UTF-8. Python: `.value`. */
  get value(): string;
  set value(v: string | Uint8Array);
  /** All bytes. Python: `.raw`. */
  get raw(): Buffer;
  set raw(v: string | Uint8Array);
}

/**
 * Text accessor of `c_wchar` buffers (arrays, {@link create_unicode_buffer}).
 * @category Memory
 */
export interface WideBufferValue {
  /** Characters up to the first NUL. Python: `.value`. */
  get value(): string;
  set value(v: string);
}

type ArgsFromCTypes<TArgs extends readonly any[]> = {
  [K in keyof TArgs]: JsArgFromCType<TArgs[K]>;
};

/** JS argument accepted for a function parameter of type `T`. */
type JsArgFromFFIType<T> =
  { readonly _as_parameter_: unknown } | (T extends StructureClass ? Buffer | { _buffer: Buffer } | Record<string, any> : T extends ArrayTypeDef<infer E> ? ArrayInstance<E> | ArrayBufferView | ArrayBuffer : JsArgFromCType<T>);

/** Function arguments for `argtypes` `TArgs` (`any[]` when not a literal tuple). */
type FFIArgs<TArgs extends readonly any[]> = FFIType[] extends TArgs ? any[] : { [K in keyof TArgs]: JsArgFromFFIType<TArgs[K]> };

/**
 * JS value returned by a function with `restype` `T`. As in Python, a
 * `POINTER(T)` restype returns a {@link PointerInstance}, a {@link CFUNCTYPE}
 * restype a callable function (`null` for NULL) and a Structure/Union class an
 * instance of that class.
 */
type FFIReturn<T> = FFIType extends T ? any : T extends null ? undefined : T extends { _check_retval_: (...args: never[]) => infer Result } ? Result : T extends StructureClass ? InstanceType<T> : JsFromCType<T>;

/**
 * A union type definition created by the {@link union} function.
 *
 * All fields share the same memory region. The total size equals the
 * size of the largest field.
 *
 * @category Structures
 */
export interface UnionDef<F extends Record<string, FieldSpec> = Record<string, any>> extends StructDef<F> {
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
 * Python equivalent: `c_int * 5`. Call it (with or without `new`) with the
 * initial elements, as Python's `(c_int * 5)(1, 2, 3)`.
 *
 * @example
 * ```javascript
 * const IntArray5 = array(c_int32, 5);
 * const arr = IntArray5(1, 2, 3, 4, 5);  // or IntArray5.create([1, 2, 3, 4, 5])
 * console.log(arr[0]);  // 1
 * ```
 *
 * @category Structures
 */
export interface ArrayTypeDef<E = any> {
  /** Create an array initialized with the given elements (Python: `(c_int * 3)(1, 2, 3)`). */
  (...values: ArrayElementArg<E>[]): ArrayInstance<E>;
  /** Create an array initialized with the given elements. */
  new (...values: ArrayElementArg<E>[]): ArrayInstance<E>;
  /** Element type. */
  readonly elementType: AnyType | StructureClass | ArrayTypeDef | PointerTypeDef | FuncPtrFactory;
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
  /**
   * Create a new array, optionally initialized with values (a string writes
   * its char codes). Returns a Proxy with index access.
   */
  create(values?: ReadonlyArray<ArrayElementArg<E>> | string): ArrayInstance<E>;
  /** Wrap an existing buffer as an array with index access. */
  wrap(buffer: Buffer): ArrayInstance<E>;
  /**
   * Array sharing the memory of `source` from `offset` (Python:
   * `(c_int * 3).from_buffer(source, offset)`).
   */
  from_buffer(source: Buffer | Uint8Array | { _buffer: Buffer }, offset?: number): ArrayInstance<E>;
  /** Array with a copy of the bytes of `source` from `offset` (Python: `from_buffer_copy`). */
  from_buffer_copy(source: Buffer | Uint8Array | { _buffer: Buffer }, offset?: number): ArrayInstance<E>;
  /**
   * Array on the memory at `address` (Python: `(c_int * 3).from_address(address)`).
   * Its `_buffer` is a Buffer over that memory, as Python's
   * `memoryview((c_char * n).from_address(address))`; where
   * {@link EXTERNAL_BUFFERS} is `false` it is a copy kept in sync by the
   * array's element accesses.
   */
  from_address(address: bigint | number): ArrayInstance<E>;
}

/**
 * Proxy interface for array index access and iteration.
 * @category Structures
 */
export interface ArrayProxy<T = any> extends Pick<
  T[],
  | "at"
  | "copyWithin"
  | "entries"
  | "every"
  | "fill"
  | "filter"
  | "find"
  | "findIndex"
  | "findLast"
  | "findLastIndex"
  | "forEach"
  | "includes"
  | "indexOf"
  | "join"
  | "keys"
  | "lastIndexOf"
  | "map"
  | "reduce"
  | "reduceRight"
  | "reverse"
  | "slice"
  | "some"
  | "sort"
  | "toLocaleString"
  | "toReversed"
  | "toSorted"
  | "values"
  | "with"
> {
  [index: number]: T;
  [Symbol.iterator](): Iterator<T>;
  /** Number of elements (Python `len(arr)`); the size in bytes is `byteLength`. */
  readonly length: number;
  /** The elements, for `JSON.stringify`. */
  toJSON(): T[];
  /**
   * The Buffer of the array: for an array on native memory
   * ({@link ArrayTypeDef.from_address}) a Buffer over that memory, as
   * Python's `memoryview()` (a copy where {@link EXTERNAL_BUFFERS} is `false`).
   */
  readonly _buffer: Buffer;
}

/**
 * Options for struct creation.
 * @category Structures
 */
export interface StructOptions {
  /** If `true`, disables padding between fields (as `pack: 1`). */
  packed?: boolean;
  /** Maximum field alignment in bytes, as Python's `_pack_`. */
  pack?: number | boolean | bigint | string | null;
  /** Bit field layout, as Python's `_layout_` (`"ms"` with `pack`, otherwise the platform's). */
  layout?: "gcc-sysv" | "ms";
  /** Minimum alignment in bytes, as Python's `_align_`. */
  align?: number;
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
 * A pointer instance created by {@link PointerTypeDef.create}, {@link PointerTypeDef.fromBuffer},
 * or {@link PointerTypeDef.fromAddress}.
 *
 * Supports Python ctypes-compatible `.contents` property and C-like `[index]` pointer arithmetic.
 *
 * @example
 * ```javascript
 * const IntPtr = POINTER(c_int32);
 * const p = IntPtr.fromBuffer(buf);
 * console.log(p.contents.value);  // dereferenced value (like *p in C)
 * console.log(p[0]);        // same as p.contents
 * console.log(p[5]);        // pointer arithmetic (like p[5] in C)
 * ```
 *
 * @example Access a native array via pointer from a struct field
 * ```javascript
 * // When a struct has a c_void_p field pointing to an array of structs:
 * const pValues = POINTER(ADSVALUE).fromAddress(col.pADsValues);
 * for (let i = 0; i < col.dwNumValues; i++) {
 *   console.log(pValues[i].dwType);  // struct view at pValues + i * sizeof(ADSVALUE)
 * }
 * ```
 *
 * @category Pointers
 */
export interface PointerInstance<T = any> {
  /** The pointer type definition this instance was created from. */
  readonly _pointerType: PointerTypeDef<T>;
  /** The base type this pointer points to. */
  readonly _baseType: AnyType | StructDef;
  /** Size of the pointed-to type in bytes. */
  readonly _baseSize: number;

  /** Raw memory address as BigInt. */
  readonly address: bigint;

  /**
   * The pointed object, as Python's `p.contents`: a live instance on the
   * pointed memory (`p.contents.value` for simple types, `p.contents.x` for
   * structures). Assigning an instance re-points the pointer to it; assigning
   * a plain value writes it.
   *
   * @example
   * ```javascript
   * const p = POINTER(c_int32).fromBuffer(buf);
   * console.log(p.contents.value);  // read value
   * p.contents = 42;                // write value
   * p.contents = new c_int32(7);    // re-point
   * ```
   */
  get contents(): PointerContents<T>;
  set contents(value: PointerContents<T> | JsArgFromCType<T>);

  /** The underlying buffer (if created from a buffer), or null. */
  readonly _buffer: Buffer | null;

  /** Alias for the contents getter. */
  deref(): PointerContents<T>;

  /**
   * Set pointer to a new target (buffer or address).
   * @param value - Buffer to point to, or BigInt/number address
   */
  set(value: Buffer | bigint | number): void;

  /** Check if this is a NULL pointer. */
  readonly isNull: boolean;

  /** Get pointer as an 8-byte buffer containing the address. */
  toBuffer(): Buffer;

  toString(): string;

  /**
   * Pointer arithmetic — access elements at offset from the pointer.
   *
   * `p[i]` reads `sizeof(baseType)` bytes at `address + i * sizeof(baseType)`,
   * exactly like C pointer indexing.
   *
   * @example
   * ```javascript
   * const arr = POINTER(c_int32).fromAddress(arrayAddr);
   * arr[0]       // first element
   * arr[5]       // sixth element
   * arr[2] = 99; // write to third element
   * ```
   */
  [index: number]: PointerValue<T>;

  /**
   * Return a new pointer offset by `n` elements (not bytes), matching C's
   * `ptr + n`. The pointer keeps the same element type.
   */
  add(n: number): PointerInstance<T>;

  /**
   * Read `end - start` consecutive elements into a JS array, analogous to
   * Python's `p[start:end]` on a POINTER(T).
   */
  slice(start: number, end: number): PointerValue<T>[];
}

/**
 * A pointer type created by {@link POINTER}.
 *
 * @example
 * ```javascript
 * const IntPtr = POINTER(c_int32);
 *
 * // From existing buffer
 * const p = IntPtr.fromBuffer(buf);
 * console.log(p.contents.value);  // 42
 * console.log(p[0]);        // 42
 *
 * // From raw address (e.g., from a struct's c_void_p field)
 * const pValues = POINTER(MyStruct).fromAddress(someStruct.pData);
 * console.log(pValues[0].field1);
 * ```
 *
 * @category Pointers
 */
export interface PointerTypeDef<T = any> {
  /** The resolved base type, including for lazy pointer declarations. */
  readonly _pointerTo: T;
  /** Python ctypes alias for the resolved base type. */
  readonly _type_: T;
  /** Size of the pointed-to type. */
  readonly _baseSize: number;
  /** Pointer size (always 8 on 64-bit). */
  readonly size: number;

  /**
   * Create a NULL pointer instance.
   *
   * @example
   * ```javascript
   * const p = POINTER(c_int32).create();
   * console.log(p.isNull);  // true
   * ```
   */
  create(value?: Buffer | bigint | number): PointerInstance<T>;

  /**
   * Create a pointer from an existing buffer (points to that buffer's memory).
   *
   * @param targetBuf - Buffer to point to
   *
   * @example
   * ```javascript
   * const buf = Buffer.alloc(4);
   * buf.writeInt32LE(42, 0);
   * const p = POINTER(c_int32).fromBuffer(buf);
   * console.log(p.contents.value);  // 42
   * ```
   */
  fromBuffer(targetBuf: Buffer): PointerInstance<T>;

  /**
   * Create a pointer from a raw memory address.
   *
   * Use this to create typed access to native memory, especially useful with
   * `c_void_p` struct fields that point to arrays of structs.
   *
   * @param address - Memory address as BigInt or number
   *
   * @example
   * ```javascript
   * // Access array of structs from a c_void_p field
   * const pValues = POINTER(ADSVALUE).fromAddress(col.pADsValues);
   * for (let i = 0; i < col.dwNumValues; i++) {
   *   console.log(pValues[i].dwType);
   * }
   * ```
   */
  fromAddress(address: bigint | number): PointerInstance<T>;

  /**
   * @deprecated Use pointer instance `.contents` instead.
   * Legacy API: Dereferences a pointer buffer.
   */
  deref(ptrBuf: Buffer): bigint | null;

  /**
   * @deprecated Use pointer instance `.set()` instead.
   * Legacy API: Sets pointer buffer value.
   */
  set(ptrBuf: Buffer, value: Buffer | bigint): void;

  toString(): string;
}

// =============================================================================
// Native Struct/Array Types
// =============================================================================

/**
 * Low-level native struct type. Prefer {@link Structure} for most use cases.
 * Mutable only until captured by a field, array, prepared function/callback
 * signature or native value. Finalization includes nested descriptors.
 * Create a new descriptor rather than modifying a finalized layout.
 * @category Structures
 */
export class StructType {
  constructor(options?: { union?: boolean; alignment?: number; memoryClass?: boolean });
  /** Append a field while the builder is open; throws after finalization. */
  addField(name: string, type: number | StructType | ArrayType | { readonly _native: ArrayType }, options?: { anonymous?: boolean }): this;
  /** Query without finalizing an unused builder. */
  getSize(): number;
  /** Query without finalizing an unused builder. */
  getAlignment(): number;
  /** Materialize a value and finalize its layout. */
  create(values?: Record<string, unknown>): Record<string, unknown> & { readonly _buffer: Buffer };
  read(buffer: Buffer): Record<string, any>;
  toObject(source: Buffer | { readonly _buffer: Buffer }): Record<string, unknown>;
}

/**
 * Low-level native array type. Prefer {@link array} for most use cases.
 * Captures and finalizes an aggregate element's layout, including at length zero.
 * @category Structures
 */
export class ArrayType {
  constructor(elementType: number | StructType, count: number);
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
  static _fields_?: ReadonlyArray<FieldEntry> | Record<string, FieldSpec>;

  /**
   * Maximum field alignment in bytes, as Python's `_pack_` (`1` = no padding).
   * `true` is accepted as `1`.
   */
  static _pack_?: number | boolean | bigint | string | null;

  /**
   * Bit field layout, as Python's `_layout_`: `"gcc-sysv"` (default except on
   * Windows) or `"ms"` (default on Windows and with `_pack_`).
   */
  static _layout_?: "gcc-sysv" | "ms";

  /** Minimum alignment in bytes, as Python's `_align_`. */
  static _align_?: number;

  /**
   * List of field names whose members are promoted to the parent struct.
   *
   * Python equivalent: `_anonymous_`
   */
  static _anonymous_?: ReadonlyArray<string>;

  /** Size in bytes (Python: `sizeof(cls)`). */
  static readonly size: number;

  /** Alignment in bytes (Python: `alignment(cls)`). */
  static readonly alignment: number;

  /** Field descriptors, in layout order. */
  static readonly fields: FieldDef[];

  /** Create instance with optional initial values. */
  static create<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, values?: Partial<FieldsToInstance<F>> | Buffer): ThisT;

  /** Convert a buffer or instance to a plain object. */
  static toObject<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, bufOrInstance: Buffer | Structure<F>): FieldsToInstance<F>;

  /**
   * Create an instance that aliases memory inside an existing Buffer.
   * Writes through the instance propagate to the source Buffer.
   *
   * Python ctypes parity: `Structure.from_buffer(source, offset=0)`.
   */
  static from_buffer<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, source: ArrayBufferView | { _buffer: Buffer }, offset?: number): ThisT;

  /**
   * Create an instance whose buffer is an independent copy of the source bytes.
   *
   * Python ctypes parity: `Structure.from_buffer_copy(source, offset=0)`.
   */
  static from_buffer_copy<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, source: ArrayBufferView | { _buffer: Buffer }, offset?: number): ThisT;

  /**
   * Create an instance that views raw memory at `address`. Caller is
   * responsible for ensuring the memory stays valid and is at least
   * `sizeof(this)` bytes.
   *
   * Python ctypes parity: `Structure.from_address(address)`.
   */
  static from_address<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, address: bigint | number): ThisT;

  /**
   * Bind the Structure to an exported global variable in a shared library.
   * Reads/writes through the returned instance go to/from the DLL's memory.
   *
   * Python ctypes parity: `Structure.in_dll(library, name)`.
   */
  static in_dll<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, library: CDLL | Library, name: string): ThisT;

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

  /** The fields, for `JSON.stringify` (same as {@link toObject}). */
  toJSON(): FieldsToInstance<F>;

  /** Fields: accessors of the class (not own properties, as in Python). */
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

/**
 * Structure subclass that lays out scalar fields in big-endian byte order.
 *
 * Scalar primitive fields (int*, uint*, float, double, size_t/ssize_t, wchar)
 * are byte-swapped transparently on read/write. 1-byte fields (int8, uint8,
 * bool, char) and pointers keep native layout. Bitfields follow the
 * underlying integer's endianness and currently match Python's LE layout.
 *
 * Python equivalent: `ctypes.BigEndianStructure`
 *
 * @example
 * ```javascript
 * class NetHeader extends BigEndianStructure {
 *   static _fields_ = [
 *     ['magic', c_uint32],
 *     ['length', c_uint32],
 *   ];
 * }
 * const h = new NetHeader();
 * h.magic = 0x12345678;   // stored as 12 34 56 78 on the wire
 * ```
 *
 * @category Structures
 */
export class BigEndianStructure<F extends Record<string, FieldSpec> = Record<string, any>> extends Structure<F> {}

/**
 * Structure subclass with explicit little-endian layout. On the LE hosts we
 * officially support this is identical to plain {@link Structure}; it exists
 * for API symmetry with {@link BigEndianStructure} and to document intent.
 *
 * Python equivalent: `ctypes.LittleEndianStructure`
 *
 * @category Structures
 */
export class LittleEndianStructure<F extends Record<string, FieldSpec> = Record<string, any>> extends Structure<F> {}

/**
 * Union subclass with big-endian primitive fields.
 *
 * Python equivalent: `ctypes.BigEndianUnion`
 *
 * @category Structures
 */
export class BigEndianUnion<F extends Record<string, FieldSpec> = Record<string, any>> extends Union<F> {}

/**
 * Union subclass with explicit little-endian layout (same as plain {@link Union}
 * on LE hosts).
 *
 * Python equivalent: `ctypes.LittleEndianUnion`
 *
 * @category Structures
 */
export class LittleEndianUnion<F extends Record<string, FieldSpec> = Record<string, any>> extends Union<F> {}

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
type CallbackRestype = SimpleCDataConstructor | PointerTypeDef | FuncPtrFactory | number | null;
type CallbackArgs<T extends readonly FFIType[]> = { -readonly [K in keyof T]: JsFromCType<T[K]> };
type CallbackResult<T> = T extends null | SimpleCDataConstructor<"void"> ? void : T extends StructureClass | StructDef | ArrayTypeDef ? never : JsArgFromCType<T> | (T extends SimpleCDataConstructor ? InstanceType<T> : never);

export function callback<TRet extends CallbackRestype, const TArgs extends readonly FFIType[] = readonly []>(fn: (...args: CallbackArgs<TArgs>) => CallbackResult<TRet>, returnType: TRet, argTypes?: TArgs): CallbackWrapper;

/**
 * Create a thread-safe callback that can be invoked from any thread.
 *
 * **Important:** Call `.release()` when the callback is no longer needed.
 * Like a timer, it keeps the Node.js event loop alive until released, unless
 * `.unref()` is called.
 *
 * @param fn - JavaScript function to wrap
 * @param returnType - Return type of the callback
 * @param argTypes - Argument types
 *
 * @category Callbacks
 */
export function threadSafeCallback<TRet extends CallbackRestype, const TArgs extends readonly FFIType[] = readonly []>(fn: (...args: CallbackArgs<TArgs>) => CallbackResult<TRet>, returnType: TRet, argTypes?: TArgs): ThreadSafeCallbackWrapper;

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
/**
 * Single entry in a paramflags array: describes direction (in/out), parameter
 * name, and optional default value for that slot.
 *
 * Python ctypes parity: the tuple form `(flag, name[, default])` used with
 * `prototype((name, lib), paramflags)`.
 *
 * @category Function Pointers
 */
export interface ParamFlag {
  /** OUT allocates a pointee; INOUT uses and returns the supplied instance. */
  dir: "in" | "out" | "inout";
  /** Parameter name, used for the named-call form `fn({ name: value, ... })`. */
  name: string;
  /** Optional default value; applied when the caller omits this `in` param. */
  default?: any;
}

/**
 * Factory returned by {@link CFUNCTYPE} / {@link WINFUNCTYPE}.
 *
 * @category Function Pointers
 */
export interface FuncPtrFactory<TRet extends FFIType | null = FFIType | null, TArgs extends readonly FFIType[] = readonly FFIType[]> {
  /** Call with a raw address to produce a caller. */
  (address: bigint | number): TypedFFIFunction<TArgs, TRet>;
  new (address: bigint | number): TypedFFIFunction<TArgs, TRet>;
  /**
   * Call with a JS function to produce a directly callable, typed C callback,
   * usable as an argument or struct field. Keep it referenced while C may
   * call it; `release()` frees it.
   */
  (fn: (...args: CallbackArgs<TArgs>) => CallbackResult<TRet>): CallableCallback<TArgs, TRet>;
  new (fn: (...args: CallbackArgs<TArgs>) => CallbackResult<TRet>): CallableCallback<TArgs, TRet>;
  /**
   * Bind an exported function of a library, optionally with paramflags.
   * Python: `prototype((name, dll))` / `prototype((name, dll), paramflags)`.
   */
  (spec: readonly [name: string, library: CDLL]): TypedFFIFunction<TArgs, TRet>;
  (spec: readonly [name: string, library: CDLL], paramflags: ReadonlyArray<ParamFlag | readonly [flag: number, name?: string, defaultValue?: any]>): FFIFunction;

  /** Shared metadata; assigning it does not recompile the captured signature. */
  restype: FFIType | null;
  /** Shared metadata; mutating it does not recompile the captured signature. */
  argtypes: FFIType[];
  readonly _isFuncPtr: true;

  /**
   * Bind the factory to a library export with Python-style paramflags.
   * Out params are allocated automatically and returned alone (one value or
   * an array). Returning the original `args` from errcheck keeps this behavior.
   * `callAsync()` uses the same output processing and per-call hook snapshot.
   *
   * Python ctypes parity: `prototype((name, lib), paramflags)`.
   *
   * @example
   * ```javascript
   * const proto = WINFUNCTYPE(DWORD, HWND, LPDWORD);
   * const fn = proto.bind(user32, "GetWindowThreadProcessId", [
   *   { dir: "in", name: "hWnd" },
   *   { dir: "out", name: "pid" },
   * ]);
   * const pid = fn(hwnd);                  // positional; thread ID is discarded
   * const pid2 = fn({ hWnd: hwnd });        // named
   * const pid3 = await fn.callAsync(hwnd);  // async, same output processing
   * ```
   */
  bind(library: CDLL, symbolName: string, paramflags: ReadonlyArray<ParamFlag | readonly [flag: number, name?: string, defaultValue?: any]>): FFIFunction;
}

export function CFUNCTYPE<TRet extends FFIType | null, const TArgs extends readonly FFIType[]>(restype: TRet, ...argtypes: TArgs): FuncPtrFactory<TRet, TArgs>;

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
export function WINFUNCTYPE<TRet extends FFIType | null, const TArgs extends readonly FFIType[]>(restype: TRet, ...argtypes: TArgs): FuncPtrFactory<TRet, TArgs>;

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
export function create_string_buffer(init: number | string | Uint8Array, size?: number): Buffer & CharBufferValue;

/**
 * Alias of {@link create_string_buffer}. Python equivalent: `ctypes.c_buffer`.
 * @category Memory
 */
export function c_buffer(init: number | string | Uint8Array, size?: number): Buffer & CharBufferValue;

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
export function create_unicode_buffer(init: number | string, size?: number): Buffer & WideBufferValue;

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
export function addressof(ptr: ArrayBufferView | ArrayBuffer | { readonly _buffer: Buffer } | PointerInstance | bigint | number): bigint;

/**
 * Memory argument of {@link memmove} / {@link memset}: a buffer (any typed
 * array, DataView or ArrayBuffer, as bytes), a ctypes instance, a pointer or an
 * address.
 */
export type MemoryTarget = ArrayBufferView | ArrayBufferLike | { readonly _buffer: Buffer } | { readonly _as_parameter_: unknown } | PointerInstance | bigint | number | null;

/**
 * Copy memory from source to destination.
 *
 * Python equivalent: `ctypes.memmove`
 *
 * @category Memory
 */
export function memmove(dst: MemoryTarget, src: MemoryTarget, count: number): bigint;

/**
 * Fill memory with a byte value.
 *
 * Python equivalent: `ctypes.memset`
 *
 * @category Memory
 */
export function memset(dst: MemoryTarget, value: number, count: number): bigint;

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
export function readValue<T extends AnyType>(ptr: MemorySource, type: T, offset?: number): JsFromCType<T>;
export function readValue(ptr: MemorySource, type: AnyType | StructureClass, offset?: number): any;

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
export function writeValue<T extends AnyType>(ptr: MemorySource, type: T, value: JsArgFromCType<T>, offset?: number): number | void;
export function writeValue(ptr: MemorySource, type: AnyType | StructureClass, value: any, offset?: number): number | void;

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
export function sizeof(type: AnyType | StructDef | ArrayTypeDef | StructureClass | PointerTypeDef | FuncPtrFactory | SimpleCDataInstance | Structure<any> | ArrayBufferView): number;

/** Memory read/written by {@link readValue} / {@link writeValue}: a buffer, a ctypes instance, a pointer or an address. */
type MemorySource = Buffer | ArrayBufferView | { _buffer: Buffer } | bigint | number | PointerInstance;

/**
 * Get the alignment requirement of a type in bytes.
 *
 * Python equivalent: `ctypes.alignment`
 *
 * @example
 * ```javascript
 * alignment(c_int32)    // 4
 * alignment(c_double)   // 8
 * alignment(MyStruct)   // max field alignment
 * ```
 *
 * @category Memory
 */
export function alignment(type: AnyType | StructDef | ArrayTypeDef | StructureClass | PointerTypeDef | FuncPtrFactory | SimpleCDataInstance | Structure<any>): number;

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
export function struct<F extends Record<string, FieldSpec>>(fields: F, options?: StructOptions): StructDef<F>;

/**
 * Define a union using the functional API.
 *
 * For Python-like class syntax, use {@link Union} instead.
 *
 * @param fields - Object mapping field names to types
 * @param options - Union options (e.g. `{ pack: 1 }`)
 *
 * @category Structures
 */
export function union<F extends Record<string, FieldSpec>>(fields: F, options?: StructOptions): UnionDef<F>;

/**
 * Factory that returns a Structure subclass with typed fields.
 *
 * @param fields - Object mapping field names to types
 * @param options - Struct options
 *
 * @category Structures
 */
export function defineStruct<F extends Record<string, FieldSpec>>(fields: F, options?: StructOptions): DefinedClass<F, Structure<F> & FieldsToInstance<F>>;

/**
 * Factory that returns a Union subclass with typed fields.
 *
 * @param fields - Object mapping field names to types
 *
 * @category Structures
 */
export function defineUnion<F extends Record<string, FieldSpec>>(fields: F, options?: StructOptions): DefinedClass<F, Union<F> & FieldsToInstance<F>>;

/**
 * Class returned by {@link defineStruct} / {@link defineUnion}: the statics of
 * {@link Structure} and a constructor with positional values (field order),
 * an object of field values or a Buffer.
 * @category Structures
 */
export interface DefinedClass<F extends Record<string, FieldSpec>, I> {
  new (values?: Partial<FieldsToInstance<F>> | Buffer): I;
  new (...values: any[]): I;
  readonly size: number;
  readonly alignment: number;
  readonly fields: FieldDef[];
  create(values?: Partial<FieldsToInstance<F>> | Buffer): I;
  toObject(bufOrInstance: Buffer | I): FieldsToInstance<F>;
  from_buffer(source: ArrayBufferView | { _buffer: Buffer }, offset?: number): I;
  from_buffer_copy(source: ArrayBufferView | { _buffer: Buffer }, offset?: number): I;
  from_address(address: bigint | number): I;
  in_dll(library: CDLL | Library, name: string): I;
}

/**
 * Define a fixed-size array type.
 *
 * Weakly interned by element type and count: live types keep their identity,
 * including when retained by instances, signatures or containing types.
 * The cache does not keep unused types alive.
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
export function array<E extends ArrayElementType>(elementType: E, count: number): ArrayTypeDef<E>;

/** Element types of {@link array}: C types, structures and unions (classes or definitions), arrays, pointers, function pointers. */
type ArrayElementType = SimpleCDataConstructor | StructDef | UnionDef | StructureClass | ArrayTypeDef | PointerTypeDef | FuncPtrFactory;

/**
 * Alias of {@link array}. Python equivalent: `ctypes.ARRAY(type, length)`.
 * @category Structures
 */
export function ARRAY<E extends ArrayElementType>(elementType: E, count: number): ArrayTypeDef<E>;

/**
 * Define a bit field for use in struct `_fields_`.
 *
 * @param baseType - The underlying integer type (e.g. `c_uint32`) or `c_bool`; other types raise TypeError, as in Python
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
export function bitfield(baseType: SimpleCDataConstructor, bits: number): BitFieldDef;

/**
 * Pass an object by reference, retaining its owner and applying a signed byte offset.
 * In-range references are Buffer views; out-of-range offsets are address carriers.
 *
 * Python equivalent: `ctypes.byref`
 *
 * @param obj - A Buffer, SimpleCData instance, or any object with a `_buffer` property
 * @param offset - Signed byte offset; the caller is responsible for valid external memory
 *
 * @category Pointers
 */
export interface ByRefAddress {
  readonly address: bigint;
  readonly _as_parameter_: bigint;
}
export function byref(obj: Buffer | SimpleCDataInstance | { _buffer: Buffer }, offset?: 0): Buffer;
export function byref(obj: Buffer | SimpleCDataInstance | { _buffer: Buffer }, offset: number): Buffer | ByRefAddress;

/**
 * Interpret a pointer as a different type.
 *
 * Python equivalent: `ctypes.cast`
 *
 * When the target is a {@link PointerTypeDef}, returns a {@link PointerInstance} with
 * `.contents` and `[index]` access — equivalent to Python's
 * `cast(c_void_p(addr), POINTER(MyStruct))`.
 * A {@link FuncPtrFactory} target returns a caller with that prototype.
 *
 * @param ptr - Memory, a pointer/address, or a native function/callback
 * @param targetType - The target type (primitive, struct, POINTER or CFUNCTYPE)
 *
 * @example Cast to POINTER for typed array access
 * ```javascript
 * // Python: cast(c_void_p(addr), POINTER(MyStruct))
 * const pValues = cast(col.pADsValues, POINTER(ADSVALUE));
 * for (let i = 0; i < col.dwNumValues; i++) {
 *   console.log(pValues[i].dwType);
 * }
 * ```
 *
 * @example Cast to primitive type
 * ```javascript
 * const floatVal = cast(intBuf, c_float);
 * ```
 *
 * @category Pointers
 */
type CastSource = MemorySource | ArrayBuffer | ByRefAddress | FFIFunction | CallbackWrapper | null;
export function cast<T>(ptr: CastSource, targetType: PointerTypeDef<T>): PointerInstance<T>;
export function cast<TRet extends FFIType | null, TArgs extends readonly FFIType[]>(ptr: CastSource, targetType: FuncPtrFactory<TRet, TArgs>): TypedFFIFunction<TArgs, TRet>;
export function cast<T extends SimpleCDataConstructor<"pointer"> | SimpleCDataConstructor<"string"> | SimpleCDataConstructor<"wstring">>(ptr: CastSource, targetType: T): InstanceType<T>;
export function cast(ptr: CastSource, targetType: AnyType | StructDef | StructureClass): any;

/**
 * Create a pointer type for a given base type.
 *
 * Python equivalent: `ctypes.POINTER`
 *
 * @param baseType - The type to point to
 * @returns A pointer type with `create()`, `fromBuffer()`, etc.
 *
 * @example Basic pointer
 * ```javascript
 * const IntPtr = POINTER(c_int32);
 * const buf = Buffer.alloc(4);
 * buf.writeInt32LE(42, 0);
 *
 * const p = IntPtr.fromBuffer(buf);
 * console.log(p.contents.value);  // 42
 * console.log(p[0]);        // 42
 * ```
 *
 * @example Typed access to native array via c_void_p struct field
 * ```javascript
 * // Structure fields don't accept POINTER() types directly — use c_void_p,
 * // then wrap with POINTER().fromAddress() for typed indexed access:
 * class Column extends Structure {
 *   static _fields_ = [["pValues", c_void_p], ["count", c_uint32]];
 * }
 * const pValues = POINTER(ValueStruct).fromAddress(col.pValues);
 * for (let i = 0; i < col.count; i++) {
 *   console.log(pValues[i].field);  // struct view at offset i
 * }
 * ```
 *
 * @category Pointers
 */
export function POINTER<T extends AnyType | StructureClass | PointerTypeDef>(baseType: T): PointerTypeDef<T>;
/** Lazy base type, for self-referential structs: `POINTER(() => Node)`. */
export function POINTER<T extends AnyType | StructureClass>(baseType: () => T): PointerTypeDef<T>;

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
 * console.log(p.contents.value);  // 42
 * p.contents = 100;
 * console.log(x.value);     // 100
 * ```
 *
 * @category Pointers
 */
export function pointer<T>(obj: PointerInstance<T>): PointerInstance<PointerTypeDef<T>>;
export function pointer<T extends Structure<any>>(obj: T): PointerInstance<new (...args: any[]) => T>;
export function pointer<V>(obj: SimpleCDataInstance<V>): PointerInstance;
export function pointer(obj: Buffer | { _buffer: Buffer }): PointerInstance;

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
export function SetLastError(code: number): number;

/**
 * Python name of {@link GetLastError}: the error code captured by the last
 * call. Python equivalent: `ctypes.get_last_error()`
 *
 * @category Error Handling
 */
export function get_last_error(): number;

/**
 * Python name of {@link SetLastError}; returns the previous value.
 * Python equivalent: `ctypes.set_last_error(value)`
 *
 * @category Error Handling
 */
export function set_last_error(code: number): number;

/**
 * Raised when a function argument cannot be converted to its `argtypes` type,
 * with the message `"argument N: TypeError: ..."`. Subclass of `TypeError`.
 *
 * Python equivalent: `ctypes.ArgumentError`
 *
 * @category Error Handling
 */
export class ArgumentError extends TypeError {
  constructor(message?: string, options?: ErrorOptions);
}

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
 * @param descr - Message (defaults to `FormatError(code)`)
 * @returns Error with `winerror`, `errno` (mapped as Python's OSError) and `strerror`
 *
 * @category Error Handling
 */
export function WinError(code?: number | null, descr?: string): Error & { winerror: number; errno: number; strerror: string };

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
export interface SimpleCDataConstructor<Tag extends string = string> {
  new (value?: any): SimpleCDataInstance<JsFromTag<Tag>>;
  /** Size of this type in bytes. */
  readonly _size: number;
  /** CType numeric identifier. */
  readonly _type: number;
  /** @internal */
  readonly _isSimpleCData: true;
  /** @internal Phantom tag for TS inference (erased at runtime). */
  readonly _tag?: Tag;
  /** @internal */
  _reader(buf: Buffer, offset: number): JsFromTag<Tag>;
  /** @internal */
  _writer(buf: Buffer, offset: number, value: JsArgFromTag<Tag>): void;

  /** Create an instance that aliases an existing Buffer (zero-copy). */
  from_buffer<T extends SimpleCDataConstructor<Tag>>(this: T, buffer: ArrayBufferView | { readonly _buffer: Buffer }, offset?: number): InstanceType<T>;
  /** Create an instance whose buffer is a copy of the source bytes. */
  from_buffer_copy<T extends SimpleCDataConstructor<Tag>>(this: T, buffer: ArrayBufferView | { readonly _buffer: Buffer }, offset?: number): InstanceType<T>;
  /** Create an instance viewing raw memory at the given address. */
  from_address<T extends SimpleCDataConstructor<Tag>>(this: T, address: bigint | number): InstanceType<T>;
  /** Bind this type to an exported global variable in a shared library. */
  in_dll<T extends SimpleCDataConstructor<Tag>>(this: T, library: CDLL | Library, name: string): InstanceType<T>;
}

/**
 * Maps a SimpleCData tag to its JavaScript **return** type (what reads produce).
 *
 * @category Types
 */
export type JsFromTag<Tag extends string> = Tag extends "void"
  ? void
  : Tag extends "char" | "wchar"
    ? string
    : Tag extends "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "float" | "double"
      ? number
      : Tag extends "int64" | "uint64" | "size_t" | "ssize_t" | "long" | "ulong"
        ? bigint
        : Tag extends "bool"
          ? boolean
          : Tag extends "string"
            ? string | null
            : Tag extends "wstring"
              ? string | null
              : Tag extends "pointer"
                ? bigint | null
                : any;

/**
 * Maps a SimpleCData tag to accepted JavaScript **input** types (what writes/args accept).
 * Generally a superset of `JsFromTag` (e.g. strings accept Buffer too, ints accept bigint).
 *
 * @category Types
 */
export type JsArgFromTag<Tag extends string> = Tag extends "void"
  ? never
  : Tag extends "char"
    ? string | number | Uint8Array
    : Tag extends "wchar"
      ? string | number
      : Tag extends "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "float" | "double"
        ? number
        : Tag extends "int64" | "uint64" | "size_t" | "ssize_t" | "long" | "ulong"
          ? bigint | number
          : Tag extends "bool"
            ? boolean | number
            : Tag extends "string"
              ? string | Buffer | null
              : Tag extends "wstring"
                ? string | Buffer | null
                : Tag extends "pointer"
                  ? bigint | Buffer | number | null | { readonly _as_parameter_: unknown }
                  : any;

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
export interface SimpleCDataInstance<T = any> {
  /** The current value. */
  value: T;
  /** The underlying memory buffer. */
  _buffer: Buffer;
  toString(): string;
  toJSON(): T;
  valueOf(): T;
  /** OUT conversion; defaults to the value for builtins and the instance for subclasses. */
  __ctypes_from_outparam__(): unknown;
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
export const c_void: SimpleCDataConstructor<"void">;

/** 32-bit signed integer. Python: `ctypes.c_int` @category Types */
export const c_int: SimpleCDataConstructor<"int32">;
/** 32-bit unsigned integer. Python: `ctypes.c_uint` @category Types */
export const c_uint: SimpleCDataConstructor<"uint32">;
/** 8-bit signed integer. Python: `ctypes.c_int8` @category Types */
export const c_int8: SimpleCDataConstructor<"int8">;
/** 8-bit unsigned integer. Python: `ctypes.c_uint8` @category Types */
export const c_uint8: SimpleCDataConstructor<"uint8">;
/** 16-bit signed integer. Python: `ctypes.c_int16` @category Types */
export const c_int16: SimpleCDataConstructor<"int16">;
/** 16-bit unsigned integer. Python: `ctypes.c_uint16` @category Types */
export const c_uint16: SimpleCDataConstructor<"uint16">;
/** 32-bit signed integer. Python: `ctypes.c_int32` @category Types */
export const c_int32: SimpleCDataConstructor<"int32">;
/** 32-bit unsigned integer. Python: `ctypes.c_uint32` @category Types */
export const c_uint32: SimpleCDataConstructor<"uint32">;
/** 64-bit signed integer (BigInt). Python: `ctypes.c_int64` @category Types */
export const c_int64: SimpleCDataConstructor<"int64">;
/** 64-bit unsigned integer (BigInt). Python: `ctypes.c_uint64` @category Types */
export const c_uint64: SimpleCDataConstructor<"uint64">;
/** 32-bit float. Python: `ctypes.c_float` @category Types */
export const c_float: SimpleCDataConstructor<"float">;
/** 64-bit double. Python: `ctypes.c_double` @category Types */
export const c_double: SimpleCDataConstructor<"double">;
/**
 * 1-byte character. Python: `ctypes.c_char`. Values are 1-character strings
 * (Python `bytes` of length 1); writes also accept a byte number (0..255) or a
 * 1-byte Buffer.
 * @category Types
 */
export const c_char: SimpleCDataConstructor<"char">;
/** Pointer to null-terminated string. Python: `ctypes.c_char_p` @category Types */
export const c_char_p: SimpleCDataConstructor<"string">;
/**
 * Wide character (`wchar_t`). Python: `ctypes.c_wchar`. Values are 1-character
 * strings; writes also accept a code point number.
 * @category Types
 */
export const c_wchar: SimpleCDataConstructor<"wchar">;
/** Pointer to null-terminated wide string. Python: `ctypes.c_wchar_p` @category Types */
export const c_wchar_p: SimpleCDataConstructor<"wstring">;
/** Void pointer. Python: `ctypes.c_void_p` @category Types */
export const c_void_p: SimpleCDataConstructor<"pointer">;
/** Boolean (1 byte). Python: `ctypes.c_bool` @category Types */
export const c_bool: SimpleCDataConstructor<"bool">;
/** Platform-dependent unsigned size type (BigInt). Python: `ctypes.c_size_t` @category Types */
export const c_size_t: SimpleCDataConstructor<"size_t">;
/** Platform-dependent signed size type (BigInt). Python: `ctypes.c_ssize_t` @category Types */
export const c_ssize_t: SimpleCDataConstructor<"ssize_t">;
/** Platform-dependent signed long. Python: `ctypes.c_long` @category Types */
export const c_long: SimpleCDataConstructor<"long">;
/** Platform-dependent unsigned long. Python: `ctypes.c_ulong` @category Types */
export const c_ulong: SimpleCDataConstructor<"ulong">;

/** Alias for `c_int8`. Python: `ctypes.c_byte` @category Types */
export const c_byte: SimpleCDataConstructor<"int8">;
/** Alias for `c_uint8`. Python: `ctypes.c_ubyte` @category Types */
export const c_ubyte: SimpleCDataConstructor<"uint8">;
/** Alias for `c_int16`. Python: `ctypes.c_short` @category Types */
export const c_short: SimpleCDataConstructor<"int16">;
/** Alias for `c_uint16`. Python: `ctypes.c_ushort` @category Types */
export const c_ushort: SimpleCDataConstructor<"uint16">;
/** Alias for `c_int64`. Python: `ctypes.c_longlong` @category Types */
export const c_longlong: SimpleCDataConstructor<"int64">;
/** Alias for `c_uint64`. Python: `ctypes.c_ulonglong` @category Types */
export const c_ulonglong: SimpleCDataConstructor<"uint64">;
/** Alias of {@link c_void_p}. Python: `ctypes.c_voidp` @category Types */
export const c_voidp: SimpleCDataConstructor<"pointer">;
/** `time_t` (64-bit). Python: `ctypes.c_time_t` @category Types */
export const c_time_t: SimpleCDataConstructor<"int64">;

/**
 * A Structure class with known fields (used by {@link wintypes}).
 * @category Types
 */
export type StructureOf<T> = (new (...args: any[]) => Structure<any> & T) & Omit<typeof Structure, "prototype">;

type W_BYTE = SimpleCDataConstructor<"uint8">;
type W_WORD = SimpleCDataConstructor<"uint16">;
type W_DWORD = SimpleCDataConstructor<"ulong">;
type W_LONG = SimpleCDataConstructor<"long">;
type W_SHORT = SimpleCDataConstructor<"int16">;
type W_HANDLE = SimpleCDataConstructor<"pointer">;
type W_RECT = StructureOf<{ left: bigint; top: bigint; right: bigint; bottom: bigint }>;
type W_POINT = StructureOf<{ x: bigint; y: bigint }>;
type W_SIZE = StructureOf<{ cx: bigint; cy: bigint }>;
type W_SMALL_RECT = StructureOf<{ Left: number; Top: number; Right: number; Bottom: number }>;
type W_FILETIME = StructureOf<{ dwLowDateTime: bigint; dwHighDateTime: bigint }>;
type W_MSG = StructureOf<{ hWnd: bigint | null; message: number; wParam: bigint; lParam: bigint; time: bigint; pt: InstanceType<W_POINT> }>;
type W_FIND_DATA = StructureOf<{
  dwFileAttributes: bigint;
  ftCreationTime: InstanceType<W_FILETIME>;
  ftLastAccessTime: InstanceType<W_FILETIME>;
  ftLastWriteTime: InstanceType<W_FILETIME>;
  nFileSizeHigh: bigint;
  nFileSizeLow: bigint;
  dwReserved0: bigint;
  dwReserved1: bigint;
  cFileName: string;
  cAlternateFileName: string;
}>;

/**
 * Windows API types, as Python's `ctypes.wintypes`: the same names, aliases,
 * structures (`RECT`, `POINT`, `SIZE`, `MSG`, `FILETIME`, ...) and pointer
 * types (`LPDWORD = POINTER(DWORD)`, ...), plus common extras (`QWORD`,
 * `LRESULT`, `UINT_PTR`, `LSTATUS`, ...). Available on every platform.
 *
 * @example
 * ```javascript
 * import { wintypes } from "node-ctypes";
 * const { HWND, UINT, RECT, LPRECT } = wintypes;
 * ```
 *
 * @category Types
 */
export const wintypes: {
  readonly BYTE: W_BYTE;
  readonly WORD: W_WORD;
  readonly DWORD: W_DWORD;
  readonly CHAR: SimpleCDataConstructor<"char">;
  readonly WCHAR: SimpleCDataConstructor<"wchar">;
  readonly UINT: SimpleCDataConstructor<"uint32">;
  readonly INT: SimpleCDataConstructor<"int32">;
  readonly DOUBLE: SimpleCDataConstructor<"double">;
  readonly FLOAT: SimpleCDataConstructor<"float">;
  readonly BOOLEAN: W_BYTE;
  readonly BOOL: W_LONG;
  readonly VARIANT_BOOL: SimpleCDataConstructor<"bool">;
  readonly ULONG: W_DWORD;
  readonly LONG: W_LONG;
  readonly USHORT: W_WORD;
  readonly SHORT: W_SHORT;
  readonly _LARGE_INTEGER: SimpleCDataConstructor<"int64">;
  readonly LARGE_INTEGER: SimpleCDataConstructor<"int64">;
  readonly _ULARGE_INTEGER: SimpleCDataConstructor<"uint64">;
  readonly ULARGE_INTEGER: SimpleCDataConstructor<"uint64">;
  readonly LPCOLESTR: SimpleCDataConstructor<"wstring">;
  readonly LPOLESTR: SimpleCDataConstructor<"wstring">;
  readonly OLESTR: SimpleCDataConstructor<"wstring">;
  readonly LPCWSTR: SimpleCDataConstructor<"wstring">;
  readonly LPWSTR: SimpleCDataConstructor<"wstring">;
  readonly LPCSTR: SimpleCDataConstructor<"string">;
  readonly LPSTR: SimpleCDataConstructor<"string">;
  readonly LPCVOID: W_HANDLE;
  readonly LPVOID: W_HANDLE;
  readonly WPARAM: SimpleCDataConstructor<"size_t">;
  readonly LPARAM: SimpleCDataConstructor<"ssize_t">;
  readonly ATOM: W_WORD;
  readonly LANGID: W_WORD;
  readonly COLORREF: W_DWORD;
  readonly LGRPID: W_DWORD;
  readonly LCTYPE: W_DWORD;
  readonly LCID: W_DWORD;
  readonly HANDLE: W_HANDLE;
  readonly HACCEL: W_HANDLE;
  readonly HBITMAP: W_HANDLE;
  readonly HBRUSH: W_HANDLE;
  readonly HCOLORSPACE: W_HANDLE;
  readonly HDC: W_HANDLE;
  readonly HDESK: W_HANDLE;
  readonly HDWP: W_HANDLE;
  readonly HENHMETAFILE: W_HANDLE;
  readonly HFONT: W_HANDLE;
  readonly HGDIOBJ: W_HANDLE;
  readonly HGLOBAL: W_HANDLE;
  readonly HHOOK: W_HANDLE;
  readonly HICON: W_HANDLE;
  readonly HINSTANCE: W_HANDLE;
  readonly HKEY: W_HANDLE;
  readonly HKL: W_HANDLE;
  readonly HLOCAL: W_HANDLE;
  readonly HMENU: W_HANDLE;
  readonly HMETAFILE: W_HANDLE;
  readonly HMODULE: W_HANDLE;
  readonly HMONITOR: W_HANDLE;
  readonly HPALETTE: W_HANDLE;
  readonly HPEN: W_HANDLE;
  readonly HRGN: W_HANDLE;
  readonly HRSRC: W_HANDLE;
  readonly HSTR: W_HANDLE;
  readonly HTASK: W_HANDLE;
  readonly HWINSTA: W_HANDLE;
  readonly HWND: W_HANDLE;
  readonly SC_HANDLE: W_HANDLE;
  readonly SERVICE_STATUS_HANDLE: W_HANDLE;
  readonly RECT: W_RECT;
  readonly tagRECT: W_RECT;
  readonly _RECTL: W_RECT;
  readonly RECTL: W_RECT;
  readonly _SMALL_RECT: W_SMALL_RECT;
  readonly SMALL_RECT: W_SMALL_RECT;
  readonly _COORD: StructureOf<{ X: number; Y: number }>;
  readonly POINT: W_POINT;
  readonly tagPOINT: W_POINT;
  readonly _POINTL: W_POINT;
  readonly POINTL: W_POINT;
  readonly SIZE: W_SIZE;
  readonly tagSIZE: W_SIZE;
  readonly SIZEL: W_SIZE;
  /** `red + (green << 8) + (blue << 16)` */
  RGB(red: number, green: number, blue: number): number;
  readonly FILETIME: W_FILETIME;
  readonly _FILETIME: W_FILETIME;
  readonly MSG: W_MSG;
  readonly tagMSG: W_MSG;
  readonly MAX_PATH: 260;
  readonly WIN32_FIND_DATAA: W_FIND_DATA;
  readonly WIN32_FIND_DATAW: W_FIND_DATA;
  readonly LPBOOL: PointerTypeDef<W_LONG>;
  readonly PBOOL: PointerTypeDef<W_LONG>;
  readonly PBOOLEAN: PointerTypeDef<W_BYTE>;
  readonly LPBYTE: PointerTypeDef<W_BYTE>;
  readonly PBYTE: PointerTypeDef<W_BYTE>;
  readonly PCHAR: PointerTypeDef<SimpleCDataConstructor<"char">>;
  readonly LPCOLORREF: PointerTypeDef<W_DWORD>;
  readonly LPDWORD: PointerTypeDef<W_DWORD>;
  readonly PDWORD: PointerTypeDef<W_DWORD>;
  readonly LPFILETIME: PointerTypeDef<W_FILETIME>;
  readonly PFILETIME: PointerTypeDef<W_FILETIME>;
  readonly PFLOAT: PointerTypeDef<SimpleCDataConstructor<"float">>;
  readonly LPHANDLE: PointerTypeDef<W_HANDLE>;
  readonly PHANDLE: PointerTypeDef<W_HANDLE>;
  readonly PHKEY: PointerTypeDef<W_HANDLE>;
  readonly LPHKL: PointerTypeDef<W_HANDLE>;
  readonly LPINT: PointerTypeDef<SimpleCDataConstructor<"int32">>;
  readonly PINT: PointerTypeDef<SimpleCDataConstructor<"int32">>;
  readonly PLARGE_INTEGER: PointerTypeDef<SimpleCDataConstructor<"int64">>;
  readonly PLCID: PointerTypeDef<W_DWORD>;
  readonly LPLONG: PointerTypeDef<W_LONG>;
  readonly PLONG: PointerTypeDef<W_LONG>;
  readonly LPMSG: PointerTypeDef<W_MSG>;
  readonly PMSG: PointerTypeDef<W_MSG>;
  readonly LPPOINT: PointerTypeDef<W_POINT>;
  readonly PPOINT: PointerTypeDef<W_POINT>;
  readonly PPOINTL: PointerTypeDef<W_POINT>;
  readonly LPRECT: PointerTypeDef<W_RECT>;
  readonly PRECT: PointerTypeDef<W_RECT>;
  readonly LPRECTL: PointerTypeDef<W_RECT>;
  readonly PRECTL: PointerTypeDef<W_RECT>;
  readonly LPSC_HANDLE: PointerTypeDef<W_HANDLE>;
  readonly PSHORT: PointerTypeDef<W_SHORT>;
  readonly LPSIZE: PointerTypeDef<W_SIZE>;
  readonly PSIZE: PointerTypeDef<W_SIZE>;
  readonly LPSIZEL: PointerTypeDef<W_SIZE>;
  readonly PSIZEL: PointerTypeDef<W_SIZE>;
  readonly PSMALL_RECT: PointerTypeDef<W_SMALL_RECT>;
  readonly LPUINT: PointerTypeDef<SimpleCDataConstructor<"uint32">>;
  readonly PUINT: PointerTypeDef<SimpleCDataConstructor<"uint32">>;
  readonly PULARGE_INTEGER: PointerTypeDef<SimpleCDataConstructor<"uint64">>;
  readonly PULONG: PointerTypeDef<W_DWORD>;
  readonly PUSHORT: PointerTypeDef<W_WORD>;
  readonly PWCHAR: PointerTypeDef<SimpleCDataConstructor<"wchar">>;
  readonly LPWIN32_FIND_DATAA: PointerTypeDef<W_FIND_DATA>;
  readonly PWIN32_FIND_DATAA: PointerTypeDef<W_FIND_DATA>;
  readonly LPWIN32_FIND_DATAW: PointerTypeDef<W_FIND_DATA>;
  readonly PWIN32_FIND_DATAW: PointerTypeDef<W_FIND_DATA>;
  readonly LPWORD: PointerTypeDef<W_WORD>;
  readonly PWORD: PointerTypeDef<W_WORD>;
  // Extras (not in Python's wintypes)
  readonly QWORD: SimpleCDataConstructor<"uint64">;
  readonly DWORDLONG: SimpleCDataConstructor<"uint64">;
  readonly LONGLONG: SimpleCDataConstructor<"int64">;
  readonly ULONGLONG: SimpleCDataConstructor<"uint64">;
  readonly PVOID: W_HANDLE;
  readonly HCURSOR: W_HANDLE;
  readonly LRESULT: SimpleCDataConstructor<"ssize_t">;
  readonly UINT_PTR: SimpleCDataConstructor<"size_t">;
  readonly LONG_PTR: SimpleCDataConstructor<"ssize_t">;
  readonly ULONG_PTR: SimpleCDataConstructor<"size_t">;
  readonly LSTATUS: W_LONG;
  readonly REGSAM: W_DWORD;
};

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
 * `false` where the runtime does not allow Buffers over native memory
 * (Electron, or `NODE_CTYPES_NO_EXTERNAL_BUFFERS=1`). ctypes instances on
 * native memory (`from_address`, `in_dll`, pointers) then work on a
 * synchronized copy, and their `_buffer` is that copy.
 * @category Constants
 */
export const EXTERNAL_BUFFERS: boolean;

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

/**
 * Size of `time_t` in bytes. Python: `ctypes.SIZEOF_TIME_T`
 * @category Constants
 */
export const SIZEOF_TIME_T: number;

/**
 * `dlopen` flag: symbols are available to subsequently loaded libraries
 * (0 on Windows). Python: `ctypes.RTLD_GLOBAL`
 * @category Constants
 */
export const RTLD_GLOBAL: number;

/**
 * `dlopen` flag: symbols stay local to the library (0 on Windows).
 * Python: `ctypes.RTLD_LOCAL`
 * @category Constants
 */
export const RTLD_LOCAL: number;

/**
 * Default `mode` of {@link CDLL} (`RTLD_LOCAL`). Python: `ctypes.DEFAULT_MODE`
 * @category Constants
 */
export const DEFAULT_MODE: number;

/**
 * Resolve a library name to a platform-specific filename or path.
 *
 * Python equivalent: `ctypes.util.find_library(name)`
 *
 * - On Windows, bare names get `.dll` appended, and a few universal aliases
 *   are provided (e.g. `"c"` → `"msvcrt.dll"`).
 * - On Linux, the `ldconfig` cache and common library directories are
 *   searched for the best-matching `libNAME.so.VERSION`.
 * - On macOS, the `DYLD_*` paths, the dyld fallback directories, Homebrew and
 *   the framework directories are searched, including the dyld shared cache
 *   (system libraries and frameworks are not on disk since macOS 11).
 *
 * Returns `null` if the input is invalid. Returns a best-effort fallback
 * (bare soname) if nothing is found, so the loader can still try its own
 * search path.
 *
 * @example
 * ```javascript
 * import { find_library, CDLL } from 'node-ctypes';
 * const libc = new CDLL(find_library('c'));
 * ```
 *
 * @category Library Loading
 */
export function find_library(name: string): string | null;
