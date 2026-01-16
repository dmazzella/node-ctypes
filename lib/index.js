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
      const unpackedPath = path.join(
        electronProcess.resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        moduleName
      );
      if (existsSync(buildPath(unpackedPath))) {
        return buildPath(unpackedPath);
      }
    }
  }

  // Check in current working directory's node_modules
  const cwdPath = buildPath(
    path.join(process.cwd(), "node_modules", moduleName)
  );
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

  throw new Error(
    `Native module "${nativeFile}" not found for "${moduleName}". ` +
      `Searched in Electron resources, node_modules, and local build.`
  );
};

// Load the native module
let nativeModulePath;
try {
  nativeModulePath = getNativeModulePath("node-ctypes", `ctypes.node`);
} catch (e) {
  const platform = process.platform;
  const arch = process.arch;
  nativeModulePath = getNativeModulePath(
    "node-ctypes",
    `ctypes-${platform}-${arch}.node`
  );
}
const require = createRequire(path.join(process.cwd(), "index.js"));
const native = require(nativeModulePath);

// Re-esporta le classi native
const {
  Version,
  Library,
  FFIFunction,
  Callback,
  ThreadSafeCallback,
  CType,
  StructType,
  ArrayType,
} = native;

// Tipi predefiniti
const types = native.types;

/**
 * Carica una libreria dinamica
 * @param {string|null} libPath - Percorso della libreria o null per l'eseguibile corrente
 * @returns {Library} Oggetto Library
 */
function load(libPath) {
  return new Library(libPath);
}

/**
 * Wrapper conveniente per CDLL (come in Python ctypes)
 */
class CDLL {
  constructor(libPath) {
    this._lib = new Library(libPath);
    this._cache = new Map();
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
    const cacheKey = `${name}:${returnType}:${argTypes.length}`;

    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const ffiFunc = this._lib.func(name, returnType, argTypes, options);

    // Crea wrapper minimo ottimizzato
    // Estrae ._buffer solo da argomenti che sono oggetti NON-Buffer
    const callMethod = function (...args) {
      // Fast path: se nessun argomento è un oggetto non-Buffer, passa direttamente
      let hasNonBufferObject = false;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg && typeof arg === "object" && !Buffer.isBuffer(arg)) {
          hasNonBufferObject = true;
          break;
        }
      }

      if (!hasNonBufferObject) {
        return ffiFunc.call(...args);
      }

      // Slow path: estrai ._buffer dove presente
      const processedArgs = args.map((arg) => {
        if (
          arg &&
          typeof arg === "object" &&
          !Buffer.isBuffer(arg) &&
          arg._buffer &&
          Buffer.isBuffer(arg._buffer)
        ) {
          return arg._buffer;
        }
        return arg;
      });

      return ffiFunc.call(...processedArgs);
    };

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
    return this._lib.callback(returnType, argTypes, fn);
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
  const cb = new Callback(fn, returnType, argTypes);

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
  const cb = new ThreadSafeCallback(fn, returnType, argTypes);

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
 * Per tipi base comuni usa Buffer methods direttamente (più veloce)
 * @param {Buffer|BigInt|number} ptr - Puntatore
 * @param {string|CType} type - Tipo del valore
 * @param {number} [offset=0] - Offset in bytes
 * @returns {*} Valore letto
 */
