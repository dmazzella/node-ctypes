/**
 * node-ctypes - Python ctypes-like FFI for Node.js
 *
 * A simple FFI library that allows calling C functions from JavaScript,
 * similar to Python's ctypes module.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Get the path to the native module, checking multiple possible locations
 * @param {string} moduleName - The name of the npm module
 * @param {string} nativeFile - The name of the native .node file
 * @param {string} config - Build configuration (Release or Debug)
 * @returns {string} The absolute path to the native module
 */
const getNativeModulePath = (moduleName, nativeFile, config = "Release") => {
  const buildPath = (base) => path.join(base, "build", config, nativeFile);

  // Check if running in Electron
  if (process.versions?.electron) {
    const electronProcess = process;
    if (electronProcess.resourcesPath) {
      const unpackedPath = path.join(electronProcess.resourcesPath, "app.asar.unpacked", "node_modules", moduleName);
      if (existsSync(buildPath(unpackedPath))) {
        return buildPath(unpackedPath);
      }
    }
  }

  // Check in current working directory's node_modules
  const cwdPath = buildPath(path.join(process.cwd(), "node_modules", moduleName));
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  // Check local build directory in the project root (useful for local testing)
  const localBuildPath = buildPath(process.cwd());
  if (existsSync(localBuildPath)) {
    return localBuildPath;
  }

  // Try Debug build as fallback
  if (config === "Release") {
    try {
      return getNativeModulePath(moduleName, nativeFile, "Debug");
    } catch (e) {
      // Continue to error below
    }
  }

  throw new Error(`Native module "${nativeFile}" not found for "${moduleName}". ` + `Searched in Electron resources, node_modules, and local build.`);
};

// Load the native module
let nativeModulePath;
try {
  nativeModulePath = getNativeModulePath("node-ctypes", `ctypes.node`);
} catch (e) {
  const platform = process.platform;
  const arch = process.arch;
  nativeModulePath = getNativeModulePath("node-ctypes", `ctypes-${platform}-${arch}.node`);
}
const require = createRequire(path.join(process.cwd(), "index.js"));
const native = require(nativeModulePath);

// Re-esporta le classi native
const { Version, Library, FFIFunction, Callback, ThreadSafeCallback, CType, StructType, ArrayType } = native;

// Tipi predefiniti
const types = native.types;

// ============================================================================
// Type Normalization Helper
// Converts SimpleCData classes to their string type names for FFI
// ============================================================================

/**
 * Converte un tipo SimpleCData nel formato richiesto dal modulo nativo FFI
 * @param {Function} type - Classe SimpleCData
 * @returns {string|Object} Tipo per FFI nativo
 */
function _toNativeType(type) {
  if (typeof type === "function" && type._isSimpleCData) {
    // String pointer types need native CType for automatic conversion
    if (type._type === "char_p") return types.c_char_p;
    if (type._type === "wchar_p") return types.c_wchar_p;
    return type._type;
  }
  // Struct/Union classes pass through
  if (typeof type === "function" && (type.prototype instanceof Structure || type.prototype instanceof Union)) {
    return type;
  }
  // Native CType objects pass through
  return type;
}

/**
 * Normalizza un array di tipi
 * @param {Array} types - Array di tipi
 * @returns {Array} Array di tipi normalizzati
 */
function _toNativeTypes(types) {
  if (!Array.isArray(types)) return types;
  return types.map(_toNativeType);
}

/**
 * Carica una libreria dinamica
 * @param {string|null} libPath - Percorso della libreria o null per l'eseguibile corrente
 * @returns {Library} Oggetto Library
 */
function load(libPath) {
  return new Library(libPath);
}

/**
 * Wrapper per funzioni con sintassi Python-like ctypes (argtypes/restype)
 */
class FunctionWrapper {
  constructor(cdll, name) {
    const argtypes = [];
    let restype = undefined;
    let cachedFunc = null;

    // Create a function and proxy it to make it callable
    const func = (...args) => {
      if (restype === undefined) {
        throw new Error(`Function ${name}: restype not set`);
      }
      if (!cachedFunc) {
        cachedFunc = cdll.func(name, restype, argtypes);
      }
      return cachedFunc(...args);
    };

    // Proxy the function to intercept property access
    return new Proxy(func, {
      get(target, prop) {
        if (prop === "argtypes") return argtypes;
        if (prop === "restype") return restype;
        if (prop === "errcheck") return cachedFunc ? cachedFunc.errcheck : undefined;
        return target[prop];
      },
      set(target, prop, value) {
        if (prop === "argtypes") {
          argtypes.splice(0, argtypes.length, ...value);
          cachedFunc = null; // Invalidate cache
          return true;
        }
        if (prop === "restype") {
          restype = value;
          cachedFunc = null; // Invalidate cache
          return true;
        }
        if (prop === "errcheck") {
          if (!cachedFunc) {
            if (restype === undefined) {
              throw new Error(`Function ${name}: restype not set`);
            }
            cachedFunc = cdll.func(name, restype, argtypes);
          }
          cachedFunc.errcheck = value;
          return true;
        }
        target[prop] = value;
        return true;
      },
    });
  }
}

/**
 * Wrapper conveniente per CDLL (come in Python ctypes)
 */
class CDLL {
  constructor(libPath) {
    this._lib = new Library(libPath);
    this._cache = new Map();

    // Return a proxy to enable Python-like syntax: libc.abs.argtypes = [...]; libc.abs.restype = ...; libc.abs(...)
    return new Proxy(this, {
      get(target, prop, receiver) {
        // Allow access to existing properties/methods
        if (prop in target || typeof prop !== "string") {
          return Reflect.get(target, prop, receiver);
        }
        // Assume it's a function name from the library
        return new FunctionWrapper(target, prop);
      },
    });
  }

  /**
   * Ottiene una funzione dalla libreria
   * @param {string} name - Nome della funzione
   * @param {string|CType} returnType - Tipo di ritorno
   * @param {Array<string|CType>} argTypes - Tipi degli argomenti
   * @param {Object} [options] - Opzioni aggiuntive (es. { abi: 'stdcall' })
   * @returns {Function} Funzione callable
   */
  func(name, returnType, argTypes = [], options = {}) {
    const cacheKey = `${name}:${returnType}:${argTypes.join(",")}`;

    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const ffiFunc = this._lib.func(name, _toNativeType(returnType), _toNativeTypes(argTypes), options);

    // =========================================================================
    // OPTIMIZATION: Create specialized wrapper based on argument types
    // For primitive-only args, bypass the processing loop entirely
    // =========================================================================

    const argCount = argTypes.length;

    // Check if all args are primitive types (no structs/buffers that need _buffer extraction)
    const allPrimitive = argTypes.every((t) => {
      if (typeof t === "function" && t._isSimpleCData) {
        // SimpleCData types that are NOT pointers are primitive
        const typeName = t._type;
        return typeName !== "pointer" && typeName !== "char_p" && typeName !== "wchar_p";
      }
      if (typeof t === "string") {
        return t !== "pointer" && t !== "char_p" && t !== "wchar_p" && t !== "void_p";
      }
      // CType objects from native - check if it's a pointer type
      if (t && typeof t === "object" && t.name) {
        return !t.name.includes("pointer") && !t.name.includes("char_p");
      }
      return false;
    });

    let callMethod;

    if (argCount === 0) {
      // FAST PATH: No arguments - direct call
      callMethod = function () {
        return ffiFunc.call();
      };
    } else if (allPrimitive) {
      // FAST PATH: All primitive args - direct call without processing
      switch (argCount) {
        case 1:
          callMethod = function (a0) {
            return ffiFunc.call(a0);
          };
          break;
        case 2:
          callMethod = function (a0, a1) {
            return ffiFunc.call(a0, a1);
          };
          break;
        case 3:
          callMethod = function (a0, a1, a2) {
            return ffiFunc.call(a0, a1, a2);
          };
          break;
        case 4:
          callMethod = function (a0, a1, a2, a3) {
            return ffiFunc.call(a0, a1, a2, a3);
          };
          break;
        default:
          // Fallback for many args
          callMethod = function (...args) {
            return ffiFunc.call(...args);
          };
      }
    } else {
      // SLOW PATH: Has buffer/struct args - need to extract _buffer
      callMethod = function (...args) {
        const processedArgs = [];

        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          // Check for _buffer FIRST (handles Proxy-wrapped structs)
          // This avoids calling Buffer.isBuffer() on Proxy which can cause issues
          if (arg && typeof arg === "object") {
            // Check for struct proxy FIRST - accessing _buffer on Proxy is safe
            // but Buffer.isBuffer(proxy) can cause hangs
            if (arg._buffer !== undefined && Buffer.isBuffer(arg._buffer)) {
              // Struct proxy or object with _buffer
              processedArgs.push(arg._buffer);
            } else if (Buffer.isBuffer(arg)) {
              // Already a buffer, use directly
              processedArgs.push(arg);
            } else {
              // Other object, pass as-is
              processedArgs.push(arg);
            }
          } else {
            // Primitive value (number, string, bigint, null, undefined)
            processedArgs.push(arg);
          }
        }

        return ffiFunc.call(...processedArgs);
      };
    }

