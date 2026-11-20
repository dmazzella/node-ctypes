/**
 * @file layout.js
 * @module structures/helpers/layout
 * @description Field layout of structures and unions, ported from CPython's
 * `ctypes._layout.get_layout` (Python 3.14+), so that offsets, bitfields,
 * `_pack_`, `_align_`, `_layout_` and inheritance give the same result as
 * Python ctypes.
 *
 * Two layouts exist, as in Python:
 * - `"gcc-sysv"` (default except on Windows): fields are placed bit by bit; a
 *   bitfield that would cross a boundary of its type moves to the next one.
 * - `"ms"` (default on Windows, and whenever `_pack_` is set): adjacent
 *   bitfields share an allocation unit only if their types have the same size
 *   and the next one fits.
 */

const roundDown = (n, multiple) => Math.floor(n / multiple) * multiple;
const roundUp = (n, multiple) => Math.ceil(n / multiple) * multiple;

export function normalizePack(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") {
    if (!/^[+-]?\d+$/.test(value.trim())) throw new TypeError("_pack_ must be convertible to an integer");
    value = Number(value);
  } else if (typeof value === "boolean" || typeof value === "bigint") {
    value = Number(value);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("_pack_ must be convertible to an integer");
  const pack = Math.trunc(value);
  if (pack < 0 || pack > 0x7fffffff) throw new RangeError("_pack_ must be between 0 and 2147483647");
  return pack;
}

/**
 * Layout mode of a class or definition, as Python: `_layout_` if given,
 * otherwise `"ms"` on Windows or with `_pack_`, `"gcc-sysv"` elsewhere.
 *
 * @param {string|undefined} layout - `_layout_`
 * @param {number} pack - `_pack_` (0 when absent)
 * @returns {boolean} true for the gcc-sysv layout
 */
export function isGccLayout(layout, pack, specified = pack !== 0) {
  if (layout === undefined || layout === null) {
    return process.platform !== "win32" && !specified;
  }
  if (layout === "ms") return false;
  if (layout === "gcc-sysv") {
    if (specified) throw new Error("_pack_ is not compatible with gcc-sysv layout");
    return true;
  }
  throw new Error(`unknown _layout_: ${String(layout)}`);
}

/**
 * Compute the layout of a structure or union.
 *
 * @param {Array<{size: number, align: number, bitSize?: number}>} fields -
 *   Size and alignment of each field type; `bitSize` for bitfields.
 * @param {Object} options
 * @param {boolean} options.isStruct - false for unions
 * @param {boolean} options.gccLayout - see {@link isGccLayout}
 * @param {number} [options.pack=0] - `_pack_` (ms layout only)
 * @param {number} [options.align=1] - `_align_` (minimum alignment)
 * @param {{size: number, alignment: number}} [options.base] - Layout of the base class
 * @param {boolean} [options.bigEndian=false] - Bitfields laid out from the big end
 * @returns {{offsets: Array<{offset: number, bitOffset?: number}>, size: number, alignment: number}}
 */
export function computeLayout(fields, { isStruct, gccLayout, pack = 0, align = 1, base = null, bigEndian = false }) {
  if (!Number.isInteger(align) || align < 0) throw new RangeError("_align_ must be a non-negative integer");
  let alignment = Math.max(align, 1);
  if (base) alignment = Math.max(base.alignment, alignment);

  let size = base ? base.size : 0;
  let unionSize = isStruct ? 0 : size;
  let nextBit = size * 8; // SysV can reuse the tail of a partially occupied byte.
  let msUnitSize = 0;
  let msBitsLeft = 0;

  const offsets = [];
  for (const field of fields) {
    if (!isStruct) {
      size = nextBit = msUnitSize = msBitsLeft = 0;
    }

    const typeSize = field.size;
    const naturalAlign = field.align || 1;
    const typeAlign = !gccLayout && pack ? Math.min(pack, naturalAlign) : naturalAlign;
    const bitSize = field.bitSize;
    if (bitSize == null) {
      // MS reuses an empty allocation unit for another zero-sized field.
      const reuseEmptyUnit = !gccLayout && typeSize === 0 && msUnitSize === 0;
      const offset = reuseEmptyUnit ? size : roundUp(size, typeAlign);
      size = offset + typeSize;
      nextBit = size * 8;
      msUnitSize = typeSize;
      msBitsLeft = 0;
      offsets.push({ offset });
    } else {
      const typeBitSize = typeSize * 8;
      if (!Number.isInteger(bitSize) || bitSize <= 0 || bitSize > typeBitSize) {
        throw new RangeError(`number of bits invalid for bit field ${JSON.stringify(field.name)}`);
      }

      let offset, bitOffset;
      if (gccLayout) {
        const bitAlign = typeAlign * 8;
        // The aligned slot containing the first bit must also contain the last.
        const slotEnd = roundDown(nextBit, bitAlign) + typeBitSize;
        if (nextBit + bitSize > slotEnd) nextBit = roundUp(nextBit, bitAlign);
        offset = roundDown(nextBit, bitAlign) / 8;
        bitOffset = nextBit - offset * 8;
        nextBit += bitSize;
        size = Math.ceil(nextBit / 8);
      } else {
        if (msUnitSize !== typeSize || msBitsLeft < bitSize) {
          size = roundUp(size, typeAlign) + typeSize;
          msUnitSize = typeSize;
          msBitsLeft = typeBitSize;
        }
        offset = size - typeSize;
        bitOffset = typeBitSize - msBitsLeft;
        msBitsLeft -= bitSize;
      }
      offsets.push({ offset, bitOffset: bigEndian ? typeBitSize - bitSize - bitOffset : bitOffset });
    }
    alignment = Math.max(alignment, typeAlign);
    if (!isStruct) unionSize = Math.max(unionSize, size);
  }

  const totalSize = isStruct ? size : unionSize;
  return { offsets, size: roundUp(totalSize, alignment), alignment };
}
