/** Pointer registrations and leases belong to the backing memory, not to an individual view. */
import { flush, mirrorsActive, refresh } from "./mirror.js";
import { POINTER_SIZE } from "../platform/constants.js";

export function sourceBytes(source, offset, size, name) {
  const bytes = source !== null && typeof source === "object" && !ArrayBuffer.isView(source) && Buffer.isBuffer(source._buffer) ? source._buffer : source;
  if (!ArrayBuffer.isView(bytes)) throw new TypeError(`${name}: source must be a Buffer, a typed array or a ctypes instance`);
  if (!Number.isSafeInteger(offset)) throw new TypeError(`${name}: offset must be a safe integer`);
  if (offset < 0) throw new RangeError(`${name}: offset cannot be negative`);
  if (bytes.byteLength - offset < size) throw new RangeError(`${name}: Buffer size too small (${bytes.byteLength} instead of at least ${size + offset} bytes)`);
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function keepFunctionOwner(fn, owner) {
  if (owner !== undefined) {
    Object.defineProperty(fn, "_objects", { value: owner });
    // AsyncWorker pins the native handle, not its public JS function.
    Object.defineProperty(fn._ffi, "_objects", { value: owner });
  }
  return fn;
}

const keptObjects = new WeakMap();

const memoryOwners = new WeakMap();

// Address-backed aliases share the reference table of their known owner.
const memoryDomains = new WeakMap();

export function memoryDomain(buf) {
  return memoryDomains.get(buf.buffer) ?? { root: buf.buffer, offset: 0n };
}

function memoryPosition(buf, offset) {
  return BigInt(buf.byteOffset + offset) + (memoryDomains.get(buf.buffer)?.offset ?? 0n);
}

export function shareMemory(buf, memory, position) {
  memoryDomains.set(buf.buffer, { root: memory.root, offset: position - BigInt(buf.byteOffset) });
  return keepMemoryOwner(buf, memory);
}

// Attach to the backing store, so subarrays and typed arrays keep the lease too.
export function keepMemoryOwner(buf, owner) {
  if (owner === undefined || owner === null) return buf;
  let owners = memoryOwners.get(buf.buffer);
  if (owners === undefined) memoryOwners.set(buf.buffer, (owners = new Set()));
  owners.add(owner);
  return buf;
}

function storedAddress(buf, offset) {
  return POINTER_SIZE === 8 ? buf.readBigUInt64LE(offset) : BigInt(buf.readUInt32LE(offset));
}

export function pointerOwner(buf, offset, address) {
  const root = memoryDomains.get(buf.buffer)?.root ?? buf.buffer;
  const kept = keptObjects.get(root);
  if (kept === undefined) return buf;
  const position = memoryPosition(buf, offset);
  const reference = kept.get(position);
  if (reference !== undefined && reference.address !== (address ?? storedAddress(buf, offset))) {
    kept.delete(position);
    return buf;
  }
  return reference?.owner ?? buf;
}

export function inDllBuffer(library, name, size, ptrToBuffer) {
  const lib = library?._lib ?? library;
  if (typeof lib?._symbolView !== "function") throw new TypeError("in_dll: first arg must be a Library (CDLL/WinDLL)");
  const { address, owner } = lib._symbolView(name);
  return keepMemoryOwner(ptrToBuffer(address, size), owner);
}

function pointerSlots(type, offset = 0, size) {
  if (type?._isPointerValued || type?._isFuncPtr || type?._pointerTo !== undefined) return [[offset, type._size ?? type.size ?? size]];
  if (type?._isArrayType) {
    const slots = [];
    const elementSize = type.length === 0 ? 0 : type.getSize() / type.length;
    const elements = pointerSlots(type.elementType, 0, elementSize);
    if (elements.length === 0) return slots;
    for (let i = 0; i < type.length; i++) {
      for (const [position, width] of elements) slots.push([offset + i * elementSize + position, width]);
    }
    return slots;
  }
  const def = typeof type?._buildStruct === "function" ? (type._structDef ?? type._buildStruct()) : type;
  const slots = [];
  for (const field of def?.fields ?? []) {
    if (field.isPointer) slots.push([offset + field.offset, field.size]);
    else slots.push(...pointerSlots(field.type, offset + field.offset, field.size));
  }
  return slots;
}

/**
 * Keep `value` alive as long as the memory of `targetBuf`, like Python ctypes
 * `_objects`: an object whose address is stored in the buffer (string,
 * pointer, callback) must not be garbage collected while native code can
 * still read that address. The table belongs to the memory, not to the view,
 * so assigning through a nested structure keeps the object alive with the
 * outer one.
 *
 * @param {Uint8Array} targetBuf - Buffer holding the address
 * @param {number} offset - Offset of the slot in `targetBuf`
 * @param {*} value - Referenced object (or null to clear the slot)
 */
export function keepAlive(targetBuf, offset, value) {
  const position = memoryPosition(targetBuf, offset);
  const root = memoryDomains.get(targetBuf.buffer)?.root ?? targetBuf.buffer;
  let kept = keptObjects.get(root);
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    kept?.delete(position);
    return;
  }
  if (kept === undefined) {
    kept = new Map();
    keptObjects.set(root, kept);
  }
  // A pointer wrapper can later be repointed; retain its current memory.
  if (value._pointerType !== undefined) value = value._buffer ?? value._objects ?? value;
  else if (value._isSimpleCDataInstance && value.constructor._isPointerValued) value = pointerOwner(value._buffer, 0);
  kept.set(position, { owner: value, address: storedAddress(targetBuf, offset) });
}