    // Aggiungi metadata come proprietà non-enumerable per non interferire
    Object.defineProperties(callMethod, {
      funcName: { value: name },
      address: { value: ffiFunc.address },
      _ffi: { value: ffiFunc },
      // Esponi errcheck come setter/getter
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

    this._cache.set(cacheKey, callMethod);
    return callMethod;
  }

  /**
   * Ottiene l'indirizzo di un simbolo
   * @param {string} name - Nome del simbolo
   * @returns {BigInt} Indirizzo del simbolo
   */
  symbol(name) {
    return this._lib.symbol(name);
  }

  /**
   * Crea un callback JS chiamabile da C
   * @param {Function} fn - Funzione JavaScript
   * @param {string|CType} returnType - Tipo di ritorno
   * @param {Array<string|CType>} argTypes - Tipi degli argomenti
   * @returns {Object} Oggetto callback con proprietà pointer e metodi
   */
  callback(fn, returnType, argTypes = []) {
    return this._lib.callback(_toNativeType(returnType), _toNativeTypes(argTypes), fn);
  }

  /**
   * Chiude la libreria
   */
  close() {
    this._lib.close();
    this._cache.clear();
  }

  get path() {
    return this._lib.path;
  }

  get loaded() {
    return this._lib.loaded;
  }
}

/**
 * WinDLL - come CDLL ma con stdcall di default (per Windows)
 */
class WinDLL extends CDLL {
  func(name, returnType, argTypes = [], options = {}) {
    return super.func(name, returnType, argTypes, {
      abi: "stdcall",
      ...options,
    });
  }
}

/**
 * Crea un callback JS chiamabile da C (solo main thread)
 *
 * Questo callback è veloce e senza overhead, ma DEVE essere chiamato
 * solo dal main thread di Node.js (es: qsort, EnumWindows, etc.)
 *
 * Per callback da thread esterni (es: CreateThread), usa threadSafeCallback()
 *
 * @param {Function} fn - Funzione JavaScript
 * @param {string|CType} returnType - Tipo di ritorno
 * @param {Array<string|CType>} argTypes - Tipi degli argomenti
 * @returns {Object} Oggetto con .pointer (BigInt), .release()
 */
function callback(fn, returnType, argTypes = []) {
  const cb = new Callback(fn, _toNativeType(returnType), _toNativeTypes(argTypes));

  return {
    get pointer() {
      return cb.pointer;
    },
    release() {
      cb.release();
    },
    _callback: cb,
  };
}

/**
 * Crea un callback JS chiamabile da qualsiasi thread
 *
 * Questo callback può essere invocato da thread C esterni (es: CreateThread,
 * thread pool, etc.) in modo sicuro. Ha overhead maggiore rispetto a callback()
 * per la sincronizzazione tra thread.
 *
 * Per callback dal main thread (es: qsort), preferisci callback() che è più veloce.
 *
 * @param {Function} fn - Funzione JavaScript
 * @param {string|CType} returnType - Tipo di ritorno
 * @param {Array<string|CType>} argTypes - Tipi degli argomenti
 * @returns {Object} Oggetto con .pointer (BigInt), .release()
 */
function threadSafeCallback(fn, returnType, argTypes = []) {
  const cb = new ThreadSafeCallback(fn, _toNativeType(returnType), _toNativeTypes(argTypes));

  return {
    get pointer() {
      return cb.pointer;
    },
    release() {
      cb.release();
    },
    _callback: cb,
  };
}

/**
 * Alloca memoria nativa
 * @param {number} size - Dimensione in bytes
 * @returns {Buffer} Buffer allocato
 */
function alloc(size) {
  // Usa Buffer.alloc direttamente per performance (evita chiamata nativa)
  return Buffer.alloc(size);
}

/**
 * Crea un buffer con una stringa C null-terminata
 * @param {string} str - Stringa JavaScript
 * @returns {Buffer} Buffer con stringa C
 */
function cstring(str) {
  return native.cstring(str);
}

/**
 * Crea un buffer con una stringa wide (wchar_t*) null-terminata
 * @param {string} str - Stringa JavaScript
 * @returns {Buffer} Buffer con stringa wide
 */
function wstring(str) {
  // Converti stringa JS a UTF-16LE (che è come wchar_t su Windows)
  const buf = Buffer.from(str + "\0", "utf16le");
  return buf;
}

/**
 * Legge una stringa C da un puntatore
 * @param {Buffer|BigInt|number} ptr - Puntatore alla stringa
 * @param {number} [maxLen] - Lunghezza massima da leggere
 * @returns {string|null} Stringa letta o null
 */
function readCString(ptr, maxLen) {
  return native.readCString(ptr, maxLen);
}

/**
 * Legge una stringa wide (wchar_t*) da un puntatore
 * @param {Buffer|BigInt|number} ptr - Puntatore alla stringa wide
 * @param {number} [size] - Numero di caratteri da leggere (non bytes)
 * @returns {string|null} Stringa letta o null
 */
function readWString(ptr, size) {
  if (ptr === null || ptr === undefined) {
    return null;
  }

  const wcharSize = native.WCHAR_SIZE; // 2 su Windows, 4 su Unix

  let buf;
  if (Buffer.isBuffer(ptr)) {
    buf = ptr;
  } else {
    // Converti BigInt/number in buffer
    const maxBytes = size ? size * wcharSize : 1024;
    buf = native.ptrToBuffer(ptr, maxBytes);
  }

  // Trova il null terminator
  let end = size ? size * wcharSize : buf.length;

  if (wcharSize === 2) {
    // Windows: UTF-16LE
    for (let i = 0; i < end; i += 2) {
      if (i + 1 < buf.length && buf.readUInt16LE(i) === 0) {
        end = i;
        break;
      }
    }
    return buf.toString("utf16le", 0, end);
  } else {
    // Unix: UTF-32LE (wchar_t è 32-bit)
    let chars = [];
    for (let i = 0; i < end; i += 4) {
      if (i + 3 >= buf.length) break;
      const codePoint = buf.readUInt32LE(i);
      if (codePoint === 0) break;
      chars.push(String.fromCodePoint(codePoint));
    }
    return chars.join("");
  }
}

/**
 * Legge un valore dalla memoria
 * Per tipi base comuni usa lookup table
 * @param {Buffer|BigInt|number} ptr - Puntatore
 * @param {string|CType} type - Tipo del valore
 * @param {number} [offset=0] - Offset in bytes
 * @returns {*} Valore letto
 */
function readValue(ptr, type, offset = 0) {
  // SimpleCData class - use its _reader directly
  if (typeof type === "function" && type._isSimpleCData) {
    if (Buffer.isBuffer(ptr)) {
      return type._reader(ptr, offset);
    }

    // Allow passing an address (BigInt or number) and convert to buffer
    if (typeof ptr === "bigint" || typeof ptr === "number") {
      const size = type._size || sizeof(type);
      const buf = ptrToBuffer(ptr, size + offset);
      return type._reader(buf, offset);
    }

    throw new TypeError("readValue requires a Buffer or pointer address");
  }

  // Struct type (class)
  if (typeof type === "function" && type.prototype instanceof Structure) {
    const def = type._structDef || type._buildStruct();
    const tempBuf = ptr.subarray(offset, offset + def.size);
    return def.toObject(tempBuf);
  }

  // Union type (class)
  if (typeof type === "function" && type.prototype instanceof Union) {
    const def = type._unionDef || type._buildUnion();
    const tempBuf = ptr.subarray(offset, offset + def.size);
    return def.toObject(tempBuf);
  }

  throw new TypeError(`readValue: unsupported type ${type}`);
}

/**
 * Scrive un valore in memoria
 * Per tipi base comuni usa lookup table
 * @param {Buffer|BigInt|number} ptr - Puntatore
 * @param {string|CType} type - Tipo del valore
 * @param {*} value - Valore da scrivere
 * @param {number} [offset=0] - Offset in bytes
 * @returns {number} Bytes scritti
 */
function writeValue(ptr, type, value, offset = 0) {
  // SimpleCData class - use its _writer directly
  if (typeof type === "function" && type._isSimpleCData) {
    if (!Buffer.isBuffer(ptr)) {
      throw new TypeError("writeValue requires a Buffer");
    }
    type._writer(ptr, offset, value);
    return type._size;
  }

  // Struct type (class)
  if (typeof type === "function" && type.prototype instanceof Structure) {
    const def = type._structDef || type._buildStruct();
    const tempBuf = ptr.subarray(offset, offset + def.size);
    if (Buffer.isBuffer(value)) {
      value.copy(tempBuf, 0, 0, def.size);
    } else if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        def.set(tempBuf, k, v);
      }
    }
    return def.size;
  }

  // Union type (class)
  if (typeof type === "function" && type.prototype instanceof Union) {
    const def = type._unionDef || type._buildUnion();
    const tempBuf = ptr.subarray(offset, offset + def.size);
    if (Buffer.isBuffer(value)) {
      value.copy(tempBuf, 0, 0, def.size);
    } else if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        def.set(tempBuf, k, v);
      }
    }
    return def.size;
  }

  throw new TypeError(`writeValue: unsupported type ${type}`);
}

/**
 * Restituisce la dimensione di un tipo
 * Per tipi base comuni usa lookup table
 * @param {string|CType|Object} type - Tipo
 * @returns {number} Dimensione in bytes
 */
function sizeof(type) {
  // SimpleCData class (e.g., sizeof(c_uint64))
  if (typeof type === "function" && type._isSimpleCData) {
    return type._size;
  }

  // SimpleCData instance (e.g., sizeof(new c_uint64()))
  if (type && type._buffer && type.constructor && type.constructor._isSimpleCData) {
    return type.constructor._size;
  }

  // Struct type (class)
  if (typeof type === "function" && type.prototype instanceof Structure) {
    const def = type._structDef || type._buildStruct();
    return def.size;
  }

  // Union type (class)
  if (typeof type === "function" && type.prototype instanceof Union) {
    const def = type._unionDef || type._buildUnion();
    return def.size;
  }

  // Struct type
  if (typeof type === "object" && type !== null && typeof type.size === "number") {
    return type.size;
  }

  // Array type
  if (typeof type === "object" && type !== null && typeof type.getSize === "function") {
    return type.getSize();
  }

  throw new TypeError(`sizeof: unsupported type. Use SimpleCData classes like c_int32, c_uint64, etc.`);
}

/**
 * Converte un Buffer o indirizzo in BigInt
 * @param {Buffer|BigInt|number} ptr - Puntatore
 * @returns {BigInt} Indirizzo come BigInt
 */
function addressOf(ptr) {
  if (Buffer.isBuffer(ptr)) {
    // Ottieni l'indirizzo del buffer
    // Questo è un po' hacky, ma funziona
    const tempBuf = alloc(native.POINTER_SIZE);
    // Use native.writeValue with a string 'pointer' to avoid JS-level
    // writeValue -> c_void_p._writer recursion. native.writeValue accepts
    // a string type name and will write the buffer address directly.
    native.writeValue(tempBuf, "pointer", ptr, 0);
    if (native.POINTER_SIZE === 8) return tempBuf.readBigUInt64LE(0);
    return BigInt(tempBuf.readUInt32LE(0));
  }
  if (typeof ptr === "bigint") {
    return ptr;
  }
  return BigInt(ptr);
}

/**
 * Passa un oggetto per riferimento (come Python byref)
 * Supporta sia Buffer che istanze SimpleCData
 *
 * @param {Buffer|SimpleCData} obj - Oggetto da passare per riferimento
 * @returns {Buffer} Il buffer sottostante
 */
function byref(obj) {
  // SimpleCData instance - return its buffer
  if (obj && obj._buffer && Buffer.isBuffer(obj._buffer)) {
    return obj._buffer;
  }
  // Buffer - return as-is
  if (Buffer.isBuffer(obj)) {
    return obj;
  }
  throw new TypeError("byref() argument must be a ctypes instance or Buffer");
}

/**
 * Cast di un puntatore a un tipo diverso
 * Legge il valore dalla memoria interpretandolo come il nuovo tipo.
 *
 * @param {Buffer|BigInt} ptr - Puntatore sorgente
 * @param {string|Object} targetType - Tipo destinazione ('int32', 'pointer', struct, etc.)
 * @returns {*} Valore letto con il nuovo tipo
 */
function cast(ptr, targetType) {
  // Se è un tipo struct
  if (typeof targetType === "object" && targetType.size !== undefined) {
    // È una struct, restituisci un oggetto che permette di leggere i campi
    const buf = Buffer.isBuffer(ptr) ? ptr : ptrToBuffer(ptr, targetType.size);
    return {
      _buffer: buf,
      _struct: targetType,
      get contents() {
        return targetType.toObject(buf);
      },
      getField(name) {
        return targetType.get(buf, name);
      },
      setField(name, value) {
        targetType.set(buf, name, value);
      },
    };
  }

  // Se è un tipo base, leggi il valore
  if (Buffer.isBuffer(ptr)) {
    return readValue(ptr, targetType, 0);
  }

  // È un BigInt/number, converti in buffer temporaneo e leggi
  const tempBuf = ptrToBuffer(ptr, sizeof(targetType));
  return readValue(tempBuf, targetType, 0);
}

/**
 * Crea un buffer che punta a un indirizzo di memoria
 * ATTENZIONE: Usare con cautela! Accesso a memoria non valida causa crash.
 *
 * @param {BigInt|number} address - Indirizzo di memoria
 * @param {number} size - Dimensione del buffer
 * @returns {Buffer} Buffer che punta all'indirizzo
 */
function ptrToBuffer(address, size) {
  return native.ptrToBuffer(address, size);
}

/**
 * Crea un tipo POINTER(type) - puntatore a un tipo specifico
 *
 * @param {string|Object} baseType - Tipo base
 * @returns {Object} Tipo puntatore
 */
function POINTER(baseType) {
  const baseSize = typeof baseType === "object" ? baseType.size : sizeof(baseType);
  const typeName = typeof baseType === "object" ? "struct" : baseType;

  return {
    _pointerTo: baseType,
    _baseSize: baseSize,
    size: native.POINTER_SIZE,

    /**
     * Crea un puntatore NULL
     */
    create() {
      const buf = alloc(native.POINTER_SIZE);
      writeValue(buf, c_void_p, 0n);
      return buf;
    },

    /**
     * Crea un puntatore a un buffer esistente
     */
    fromBuffer(targetBuf) {
      const buf = alloc(native.POINTER_SIZE);
      writeValue(buf, c_void_p, targetBuf);
      return buf;
    },

    /**
     * Legge il puntatore (dereferenzia)
     */
    deref(ptrBuf) {
      const addr = readValue(ptrBuf, c_void_p);
      if (addr === 0n || addr === null) {
        return null;
      }
      // Per struct, restituisci wrapper
      if (typeof baseType === "object" && baseType.toObject) {
        // Non possiamo creare buffer a indirizzo arbitrario senza native
        // Restituiamo l'indirizzo
        return addr;
      }
      // Per tipi base, non possiamo leggere senza native.ptrToBuffer
      return addr;
    },

    /**
     * Scrive un indirizzo nel puntatore
     */
    set(ptrBuf, value) {
      if (Buffer.isBuffer(value)) {
        writeValue(ptrBuf, c_void_p, value);
      } else {
        writeValue(ptrBuf, c_void_p, value);
      }
    },

    toString() {
      return `POINTER(${typeName})`;
    },
  };
}

