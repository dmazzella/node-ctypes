/**
 * node-ctypes - Python ctypes-like FFI for Node.js
 *
 * A simple FFI library that allows calling C functions from JavaScript,
 * similar to Python's ctypes module.
 */

const path = require("path");

// Carica il modulo nativo
let native;
try {
  native = require("../build/Release/node_ctypes.node");
} catch (e) {
  try {
    native = require("../build/Debug/node_ctypes.node");
  } catch (e2) {
    throw new Error(
      "Failed to load native module. " +
        'Make sure to run "npm run build" first.\n' +
        "Original error: " +
        e.message
    );
  }
}

// Re-esporta le classi native
const {
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

    // Crea wrapper minimo - bind diretto al metodo call
    const callMethod = ffiFunc.call.bind(ffiFunc);

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
 * @returns {Object} Oggetto con .pointer (BigInt) e .release()
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
 * @returns {Object} Oggetto con .pointer (BigInt) e .release()
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
  return native.alloc(size);
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

  let buf;
  if (Buffer.isBuffer(ptr)) {
    buf = ptr;
  } else {
    // Converti BigInt/number in buffer
    const maxBytes = size ? size * 2 : 1024; // Default 512 caratteri
    buf = native.ptrToBuffer(ptr, maxBytes);
  }

  // Trova il null terminator (2 bytes per wchar su Windows)
  let end = size ? size * 2 : buf.length;
  for (let i = 0; i < end; i += 2) {
    if (buf.readUInt16LE(i) === 0) {
      end = i;
      break;
    }
  }

  return buf.toString("utf16le", 0, end);
}

/**
 * Legge un valore dalla memoria
 * @param {Buffer|BigInt|number} ptr - Puntatore
 * @param {string|CType} type - Tipo del valore
 * @param {number} [offset=0] - Offset in bytes
 * @returns {*} Valore letto
 */
function readValue(ptr, type, offset = 0) {
  return native.readValue(ptr, type, offset);
}

/**
 * Scrive un valore in memoria
 * @param {Buffer|BigInt|number} ptr - Puntatore
 * @param {string|CType} type - Tipo del valore
 * @param {*} value - Valore da scrivere
 * @param {number} [offset=0] - Offset in bytes
 * @returns {number} Bytes scritti
 */
function writeValue(ptr, type, value, offset = 0) {
  return native.writeValue(ptr, type, value, offset);
}

/**
 * Restituisce la dimensione di un tipo
 * @param {string|CType|Object} type - Tipo
 * @returns {number} Dimensione in bytes
 */
