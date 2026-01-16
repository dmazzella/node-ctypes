/**
 * node-ctypes - Python ctypes-like FFI for Node.js
 * TypeScript type definitions
 */

/// <reference types="node" />

// =============================================================================
// Basic Types
// =============================================================================

/** C type enumeration */
export type CTypeString =
  | "void"
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "int64"
  | "uint64"
  | "float"
  | "double"
  | "bool"
  | "pointer"
  | "string"
  | "wstring"
  | "wchar"
  | "size_t"
  | "ssize_t"
  | "long"
  | "ulong"
  | "char"
  | "uchar"
  | "short"
  | "ushort"
  | "int"
  | "uint";

/** Native CType object */
export interface CType {
  readonly size: number;
  readonly name: string;
}

/** Predefined types object */
export interface Types {
  readonly void: CType;
  readonly int8: CType;
  readonly uint8: CType;
  readonly int16: CType;
  readonly uint16: CType;
  readonly int32: CType;
  readonly uint32: CType;
  readonly int64: CType;
  readonly uint64: CType;
  readonly float: CType;
  readonly double: CType;
  readonly bool: CType;
  readonly pointer: CType;
  readonly string: CType;
  readonly wstring: CType;
  readonly wchar: CType;
  readonly size_t: CType;
  readonly long: CType;
  readonly ulong: CType;
  // Python-style aliases
  readonly c_int8: CType;
  readonly c_uint8: CType;
  readonly c_int16: CType;
  readonly c_uint16: CType;
  readonly c_int32: CType;
  readonly c_uint32: CType;
  readonly c_int64: CType;
  readonly c_uint64: CType;
  readonly c_float: CType;
  readonly c_double: CType;
  readonly c_bool: CType;
  readonly c_char_p: CType;
  readonly c_wchar_p: CType;
  readonly c_wchar: CType;
  readonly c_void_p: CType;
  readonly c_size_t: CType;
  readonly c_long: CType;
  readonly c_ulong: CType;
  readonly c_int: CType;
  readonly c_uint: CType;
  readonly c_char: CType;
  readonly c_uchar: CType;
  readonly c_short: CType;
  readonly c_ushort: CType;
}

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
  func(
    name: string,
    returnType: CTypeString | CType,
    argTypes?: (CTypeString | CType)[],
    options?: FunctionOptions,
  ): FFIFunction;
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
export type ErrcheckCallback = (
  result: any,
  func: CallableFunction,
  args: any[],
) => any;

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
  func(
    name: string,
    returnType: CTypeString | CType,
    argTypes?: (CTypeString | CType)[],
    options?: FunctionOptions,
  ): CallableFunction & { errcheck: ErrcheckCallback | null };
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
  constructor(
    fn: Function,
    returnType: CTypeString | CType,
    argTypes?: (CTypeString | CType)[],
  );
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
  type: CTypeString | CType | StructDef | ArrayTypeDef | BitFieldDef;
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
export type FieldSpec =
  | CTypeString
  | CType
  | StructDef
  | ArrayTypeDef
  | BitFieldDef
  | AnonymousField;

type JsFromCType<T> = T extends "int64" | "uint64" | "size_t"
  ? bigint
  : T extends
        | "int8"
        | "uint8"
        | "int16"
        | "uint16"
        | "int32"
        | "uint32"
        | "int"
        | "uint"
        | "short"
        | "ushort"
        | "char"
        | "uchar"
        | "float"
        | "double"
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
  readonly baseType: CTypeString;
  readonly bits: number;
  readonly baseSize: number;
}

/** Array type definition */
export interface ArrayTypeDef {
  readonly elementType: CTypeString;
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
  readonly _pointerTo: CTypeString | StructDef;
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
  addField(
    name: string,
    type: CTypeString | CType | StructType | ArrayType,
  ): this;
  getSize(): number;
  getAlignment(): number;
  create(values?: Record<string, any>): Buffer;
  read(buffer: Buffer): Record<string, any>;
}