/**
 * Helper per definire union (tutti i campi condividono offset 0)
 * Supporta nested structs e bitfields come struct()
 * @param {Object} fields - Definizione dei campi { name: type, ... }
 * @returns {Object} Definizione della union
 */
function union(fields) {
  let maxSize = 0;
  let maxAlignment = 1;
  const fieldDefs = [];

  for (const [name, type] of Object.entries(fields)) {
    let size, alignment;
    let fieldDef = { name, type, offset: 0 };

    // Nested struct
    if (_isStruct(type)) {
      size = type.size;
      alignment = type.alignment;
      fieldDef.isNested = true;
    }
    // Array type
    else if (_isArrayType(type)) {
      size = type.getSize();
      const elemSize = sizeof(type.elementType);
      alignment = Math.min(elemSize, native.POINTER_SIZE);
      fieldDef.isArray = true;
    }
    // Bit field - in union ogni bitfield occupa l'intero baseType
    else if (_isBitField(type)) {
      size = type.baseSize;
      alignment = Math.min(size, native.POINTER_SIZE);
      fieldDef.isBitField = true;
      fieldDef.bitOffset = 0;
      fieldDef.bitSize = type.bits;
      fieldDef.baseSize = type.baseSize;
      fieldDef.type = type.baseType; // Usa il tipo base per lettura/scrittura
    }
    // Tipo base (SimpleCData)
    else {
      // Validate type is a SimpleCData class
      if (!(typeof type === "function" && type._isSimpleCData)) {
        throw new TypeError(`union field "${name}": type must be a SimpleCData class, struct, union, or array`);
      }
      size = type._size;
      alignment = Math.min(size, native.POINTER_SIZE);
      fieldDef.type = type;
    }

    fieldDef.size = size;
    fieldDef.alignment = alignment;
    fieldDefs.push(fieldDef);

    if (size > maxSize) {
      maxSize = size;
    }
    if (alignment > maxAlignment) {
      maxAlignment = alignment;
    }
  }

  // Padding finale per allineamento
  if (maxSize % maxAlignment !== 0) {
    maxSize += maxAlignment - (maxSize % maxAlignment);
  }

  // Crea Map per lookup O(1)
  const fieldMap = new Map();
  for (const field of fieldDefs) {
    fieldMap.set(field.name, field);
  }

  const unionDef = {
    size: maxSize,
    alignment: maxAlignment,
    fields: fieldDefs,
    isUnion: true,
    _isStructType: true, // Per compatibilità con _isStruct()

    create(values = {}) {
      const buf = alloc(maxSize);
      buf.fill(0);

      // Prima imposta i campi diretti
      for (const field of fieldDefs) {
        if (values[field.name] !== undefined) {
          unionDef.set(buf, field.name, values[field.name]);
        }
      }

      // Proxy-based instance (single Proxy instead of N defineProperty calls)
      return new Proxy(buf, {
        get(target, prop, receiver) {
          // Special properties
          if (prop === "_buffer") return target;
          if (prop === "toObject") return () => unionDef.toObject(target);
          if (prop === Symbol.toStringTag) return "UnionInstance";
          if (prop === Symbol.iterator) return undefined;

          // Handle Buffer/TypedArray properties FIRST before field checks
          if (prop === "length" || prop === "byteLength" || prop === "byteOffset" || prop === "buffer" || prop === "BYTES_PER_ELEMENT") {
            return target[prop];
          }

          // Check if it's a known field
          if (typeof prop === "string" && fieldMap.has(prop)) {
            return unionDef.get(target, prop);
          }

          // Fallback to buffer properties and methods
          const value = target[prop];
          if (typeof value === "function") {
            return value.bind(target);
          }
          return value;
        },
        set(target, prop, value, receiver) {
          // Check if it's a known field
          if (typeof prop === "string" && fieldMap.has(prop)) {
            unionDef.set(target, prop, value);
            return true;
          }

          // Fallback
          return Reflect.set(target, prop, value, receiver);
        },
        has(target, prop) {
          if (prop === "_buffer" || prop === "toObject") return true;
          if (typeof prop === "string" && fieldMap.has(prop)) return true;
          return Reflect.has(target, prop);
        },
        ownKeys(target) {
          return fieldDefs.map((f) => f.name);
        },
        getOwnPropertyDescriptor(target, prop) {
          if (typeof prop === "string" && (fieldMap.has(prop) || prop === "_buffer" || prop === "toObject")) {
            return {
              enumerable: prop !== "_buffer" && prop !== "toObject",
              configurable: true,
              writable: true,
            };
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      });
    },

    get(bufOrObj, fieldName) {
      // NUOVO: supporta sia buffer che object wrapper
      let buf;
      if (Buffer.isBuffer(bufOrObj)) {
        buf = bufOrObj;
      } else if (bufOrObj && bufOrObj._buffer) {
        // Object wrapper - accesso diretto tramite property
        return bufOrObj[fieldName];
      } else {
        throw new TypeError("Expected Buffer or union instance");
      }

      // O(1) lookup con Map
      const field = fieldMap.get(fieldName);
      if (!field) throw new Error(`Unknown field: ${fieldName}`);

      // Bit field
      if (field.isBitField) {
        return _readBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize);
      }

      // Nested struct
      if (field.isNested) {
        const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
        // Proxy-based nested instance
        return new Proxy(nestedBuf, {
          get(target, prop, receiver) {
            if (prop === "_buffer") return target;
            if (prop === "toObject") return () => field.type.toObject(target);
            if (prop === Symbol.toStringTag) return "NestedUnionInstance";
            if (prop === Symbol.iterator) return undefined;
            // Handle Buffer/TypedArray properties
            if (prop === "length" || prop === "byteLength" || prop === "byteOffset" || prop === "buffer" || prop === "BYTES_PER_ELEMENT") {
              return target[prop];
            }
            if (typeof prop === "string" && field.type.fields) {
              if (field.type.fields.some((f) => f.name === prop && !f.isAnonymous)) {
                return field.type.get(target, prop);
              }
            }
            const value = target[prop];
            if (typeof value === "function") return value.bind(target);
            return value;
          },
          set(target, prop, value, receiver) {
            if (typeof prop === "string" && field.type.fields) {
              if (field.type.fields.some((f) => f.name === prop && !f.isAnonymous)) {
                field.type.set(target, prop, value);
                return true;
              }
            }
            return Reflect.set(target, prop, value, receiver);
          },
          has(target, prop) {
            if (prop === "_buffer" || prop === "toObject") return true;
            if (typeof prop === "string" && field.type.fields) {
              if (field.type.fields.some((f) => f.name === prop)) return true;
            }
            return Reflect.has(target, prop);
          },
          ownKeys(target) {
            return (field.type.fields || []).filter((f) => !f.isAnonymous).map((f) => f.name);
          },
          getOwnPropertyDescriptor(target, prop) {
            if (typeof prop === "string" && field.type.fields && field.type.fields.some((f) => f.name === prop)) {
              return {
                enumerable: true,
                configurable: true,
                writable: true,
              };
            }
            return Reflect.getOwnPropertyDescriptor(target, prop);
          },
        });
      }

      // Array
      if (field.isArray) {
        return field.type.wrap(buf.subarray(field.offset, field.offset + field.size));
      }

      // Tipo base
      return readValue(buf, field.type, field.offset);
    },

    set(bufOrObj, fieldName, value) {
      // NUOVO: supporta sia buffer che object wrapper
      let buf;
      if (Buffer.isBuffer(bufOrObj)) {
        buf = bufOrObj;
      } else if (bufOrObj && bufOrObj._buffer) {
        // Object wrapper - accesso diretto tramite property
        bufOrObj[fieldName] = value;
        return;
      } else {
        throw new TypeError("Expected Buffer or union instance");
      }

      // Lookup with Map
      const field = fieldMap.get(fieldName);
      if (!field) throw new Error(`Unknown field: ${fieldName}`);

      // Bit field
      if (field.isBitField) {
        _writeBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize, value);
        return;
      }

      // Nested struct
      if (field.isNested) {
        if (Buffer.isBuffer(value)) {
          value.copy(buf, field.offset, 0, field.size);
        } else if (typeof value === "object") {
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          for (const [k, v] of Object.entries(value)) {
            field.type.set(nestedBuf, k, v);
          }
        }
        return;
      }

      // Array
      if (field.isArray) {
        if (Buffer.isBuffer(value)) {
          value.copy(buf, field.offset, 0, field.size);
        } else if (Array.isArray(value)) {
          const wrapped = field.type.wrap(buf.subarray(field.offset, field.offset + field.size));
          for (let i = 0; i < Math.min(value.length, field.type.length); i++) {
            wrapped[i] = value[i];
          }
        } else if (value && value._buffer && Buffer.isBuffer(value._buffer)) {
          // Handle array proxy instances
          value._buffer.copy(buf, field.offset, 0, field.size);
        }
        return;
      }

      // Tipo base
      writeValue(buf, field.type, value, field.offset);
    },

    toObject(bufOrObj) {
      // Se è già un object (non buffer), ritorna così com'è
      if (!Buffer.isBuffer(bufOrObj)) {
        if (bufOrObj && bufOrObj._buffer && bufOrObj._buffer.length === maxSize) {
          return bufOrObj; // Già convertito
        }
        // Se è un plain object, convertilo in union
        if (typeof bufOrObj === "object") {
          const buf = alloc(maxSize);
          buf.fill(0);
          for (const [name, value] of Object.entries(bufOrObj)) {
            unionDef.set(buf, name, value);
          }
          return unionDef.toObject(buf);
        }
        throw new TypeError("Expected Buffer or union instance");
      }

      const buf = bufOrObj;
      const obj = {};

      // Cache per oggetti nested (struct/union) per evitare di ricrearli ogni volta
      const nestedCache = new Map();

      // Aggiungi _buffer come property nascosta
      Object.defineProperty(obj, "_buffer", {
        value: buf,
        writable: false,
        enumerable: false,
        configurable: false,
      });

      // Per union, tutte le properties leggono/scrivono all'offset 0
      for (const field of fieldDefs) {
        Object.defineProperty(obj, field.name, {
          get() {
            if (field.isBitField) {
              return _readBitField(buf, 0, field.type, field.bitOffset, field.bitSize);
            } else if (field.isNested) {
              // Cache nested objects per evitare di ricrearli ogni volta
              if (!nestedCache.has(field.name)) {
                const nestedBuf = buf.subarray(0, field.size);
                const nestedObj = field.type.toObject(nestedBuf);
                nestedCache.set(field.name, nestedObj);
              }
              return nestedCache.get(field.name);
            } else if (field.isArray) {
              const wrapped = field.type.wrap(buf.subarray(0, field.size));
              return [...wrapped];
            } else {
              return readValue(buf, field.type, 0);
            }
          },
          set(value) {
            if (field.isBitField) {
              _writeBitField(buf, 0, field.type, field.bitOffset, field.bitSize, value);
            } else {
              writeValue(buf, field.type, value, 0);
            }
          },
          enumerable: true,
          configurable: false,
        });
      }

      return obj;
    },

    // fromObject: write plain object values into buffer
    fromObject: function (buf, obj) {
      for (const [key, value] of Object.entries(obj)) {
        if (this.fields.some((f) => f.name === key)) {
          this.set(buf, key, value);
        }
      }
    },
  };

  return unionDef;
}

/**
 * Helper to define a JS class backed by a struct definition.
 * Useful for TypeScript inference: const Point = defineStruct({ x: 'int32', y: 'int32' }, { packed: false });
 */