function sizeof(type) {
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
 * Wrapper per ArrayType nativo che aggiunge indexing Python-like
 * @param {string} elementType - Tipo degli elementi
 * @param {number} count - Numero di elementi
 * @returns {Object} ArrayType con metodi extra
 */
function array(elementType, count) {
  const nativeArray = new ArrayType(elementType, count);
  const elementSize = sizeof(elementType);

  // Aggiungi metodo wrap per creare proxy con indexing
  nativeArray.wrap = function (buffer) {
    return new Proxy(buffer, {
      get(target, prop) {
        // Se è un numero (indice)
        const index = Number(prop);
        if (!isNaN(index) && index >= 0 && index < count) {
          return readValue(target, elementType, index * elementSize);
        }
        // Altrimenti ritorna la proprietà normale del Buffer
        return target[prop];
      },
      set(target, prop, value) {
        const index = Number(prop);
        if (!isNaN(index) && index >= 0 && index < count) {
          writeValue(target, elementType, value, index * elementSize);
          return true;
        }
        target[prop] = value;
        return true;
      },
    });
  };

  // Override create per ritornare automaticamente il proxy
  const originalCreate = nativeArray.create.bind(nativeArray);
  nativeArray.create = function (values) {
    const buffer = originalCreate(values);
    return nativeArray.wrap(buffer);
  };

  return nativeArray;
}

/**
 * Helper per definire union (tutti i campi condividono offset 0)
 * @param {Object} fields - Definizione dei campi { name: type, ... }
 * @returns {Object} Definizione della union
 */
function union(fields) {
  let maxSize = 0;
  let maxAlignment = 1;
  const fieldDefs = [];

  for (const [name, type] of Object.entries(fields)) {
    const size = sizeof(type);
    const alignment = Math.min(size, native.POINTER_SIZE);

    fieldDefs.push({ name, type, offset: 0, size, alignment });

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

  return {
    size: maxSize,
    alignment: maxAlignment,
    fields: fieldDefs,
    isUnion: true,

    create(values = {}) {
      const buf = alloc(maxSize);
      // Scrivi solo l'ultimo valore (sovrascrive gli altri)
      for (const [name, value] of Object.entries(values)) {
        const field = fieldDefs.find((f) => f.name === name);
        if (field) {
          writeValue(buf, field.type, value, 0);
        }
      }
      return buf;
    },

    get(buf, fieldName) {
      const field = fieldDefs.find((f) => f.name === fieldName);
      if (!field) throw new Error(`Unknown field: ${fieldName}`);
      return readValue(buf, field.type, 0);
    },

    set(buf, fieldName, value) {
      const field = fieldDefs.find((f) => f.name === fieldName);
      if (!field) throw new Error(`Unknown field: ${fieldName}`);
      writeValue(buf, field.type, value, 0);
    },

    toObject(buf) {
      const obj = {};
      for (const field of fieldDefs) {
        obj[field.name] = readValue(buf, field.type, 0);
      }
      return obj;
    },
  };
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
  const nativeArray = new ArrayType(elementType, count);
  const elementSize = sizeof(elementType);

  // Funzione wrap che ritorna un Proxy
  const wrap = function (buffer) {
    return new Proxy(buffer, {
      get(target, prop) {
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
      const buffer =
        values !== undefined
          ? nativeArray.create(values)
          : nativeArray.create();
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
    } else {
      // Su Linux/Mac, errno è thread-local e accessibile via __errno_location
      const libc = new CDLL(null); // Carica libc
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
 * Legge un valore bit field da un buffer
 */
function _readBitField(buf, offset, baseType, bitOffset, bitSize) {
  const baseSize = sizeof(baseType);
  let value;

  // Leggi il valore base
  switch (baseSize) {
    case 1:
      value = buf.readUInt8(offset);
      break;
    case 2:
      value = buf.readUInt16LE(offset);
      break;
    case 4:
      value = buf.readUInt32LE(offset);
      break;
    case 8:
      value = buf.readBigUInt64LE(offset);
      break;
    default:
      throw new Error(`Unsupported bit field base size: ${baseSize}`);
  }

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
 */
function _writeBitField(buf, offset, baseType, bitOffset, bitSize, newValue) {
  const baseSize = sizeof(baseType);
  let value;

  // Leggi il valore corrente
  switch (baseSize) {
    case 1:
      value = buf.readUInt8(offset);
      break;
    case 2:
      value = buf.readUInt16LE(offset);
      break;
    case 4:
      value = buf.readUInt32LE(offset);
      break;
    case 8:
      value = buf.readBigUInt64LE(offset);
      break;
    default:
      throw new Error(`Unsupported bit field base size: ${baseSize}`);
  }

  // Modifica i bit
  if (baseSize === 8) {
    const mask = (1n << BigInt(bitSize)) - 1n;
    const clearMask = ~(mask << BigInt(bitOffset));
    value =
      (value & clearMask) | ((BigInt(newValue) & mask) << BigInt(bitOffset));
    buf.writeBigUInt64LE(value, offset);
  } else {
    const mask = (1 << bitSize) - 1;
    const clearMask = ~(mask << bitOffset);
    value = (value & clearMask) | ((newValue & mask) << bitOffset);

    switch (baseSize) {
      case 1:
        buf.writeUInt8(value, offset);
        break;
      case 2:
        buf.writeUInt16LE(value, offset);
        break;
      case 4:
        buf.writeUInt32LE(value, offset);
        break;
    }
  }
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

  const structDef = {
    size: totalSize,
    alignment: maxAlignment,
    fields: fieldDefs,
    packed: packed,
    _isStructType: true,

    /**
     * Alloca e inizializza una nuova istanza
     * @param {Object} [values] - Valori iniziali
     * @returns {Buffer} Buffer con la struttura
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

      return buf;
    },

    /**
     * Legge un campo dalla struttura
     * @param {Buffer} buf - Buffer della struttura
     * @param {string} fieldName - Nome del campo (supporta 'outer.inner' per nested)
     * @returns {*} Valore del campo
     */
    get(buf, fieldName) {
      // Supporto per accesso nested: 'outer.inner'
      const parts = fieldName.split(".");
      const firstPart = parts[0];

      let field = fieldDefs.find((f) => f.name === firstPart);

      // Se non trovato, cerca negli anonymous fields
      if (!field) {
        for (const f of fieldDefs) {
          if (f.isAnonymous && f.type && f.type.fields) {
            // Verifica se il campo esiste nel tipo anonimo
            const hasField = f.type.fields.some(
              (subField) => subField.name === firstPart
            );
            if (hasField) {
              // Accede al campo dell'anonymous field
              const nestedBuf = buf.slice(f.offset, f.offset + f.size);
              return f.type.get(nestedBuf, fieldName);
            }
          }
        }
        throw new Error(`Unknown field: ${firstPart}`);
      }

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
        const nestedBuf = buf.slice(field.offset, field.offset + field.size);

        if (parts.length > 1) {
          // Accesso a campo annidato
          return field.type.get(nestedBuf, parts.slice(1).join("."));
        } else {
          // Ritorna l'intero oggetto nested
          return field.type.toObject(nestedBuf);
        }
      }

      // Array field
      if (field.isArray) {
        const arrayBuf = buf.slice(field.offset, field.offset + field.size);
        return field.type.wrap(arrayBuf);
      }

      // Tipo base
      return readValue(buf, field.type, field.offset);
    },

    /**
     * Scrive un campo nella struttura
     * @param {Buffer} buf - Buffer della struttura
     * @param {string} fieldName - Nome del campo (supporta 'outer.inner' per nested)
     * @param {*} value - Valore da scrivere
     */
    set(buf, fieldName, value) {
      // Supporto per accesso nested: 'outer.inner'
      const parts = fieldName.split(".");
      const firstPart = parts[0];

      let field = fieldDefs.find((f) => f.name === firstPart);

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
              const nestedBuf = buf.slice(f.offset, f.offset + f.size);
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
          const nestedBuf = buf.slice(field.offset, field.offset + field.size);
          field.type.set(nestedBuf, parts.slice(1).join("."), value);
        } else if (Buffer.isBuffer(value)) {
          // Copia buffer
          value.copy(buf, field.offset, 0, field.size);
        } else if (typeof value === "object") {
          // Imposta campi da oggetto
          const nestedBuf = buf.slice(field.offset, field.offset + field.size);
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
          const arrayBuf = buf.slice(field.offset, field.offset + field.size);
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
    toObject(buf) {
      const obj = {};
      for (const field of fieldDefs) {
        if (field.isBitField) {
          obj[field.name] = _readBitField(
            buf,
            field.offset,
            field.type,
            field.bitOffset,
            field.bitSize
          );
        } else if (field.isNested) {
          const nestedBuf = buf.slice(field.offset, field.offset + field.size);
          obj[field.name] = field.type.toObject(nestedBuf);
        } else {
          obj[field.name] = readValue(buf, field.type, field.offset);
        }
      }
      return obj;
    },

    /**
     * Ottiene il buffer di una nested struct
     * @param {Buffer} buf - Buffer della struttura parent
     * @param {string} fieldName - Nome del campo nested
     * @returns {Buffer} Slice del buffer per la nested struct
     */
    getNestedBuffer(buf, fieldName) {
      const field = fieldDefs.find((f) => f.name === fieldName);
      if (!field) throw new Error(`Unknown field: ${fieldName}`);
      if (!field.isNested)
        throw new Error(`Field ${fieldName} is not a nested struct`);
      return buf.slice(field.offset, field.offset + field.size);
    },
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
  if (typeof init === "number") {
    // create_unicode_buffer(size) - alloca buffer vuoto per N caratteri
    return alloc(init * 2); // wchar_t è 2 bytes su Windows
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

module.exports = {
  // Classi
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

  // Memory Management - nomi originali
  alloc,
  cstring,
  wstring,
  readCString,
  readWString,
  readValue,
  writeValue,
  sizeof,
  addressOf,

  // Memory Management - alias Python-compatibili
  create_string_buffer,
  create_unicode_buffer,
  string_at,
  wstring_at,
  addressof,
  memmove,
  memset,

  // Strutture
  struct,
  union,
  array, // Helper per array a dimensione fissa
  bitfield,
  StructType, // Native C++ struct/union support
  ArrayType, // Native C++ array support

  // Puntatori (Python-compatible)
  byref,
  cast,
  POINTER,
  ptrToBuffer,

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

  // Costanti
  POINTER_SIZE: native.POINTER_SIZE,
  NULL: null,
};
