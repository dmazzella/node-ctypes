/**
 * @file funcptr.js
 * @module core/funcptr
 * @description Function pointer type factories for calling raw function pointers.
 *
 * Provides CFUNCTYPE and WINFUNCTYPE factories that create callable function
 * types from raw memory addresses (BigInt). This enables COM vtable dispatch
 * and other scenarios where function pointers are obtained at runtime.
 *
 * **Python ctypes Compatibility**:
 * - `CFUNCTYPE(restype, ...argtypes)` ≈ Python's `ctypes.CFUNCTYPE`
 * - `WINFUNCTYPE(restype, ...argtypes)` ≈ Python's `ctypes.WINFUNCTYPE`
 *
 * @example Calling a function by address
 * ```javascript
 * import { WinDLL, WINFUNCTYPE, c_int32, c_void_p, c_wchar_p, c_uint32 } from 'node-ctypes';
 *
 * const user32 = new WinDLL('user32.dll');
 * const msgBoxAddr = user32.symbol('MessageBoxW');
 *
 * const MsgBoxProto = WINFUNCTYPE(c_int32, c_void_p, c_wchar_p, c_wchar_p, c_uint32);
 * const msgBox = MsgBoxProto(msgBoxAddr);
 * msgBox(null, 'Hello from FuncPtr!', 'Test', 0);
 * ```
 *
 * @example COM vtable dispatch
 * ```javascript
 * import { WINFUNCTYPE, c_int32, c_void_p, ptrToBuffer } from 'node-ctypes';
 *
 * // Read vtable pointer from COM object
 * const vtableBuf = ptrToBuffer(objPtr, 8);
 * const vtableAddr = vtableBuf.readBigUInt64LE(0);
 * const vtable = ptrToBuffer(vtableAddr, 24); // 3 IUnknown methods * 8 bytes
 *
 * // QueryInterface is the first vtable entry
 * const QueryInterface = WINFUNCTYPE(c_int32, c_void_p, c_void_p, c_void_p);
 * const qi = QueryInterface(vtable.readBigUInt64LE(0));
 * ```
 */

import { _toNativeType, _toNativeTypes } from "./types.js";

/**
 * Creates a function pointer type factory with cdecl calling convention.
 *
 * @param {Function|Object|number} restype - Return type
 * @param {...(Function|Object|number)} argtypes - Argument types
 * @returns {Function} Factory that accepts a BigInt address and returns a callable
 */
export function createCFUNCTYPE(native) {
  return function CFUNCTYPE(restype, ...argtypes) {
    const nativeRestype = _toNativeType(restype, native);
    const nativeArgtypes = _toNativeTypes(argtypes, native);

    function createFromAddress(address) {
      if (typeof address !== "bigint") {
        throw new TypeError("CFUNCTYPE: address must be a BigInt");
      }

      const ffiFunc = new native.FFIFunction(address, null, nativeRestype, nativeArgtypes);

      const callMethod = function (...args) {
        const processedArgs = processArgs(args);
        return ffiFunc.call(...processedArgs);
      };

      Object.defineProperties(callMethod, {
        funcName: { value: `0x${address.toString(16)}` },
        address: { value: ffiFunc.address },
        _ffi: { value: ffiFunc },
        callAsync: {
          value: function (...args) {
            const processedArgs = processArgs(args);
            return ffiFunc.callAsync(...processedArgs);
          },
          writable: false,
          enumerable: false,
          configurable: false,
        },
        errcheck: {
          get() {
            return ffiFunc._errcheck;
          },
          set(callback) {
            ffiFunc._errcheck = callback;
            ffiFunc.setErrcheck(callback);
          },
          enumerable: false,
          configurable: true,
        },
      });

      return callMethod;
    }

    // Attach metadata to the factory
    createFromAddress.restype = restype;
    createFromAddress.argtypes = argtypes;
    createFromAddress._isFuncPtr = true;

    return createFromAddress;
  };
}

/**
 * Creates a function pointer type factory with stdcall calling convention.
 *
 * @param {Function|Object|number} restype - Return type
 * @param {...(Function|Object|number)} argtypes - Argument types
 * @returns {Function} Factory that accepts a BigInt address and returns a callable
 */
export function createWINFUNCTYPE(native) {
  return function WINFUNCTYPE(restype, ...argtypes) {
    const nativeRestype = _toNativeType(restype, native);
    const nativeArgtypes = _toNativeTypes(argtypes, native);

    function createFromAddress(address) {
      if (typeof address !== "bigint") {
        throw new TypeError("WINFUNCTYPE: address must be a BigInt");
      }

      const ffiFunc = new native.FFIFunction(address, null, nativeRestype, nativeArgtypes, { abi: "stdcall" });

      const callMethod = function (...args) {
        const processedArgs = processArgs(args);
        return ffiFunc.call(...processedArgs);
      };

      Object.defineProperties(callMethod, {
        funcName: { value: `0x${address.toString(16)}` },
        address: { value: ffiFunc.address },
        _ffi: { value: ffiFunc },
        callAsync: {
          value: function (...args) {
            const processedArgs = processArgs(args);
            return ffiFunc.callAsync(...processedArgs);
          },
          writable: false,
          enumerable: false,
          configurable: false,
        },
        errcheck: {
          get() {
            return ffiFunc._errcheck;
          },
          set(callback) {
            ffiFunc._errcheck = callback;
            ffiFunc.setErrcheck(callback);
          },
          enumerable: false,
          configurable: true,
        },
      });

      return callMethod;
    }

    // Attach metadata to the factory
    createFromAddress.restype = restype;
    createFromAddress.argtypes = argtypes;
    createFromAddress._isFuncPtr = true;

    return createFromAddress;
  };
}

/**
 * Process arguments, extracting _buffer from struct/union proxies.
 * @private
 */
function processArgs(args) {
  const processedArgs = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg && typeof arg === "object") {
      if (arg._buffer !== undefined && Buffer.isBuffer(arg._buffer)) {
        processedArgs.push(arg._buffer);
      } else if (Buffer.isBuffer(arg)) {
        processedArgs.push(arg);
      } else {
        processedArgs.push(arg);
      }
    } else {
      processedArgs.push(arg);
    }
  }
  return processedArgs;
}