function defineStruct(fields, options) {
  const def = struct(fields, options);
  class AutoStruct extends Structure {}
  // cache structDef on the class so constructor picks it up
  AutoStruct._structDef = def;
  AutoStruct._fields_ = fields;
  return AutoStruct;
}

/**
 * Helper to define a JS class backed by a union definition.
 */
function defineUnion(fields) {
  const def = union(fields);
  class AutoUnion extends Union {}
  AutoUnion._structDef = def;
  AutoUnion._fields_ = fields;
  return AutoUnion;
}

// --------------------------------------------------------------------------
// Python-compatible class wrappers to allow `class X extends Structure` and
// `class Y extends Union` patterns similar to Python ctypes.
// These classes read static properties on the subclass:
// - `_fields_`: array of [name, type] or object map { name: type }
// - `_anonymous_`: optional array of anonymous field names (for structs)
// - `_pack_`: optional packing value (true/false)
// The classes expose `create()`, `toObject()`, `get()`, `set()` and a hidden
// `_buffer` when an instance is created via `new`.
// --------------------------------------------------------------------------

class Structure {
  constructor(...args) {
    const Ctor = this.constructor;
    const def = Ctor._structDef || Ctor._buildStruct();
    // Allocate buffer for instance
    let buf = alloc(def.size);
    buf.fill(0);

    // Support positional args: new Point(10,20)
    if (args.length === 1 && typeof args[0] === "object" && !Array.isArray(args[0]) && !Buffer.isBuffer(args[0])) {
      const initial = args[0];
      for (const [k, v] of Object.entries(initial)) {
        def.set(buf, k, v);
      }
    } else if (args.length === 1 && Buffer.isBuffer(args[0])) {
      // new Point(buffer) - wrap existing buffer
      buf = args[0];
    } else if (args.length > 0) {
      // Positional mapping to non-anonymous declared fields order
      const ordered = def.fields.filter((f) => !f.isAnonymous);
      for (let i = 0; i < Math.min(args.length, ordered.length); i++) {
        def.set(buf, ordered[i].name, args[i]);
      }
    }

    // Store internal references on this (needed for methods like toObject)
    this.__buffer = buf;
    this.__structDef = def;

    // Build field map for O(1) lookup
    const fieldMap = new Map();
    const anonFieldNames = new Set();
    for (const field of def.fields) {
      fieldMap.set(field.name, field);
      if (field.isAnonymous && field.type && Array.isArray(field.type.fields)) {
        for (const subField of field.type.fields) {
          anonFieldNames.add(subField.name);
        }
      }
    }

    // Return Proxy instead of using Object.defineProperty for each field
    return new Proxy(this, {
      get(target, prop, receiver) {
        // Special properties that exist on the instance
        if (prop === "_buffer") return buf;
        if (prop === "_structDef") return def;
        if (prop === "__buffer") return buf;
        if (prop === "__structDef") return def;
        if (prop === Symbol.toStringTag) return Ctor.name || "Structure";
        if (prop === Symbol.iterator) return undefined;

        // Methods defined on the prototype
        if (typeof target[prop] === "function") {
          return target[prop].bind(target);
        }

        // Check if it's a known field (O(1) lookup)
        if (typeof prop === "string" && fieldMap.has(prop)) {
          return def.get(buf, prop);
        }

        // Check anonymous fields
        if (typeof prop === "string" && anonFieldNames.has(prop)) {
          return def.get(buf, prop);
        }

        // Fallback to target properties
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        // Check if it's a known field (O(1) lookup)
        if (typeof prop === "string" && fieldMap.has(prop)) {
          def.set(buf, prop, value);
          return true;
        }

        // Check anonymous fields
        if (typeof prop === "string" && anonFieldNames.has(prop)) {
          def.set(buf, prop, value);
          return true;
        }

        // Fallback
        return Reflect.set(target, prop, value, receiver);
      },
      has(target, prop) {
        if (prop === "_buffer" || prop === "_structDef" || prop === "toObject") return true;
        if (typeof prop === "string" && fieldMap.has(prop)) return true;
        if (typeof prop === "string" && anonFieldNames.has(prop)) return true;
        return Reflect.has(target, prop);
      },
      ownKeys(target) {
        const keys = [];
        for (const f of def.fields) {
          if (f.isAnonymous && f.type && Array.isArray(f.type.fields)) {
            for (const sf of f.type.fields) {
              keys.push(sf.name);
            }
          } else {
            keys.push(f.name);
          }
        }
        return keys;
      },
      getOwnPropertyDescriptor(target, prop) {
        if (typeof prop === "string" && (fieldMap.has(prop) || anonFieldNames.has(prop))) {
          return {
            enumerable: true,
            configurable: true,
            writable: true,
          };
        }
        if (prop === "_buffer" || prop === "_structDef") {
          return {
            enumerable: false,
            configurable: true,
            writable: true,
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    });
  }

  // Build the underlying struct definition and cache it on the constructor
  static _buildStruct() {
    // Accept either array _fields_ (Python style) or object map
    const fields = this._fields_ || {};
    let mapFields = {};

    if (Array.isArray(fields)) {
      for (const entry of fields) {
        if (Array.isArray(entry) && entry.length >= 2) {
          mapFields[entry[0]] = entry[1];
        }
      }
    } else if (typeof fields === "object" && fields !== null) {
      mapFields = { ...fields };
    }

    // Handle anonymous fields list: convert to { anonymous: true, type: T }
    if (Array.isArray(this._anonymous_)) {
      for (const anonName of this._anonymous_) {
        if (mapFields[anonName] !== undefined) {
          mapFields[anonName] = {
            anonymous: true,
            type: mapFields[anonName],
          };
        }
      }
    }

    const options = {};
    if (this._pack_ !== undefined) options.packed = !!this._pack_;

    const def = struct(mapFields, options);
    this._structDef = def;
    return def;
  }

  // Create returns an instance of the JS class (not a plain object)
  static create(values = {}) {
    const def = this._structDef || this._buildStruct();
    // If a Buffer provided, wrap it
    if (Buffer.isBuffer(values)) {
      const inst = new this(values);
      return inst;
    }
    // If values is instance of this class, return it
    if (values && values._buffer && values._structDef === def) {
      return values;
    }
    return new this(values);
  }

  // Create raw plain object without synchronization (for performance)
  static createRaw(values = {}) {
    const def = this._structDef || this._buildStruct();
    return def.toObject(def.create(values)._buffer);
  }

  // Synchronize plain object into instance buffer
  syncFromObject(obj) {
    const plain = this.__structDef.toObject(this.__buffer);
    Object.assign(plain, obj);
    this.__structDef.fromObject(this.__buffer, plain);
  }

  // toObject: accept Buffer, instance or plain buffer
  static toObject(bufOrInst) {
    const def = this._structDef || this._buildStruct();
    if (bufOrInst && bufOrInst._buffer) {
      return def.toObject(bufOrInst._buffer);
    }
    return def.toObject(bufOrInst);
  }

  // fromObject: write plain object into buffer
  static fromObject(bufOrInst, obj) {
    const def = this._structDef || this._buildStruct();
    const buf = bufOrInst && bufOrInst._buffer ? bufOrInst._buffer : bufOrInst;
    return def.fromObject(buf, obj);
  }

  // Instance convenience
  get(fieldName) {
    return this.__structDef.get(this.__buffer, fieldName);
  }

  set(fieldName, value) {
    return this.__structDef.set(this.__buffer, fieldName, value);
  }

  // Bulk operations for better performance
  setFields(fields) {
    for (const [name, value] of Object.entries(fields)) {
      this.__structDef.set(this.__buffer, name, value);
    }
  }

  getFields(fieldNames) {
    const result = {};
    for (const name of fieldNames) {
      result[name] = this.__structDef.get(this.__buffer, name);
    }
    return result;
  }

  // bulk operations (Proxy reads directly from buffer - no cache needed)
  withBulkUpdate(callback) {
    return callback(this);
  }

  // Direct typed array access for numeric fields (maximum performance)
  getInt32Array(offset = 0, length) {
    return new Int32Array(this.__buffer.buffer, this.__buffer.byteOffset + offset, length);
  }

  getFloat64Array(offset = 0, length) {
    return new Float64Array(this.__buffer.buffer, this.__buffer.byteOffset + offset, length);
  }

  // Get raw buffer slice for external operations
  getBufferSlice(offset = 0, size = this.__buffer.length - offset) {
    return this.__buffer.subarray(offset, offset + size);
  }

  // Vectorized operations for arrays of structs
  static createArray(count, initialValues = []) {
    const instances = [];
    for (let i = 0; i < count; i++) {
      instances.push(this.create(initialValues[i] || {}));
    }
    return instances;
  }

  // Bulk update all instances in array
  static updateArray(instances, updates) {
    for (let i = 0; i < instances.length && i < updates.length; i++) {
      if (updates[i] && typeof updates[i] === "object") {
        instances[i].setFields(updates[i]);
      }
    }
  }

  toObject() {
    return this.__structDef.toObject(this.__buffer);
  }
}

class Union extends Structure {
  static _buildStruct() {
    const fields = this._fields_ || {};
    let mapFields = {};
    if (Array.isArray(fields)) {
      for (const entry of fields) {
        if (Array.isArray(entry) && entry.length >= 2) {
          mapFields[entry[0]] = entry[1];
        }
      }
    } else if (typeof fields === "object" && fields !== null) {
      mapFields = fields;
    }
    const def = union(mapFields);
    this._structDef = def;
    return def;
  }
}

/**
 * Helper per creare array a dimensione fissa (come c_int * 5 in Python)
 * Ritorna un ArrayType wrapper con supporto per indexing arr[i]
 *
 * @param {string} elementType - Tipo degli elementi ('int32', 'float', etc.)
 * @param {number} count - Numero di elementi
 * @returns {Object} ArrayType con metodi getSize(), getLength(), create(), wrap()
 *
 * @example
 * const IntArray5 = array('int32', 5);
 * const arr = IntArray5.create([1, 2, 3, 4, 5]);
 * console.log(arr[0]);  // 1 - indexing Python-like!
 * arr[2] = 42;
 * console.log(arr[2]);  // 42
 */
function array(elementType, count) {
  // Validate elementType is a SimpleCData class
  if (!(typeof elementType === "function" && elementType._isSimpleCData)) {
    throw new TypeError("array elementType must be a SimpleCData class (e.g., c_int32, c_uint8)");
  }

  const elementSize = elementType._size;
  let nativeArray;
  if (typeof elementType === "object") {
    nativeArray = new ArrayType(elementType, count);
  } else {
    // For strings, create a mock
    nativeArray = {
      getSize: () => count * elementSize,
      getLength: () => count,
      getAlignment: () => elementSize, // Approximation
      create: (values) => {
        // Already handled in JS
        throw new Error("Should not be called");
      },
    };
  }

  // Funzione wrap che ritorna un Proxy
  const wrap = function (buffer) {
    return new Proxy(buffer, {
      get(target, prop, receiver) {
        // Special case for _buffer to return the underlying buffer
        if (prop === "_buffer") {
          return target;
        }

        // Special case for toString to show array contents
        if (prop === "toString") {
          return function () {
            try {
              const arr = Array.from(this);
              return `[${arr.join(", ")}]`;
            } catch (e) {
              return "[error]";
            }
          }.bind(receiver);
        }

        // Intercetta Symbol.iterator per iterare sugli elementi, non sui bytes
        if (prop === Symbol.iterator) {
          return function* () {
            for (let i = 0; i < count; i++) {
              yield elementType._reader(target, i * elementSize);
            }
          };
        }

        // Ignora altri Symbol
        if (typeof prop === "symbol") {
          const value = Reflect.get(target, prop, target);
          if (typeof value === "function") {
            return value.bind(target);
          }
          return value;
        }

        // Se è un numero (indice) - intercetta PRIMA di controllare target
        const index = Number(prop);
        if (Number.isInteger(index) && !isNaN(index)) {
          if (index >= 0 && index < count) {
            return readValue(target, elementType, index * elementSize);
          }
          // Indice numerico fuori bounds -> undefined (comportamento JavaScript)
          return undefined;
        }

        // Per tutto il resto, usa il buffer normale
        const value = Reflect.get(target, prop, target);
        // Se è una funzione, bindala al target
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },
      set(target, prop, value) {
        // Ignora i Symbol
        if (typeof prop === "symbol") {
          return Reflect.set(target, prop, value, target);
        }

        const index = Number(prop);
        if (Number.isInteger(index) && !isNaN(index)) {
          if (index >= 0 && index < count) {
            writeValue(target, elementType, value, index * elementSize);
            return true;
          }
          // Indice fuori bounds - non scrive nulla ma ritorna false
          return false;
        }
        return Reflect.set(target, prop, value, target);
      },
    });
  };

  // Ritorna un wrapper object che delega a nativeArray ma override create()
  return {
    // Informazioni sul tipo
    elementType,
    length: count,

    // Metodi delegati
    getSize: () => nativeArray.getSize(),
    getLength: () => nativeArray.getLength(),
    getAlignment: () => nativeArray.getAlignment(),

    // create ritorna automaticamente il proxy
    create: (values) => {
      const size = count * sizeof(elementType);
      const buffer = alloc(size);
      buffer.fill(0);
      if (Array.isArray(values)) {
        for (let i = 0; i < Math.min(values.length, count); i++) {
          writeValue(buffer, elementType, values[i], i * sizeof(elementType));
        }
      } else if (typeof values === "string") {
        for (let i = 0; i < Math.min(values.length, count); i++) {
          writeValue(buffer, elementType, values.charCodeAt(i), i * sizeof(elementType));
        }
      }
      return wrap(buffer);
    },

    // wrap esplicito
    wrap: wrap,

    // Per compatibilità, esponi il native array (serve per StructType.addField)
    _native: nativeArray,

    // Helper per verificare se è un ArrayType wrapper
    _isArrayType: true,
  };
}

// ============================================================================
// Error Handling
// ============================================================================
// ============================================================================

let _errno_funcs = null;
let _win_error_funcs = null;

/**
 * Inizializza le funzioni errno (lazy loading)
 */
function _initErrno() {
  if (_errno_funcs) return _errno_funcs;

  try {
    if (process.platform === "win32") {
      const msvcrt = new CDLL("msvcrt.dll");
      _errno_funcs = {
        _get: msvcrt.func("_get_errno", c_int32, [c_void_p]),
        _set: msvcrt.func("_set_errno", c_int32, [c_int32]),
        _lib: msvcrt,
      };
    } else if (process.platform === "darwin") {
      // macOS usa __error invece di __errno_location
      const libc = new CDLL(null);
      _errno_funcs = {
        _location: libc.func("__error", c_void_p, []),
        _lib: libc,
      };
    } else {
      // Linux e altri Unix usano __errno_location
      const libc = new CDLL(null);
      _errno_funcs = {
        _location: libc.func("__errno_location", c_void_p, []),
        _lib: libc,
      };
    }
  } catch (e) {
    _errno_funcs = { error: e.message };
  }

  return _errno_funcs;
}

/**
 * Ottiene il valore corrente di errno
 * @returns {number} Valore di errno
 */
function get_errno() {
  const funcs = _initErrno();
  if (funcs.error) {
    throw new Error("errno not available: " + funcs.error);
  }

  if (process.platform === "win32") {
    const buf = alloc(4);
    funcs._get(buf);
    return readValue(buf, c_int32);
  } else {
    const ptr = funcs._location();
    return readValue(ptr, c_int32);
  }
}

/**
 * Imposta il valore di errno
 * @param {number} value - Nuovo valore
 */
function set_errno(value) {
  const funcs = _initErrno();
  if (funcs.error) {
    throw new Error("errno not available: " + funcs.error);
  }

  if (process.platform === "win32") {
    funcs._set(value);
  } else {
    const ptr = funcs._location();
    writeValue(ptr, c_int32, value);
  }
}

/**
 * Inizializza le funzioni Windows error (lazy loading)
 */
function _initWinError() {
  if (_win_error_funcs) return _win_error_funcs;

  if (process.platform !== "win32") {
    _win_error_funcs = { error: "Windows only" };
    return _win_error_funcs;
  }

  try {
    const kernel32 = new WinDLL("kernel32.dll");
    _win_error_funcs = {
      GetLastError: kernel32.func("GetLastError", c_uint32, []),
      SetLastError: kernel32.func("SetLastError", c_void, [c_uint32]),
      FormatMessageW: kernel32.func("FormatMessageW", c_uint32, [c_uint32, c_void_p, c_uint32, c_uint32, c_void_p, c_uint32, c_void_p]),
      _lib: kernel32,
    };
  } catch (e) {
    _win_error_funcs = { error: e.message };
  }

  return _win_error_funcs;
}

/**
 * Ottiene l'ultimo errore Windows (GetLastError)
 * @returns {number} Codice errore
 */
function GetLastError() {
  const funcs = _initWinError();
  if (funcs.error) {
    throw new Error("GetLastError not available: " + funcs.error);
  }
  return funcs.GetLastError();
}

/**
 * Imposta l'ultimo errore Windows (SetLastError)
 * @param {number} code - Codice errore
 */
function SetLastError(code) {
  const funcs = _initWinError();
  if (funcs.error) {
    throw new Error("SetLastError not available: " + funcs.error);
  }
  funcs.SetLastError(code);
}

/**
 * Formatta un codice errore Windows in stringa
 * @param {number} [code] - Codice errore (default: GetLastError())
 * @returns {string} Messaggio di errore
 */
function FormatError(code) {
  const funcs = _initWinError();
  if (funcs.error) {
    throw new Error("FormatError not available: " + funcs.error);
  }

  if (code === undefined) {
    code = funcs.GetLastError();
  }

  const FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000;
  const FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200;

  const bufSize = 512;
  const buf = alloc(bufSize * 2); // Wide chars

  const len = funcs.FormatMessageW(
    FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    null,
    code,
    0, // Default language
    buf,
    bufSize,
    null,
  );

  if (len === 0) {
    return `Unknown error ${code}`;
  }

  // Converti da UTF-16LE a string
  return buf.toString("utf16le", 0, len * 2).replace(/\r?\n$/, "");
}

/**
 * Crea un Error da un codice errore Windows
 * @param {number} [code] - Codice errore (default: GetLastError())
 * @returns {Error} Oggetto Error con messaggio
 */
function WinError(code) {
  if (code === undefined) {
    code = GetLastError();
  }
  const msg = FormatError(code);
  const err = new Error(`[WinError ${code}] ${msg}`);
  err.winerror = code;
  return err;
}

/**
 * Helper per definire un bit field
 * @param {string} baseType - Tipo base (uint8, uint16, uint32, uint64)
 * @param {number} bits - Numero di bit
 * @returns {Object} Definizione del bit field
 */
function bitfield(baseType, bits) {
  const baseSize = sizeof(baseType);
  const maxBits = baseSize * 8;

  if (bits < 1 || bits > maxBits) {
    throw new Error(`Bit field size must be between 1 and ${maxBits} for ${baseType}`);
  }

  return {
    _isBitField: true,
    baseType: baseType,
    bits: bits,
    baseSize: baseSize,
  };
}

/**
 * Helper per verificare se un tipo è una struct
 */
function _isStruct(type) {
  return typeof type === "object" && type !== null && typeof type.size === "number" && Array.isArray(type.fields) && typeof type.create === "function";
}

/**
 * Helper per verificare se un tipo è un array type
 */
function _isArrayType(type) {
  return typeof type === "object" && type !== null && type._isArrayType === true;
}

/**
 * Helper per verificare se un tipo è un bit field
 */
function _isBitField(type) {
  return typeof type === "object" && type !== null && type._isBitField === true;
}

/**
 * Helper per leggere un valore intero unsigned da un buffer
 * @private
 */
function _readUintFromBuffer(buf, offset, byteSize) {
  switch (byteSize) {
    case 1:
      return buf.readUInt8(offset);
    case 2:
      return buf.readUInt16LE(offset);
    case 4:
      return buf.readUInt32LE(offset);
    case 8:
      return buf.readBigUInt64LE(offset);
    default:
      throw new Error(`Unsupported byte size: ${byteSize}`);
  }
}

/**
 * Helper per scrivere un valore intero unsigned in un buffer
 * @private
 */
function _writeUintToBuffer(buf, offset, byteSize, value) {
  switch (byteSize) {
    case 1:
      buf.writeUInt8(value, offset);
      break;
    case 2:
      buf.writeUInt16LE(value, offset);
      break;
    case 4:
      buf.writeUInt32LE(value, offset);
      break;
    case 8:
      buf.writeBigUInt64LE(value, offset);
      break;
    default:
      throw new Error(`Unsupported byte size: ${byteSize}`);
  }
}

/**
 * Legge un valore bit field da un buffer
 * @private
 */
function _readBitField(buf, offset, baseType, bitOffset, bitSize) {
  const baseSize = sizeof(baseType);
  const value = _readUintFromBuffer(buf, offset, baseSize);

  // Estrai i bit
  if (baseSize === 8) {
    const mask = (1n << BigInt(bitSize)) - 1n;
    return Number((value >> BigInt(bitOffset)) & mask);
  } else {
    const mask = (1 << bitSize) - 1;
    return (value >> bitOffset) & mask;
  }
}

/**
 * Scrive un valore bit field in un buffer
 * @private
 */
function _writeBitField(buf, offset, baseType, bitOffset, bitSize, newValue) {
  const baseSize = sizeof(baseType);
  let value = _readUintFromBuffer(buf, offset, baseSize);

  // Modifica i bit
  if (baseSize === 8) {
    const mask = (1n << BigInt(bitSize)) - 1n;
    const clearMask = ~(mask << BigInt(bitOffset));
    value = (value & clearMask) | ((BigInt(newValue) & mask) << BigInt(bitOffset));
  } else {
    const mask = (1 << bitSize) - 1;
    const clearMask = ~(mask << bitOffset);
    value = (value & clearMask) | ((newValue & mask) << bitOffset);
  }

  _writeUintToBuffer(buf, offset, baseSize, value);
}

/**
 * Helper per definire struct con supporto per:
 * - Alignment corretto
 * - Nested structs
 * - Bit fields
 *
 * @param {Object} fields - Definizione dei campi { name: type, ... }
 *   - type può essere: 'int32', 'uint8', etc. (tipi base)
 *   - type può essere: un'altra struct (nested)
 *   - type può essere: bitfield('uint32', 4) (bit field)
 * @param {Object} [options] - Opzioni { packed: false }
 * @returns {Object} Definizione della struttura
 */
function struct(fields, options = {}) {
  const packed = options.packed || false;
  let totalSize = 0;
  const fieldDefs = [];
  let maxAlignment = 1;

  // Stato per bit fields consecutivi
  let currentBitFieldBase = null;
  let currentBitFieldOffset = 0;
  let currentBitOffset = 0;

  for (const [name, type] of Object.entries(fields)) {
    let fieldDef;

    // Caso 0: Anonymous field - { type: SomeStruct, anonymous: true }
    if (typeof type === "object" && type !== null && type.anonymous === true && type.type) {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      const actualType = type.type;
      const size = actualType.size;
      const alignment = packed ? 1 : actualType.alignment;

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type: actualType,
        offset: totalSize,
        size,
        alignment,
        isNested: true,
        isAnonymous: true,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 1: Bit field
    else if (_isBitField(type)) {
      const { baseType, bits, baseSize } = type;
      const alignment = packed ? 1 : Math.min(baseSize, native.POINTER_SIZE);

      // Verifica se possiamo continuare nel bit field corrente
      const canContinue = currentBitFieldBase === baseType && currentBitOffset + bits <= baseSize * 8;

      if (!canContinue) {
        // Inizia un nuovo bit field
        // Applica padding per allineamento
        if (!packed && totalSize % alignment !== 0) {
          totalSize += alignment - (totalSize % alignment);
        }

        currentBitFieldBase = baseType;
        currentBitFieldOffset = totalSize;
        currentBitOffset = 0;
        totalSize += baseSize;
      }

      fieldDef = {
        name,
        type: baseType,
        offset: currentBitFieldOffset,
        size: 0, // Bit fields non aggiungono size extra
        alignment,
        isBitField: true,
        bitOffset: currentBitOffset,
        bitSize: bits,
        baseSize,
      };

      currentBitOffset += bits;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 2: Nested struct
    else if (_isStruct(type)) {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      const nestedStruct = type;
      const size = nestedStruct.size;
      const alignment = packed ? 1 : nestedStruct.alignment;

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type: nestedStruct,
        offset: totalSize,
        size,
        alignment,
        isNested: true,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 3: Array type
    else if (_isArrayType(type)) {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      const size = type.getSize();
      const elemSize = sizeof(type.elementType);
      const alignment = packed ? 1 : Math.min(elemSize, native.POINTER_SIZE);

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type,
        offset: totalSize,
        size,
        alignment,
        isArray: true,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 4: Tipo base (SimpleCData)
    else {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      // Validate type is a SimpleCData class
      if (!(typeof type === "function" && type._isSimpleCData)) {
        throw new TypeError(`struct field "${name}": type must be a SimpleCData class, struct, union, or array`);
      }

      const size = type._size;
      const naturalAlign = Math.min(size, native.POINTER_SIZE);
      const alignment = packed ? 1 : naturalAlign;

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type,
        offset: totalSize,
        size,
        alignment,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }

    fieldDefs.push(fieldDef);
  }

  // Padding finale per allineamento della struct
  if (!packed && totalSize % maxAlignment !== 0) {
    totalSize += maxAlignment - (totalSize % maxAlignment);
  }

  // Crea Map per lookup O(1) invece di find() O(n)
  const fieldMap = new Map();
  for (const field of fieldDefs) {
    fieldMap.set(field.name, field);
  }

  // Pre-compile reader/writer functions for each field
  const fieldReaders = new Map();
  const fieldWriters = new Map();

  for (const field of fieldDefs) {
    const offset = field.offset;
    const name = field.name;

    // Skip complex types - they need special handling
    if (field.isBitField || field.isNested || field.isArray) {
      continue;
    }

    // Pre-compile based on SimpleCData type
    // Use the type's _reader and _writer directly for optimization
    const fieldType = field.type;
    if (fieldType && fieldType._isSimpleCData) {
      const fieldOffset = offset; // Capture offset for closure
      fieldReaders.set(name, (buf) => fieldType._reader(buf, fieldOffset));
      fieldWriters.set(name, (buf, val) => fieldType._writer(buf, fieldOffset, val));
    }
  }

  const structDef = {
    size: totalSize,
    alignment: maxAlignment,
    fields: fieldDefs,
    packed: packed,
    _isStructType: true,

    /**
     * Alloca e inizializza una nuova istanza
     * @param {Object} [values] - Valori iniziali
     * @returns {Proxy} Proxy-based struct instance
     */
    create(values = {}) {
      const buf = alloc(totalSize);
      buf.fill(0); // Inizializza a zero

      // Prima imposta i campi diretti
      for (const field of fieldDefs) {
        if (values[field.name] !== undefined) {
          structDef.set(buf, field.name, values[field.name]);
        }
      }

      // Poi gestisci i campi anonymous - i loro campi possono essere passati direttamente nell'oggetto values
      for (const field of fieldDefs) {
        if (field.isAnonymous && field.type && field.type.fields) {
          for (const subField of field.type.fields) {
            if (values[subField.name] !== undefined) {
              structDef.set(buf, subField.name, values[subField.name]);
            }
          }
        }
      }

      // Proxy-based instance with pre-compiled readers/writers
      return new Proxy(buf, {
        get(target, prop, receiver) {
          // Special properties
          if (prop === "_buffer") return target;
          if (prop === "toObject") return () => structDef.toObject(target);
          if (prop === Symbol.toStringTag) return "StructInstance";
          if (prop === Symbol.iterator) return undefined;

          // Handle Buffer/TypedArray properties FIRST before field checks
          // TypedArray methods need direct access to avoid Proxy interference
          if (prop === "length" || prop === "byteLength" || prop === "byteOffset" || prop === "buffer" || prop === "BYTES_PER_ELEMENT") {
            return target[prop];
          }

          // Use pre-compiled reader if available
          if (typeof prop === "string") {
            const reader = fieldReaders.get(prop);
            if (reader) return reader(target);

            // Fallback to general get for complex types
            if (fieldMap.has(prop)) {
              return structDef.get(target, prop);
            }
          }

          // Check anonymous fields
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              if (f.type.fields.some((sf) => sf.name === prop)) {
                return structDef.get(target, prop);
              }
            }
          }

          // Fallback to buffer properties and methods
          const value = target[prop];
          if (typeof value === "function") {
            return value.bind(target);
          }
          return value;
        },
        set(target, prop, value, receiver) {
          // FAST PATH: Use pre-compiled writer if available
          if (typeof prop === "string") {
            const writer = fieldWriters.get(prop);
            if (writer) {
              writer(target, value);
              return true;
            }

            // Fallback to general set for complex types
            if (fieldMap.has(prop)) {
              structDef.set(target, prop, value);
              return true;
            }
          }

          // Check anonymous fields
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              if (f.type.fields.some((sf) => sf.name === prop)) {
                structDef.set(target, prop, value);
                return true;
              }
            }
          }

          // Fallback
          return Reflect.set(target, prop, value, target);
        },
        has(target, prop) {
          if (prop === "_buffer" || prop === "toObject") return true;
          if (typeof prop === "string" && fieldMap.has(prop)) return true;
          // Check anonymous fields
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              if (f.type.fields.some((sf) => sf.name === prop)) return true;
            }
          }
          return Reflect.has(target, prop);
        },
        ownKeys(target) {
          const keys = [];
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              for (const sf of f.type.fields) {
                keys.push(sf.name);
              }
            } else {
              keys.push(f.name);
            }
          }
          return keys;
        },
        getOwnPropertyDescriptor(target, prop) {
          if (typeof prop === "string" && (fieldMap.has(prop) || prop === "_buffer" || prop === "toObject")) {
            return {
              enumerable: prop !== "_buffer" && prop !== "toObject",
              configurable: true,
              writable: true,
            };
          }
          // Check anonymous fields
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              if (f.type.fields.some((sf) => sf.name === prop)) {
                return {
                  enumerable: true,
                  configurable: true,
                  writable: true,
                };
              }
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      });
    },

    /**
     * Legge un campo dalla struttura
     * @param {Buffer|Object} bufOrObj - Buffer della struttura O object wrapper
     * @param {string} fieldName - Nome del campo (supporta 'outer.inner' per nested)
     * @returns {*} Valore del campo
     */
    get(bufOrObj, fieldName) {
      // supporta sia buffer che object wrapper o plain object
      let buf;
      if (Buffer.isBuffer(bufOrObj)) {
        buf = bufOrObj;
      } else if (bufOrObj && bufOrObj._buffer) {
        // Object wrapper - gestisci dot notation
        if (fieldName.includes(".")) {
          const parts = fieldName.split(".");
          let current = bufOrObj;
          for (const part of parts) {
            current = current[part];
            if (current === undefined) return undefined;
          }
          return current;
        }
        // Accesso diretto tramite property
        return bufOrObj[fieldName];
      } else if (typeof bufOrObj === "object" && bufOrObj !== null) {
        // Plain object (da toObject/create) - accesso diretto
        if (fieldName.includes(".")) {
          const parts = fieldName.split(".");
          let current = bufOrObj;
          for (const part of parts) {
            current = current[part];
            if (current === undefined) return undefined;
          }
          return current;
        }
        // Accesso diretto tramite property
        return bufOrObj[fieldName];
      } else {
        throw new TypeError("Expected Buffer or struct instance");
      }

      // Fast path: nome semplice senza dot notation
      // Lookup with Map
      let field = fieldMap.get(fieldName);

      if (field) {
        // Bit field
        if (field.isBitField) {
          return _readBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize);
        }

        // Nested struct (senza dot = ritorna intero oggetto)
        if (field.isNested) {
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          // Proxy-based nested instance
          return field.type.create
            ? // Se ha create(), usa quello per creare il proxy
              new Proxy(nestedBuf, {
                get(target, prop, receiver) {
                  if (prop === "_buffer") return target;
                  if (prop === "toObject") return () => field.type.toObject(target);
                  if (prop === Symbol.toStringTag) return "NestedStructInstance";
                  if (prop === Symbol.iterator) return undefined;
                  // Handle Buffer/TypedArray properties
                  if (prop === "length" || prop === "byteLength" || prop === "byteOffset" || prop === "buffer" || prop === "BYTES_PER_ELEMENT") {
                    return target[prop];
                  }
                  if (typeof prop === "string") {
                    // Check direct fields
                    const nestedFieldMap = field.type.fields ? new Map(field.type.fields.map((f) => [f.name, f])) : new Map();
                    if (nestedFieldMap.has(prop)) {
                      return field.type.get(target, prop);
                    }
                    // Check anonymous fields
                    for (const sf of field.type.fields || []) {
                      if (sf.isAnonymous && sf.type && sf.type.fields) {
                        if (sf.type.fields.some((ssf) => ssf.name === prop)) {
                          return field.type.get(target, prop);
                        }
                      }
                    }
                  }
                  const value = target[prop];
                  if (typeof value === "function") return value.bind(target);
                  return value;
                },
                set(target, prop, value, receiver) {
                  if (typeof prop === "string") {
                    const nestedFieldMap = field.type.fields ? new Map(field.type.fields.map((f) => [f.name, f])) : new Map();
                    if (nestedFieldMap.has(prop)) {
                      field.type.set(target, prop, value);
                      return true;
                    }
                    // Check anonymous fields
                    for (const sf of field.type.fields || []) {
                      if (sf.isAnonymous && sf.type && sf.type.fields) {
                        if (sf.type.fields.some((ssf) => ssf.name === prop)) {
                          field.type.set(target, prop, value);
                          return true;
                        }
                      }
                    }
                  }
                  return Reflect.set(target, prop, value, receiver);
                },
                has(target, prop) {
                  if (prop === "_buffer" || prop === "toObject") return true;
                  if (typeof prop === "string" && field.type.fields) {
                    if (field.type.fields.some((f) => f.name === prop)) return true;
                  }
                  return Reflect.has(target, prop);
                },
                ownKeys(target) {
                  return (field.type.fields || []).map((f) => f.name);
                },
                getOwnPropertyDescriptor(target, prop) {
                  if (typeof prop === "string" && field.type.fields && field.type.fields.some((f) => f.name === prop)) {
                    return {
                      enumerable: true,
                      configurable: true,
                      writable: true,
                    };
                  }
                  return Reflect.getOwnPropertyDescriptor(target, prop);
                },
              })
            : field.type.toObject(nestedBuf);
        }

        // Array field
        if (field.isArray) {
          const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
          return field.type.wrap(arrayBuf);
        }

        // Tipo base - fast path!
        return readValue(buf, field.type, field.offset);
      }

      // supporto per accesso nested 'outer.inner' o anonymous fields
      const parts = fieldName.split(".");
      const firstPart = parts[0];

      field = fieldMap.get(firstPart);

      // Se non trovato, cerca negli anonymous fields
      if (!field) {
        for (const f of fieldDefs) {
          if (f.isAnonymous && f.type && f.type.fields) {
            const hasField = f.type.fields.some((subField) => subField.name === firstPart);
            if (hasField) {
              const nestedBuf = buf.subarray(f.offset, f.offset + f.size);
              return f.type.get(nestedBuf, fieldName);
            }
          }
        }
        throw new Error(`Unknown field: ${firstPart}`);
      }

      // Nested struct con dot notation
      if (field.isNested && parts.length > 1) {
        const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
        return field.type.get(nestedBuf, parts.slice(1).join("."));
      }

      throw new Error(`Unknown field: ${fieldName}`);
    },

