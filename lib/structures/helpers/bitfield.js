/**
 * @file bitfield.js
 * @module structures/helpers/bitfield
 * @description Readers and writers of bitfields in structs and unions.
 *
 * A bitfield is `bitSize` bits at `bitOffset` inside an allocation unit of
 * its base type (`baseSize` bytes at `offset`), as computed by layout.js.
 * Values are truncated to the field width on write; signed base types are
 * sign-extended on read, as in Python ctypes. Fields up to 53 bits read as
 * numbers, wider ones (only possible with 64-bit base types) as BigInt.
 */

const readers = {
  1: { le: (buf, off) => buf.readUInt8(off), be: (buf, off) => buf.readUInt8(off) },
  2: { le: (buf, off) => buf.readUInt16LE(off), be: (buf, off) => buf.readUInt16BE(off) },
  4: { le: (buf, off) => buf.readUInt32LE(off), be: (buf, off) => buf.readUInt32BE(off) },
  8: { le: (buf, off) => buf.readBigUInt64LE(off), be: (buf, off) => buf.readBigUInt64BE(off) },
};

const writers = {
  1: { le: (buf, off, v) => buf.writeUInt8(v, off), be: (buf, off, v) => buf.writeUInt8(v, off) },
  2: { le: (buf, off, v) => buf.writeUInt16LE(v, off), be: (buf, off, v) => buf.writeUInt16BE(v, off) },
  4: { le: (buf, off, v) => buf.writeUInt32LE(v, off), be: (buf, off, v) => buf.writeUInt32BE(v, off) },
  8: { le: (buf, off, v) => buf.writeBigUInt64LE(v, off), be: (buf, off, v) => buf.writeBigUInt64BE(v, off) },
};

import { notIntegral } from "./common.js";

/**
 * Reader and writer of one bitfield.
 *
 * @param {Object} field
 * @param {number} field.offset - Byte offset of the allocation unit
 * @param {number} field.baseSize - Size of the base type (1, 2, 4 or 8)
 * @param {number} field.bitOffset - First bit inside the unit
 * @param {number} field.bitSize - Width in bits
 * @param {boolean} [field.signed=false] - Signed base type
 * @param {boolean} [field.bigEndian=false] - Unit stored big-endian
 * @returns {{read: (buf: Buffer) => number|bigint, write: (buf: Buffer, value: number|bigint) => void}}
 */
export function bitFieldAccessors({ offset, baseSize, bitOffset, bitSize, signed = false, bigEndian = false }) {
  const order = bigEndian ? "be" : "le";
  const readUnit = readers[baseSize]?.[order];
  const writeUnit = writers[baseSize]?.[order];
  if (readUnit === undefined) throw new RangeError(`Unsupported bitfield base size: ${baseSize}`);

  if (baseSize === 8) {
    const shift = BigInt(bitOffset);
    const width = BigInt(bitSize);
    const mask = ((1n << width) - 1n) << shift;
    const toValue = bitSize <= 53 ? Number : (v) => v;
    return {
      read: (buf) => {
        const raw = (readUnit(buf, offset) & mask) >> shift;
        return toValue(signed ? BigInt.asIntN(bitSize, raw) : raw);
      },
      write: (buf, value) => {
        if (typeof value === "number" && !Number.isInteger(value)) notIntegral();
        const bits = BigInt.asUintN(bitSize, BigInt(value)) << shift;
        writeUnit(buf, offset, (readUnit(buf, offset) & ~mask) | bits);
      },
    };
  }

  // Units up to 32 bits: >>> 0 keeps the results unsigned (also for 32-bit fields).
  const fieldMask = bitSize === 32 ? 0xffffffff : 2 ** bitSize - 1;
  const unitMask = (fieldMask * 2 ** bitOffset) >>> 0;
  const unsignedValue = (value) => {
    if (typeof value === "bigint") return Number(BigInt.asUintN(bitSize, value)) >>> 0;
    if (typeof value === "number" && !Number.isInteger(value)) notIntegral();
    return (Number(value) & fieldMask) >>> 0;
  };
  const signShift = 32 - bitSize;
  return {
    read: signed ? (buf) => (((readUnit(buf, offset) & unitMask) >>> bitOffset) << signShift) >> signShift : (buf) => (readUnit(buf, offset) & unitMask) >>> bitOffset,
    write: (buf, value) => {
      const bits = (unsignedValue(value) << bitOffset) >>> 0;
      writeUnit(buf, offset, ((readUnit(buf, offset) & ~unitMask) | bits) >>> 0);
    },
  };
}
