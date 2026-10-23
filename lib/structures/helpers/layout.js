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

/**
 * Layout mode of a class or definition, as Python: `_layout_` if given,
 * otherwise `"ms"` on Windows or with `_pack_`, `"gcc-sysv"` elsewhere.
 *
 * @param {string|undefined} layout - `_layout_`
 * @param {number} pack - `_pack_` (0 when absent)
 * @returns {boolean} true for the gcc-sysv layout
 */
export function isGccLayout(layout, pack) {
  if (layout === undefined || layout === null) {
    return process.platform !== "win32" && !pack;
  }
  if (layout === "ms") return false;
  if (layout === "gcc-sysv") {
    if (pack) throw new Error("_pack_ is not compatible with gcc-sysv layout");
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

  let lastFieldBitSize = 0; // ms layout only
  // `8 * nextByteOffset + nextBitOffset` points to where the next field would start.
  let nextBitOffset = 0;
  let nextByteOffset = 0;
  let structSize = 0;
  let unionSize = 0;

  if (base) {
    structSize = base.size;
    if (gccLayout) nextBitOffset = structSize * 8;
    else nextByteOffset = structSize;
    unionSize = isStruct ? 0 : base.size;
  }

  const offsets = [];
  for (const field of fields) {
    if (!isStruct) {
      // Unions start fresh each time
      lastFieldBitSize = 0;
      nextBitOffset = 0;
      nextByteOffset = 0;
    }

    const isBitField = field.bitSize !== undefined && field.bitSize !== null;
    const typeSize = field.size;
    const typeBitSize = typeSize * 8;
    const bitSize = isBitField ? field.bitSize : typeBitSize;
    if (isBitField && (!Number.isInteger(bitSize) || bitSize <= 0 || bitSize > typeBitSize)) {
      throw new RangeError(`number of bits invalid for bit field ${JSON.stringify(field.name)}`);
    }
    let typeAlign = field.align || 1;
    let offset;
    let bitOffset;

    if (gccLayout) {
      const typeBitAlign = typeAlign * 8;
      // The "slot" sized and aligned for the type that contains the start of
      // the field must also contain its last bit, otherwise pad to the next one.
      const slotEndBit = roundDown(nextBitOffset, typeBitAlign) + typeBitSize;
      if (nextBitOffset + bitSize > slotEndBit) {
        nextBitOffset = roundUp(nextBitOffset, typeBitAlign);
      }
      offset = roundDown(nextBitOffset, typeBitAlign) / 8;
      if (isBitField) bitOffset = nextBitOffset - 8 * offset;
      nextBitOffset += bitSize;
      structSize = roundUp(nextBitOffset, 8) / 8;
    } else {
      if (pack) typeAlign = Math.min(pack, typeAlign);
      // Close the previous bitfield (if any) and start a new allocation unit.
      if (0 < nextBitOffset + bitSize || typeBitSize !== lastFieldBitSize) {
        nextByteOffset = roundUp(nextByteOffset, typeAlign) + typeSize;
        lastFieldBitSize = typeBitSize;
        nextBitOffset = -lastFieldBitSize;
      }
      offset = nextByteOffset - lastFieldBitSize / 8;
      if (isBitField) bitOffset = lastFieldBitSize + nextBitOffset;
      nextBitOffset += bitSize;
      structSize = nextByteOffset;
    }

    if (isBitField && bigEndian) {
      // Bitfields of big-endian structures start from the big end.
      bitOffset = typeBitSize - bitSize - bitOffset;
    }

    offsets.push(isBitField ? { offset, bitOffset } : { offset });
    alignment = Math.max(alignment, typeAlign);
    if (!isStruct) unionSize = Math.max(unionSize, structSize);
  }

  const totalSize = isStruct ? structSize : unionSize;
  return { offsets, size: roundUp(totalSize, alignment), alignment };
}