    /**
     * Scrive un campo nella struttura
     * @param {Buffer|Object} bufOrObj - Buffer della struttura O object wrapper
     * @param {string} fieldName - Nome del campo (supporta 'outer.inner' per nested)
     * @param {*} value - Valore da scrivere
     */
    set(bufOrObj, fieldName, value) {
      // supporta sia buffer che object wrapper o plain object
      let buf;
      if (Buffer.isBuffer(bufOrObj)) {
        buf = bufOrObj;
      } else if (bufOrObj && bufOrObj._buffer) {
        // Object wrapper - accesso diretto tramite property
        bufOrObj[fieldName] = value;
        return;
      } else if (typeof bufOrObj === "object" && bufOrObj !== null) {
        // Plain object (da toObject/create) - accesso diretto
        bufOrObj[fieldName] = value;
        return;
      } else {
        throw new TypeError("Expected Buffer or struct instance");
      }

      // Fast path: nome semplice senza dot notation
      // Lookup with Map
      let field = fieldMap.get(fieldName);

      if (field) {
        // Bit field
        if (field.isBitField) {
          _writeBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize, value);
          return;
        }

        // Nested struct (senza dot = imposta da oggetto)
        if (field.isNested) {
          if (Buffer.isBuffer(value)) {
            value.copy(buf, field.offset, 0, field.size);
          } else if (typeof value === "object") {
            const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
            for (const [k, v] of Object.entries(value)) {
              field.type.set(nestedBuf, k, v);
            }
          }
          return;
        }

        // Array field
        if (field.isArray) {
          if (Buffer.isBuffer(value)) {
            value.copy(buf, field.offset, 0, field.size);
          } else if (Array.isArray(value)) {
            const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
            const wrapped = field.type.wrap(arrayBuf);
            for (let i = 0; i < Math.min(value.length, field.type.length); i++) {
              wrapped[i] = value[i];
            }
          }
          return;
        }

        // Tipo base - fast path!
        writeValue(buf, field.type, value, field.offset);
        return;
      }