function readValue(ptr, type, offset = 0) {
  // Fast path: Buffer + tipo stringa comune
  if (Buffer.isBuffer(ptr) && typeof type === "string") {
    switch (type) {
      case "int8":
      case "c_int8":
        return ptr.readInt8(offset);
      case "uint8":
      case "c_uint8":
        return ptr.readUInt8(offset);
      case "int16":
      case "c_int16":
        return ptr.readInt16LE(offset);
      case "uint16":
      case "c_uint16":
        return ptr.readUInt16LE(offset);
      case "int32":
      case "int":
      case "c_int32":
      case "c_int":
        return ptr.readInt32LE(offset);
      case "uint32":
      case "uint":
      case "c_uint32":
      case "c_uint":
        return ptr.readUInt32LE(offset);
      case "int64":
      case "c_int64":
        return ptr.readBigInt64LE(offset);
      case "uint64":
      case "c_uint64":
        return ptr.readBigUInt64LE(offset);
      case "float":
      case "c_float":
        return ptr.readFloatLE(offset);
      case "double":
      case "c_double":
        return ptr.readDoubleLE(offset);
      case "bool":
      case "c_bool":
        return ptr.readUInt8(offset) !== 0;
    }
  }
  // Struct type (class)
  if (typeof type === "function" && type.prototype instanceof Structure) {
    const def = type._structDef || type._buildStruct();
    const tempBuf = ptr.subarray(offset, offset + def.size);
    return def.toObject(tempBuf);
  }
  // Slow path: tipi complessi o puntatori raw
  return native.readValue(ptr, type, offset);
}

/**
 * Scrive un valore in memoria
 * Per tipi base comuni usa Buffer methods direttamente (più veloce)
 * @param {Buffer|BigInt|number} ptr - Puntatore
 * @param {string|CType} type - Tipo del valore
 * @param {*} value - Valore da scrivere
 * @param {number} [offset=0] - Offset in bytes
 * @returns {number} Bytes scritti
 */
function writeValue(ptr, type, value, offset = 0) {
  // Fast path: Buffer + tipo stringa comune
  if (Buffer.isBuffer(ptr) && typeof type === "string") {
    switch (type) {
      case "int8":
      case "c_int8":
        ptr.writeInt8(value, offset);
        return 1;
      case "uint8":
      case "c_uint8":
        ptr.writeUInt8(value, offset);
        return 1;
      case "int16":
      case "c_int16":
        ptr.writeInt16LE(value, offset);
        return 2;
      case "uint16":
      case "c_uint16":
        ptr.writeUInt16LE(value, offset);
        return 2;
      case "int32":
      case "int":
      case "c_int32":
      case "c_int":
        ptr.writeInt32LE(value, offset);
        return 4;
      case "uint32":
      case "uint":
      case "c_uint32":
      case "c_uint":
        ptr.writeUInt32LE(value, offset);
        return 4;
      case "int64":
      case "c_int64":
        ptr.writeBigInt64LE(BigInt(value), offset);
        return 8;
      case "uint64":
      case "c_uint64":
        ptr.writeBigUInt64LE(BigInt(value), offset);
        return 8;
      case "float":
      case "c_float":
        ptr.writeFloatLE(value, offset);
        return 4;
      case "double":
      case "c_double":
        ptr.writeDoubleLE(value, offset);
        return 8;
      case "bool":
      case "c_bool":
        ptr.writeUInt8(value ? 1 : 0, offset);
        return 1;
    }
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
  // Slow path: tipi complessi o puntatori raw
  return native.writeValue(ptr, type, value, offset);
}

/**
 * Restituisce la dimensione di un tipo
 * @param {string|CType|Object} type - Tipo
 * @returns {number} Dimensione in bytes
 */
function sizeof(type) {
  // Struct type (class)
  if (typeof type === "function" && type.prototype instanceof Structure) {
    const def = type._structDef || type._buildStruct();
    return def.size;
  }

  // Struct type
  if (
    typeof type === "object" &&
    type !== null &&
    typeof type.size === "number"
  ) {
    return type.size;
  }

  // Array type
  if (
    typeof type === "object" &&
    type !== null &&
    typeof type.getSize === "function"
  ) {
    return type.getSize();
  }

  // Tipo base (stringa o CType nativo)
  if (typeof type === "string") {
    switch (type) {
      case "int8":
      case "c_int8":
        return 1;
      case "uint8":
      case "c_uint8":
        return 1;
      case "int16":
      case "c_int16":
        return 2;
      case "uint16":
      case "c_uint16":
        return 2;
      case "int32":
      case "int":
      case "c_int32":
      case "c_int":
        return 4;
      case "uint32":
      case "uint":
      case "c_uint32":
      case "c_uint":
        return 4;
      case "int64":
      case "c_int64":
        return 8;
      case "uint64":
      case "c_uint64":
        return 8;
      case "float":
      case "c_float":
        return 4;
      case "double":
      case "c_double":
        return 8;
      case "bool":
      case "c_bool":
        return 1;
      case "pointer":
      case "c_void_p":
        return native.POINTER_SIZE;
      case "size_t":
        return native.POINTER_SIZE; // Assume same as pointer
      default:
        // Fallback to native
        break;
    }
  }
  return native.sizeof(type);
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
    const tempBuf = alloc(8);
    writeValue(tempBuf, "pointer", ptr);
    return readValue(tempBuf, "pointer");
  }
  if (typeof ptr === "bigint") {
    return ptr;
  }
  return BigInt(ptr);
}

