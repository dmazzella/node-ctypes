/**
 * node-ctypes - Python ctypes-like FFI for Node.js
 * TypeScript type definitions
 */

/// <reference types="node" />

// =============================================================================
// Basic Types
// =============================================================================

/**
 * CType - Object containing numeric type identifiers
 * Single source of truth for type values
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

/** CType object with numeric type identifiers */
export const CType: CTypeValues;

/** Any accepted type specification (SimpleCData class, CType value, or struct/union) */
export type AnyType = SimpleCDataConstructor | number | StructDef | UnionDef;

// =============================================================================
// Library & Function
// =============================================================================

/** Version information */
export class Version {
  static get major(): number;
  static get minor(): number;
  static get patch(): number;
  static toString(): string;
}

/** Native library handle */
export class Library {
  constructor(path: string | null);
  func(name: string, returnType: AnyType, argTypes?: AnyType[], options?: FunctionOptions): FFIFunction;
  symbol(name: string): bigint;
  close(): void;
  readonly path: string;
  readonly loaded: boolean;
}

/** Function call options */
export interface FunctionOptions {
  abi?: "cdecl" | "stdcall" | "fastcall" | "thiscall" | "default";
}

/** Errcheck callback type */
export type ErrcheckCallback = (result: any, func: CallableFunction, args: any[]) => any;

/** FFI function wrapper */
export interface FFIFunction {
  (...args: any[]): any;
  readonly funcName: string;
  readonly address: bigint;
  errcheck: ErrcheckCallback | null;
}

/** CDLL - C calling convention library */
export class CDLL {
  constructor(path: string | null);
  func(name: string, returnType: AnyType, argTypes?: AnyType[], options?: FunctionOptions): CallableFunction & { errcheck: ErrcheckCallback | null };
  symbol(name: string): bigint;
  close(): void;
  readonly path: string;
  readonly loaded: boolean;
}

/** WinDLL - stdcall calling convention library (Windows) */
export class WinDLL extends CDLL {
  constructor(path: string);
}

// =============================================================================
// Callbacks
// =============================================================================

/** Callback wrapper for main-thread callbacks */
export interface CallbackWrapper {
  readonly pointer: bigint;
  release(): void;
}

/** Native Callback class */
export class Callback {
  constructor(fn: Function, returnType: AnyType, argTypes?: AnyType[]);
  readonly pointer: bigint;
  release(): void;
}

/** Thread-safe callback class */
export class ThreadSafeCallback extends Callback {}

// =============================================================================
// Structures
// =============================================================================

/** Field definition for struct */
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

/** Struct definition */
export interface StructDef {
  readonly size: number;
  readonly alignment: number;
  readonly fields: FieldDef[];
  readonly packed: boolean;
  readonly _isStructType: true;

  create(values?: Record<string, any>): Buffer;
  get(buf: Buffer, fieldName: string): any;
  set(buf: Buffer, fieldName: string, value: any): void;
  toObject(buf: Buffer): Record<string, any>;
  getNestedBuffer(buf: Buffer, fieldName: string): Buffer;
}

// Helper types for improved typed structs
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

/** Union definition (same interface as struct) */
export interface UnionDef extends StructDef {
  readonly isUnion: true;
}

/** Bit field definition */
export interface BitFieldDef {
  readonly _isBitField: true;
  readonly baseType: AnyType;
  readonly bits: number;
  readonly baseSize: number;
}

/** Array type definition */
export interface ArrayTypeDef {
  readonly elementType: AnyType;
  readonly length: number;
  readonly _isArrayType: true;

  getSize(): number;
  getLength(): number;
  getAlignment(): number;
  create(values?: any[]): Buffer & ArrayProxy;
  wrap(buffer: Buffer): Buffer & ArrayProxy;
}

/** Array proxy for index access */
export interface ArrayProxy {
  [index: number]: any;
  [Symbol.iterator](): Iterator<any>;
}

/** Struct options */
export interface StructOptions {
  packed?: boolean;
}

/** Anonymous field wrapper */
export interface AnonymousField {
  type: StructDef;
  anonymous: true;
}

// =============================================================================
// Pointers
// =============================================================================

/** POINTER type definition */
export interface PointerTypeDef {
  readonly _pointerTo: AnyType | StructDef;
  readonly _baseSize: number;
  readonly size: number;

  create(): Buffer;
  fromBuffer(targetBuf: Buffer): Buffer;
  deref(ptrBuf: Buffer): bigint | null;
  set(ptrBuf: Buffer, value: Buffer | bigint): void;
  toString(): string;
}

// =============================================================================
// Native Struct/Array Types
// =============================================================================

/** Native StructType class */
export class StructType {
  constructor(isUnion?: boolean);
  addField(name: string, type: AnyType | StructType | ArrayType): this;
  getSize(): number;
  getAlignment(): number;
  create(values?: Record<string, any>): Buffer;
  read(buffer: Buffer): Record<string, any>;
}

/** Native ArrayType class */
export class ArrayType {
  constructor(elementType: AnyType, count: number);
  getSize(): number;
  getLength(): number;
  getAlignment(): number;
  create(values?: any[]): Buffer;
}

/**
 * Python-like Structure base class.
 * Subclasses should define `static _fields_` as array of [name, type]
 * or an object map { name: type }.
 */