      // Slow path: supporto per accesso nested 'outer.inner' o anonymous fields
      const parts = fieldName.split(".");
      const firstPart = parts[0];

      field = fieldMap.get(firstPart);

      // Se non trovato, cerca negli anonymous fields
      if (!field) {
        for (const f of fieldDefs) {
          if (f.isAnonymous && f.type && f.type.fields) {
            // Verifica se il campo esiste nel tipo anonimo
            const hasField = f.type.fields.some((subField) => subField.name === firstPart);
            if (hasField) {
              // Scrive nel campo dell'anonymous field
              const nestedBuf = buf.subarray(f.offset, f.offset + f.size);
              f.type.set(nestedBuf, fieldName, value);
              return;
            }
          }
        }
        throw new Error(`Unknown field: ${firstPart}`);
      }

      // Bit field
      if (field.isBitField) {
        _writeBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize, value);
        return;
      }

      // Nested struct
      if (field.isNested) {
        if (parts.length > 1) {
          // Accesso a campo annidato singolo
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          field.type.set(nestedBuf, parts.slice(1).join("."), value);
        } else if (Buffer.isBuffer(value)) {
          // Copia buffer
          value.copy(buf, field.offset, 0, field.size);
        } else if (typeof value === "object") {
          // Imposta campi da oggetto
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          for (const [k, v] of Object.entries(value)) {
            field.type.set(nestedBuf, k, v);
          }
        }
        return;
      }

      // Array field
      if (field.isArray) {
        if (Buffer.isBuffer(value)) {
          // Copia buffer array
          value.copy(buf, field.offset, 0, field.size);
        } else if (Array.isArray(value)) {
          // Inizializza da array JavaScript
          const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
          const wrapped = field.type.wrap(arrayBuf);
          for (let i = 0; i < Math.min(value.length, field.type.length); i++) {
            wrapped[i] = value[i];
          }
        }
        return;
      }

      // Tipo base
      writeValue(buf, field.type, value, field.offset);
    },

    /**
     * Legge tutti i campi come oggetto (ricorsivo per nested)
     * @param {Buffer} buf - Buffer della struttura
     * @returns {Object} Oggetto con tutti i campi
     */
    /**
     * Converte buffer in plain object (KOFFI EAGER APPROACH)
     * Legge TUTTI i valori UNA VOLTA e crea PLAIN properties (no getters)
     * Molto più veloce! Sincronizzazione lazy quando serve _buffer
     */
    toObject(bufOrObj) {
      // Se è già un object (non buffer), controlla se ha _buffer
      if (!Buffer.isBuffer(bufOrObj)) {
        // Se ha _buffer, estrailo e ricarica i valori (utile dopo modifiche FFI)
        if (bufOrObj && bufOrObj._buffer && Buffer.isBuffer(bufOrObj._buffer)) {
          bufOrObj = bufOrObj._buffer; // Estrai buffer e procedi con il reload
        } else if (typeof bufOrObj === "object" && bufOrObj !== null) {
          // È già un plain object, restituiscilo così com'è
          return bufOrObj;
        } else {
          throw new TypeError("Expected Buffer or struct instance");
        }
      }

      const buf = bufOrObj;
      const result = {};

      // Leggi tutti i campi in una volta (eager approach)
      for (const field of fieldDefs) {
        if (field.isBitField) {
          result[field.name] = _readBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize);
        } else if (field.isNested) {
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          const nestedObj = field.type.toObject(nestedBuf);
          if (field.isAnonymous) {
            // Anonymous fields: promote their fields to parent level
            Object.assign(result, nestedObj);
          } else {
            result[field.name] = nestedObj;
          }
        } else if (field.isArray) {
          const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
          result[field.name] = field.type.wrap(arrayBuf);
        } else {
          // Tipo base - lettura diretta
          result[field.name] = readValue(buf, field.type, field.offset);
        }
      }

      return result;
    },

    /**
     * Ottiene il buffer di una nested struct
     * @param {Buffer} buf - Buffer della struttura parent
     * @param {string} fieldName - Nome del campo nested
     * @returns {Buffer} Slice del buffer per la nested struct
     */
    getNestedBuffer(buf, fieldName) {
      // O(1) lookup con Map
      const field = fieldMap.get(fieldName);
      if (!field) throw new Error(`Unknown field: ${fieldName}`);
      if (!field.isNested) throw new Error(`Field ${fieldName} is not a nested struct`);
      return buf.subarray(field.offset, field.offset + field.size);
    },
  };

  // Crea un'istanza C++ StructType per le operazioni native
  try {
    const cppStructType = new StructType();
    // Per ora non aggiungiamo campi - testiamo se ToObject funziona senza
    structDef._cppStructType = cppStructType;
  } catch (e) {
    // Se fallisce, continua senza C++ (fallback a JS)
    console.warn("Failed to create C++ StructType, using JavaScript fallback:", e.message);
  }

  // fromObject: write plain object values into buffer
  structDef.fromObject = function (buf, obj) {
    for (const [key, value] of Object.entries(obj)) {
      if (this.fields.some((f) => f.name === key)) {
        this.set(buf, key, value);
      }
    }
  };

  // createRaw: return plain object without synchronization
  structDef.createRaw = function (values = {}) {
    return this.toObject(this.create(values)._buffer);
  };

  return structDef;
}