/** Native ArrayType class */
export class ArrayType {
  constructor(elementType: CTypeString | CType, count: number);
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
export class Structure<
  F extends Record<string, FieldSpec> = Record<string, any>,
> {
  constructor(...args: any[]);
  static _fields_?: Array<[string, FieldSpec]> | Record<string, FieldSpec>;
  static _pack_?: boolean;
  static _anonymous_?: string[];
  static create<ThisT extends Structure<F>>(
    this: new (...args: any[]) => ThisT,
    values?: Partial<FieldsToInstance<F>> | Buffer,
  ): ThisT;
  static toObject<ThisT extends Structure<F>>(
    this: new (...args: any[]) => ThisT,
    buf: Buffer | any,
  ): FieldsToInstance<F>;
  _buffer: Buffer;
  _structDef: StructDef;
  get<K extends keyof F & string>(fieldName: K): FieldsToInstance<F>[K];
  set<K extends keyof F & string>(
    fieldName: K,
    value: FieldsToInstance<F>[K],
  ): void;
  toObject(): FieldsToInstance<F>;
  [field: string]: any; // instance has dynamic properties for fields
}

/**
 * Python-like Union base class.
 */
export class Union<
  F extends Record<string, FieldSpec> = Record<string, any>,
> extends Structure<F> {}

// =============================================================================
// Functions
// =============================================================================

// Library loading
export function load(path: string | null): Library;

// Callbacks
export function callback(
  fn: Function,
  returnType: CTypeString | CType,
  argTypes?: (CTypeString | CType)[],
): CallbackWrapper;
export function threadSafeCallback(
  fn: Function,
  returnType: CTypeString | CType,
  argTypes?: (CTypeString | CType)[],
): CallbackWrapper;

// Memory management - Python-compatible
export function create_string_buffer(init: number | string | Buffer): Buffer;
export function create_unicode_buffer(init: number | string): Buffer;
export function string_at(
  address: Buffer | bigint | number,
  size?: number,
): string | null;
export function wstring_at(
  address: Buffer | bigint | number,
  size?: number,
): string | null;
export function addressof(ptr: Buffer | bigint | number): bigint;
export function memmove(dst: Buffer, src: Buffer | bigint, count: number): void;
export function memset(dst: Buffer, value: number, count: number): void;

// Memory - utility (no direct Python equivalent)
export function readValue(
  ptr: Buffer | bigint | number,
  type: CTypeString | CType,
  offset?: number,
): any;
export function writeValue(
  ptr: Buffer | bigint | number,
  type: CTypeString | CType,
  value: any,
  offset?: number,
): number;
export function sizeof(
  type: CTypeString | CType | StructDef | ArrayTypeDef,
): number;
export function ptrToBuffer(address: bigint | number, size: number): Buffer;

// Structures
export function struct(
  fields: Record<
    string,
    | CTypeString
    | CType
    | StructDef
    | ArrayTypeDef
    | BitFieldDef
    | AnonymousField
  >,
  options?: StructOptions,
): StructDef;
export function union(
  fields: Record<
    string,
    CTypeString | CType | StructDef | ArrayTypeDef | BitFieldDef
  >,
): UnionDef;
// Factory helpers that return a typed class extending Structure/Union
export function defineStruct<F extends Record<string, FieldSpec>>(
  fields: F,
  options?: StructOptions,
): new (...args: any[]) => Structure<F>;
export function defineUnion<F extends Record<string, FieldSpec>>(
  fields: F,
): new (...args: any[]) => Union<F>;
export function array(elementType: CTypeString, count: number): ArrayTypeDef;
export function bitfield(baseType: CTypeString, bits: number): BitFieldDef;

// Pointers
export function byref(obj: Buffer): Buffer;
export function cast(
  ptr: Buffer | bigint,
  targetType: CTypeString | StructDef,
): any;
export function POINTER(baseType: CTypeString | StructDef): PointerTypeDef;

// Error handling
export function get_errno(): number;
export function set_errno(value: number): void;
export function GetLastError(): number;
export function SetLastError(code: number): void;
export function FormatError(code?: number): string;
export function WinError(code?: number): Error & { winerror: number };

// =============================================================================
// Type Aliases (Python-compatible)
// =============================================================================

export const types: Types;
export const c_int: CType;
export const c_uint: CType;
export const c_int8: CType;
export const c_uint8: CType;
export const c_int16: CType;
export const c_uint16: CType;
export const c_int32: CType;
export const c_uint32: CType;
export const c_int64: CType;
export const c_uint64: CType;
export const c_float: CType;
export const c_double: CType;
export const c_char: CType;
export const c_char_p: CType;
export const c_wchar: CType;
export const c_wchar_p: CType;
export const c_void_p: CType;
export const c_bool: CType;
export const c_size_t: CType;
export const c_long: CType;
export const c_ulong: CType;

// =============================================================================
// Constants
// =============================================================================

/** Size of a pointer in bytes (4 on 32-bit, 8 on 64-bit) */
export const POINTER_SIZE: number;

/** Size of wchar_t in bytes (2 on Windows, 4 on Unix) */
export const WCHAR_SIZE: number;

/** Null pointer constant */
export const NULL: null;