/**
 * Object kept alive at `offset` of `buf` (see {@link keepAlive}).
 *
 * @param {Uint8Array} buf - Buffer
 * @param {number} offset - Offset in `buf`
 * @returns {*} The object, or undefined
 */
export function keptObject(buf, offset) {
  const root = memoryDomains.get(buf.buffer)?.root ?? buf.buffer;
  return keptObjects.get(root)?.get(memoryPosition(buf, offset))?.owner;
}

export function clearKeepAlives(buf, offset, size) {
  const root = memoryDomains.get(buf.buffer)?.root ?? buf.buffer;
  const kept = keptObjects.get(root);
  if (kept === undefined) return;
  const start = BigInt(memoryPosition(buf, offset));
  const end = start + BigInt(size);
  for (const position of kept.keys()) {
    if (position >= start && position < end) kept.delete(position);
  }
}

/**
 * Copy a struct/union instance into a nested field: the bytes (as Python
 * does) plus the objects it keeps alive (strings, pointers, callbacks), so
 * the addresses copied with them stay valid.
 *
 * @param {Buffer} buf - Target buffer
 * @param {number} offset - Field offset
 * @param {number} size - Field size
 * @param {Object|Buffer} value - Instance with a `_buffer`, or source bytes
 * @param {number} [sourceOffset=0] - Byte offset in the source
 * @param {Function|Object} [type] - Layout used to retain references into leased memory
 */
export function copyInstance(buf, offset, size, value, sourceOffset = 0, type) {
  const bytes = value._buffer ?? value;
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mirrorsActive) refresh(source, sourceOffset, size);
  // Source and destination can overlap, including their reference tables.
  const owners = snapshotOwners(source, sourceOffset, size, type);
  source.copy(buf, offset, sourceOffset, sourceOffset + size);
  clearKeepAlives(buf, offset, size);
  for (const [relative, owner] of owners) keepAlive(buf, offset + relative, owner);
  if (mirrorsActive) flush(buf, offset, size);
}

function snapshotOwners(source, sourceOffset, size, type) {
  const start = memoryPosition(source, sourceOffset);
  const sourceRoot = memoryDomains.get(source.buffer)?.root ?? source.buffer;
  const sourceKept = keptObjects.get(sourceRoot);
  const snapshot = new Map();
  if (sourceKept !== undefined) {
    for (const [position, reference] of sourceKept) {
      if (position < start || position + BigInt(POINTER_SIZE) > start + BigInt(size)) continue;
      const relative = Number(position - start);
      if (reference.address === storedAddress(source, sourceOffset + relative)) {
        snapshot.set(relative, reference.owner);
      } else {
        // A leased copy can retain the source buffer, so don't leave a stale owner on it.
        sourceKept.delete(position);
      }
    }
  }
  if (type !== undefined && memoryOwners.has(source.buffer)) {
    for (const [position, width] of pointerSlots(type)) {
      if (snapshot.has(position) || position + width > size) continue;
      for (let i = 0; i < width; i++) {
        if (source[sourceOffset + position + i] !== 0) {
          snapshot.set(position, source);
          break;
        }
      }
    }
  }
  return snapshot;
}

// Keep the owners of the copied addresses even if a later adapter overwrites
// the original pointer fields. Plain bytes need no reference bookkeeping.
export function snapshotArgumentBytes(view, def) {
  const size = def.size;
  const copy = Buffer.alloc(size);
  if (memoryOwners.has(view.buffer) || keptObjects.has(memoryDomains.get(view.buffer)?.root ?? view.buffer)) {
    copyInstance(copy, 0, size, Buffer.from(view.buffer, view.byteOffset, size), 0, def);
  } else {
    const source = view instanceof Uint8Array && view.length === size ? view : Buffer.from(view.buffer, view.byteOffset, size);
    if (mirrorsActive) refresh(source, 0, size);
    copy.set(source);
  }
  return copy;
}