// ============================================================================
// Python-compatible Simple C Data Types (instantiable)
// Usage: const v = new c_uint64(42); v.value; byref(v);
// ============================================================================

/**
 * Base class for simple C data types (Python ctypes compatible)
 * Subclasses must define static _size, _type, _reader, _writer
 */
class SimpleCData {
  /**
   * @param {number|bigint} [value] - Initial value (default: 0)
   */
  constructor(value) {
    const Ctor = this.constructor;
    this._buffer = alloc(Ctor._size);
    if (value !== undefined && value !== null) {
      this.value = value;
    }
  }

  /**
   * Get the current value
   */
  get value() {
    const Ctor = this.constructor;
    return Ctor._reader(this._buffer, 0);
  }

  /**
   * Set the value
   */
  set value(v) {
    const Ctor = this.constructor;
    Ctor._writer(this._buffer, 0, v);
  }

  /**
   * Size of the type in bytes (instance property)
   */
  get size() {
    return this.constructor._size;
  }

  /**
   * Create instance from existing buffer (Python ctypes compatible)
   * WARNING: Returns a VIEW into the buffer, not a copy!
   * @param {Buffer} buffer - Source buffer
   * @param {number} [offset=0] - Offset in buffer
   * @returns {SimpleCData} New instance wrapping the buffer slice
   */
  static from_buffer(buffer, offset = 0) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError("from_buffer requires a Buffer");
    }
    const inst = Object.create(this.prototype);
    inst._buffer = buffer.subarray(offset, offset + this._size);
    return inst;
  }

  /**
   * Create instance from a COPY of buffer data (Python ctypes compatible)
   * @param {Buffer} buffer - Source buffer
   * @param {number} [offset=0] - Offset in buffer
   * @returns {SimpleCData} New instance with copied data
   */
  static from_buffer_copy(buffer, offset = 0) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError("from_buffer_copy requires a Buffer");
    }
    const inst = new this();
    buffer.copy(inst._buffer, 0, offset, offset + this._size);
    return inst;
  }

  /**
   * Size of the type in bytes (static property)
   */
  static get size() {
    return this._size;
  }

  toString() {
    return `${this.constructor.name}(${this.value})`;
  }

  toJSON() {
    const v = this.value;
    return typeof v === "bigint" ? v.toString() : v;
  }

  valueOf() {
    return this.value;
  }
}

SimpleCData._isSimpleCData = true;

class c_void extends SimpleCData {
  static _size = 0;
  static _type = "void";
  static _reader = (buf, off) => undefined;
  static _writer = (buf, off, val) => {};
}

// ============================================================================
// Integer types - signed
// ============================================================================

class c_int8 extends SimpleCData {
  static _size = 1;
  static _type = "int8";
  static _reader = (buf, off) => buf.readInt8(off);
  static _writer = (buf, off, val) => buf.writeInt8(val, off);
}

class c_int16 extends SimpleCData {
  static _size = 2;
  static _type = "int16";
  static _reader = (buf, off) => buf.readInt16LE(off);
  static _writer = (buf, off, val) => buf.writeInt16LE(val, off);
}

class c_int32 extends SimpleCData {
  static _size = 4;
  static _type = "int32";
  static _reader = (buf, off) => buf.readInt32LE(off);
  static _writer = (buf, off, val) => buf.writeInt32LE(val, off);
}

class c_int64 extends SimpleCData {
  static _size = 8;
  static _type = "int64";
  static _reader = (buf, off) => buf.readBigInt64LE(off);
  static _writer = (buf, off, val) => buf.writeBigInt64LE(BigInt(val), off);
}

// ============================================================================
// Integer types - unsigned
// ============================================================================

class c_uint8 extends SimpleCData {
  static _size = 1;
  static _type = "uint8";
  static _reader = (buf, off) => buf.readUInt8(off);
  static _writer = (buf, off, val) => buf.writeUInt8(val, off);
}

class c_uint16 extends SimpleCData {
  static _size = 2;
  static _type = "uint16";
  static _reader = (buf, off) => buf.readUInt16LE(off);
  static _writer = (buf, off, val) => buf.writeUInt16LE(val, off);
}

class c_uint32 extends SimpleCData {
  static _size = 4;
  static _type = "uint32";
  static _reader = (buf, off) => buf.readUInt32LE(off);
  static _writer = (buf, off, val) => buf.writeUInt32LE(val, off);
}

class c_uint64 extends SimpleCData {
  static _size = 8;
  static _type = "uint64";
  static _reader = (buf, off) => buf.readBigUInt64LE(off);
  static _writer = (buf, off, val) => buf.writeBigUInt64LE(BigInt(val), off);
}

// ============================================================================
// Floating point types
// ============================================================================

class c_float extends SimpleCData {
  static _size = 4;
  static _type = "float";
  static _reader = (buf, off) => buf.readFloatLE(off);
  static _writer = (buf, off, val) => buf.writeFloatLE(val, off);
}

class c_double extends SimpleCData {
  static _size = 8;
  static _type = "double";
  static _reader = (buf, off) => buf.readDoubleLE(off);
  static _writer = (buf, off, val) => buf.writeDoubleLE(val, off);
}