/**
 * Passa un buffer per riferimento (come Python byref)
 * In pratica restituisce il buffer stesso, che viene automaticamente
 * convertito in puntatore quando passato a funzioni FFI.
 *
 * @param {Buffer} obj - Buffer da passare per riferimento
 * @returns {Buffer} Lo stesso buffer (per compatibilità API)
 */
function byref(obj) {
  if (!Buffer.isBuffer(obj)) {
    throw new TypeError("byref() argument must be a Buffer");
  }
  return obj;
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
  const baseSize =
    typeof baseType === "object" ? baseType.size : sizeof(baseType);
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
      writeValue(buf, "pointer", 0n);
      return buf;
    },

    /**
     * Crea un puntatore a un buffer esistente
     */
    fromBuffer(targetBuf) {
      const buf = alloc(native.POINTER_SIZE);
      writeValue(buf, "pointer", targetBuf);
      return buf;
    },

    /**
     * Legge il puntatore (dereferenzia)
     */
    deref(ptrBuf) {
      const addr = readValue(ptrBuf, "pointer");
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
        writeValue(ptrBuf, "pointer", value);
      } else {
        writeValue(ptrBuf, "pointer", value);
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
    // Tipo base
    else {
      size = sizeof(type);
      alignment = Math.min(size, native.POINTER_SIZE);
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

      // Crea istanza sincronizzata come Python ctypes
      const instance = {};

      // Buffer interno nascosto
      Object.defineProperty(instance, "_buffer", {
        value: buf,
        enumerable: false,
        configurable: false,
        writable: false,
      });

      // Metodo per ottenere plain object
      instance.toObject = function () {
        return unionDef.toObject(buf);
      };

      // Getters/setters sincronizzati per ogni campo
      for (const field of fieldDefs) {
        Object.defineProperty(instance, field.name, {
          enumerable: true,
          get: () => unionDef.get(buf, field.name),
          set: (value) => unionDef.set(buf, field.name, value),
        });
      }

      return instance;
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
        return _readBitField(
          buf,
          field.offset,
          field.type,
          field.bitOffset,
          field.bitSize
        );
      }

      // Nested struct
      if (field.isNested) {
        const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
        // Crea istanza sincronizzata invece di plain object
        const instance = {};
        Object.defineProperty(instance, "_buffer", {
          value: nestedBuf,
          enumerable: false,
          configurable: false,
          writable: false,
        });
        instance.toObject = function () {
          return field.type.toObject(nestedBuf);
        };
        // Getters/setters per i campi
        for (const subField of field.type.fields) {
          if (!subField.isAnonymous) {
            Object.defineProperty(instance, subField.name, {
              enumerable: true,
              get: () => field.type.get(nestedBuf, subField.name),
              set: (value) => field.type.set(nestedBuf, subField.name, value),
            });
          }
        }
        return instance;
      }

      // Array
      if (field.isArray) {
        return field.type.wrap(
          buf.subarray(field.offset, field.offset + field.size)
        );
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

      // O(1) lookup con Map
      const field = fieldMap.get(fieldName);
      if (!field) throw new Error(`Unknown field: ${fieldName}`);

      // Bit field
      if (field.isBitField) {
        _writeBitField(
          buf,
          field.offset,
          field.type,
          field.bitOffset,
          field.bitSize,
          value
        );
        return;
      }

      // Nested struct
      if (field.isNested) {
        if (Buffer.isBuffer(value)) {
          value.copy(buf, field.offset, 0, field.size);
        } else if (typeof value === "object") {
          const nestedBuf = buf.subarray(
            field.offset,
            field.offset + field.size
          );
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
          const wrapped = field.type.wrap(
            buf.subarray(field.offset, field.offset + field.size)
          );
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
        if (
          bufOrObj &&
          bufOrObj._buffer &&
          bufOrObj._buffer.length === maxSize
        ) {
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
              return _readBitField(
                buf,
                0,
                field.type,
                field.bitOffset,
                field.bitSize
              );
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
              _writeBitField(
                buf,
                0,
                field.type,
                field.bitOffset,
                field.bitSize,
                value
              );
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
    const buf = alloc(def.size);
    buf.fill(0);
    this.__buffer = buf;
    this._structDef = def;

    // Support positional args: new Point(10,20)
    if (
      args.length === 1 &&
      typeof args[0] === "object" &&
      !Array.isArray(args[0]) &&
      !Buffer.isBuffer(args[0])
    ) {
      const initial = args[0];
      for (const [k, v] of Object.entries(initial)) {
        def.set(this.__buffer, k, v);
      }
    } else if (args.length === 1 && Buffer.isBuffer(args[0])) {
      // new Point(buffer) - wrap existing buffer
      this.__buffer = args[0];
    } else if (args.length > 0) {
      // Positional mapping to non-anonymous declared fields order
      const ordered = def.fields.filter((f) => !f.isAnonymous);
      for (let i = 0; i < Math.min(args.length, ordered.length); i++) {
        def.set(this.__buffer, ordered[i].name, args[i]);
      }
    }

    // Expose _buffer as non-enumerable property
    Object.defineProperty(this, "_buffer", {
      value: this.__buffer,
      writable: true,
      enumerable: false,
      configurable: true,
    });

    // Add caching for performance
    this._cache = new Map();
    this._cacheEnabled = true;

    // Install direct field properties (p.x style) for convenience
    for (const field of def.fields) {
      // If anonymous, its subfields will be exposed below
      const name = field.name;
      if (!Object.prototype.hasOwnProperty.call(this, name)) {
        Object.defineProperty(this, name, {
          get: () => {
            if (this._cacheEnabled && this._cache.has(name)) {
              return this._cache.get(name);
            }
            const value = this._structDef.get(this._buffer, name);
            if (this._cacheEnabled) this._cache.set(name, value);
            return value;
          },
          set: (v) => {
            this._structDef.set(this._buffer, name, v);
            if (this._cacheEnabled) this._cache.set(name, v);
          },
          enumerable: true,
          configurable: true,
        });
      }

      // If field is anonymous nested struct, expose its inner fields at top-level
      if (field.isAnonymous && field.type && Array.isArray(field.type.fields)) {
        for (const subField of field.type.fields) {
          const subName = subField.name;
          if (!Object.prototype.hasOwnProperty.call(this, subName)) {
            Object.defineProperty(this, subName, {
              get: () => {
                if (this._cacheEnabled && this._cache.has(subName)) {
                  return this._cache.get(subName);
                }
                const value = field.type.get(
                  this._buffer.subarray(
                    field.offset,
                    field.offset + field.size
                  ),
                  subName
                );
                if (this._cacheEnabled) this._cache.set(subName, value);
                return value;
              },
              set: (v) => {
                field.type.set(
                  this._buffer.subarray(
                    field.offset,
                    field.offset + field.size
                  ),
                  subName,
                  v
                );
                if (this._cacheEnabled) this._cache.set(subName, v);
              },
              enumerable: true,
              configurable: true,
            });
          }
        }
      }
    }
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
          mapFields[anonName] = { anonymous: true, type: mapFields[anonName] };
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
    const plain = this._structDef.toObject(this._buffer);
    Object.assign(plain, obj);
    this._structDef.fromObject(this._buffer, plain);
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
    return this._structDef.get(this._buffer, fieldName);
  }

  set(fieldName, value) {
    return this._structDef.set(this._buffer, fieldName, value);
  }

  // Bulk operations for better performance
  setFields(fields) {
    for (const [name, value] of Object.entries(fields)) {
      this._structDef.set(this._buffer, name, value);
      if (this._cacheEnabled) this._cache.set(name, value);
    }
  }

  getFields(fieldNames) {
    const result = {};
    for (const name of fieldNames) {
      result[name] = this._structDef.get(this._buffer, name);
    }
    return result;
  }

  // Performance optimization: temporary disable sync for bulk operations
  withBulkUpdate(callback) {
    const wasCacheEnabled = this._cacheEnabled;
    this._cacheEnabled = false; // Disable caching during bulk update
    this._cache.clear(); // Clear any stale cache

    try {
      return callback(this);
    } finally {
      this._cacheEnabled = wasCacheEnabled;
      // Invalidate cache to ensure fresh reads after bulk update
      if (wasCacheEnabled) {
        this._cache.clear();
      }
    }
  }

  // Cache management for performance
  enableCache() {
    this._cacheEnabled = true;
  }

  disableCache() {
    this._cacheEnabled = false;
    this._cache.clear();
  }

  invalidateCache() {
    this._cache.clear();
  }

  // Direct typed array access for numeric fields (maximum performance)
  getInt32Array(offset = 0, length) {
    return new Int32Array(
      this._buffer.buffer,
      this._buffer.byteOffset + offset,
      length
    );
  }

  getFloat64Array(offset = 0, length) {
    return new Float64Array(
      this._buffer.buffer,
      this._buffer.byteOffset + offset,
      length
    );
  }

  // Get raw buffer slice for external operations
  getBufferSlice(offset = 0, size = this._buffer.length - offset) {
    return this._buffer.subarray(offset, offset + size);
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
    return this._structDef.toObject(this._buffer);
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
  const elementSize = sizeof(elementType);
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
              yield readValue(target, elementType, i * elementSize);
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
          writeValue(
            buffer,
            elementType,
            values.charCodeAt(i),
            i * sizeof(elementType)
          );
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
        _get: msvcrt.func("_get_errno", "int32", ["pointer"]),
        _set: msvcrt.func("_set_errno", "int32", ["int32"]),
        _lib: msvcrt,
      };
    } else if (process.platform === "darwin") {
      // macOS usa __error invece di __errno_location
      const libc = new CDLL(null);
      _errno_funcs = {
        _location: libc.func("__error", "pointer", []),
        _lib: libc,
      };
    } else {
      // Linux e altri Unix usano __errno_location
      const libc = new CDLL(null);
      _errno_funcs = {
        _location: libc.func("__errno_location", "pointer", []),
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
    return readValue(buf, "int32");
  } else {
    const ptr = funcs._location();
    return readValue(ptr, "int32");
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
    writeValue(ptr, "int32", value);
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
      GetLastError: kernel32.func("GetLastError", "uint32", []),
      SetLastError: kernel32.func("SetLastError", "void", ["uint32"]),
      FormatMessageW: kernel32.func("FormatMessageW", "uint32", [
        "uint32",
        "pointer",
        "uint32",
        "uint32",
        "pointer",
        "uint32",
        "pointer",
      ]),
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
    null
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
    throw new Error(
      `Bit field size must be between 1 and ${maxBits} for ${baseType}`
    );
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
  return (
    typeof type === "object" &&
    type !== null &&
    typeof type.size === "number" &&
    Array.isArray(type.fields) &&
    typeof type.create === "function"
  );
}

/**
 * Helper per verificare se un tipo è un array type
 */
function _isArrayType(type) {
  return (
    typeof type === "object" && type !== null && type._isArrayType === true
  );
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
    value =
      (value & clearMask) | ((BigInt(newValue) & mask) << BigInt(bitOffset));
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
    if (
      typeof type === "object" &&
      type !== null &&
      type.anonymous === true &&
      type.type
    ) {
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
      const canContinue =
        currentBitFieldBase === baseType &&
        currentBitOffset + bits <= baseSize * 8;

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
    // Caso 4: Tipo base
    else {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      const size = sizeof(type);
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

  const structDef = {
    size: totalSize,
    alignment: maxAlignment,
    fields: fieldDefs,
    packed: packed,
    _isStructType: true,

    /**
     * Alloca e inizializza una nuova istanza
     * @param {Object} [values] - Valori iniziali
     * @returns {Object} Plain object con properties (KOFFI APPROACH)
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

      // Crea istanza sincronizzata come Python ctypes
      const instance = {};

      // Buffer interno nascosto
      Object.defineProperty(instance, "_buffer", {
        value: buf,
        enumerable: false,
        configurable: false,
        writable: false,
      });

      // Metodo per ottenere plain object
      instance.toObject = function () {
        return structDef.toObject(buf);
      };

      // Getters/setters sincronizzati per ogni campo
      for (const field of fieldDefs) {
        if (!field.isAnonymous) {
          Object.defineProperty(instance, field.name, {
            enumerable: true,
            get: () => structDef.get(buf, field.name),
            set: (value) => structDef.set(buf, field.name, value),
          });
        } else if (field.isAnonymous && field.type && field.type.fields) {
          // Campi anonymous: promuovi al livello superiore
          for (const subField of field.type.fields) {
            Object.defineProperty(instance, subField.name, {
              enumerable: true,
              get: () => structDef.get(buf, subField.name),
              set: (value) => structDef.set(buf, subField.name, value),
            });
          }
        }
      }

      return instance;
    },

    /**
     * Legge un campo dalla struttura
     * @param {Buffer|Object} bufOrObj - Buffer della struttura O object wrapper
     * @param {string} fieldName - Nome del campo (supporta 'outer.inner' per nested)
     * @returns {*} Valore del campo
     */
    get(bufOrObj, fieldName) {
      // NUOVO: supporta sia buffer che object wrapper o plain object
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
      // O(1) lookup con Map
      let field = fieldMap.get(fieldName);

      if (field) {
        // Bit field
        if (field.isBitField) {
          return _readBitField(
            buf,
            field.offset,
            field.type,
            field.bitOffset,
            field.bitSize
          );
        }

        // Nested struct (senza dot = ritorna intero oggetto)
        if (field.isNested) {
          const nestedBuf = buf.subarray(
            field.offset,
            field.offset + field.size
          );
          // Restituisci istanza sincronizzata invece di plain object
          const nestedInstance = {};

          // Buffer interno punta al nested buffer
          Object.defineProperty(nestedInstance, "_buffer", {
            value: nestedBuf,
            enumerable: false,
            configurable: false,
            writable: false,
          });

          // Metodo toObject
          nestedInstance.toObject = function () {
            return field.type.toObject(nestedBuf);
          };

          // Getters/setters per campi nested
          for (const subField of field.type.fields) {
            if (!subField.isAnonymous) {
              Object.defineProperty(nestedInstance, subField.name, {
                enumerable: true,
                get: () => field.type.get(nestedBuf, subField.name),
                set: (value) => field.type.set(nestedBuf, subField.name, value),
              });
            } else if (
              subField.isAnonymous &&
              subField.type &&
              subField.type.fields
            ) {
              for (const subSubField of subField.type.fields) {
                Object.defineProperty(nestedInstance, subSubField.name, {
                  enumerable: true,
                  get: () => field.type.get(nestedBuf, subSubField.name),
                  set: (value) =>
                    field.type.set(nestedBuf, subSubField.name, value),
                });
              }
            }
          }

          return nestedInstance;
        }

        // Array field
        if (field.isArray) {
          const arrayBuf = buf.subarray(
            field.offset,
            field.offset + field.size
          );
          return field.type.wrap(arrayBuf);
        }

        // Tipo base - fast path!
        return readValue(buf, field.type, field.offset);
      }

      // Slow path: supporto per accesso nested 'outer.inner' o anonymous fields
      const parts = fieldName.split(".");
      const firstPart = parts[0];

      field = fieldMap.get(firstPart);

      // Se non trovato, cerca negli anonymous fields
      if (!field) {
        for (const f of fieldDefs) {
          if (f.isAnonymous && f.type && f.type.fields) {
            const hasField = f.type.fields.some(
              (subField) => subField.name === firstPart
            );
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
      // NUOVO: supporta sia buffer che object wrapper o plain object
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
      // O(1) lookup con Map
      let field = fieldMap.get(fieldName);

      if (field) {
        // Bit field
        if (field.isBitField) {
          _writeBitField(
            buf,
            field.offset,
            field.type,
            field.bitOffset,
            field.bitSize,
            value
          );
          return;
        }

        // Nested struct (senza dot = imposta da oggetto)
        if (field.isNested) {
          if (Buffer.isBuffer(value)) {
            value.copy(buf, field.offset, 0, field.size);
          } else if (typeof value === "object") {
            const nestedBuf = buf.subarray(
              field.offset,
              field.offset + field.size
            );
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
            const arrayBuf = buf.subarray(
              field.offset,
              field.offset + field.size
            );
            const wrapped = field.type.wrap(arrayBuf);
            for (
              let i = 0;
              i < Math.min(value.length, field.type.length);
              i++
            ) {
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
            const hasField = f.type.fields.some(
              (subField) => subField.name === firstPart
            );
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
        _writeBitField(
          buf,
          field.offset,
          field.type,
          field.bitOffset,
          field.bitSize,
          value
        );
        return;
      }

      // Nested struct
      if (field.isNested) {
        if (parts.length > 1) {
          // Accesso a campo annidato singolo
          const nestedBuf = buf.subarray(
            field.offset,
            field.offset + field.size
          );
          field.type.set(nestedBuf, parts.slice(1).join("."), value);
        } else if (Buffer.isBuffer(value)) {
          // Copia buffer
          value.copy(buf, field.offset, 0, field.size);
        } else if (typeof value === "object") {
          // Imposta campi da oggetto
          const nestedBuf = buf.subarray(
            field.offset,
            field.offset + field.size
          );
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
          const arrayBuf = buf.subarray(
            field.offset,
            field.offset + field.size
          );
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
          result[field.name] = _readBitField(
            buf,
            field.offset,
            field.type,
            field.bitOffset,
            field.bitSize
          );
        } else if (field.isNested) {
          const nestedBuf = buf.subarray(
            field.offset,
            field.offset + field.size
          );
          const nestedObj = field.type.toObject(nestedBuf);
          if (field.isAnonymous) {
            // Anonymous fields: promote their fields to parent level
            Object.assign(result, nestedObj);
          } else {
            result[field.name] = nestedObj;
          }
        } else if (field.isArray) {
          const arrayBuf = buf.subarray(
            field.offset,
            field.offset + field.size
          );
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
      if (!field.isNested)
        throw new Error(`Field ${fieldName} is not a nested struct`);
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
    console.warn(
      "Failed to create C++ StructType, using JavaScript fallback:",
      e.message
    );
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

// Alias per compatibilità con Python ctypes - Tipi
const c_int = types.c_int;
const c_uint = types.c_uint;
const c_int8 = types.c_int8;
const c_uint8 = types.c_uint8;
const c_int16 = types.c_int16;
const c_uint16 = types.c_uint16;
const c_int32 = types.c_int32;
const c_uint32 = types.c_uint32;
const c_int64 = types.c_int64;
const c_uint64 = types.c_uint64;
const c_float = types.c_float;
const c_double = types.c_double;
const c_char = types.c_char;
const c_char_p = types.c_char_p;
const c_wchar = types.c_wchar;
const c_wchar_p = types.c_wchar_p;
const c_void_p = types.c_void_p;
const c_bool = types.c_bool;
const c_size_t = types.c_size_t;
const c_long = types.c_long;
const c_ulong = types.c_ulong;

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
  throw new TypeError(
    "create_string_buffer requires number, string, or Buffer"
  );
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

  // Tipi
  types,
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
};

// Costanti esportate
export const POINTER_SIZE = native.POINTER_SIZE;
export const WCHAR_SIZE = native.WCHAR_SIZE;
export const NULL = null;