export class Structure<F extends Record<string, FieldSpec> = Record<string, any>> {
  constructor(...args: any[]);
  static _fields_?: Array<[string, FieldSpec]> | Record<string, FieldSpec>;
  static _pack_?: boolean;
  static _anonymous_?: string[];
  static create<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, values?: Partial<FieldsToInstance<F>> | Buffer): ThisT;
  static toObject<ThisT extends Structure<F>>(this: new (...args: any[]) => ThisT, bufOrInstance: Buffer | Structure<F>): FieldsToInstance<F>;
  _buffer: Buffer;
  _structDef: StructDef;
  get<K extends keyof F & string>(fieldName: K): FieldsToInstance<F>[K];
  set<K extends keyof F & string>(fieldName: K, value: FieldsToInstance<F>[K]): void;
  toObject(): FieldsToInstance<F>;
  [field: string]: any; // instance has dynamic properties for fields
}

/**
 * Python-like Union base class.
 */
export class Union<F extends Record<string, FieldSpec> = Record<string, any>> extends Structure<F> {}

// =============================================================================
// Functions
// =============================================================================

// Library loading
export function load(path: string | null): Library;

// Callbacks
export function callback(fn: Function, returnType: AnyType, argTypes?: AnyType[]): CallbackWrapper;
export function threadSafeCallback(fn: Function, returnType: AnyType, argTypes?: AnyType[]): CallbackWrapper;

// Memory management - Python-compatible
export function create_string_buffer(init: number | string | Buffer): Buffer;
export function create_unicode_buffer(init: number | string): Buffer;
export function string_at(address: Buffer | bigint | number, size?: number): string | null;
export function wstring_at(address: Buffer | bigint | number, size?: number): string | null;
export function addressof(ptr: Buffer | bigint | number): bigint;
export function memmove(dst: Buffer, src: Buffer | bigint, count: number): void;
export function memset(dst: Buffer, value: number, count: number): void;

// Memory - utility (no direct Python equivalent)
export function readValue(ptr: Buffer | bigint | number, type: AnyType, offset?: number): any;
export function writeValue(ptr: Buffer | bigint | number, type: AnyType, value: any, offset?: number): number | void;
export function sizeof(type: AnyType | StructDef | ArrayTypeDef): number;
export function ptrToBuffer(address: bigint | number, size: number): Buffer;

// Structures
export function struct(fields: Record<string, FieldSpec>, options?: StructOptions): StructDef;
export function union(fields: Record<string, FieldSpec>): UnionDef;
// Factory helpers that return a typed class extending Structure/Union
export function defineStruct<F extends Record<string, FieldSpec>>(fields: F, options?: StructOptions): new (...args: any[]) => Structure<F>;
export function defineUnion<F extends Record<string, FieldSpec>>(fields: F): new (...args: any[]) => Union<F>;
export function array(elementType: AnyType | typeof Structure | typeof Union, count: number): ArrayTypeDef;
export function bitfield(baseType: AnyType, bits: number): BitFieldDef;

// Pointers
export function byref(obj: Buffer | SimpleCDataInstance | { _buffer: Buffer }): Buffer;
export function cast(ptr: Buffer | bigint, targetType: AnyType | StructDef): Buffer | { [key: string]: any };
export function POINTER(baseType: AnyType | StructDef): PointerTypeDef;

// Error handling
export function get_errno(): number;
export function set_errno(value: number): void;
export function GetLastError(): number;
export function SetLastError(code: number): void;
export function FormatError(code?: number): string;
export function WinError(code?: number): Error & { winerror: number };

// =============================================================================
// SimpleCData - Base class for simple C data types
// =============================================================================

/** Base class for simple C data types (int, float, pointer, etc.) */
export interface SimpleCDataConstructor {
  new (value?: any): SimpleCDataInstance;
  readonly _size: number;
  readonly _type: number;  // CType numeric value from native module
  readonly _isSimpleCData: true;
  _reader(buf: Buffer, offset: number): any;
  _writer(buf: Buffer, offset: number, value: any): void;
}

/** Instance of SimpleCData */
export interface SimpleCDataInstance {
  value: any;
  _buffer: Buffer;
  toString(): string;
  toJSON(): any;
  valueOf(): any;
}

// =============================================================================
// Type Aliases (Python-compatible)
// =============================================================================

export const c_void: SimpleCDataConstructor;
export const c_int: SimpleCDataConstructor;
export const c_uint: SimpleCDataConstructor;
export const c_int8: SimpleCDataConstructor;
export const c_uint8: SimpleCDataConstructor;
export const c_int16: SimpleCDataConstructor;
export const c_uint16: SimpleCDataConstructor;
export const c_int32: SimpleCDataConstructor;
export const c_uint32: SimpleCDataConstructor;
export const c_int64: SimpleCDataConstructor;
export const c_uint64: SimpleCDataConstructor;
export const c_float: SimpleCDataConstructor;
export const c_double: SimpleCDataConstructor;
export const c_char: SimpleCDataConstructor;
export const c_char_p: SimpleCDataConstructor;
export const c_wchar: SimpleCDataConstructor;
export const c_wchar_p: SimpleCDataConstructor;
export const c_void_p: SimpleCDataConstructor;
export const c_bool: SimpleCDataConstructor;
export const c_size_t: SimpleCDataConstructor;
export const c_long: SimpleCDataConstructor;
export const c_ulong: SimpleCDataConstructor;

// =============================================================================
// Constants
// =============================================================================

/** Size of a pointer in bytes (4 on 32-bit, 8 on 64-bit) */
export const POINTER_SIZE: number;

/** Size of wchar_t in bytes (2 on Windows, 4 on Unix) */
export const WCHAR_SIZE: number;

/** Null pointer constant */
export const NULL: null;