// ============================================================================
// Boolean type
// ============================================================================

class c_bool extends SimpleCData {
  static _size = 1;
  static _type = "bool";
  static _reader = (buf, off) => buf.readUInt8(off) !== 0;
  static _writer = (buf, off, val) => buf.writeUInt8(val ? 1 : 0, off);
}

// ============================================================================
// Character types
// ============================================================================

class c_char extends SimpleCData {
  static _size = 1;
  static _type = "char";
  static _reader = (buf, off) => buf.readInt8(off);
  static _writer = (buf, off, val) => {
    if (typeof val === "string") {
      buf.writeUInt8(val.charCodeAt(0), off);
    } else {
      buf.writeInt8(val, off);
    }
  };
}

class c_wchar extends SimpleCData {
  static _size = native.WCHAR_SIZE;
  static _type = "wchar";
  static _reader = (buf, off) => {
    if (native.WCHAR_SIZE === 2) {
      return String.fromCharCode(buf.readUInt16LE(off));
    }
    return String.fromCodePoint(buf.readUInt32LE(off));
  };
  static _writer = (buf, off, val) => {
    const code = typeof val === "string" ? val.codePointAt(0) : val;
    if (native.WCHAR_SIZE === 2) {
      buf.writeUInt16LE(code, off);
    } else {
      buf.writeUInt32LE(code, off);
    }
  };
}

// ============================================================================
// Pointer types
// ============================================================================

class c_void_p extends SimpleCData {
  static _size = native.POINTER_SIZE;
  static _type = "pointer";
  static _reader = (buf, off) => {
    const ptr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : BigInt(buf.readUInt32LE(off));
    if (!ptr) return null;
    return ptr;
  };
  static _writer = (buf, off, val) => {
    // Accept Buffers (pointer to memory) and struct proxies with _buffer
    if (Buffer.isBuffer(val)) {
      const addr = addressOf(val);
      const v = typeof addr === "bigint" ? addr : BigInt(addr || 0);
      if (native.POINTER_SIZE === 8) buf.writeBigUInt64LE(v, off);
      else buf.writeUInt32LE(Number(v), off);
      return;
    }
    if (val && typeof val === "object" && val._buffer && Buffer.isBuffer(val._buffer)) {
      const addr = addressOf(val._buffer);
      const v = typeof addr === "bigint" ? addr : BigInt(addr || 0);
      if (native.POINTER_SIZE === 8) buf.writeBigUInt64LE(v, off);
      else buf.writeUInt32LE(Number(v), off);
      return;
    }

    // Fallback: accept BigInt or number
    const v = typeof val === "bigint" ? val : BigInt(val || 0);
    if (native.POINTER_SIZE === 8) {
      buf.writeBigUInt64LE(v, off);
    } else {
      buf.writeUInt32LE(Number(v), off);
    }
  };
}

class c_size_t extends SimpleCData {
  static _size = native.POINTER_SIZE;
  static _type = "size_t";
  static _reader = (buf, off) => {
    const ptr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : BigInt(buf.readUInt32LE(off));
    if (!ptr) return null;
    return ptr;
  };
  static _writer = (buf, off, val) => {
    const v = typeof val === "bigint" ? val : BigInt(val || 0);
    if (native.POINTER_SIZE === 8) {
      buf.writeBigUInt64LE(v, off);
    } else {
      buf.writeUInt32LE(Number(v), off);
    }
  };
}

// ============================================================================
// Platform-dependent types
// ============================================================================

const _longSize = native.sizeof ? native.sizeof("long") : 4;

class c_long extends SimpleCData {
  static _size = _longSize;
  static _type = "long";
  static _reader = _longSize === 8 ? (buf, off) => buf.readBigInt64LE(off) : (buf, off) => buf.readInt32LE(off);
  static _writer = _longSize === 8 ? (buf, off, val) => buf.writeBigInt64LE(BigInt(val), off) : (buf, off, val) => buf.writeInt32LE(val, off);
}

class c_ulong extends SimpleCData {
  static _size = _longSize;
  static _type = "ulong";
  static _reader = _longSize === 8 ? (buf, off) => buf.readBigUInt64LE(off) : (buf, off) => buf.readUInt32LE(off);
  static _writer = _longSize === 8 ? (buf, off, val) => buf.writeBigUInt64LE(BigInt(val), off) : (buf, off, val) => buf.writeUInt32LE(val, off);
}

// ============================================================================
// String pointer types
// ============================================================================

class c_char_p extends SimpleCData {
  static _size = native.POINTER_SIZE;
  static _type = "char_p";
  static _reader = (buf, off) => {
    const ptr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : BigInt(buf.readUInt32LE(off));
    if (!ptr) return null;
    return readCString(ptr);
  };
  static _writer = (buf, off, val) => {
    if (typeof val === "string") {
      val = cstring(val);
    }
    if (Buffer.isBuffer(val)) {
      const addr = addressOf(val);
      const v = typeof addr === "bigint" ? addr : BigInt(addr || 0);
      if (native.POINTER_SIZE === 8) {
        buf.writeBigUInt64LE(v, off);
      } else {
        buf.writeUInt32LE(Number(v), off);
      }
    } else {
      const v = typeof val === "bigint" ? val : BigInt(val || 0);
      if (native.POINTER_SIZE === 8) {
        buf.writeBigUInt64LE(v, off);
      } else {
        buf.writeUInt32LE(Number(v), off);
      }
    }
  };
}

class c_wchar_p extends SimpleCData {
  static _size = native.POINTER_SIZE;
  static _type = "wchar_p";
  static _reader = (buf, off) => {
    const ptr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : BigInt(buf.readUInt32LE(off));
    if (!ptr) return null;
    return readWString(ptr);
  };
  static _writer = (buf, off, val) => {
    if (typeof val === "string") {
      val = wstring(val);
    }
    if (Buffer.isBuffer(val)) {
      const addr = addressOf(val);
      const v = typeof addr === "bigint" ? addr : BigInt(addr || 0);
      if (native.POINTER_SIZE === 8) {
        buf.writeBigUInt64LE(v, off);
      } else {
        buf.writeUInt32LE(Number(v), off);
      }
    } else {
      const v = typeof val === "bigint" ? val : BigInt(val || 0);
      if (native.POINTER_SIZE === 8) {
        buf.writeBigUInt64LE(v, off);
      } else {
        buf.writeUInt32LE(Number(v), off);
      }
    }
  };
}

// ============================================================================
// Python-compatible aliases
// ============================================================================

const c_byte = c_int8;
const c_ubyte = c_uint8;
const c_short = c_int16;
const c_ushort = c_uint16;
const c_int = c_int32;
const c_uint = c_uint32;
const c_longlong = c_int64;
const c_ulonglong = c_uint64;

// ============================================================================
// Alias Python-compatibili per Memory Management
// ============================================================================

/**
 * Crea un buffer di stringa (compatibile con Python ctypes)
 * @param {number|string|Buffer} init - Dimensione in bytes, stringa, o bytes
 * @returns {Buffer} Buffer allocato
 */
function create_string_buffer(init) {
  if (typeof init === "number") {
    // create_string_buffer(size) - alloca buffer vuoto
    return alloc(init);
  } else if (typeof init === "string") {
    // create_string_buffer("string") - crea buffer con stringa
    return cstring(init);
  } else if (Buffer.isBuffer(init)) {
    // create_string_buffer(bytes) - copia bytes
    const buf = alloc(init.length + 1);
    init.copy(buf);
    buf[init.length] = 0; // null terminator
    return buf;
  }
  throw new TypeError("create_string_buffer requires number, string, or Buffer");
}

/**
 * Crea un buffer di stringa Unicode (compatibile con Python ctypes)
 * @param {number|string} init - Dimensione in caratteri o stringa
 * @returns {Buffer} Buffer allocato con stringa wide
 */
function create_unicode_buffer(init) {
  const wcharSize = native.WCHAR_SIZE; // 2 su Windows, 4 su Unix

  if (typeof init === "number") {
    // create_unicode_buffer(size) - alloca buffer vuoto per N caratteri
    return alloc(init * wcharSize);
  } else if (typeof init === "string") {
    // create_unicode_buffer("string") - crea buffer con stringa wide
    return wstring(init);
  }
  throw new TypeError("create_unicode_buffer requires number or string");
}

/**
 * Legge una stringa da un indirizzo di memoria (compatibile con Python ctypes)
 * @param {Buffer|BigInt|number} address - Indirizzo di memoria
 * @param {number} [size] - Numero di bytes da leggere (default: fino a null)
 * @returns {string|null} Stringa letta
 */
function string_at(address, size) {
  return readCString(address, size);
}

/**
 * Legge una stringa wide da un indirizzo di memoria (compatibile con Python ctypes)
 * @param {Buffer|BigInt|number} address - Indirizzo di memoria
 * @param {number} [size] - Numero di caratteri wide da leggere
 * @returns {string|null} Stringa letta
 */
function wstring_at(address, size) {
  return readWString(address, size);
}

// Alias lowercase per compatibilità Python (addressof invece di addressOf)
const addressof = addressOf;

/**
 * Copia memoria da sorgente a destinazione (come memmove in C)
 * @param {Buffer} dst - Buffer destinazione
 * @param {Buffer|BigInt} src - Buffer o indirizzo sorgente
 * @param {number} count - Numero di bytes da copiare
 */
function memmove(dst, src, count) {
  if (!Buffer.isBuffer(dst)) {
    throw new TypeError("dst must be a Buffer");
  }

  let srcBuf;
  if (Buffer.isBuffer(src)) {
    srcBuf = src;
  } else {
    srcBuf = ptrToBuffer(src, count);
  }

  srcBuf.copy(dst, 0, 0, count);
}

/**
 * Riempie memoria con un valore (come memset in C)
 * @param {Buffer} dst - Buffer destinazione
 * @param {number} value - Valore byte (0-255)
 * @param {number} count - Numero di bytes da riempire
 */
function memset(dst, value, count) {
  if (!Buffer.isBuffer(dst)) {
    throw new TypeError("dst must be a Buffer");
  }
  dst.fill(value, 0, count);
}

// Export come ES module
export {
  // Classi
  Version,
  Library,
  CDLL,
  WinDLL,
  FFIFunction,
  Callback,
  ThreadSafeCallback,
  CType,

  // Funzioni base
  load,
  callback,
  threadSafeCallback,

  // Memory Management - Python-compatibili
  create_string_buffer,
  create_unicode_buffer,
  string_at,
  wstring_at,
  addressof,
  memmove,
  memset,

  // Memory - utility senza equivalente Python diretto
  readValue,
  writeValue,
  sizeof,
  ptrToBuffer,

  // Strutture
  struct,
  union,
  defineStruct,
  defineUnion,
  array,
  bitfield,
  StructType,
  ArrayType,
  Structure,
  Union,

  // Classes for Python-like subclassing: class X extends Structure { static _fields_ = [...] }
  // See Structure/Union implementation below

  // Puntatori (Python-compatible)
  byref,
  cast,
  POINTER,

  // Error handling
  get_errno,
  set_errno,
  GetLastError,
  SetLastError,
  FormatError,
  WinError,

  // SimpleCData base class
  SimpleCData,

  // Tipi (classes, now instantiable)
  types,
  c_void,
  c_int,
  c_uint,
  c_int8,
  c_uint8,
  c_int16,
  c_uint16,
  c_int32,
  c_uint32,
  c_int64,
  c_uint64,
  c_float,
  c_double,
  c_char,
  c_char_p,
  c_wchar,
  c_wchar_p,
  c_void_p,
  c_bool,
  c_size_t,
  c_long,
  c_ulong,
  // Python-compatible aliases
  c_byte,
  c_ubyte,
  c_short,
  c_ushort,
  c_longlong,
  c_ulonglong,
};

// Costanti esportate
export const POINTER_SIZE = native.POINTER_SIZE;
export const WCHAR_SIZE = native.WCHAR_SIZE;
export const NULL = null;
