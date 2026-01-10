/**
 * node-ctypes - Python ctypes-like FFI for Node.js
 * 
 * A simple FFI library that allows calling C functions from JavaScript,
 * similar to Python's ctypes module.
 */

const path = require('path');

// Carica il modulo nativo
let native;
try {
    native = require('../build/Release/node_ctypes.node');
} catch (e) {
    try {
        native = require('../build/Debug/node_ctypes.node');
    } catch (e2) {
        throw new Error(
            'Failed to load native module. ' +
            'Make sure to run "npm run build" first.\n' +
            'Original error: ' + e.message
        );
    }
}

// Re-esporta le classi native
const { Library, FFIFunction, Callback, CType } = native;

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
        const cacheKey = `${name}:${returnType}:${JSON.stringify(argTypes)}`;
        
        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const ffiFunc = this._lib.func(name, returnType, argTypes, options);
        
        // Crea una funzione wrapper che chiama ffiFunc.call()
        const wrapper = (...args) => ffiFunc.call(...args);
        
        // Aggiungi proprietà utili (usando defineProperty per name)
        Object.defineProperty(wrapper, 'funcName', { value: name, writable: false });
        Object.defineProperty(wrapper, 'address', { value: ffiFunc.address, writable: false });
        wrapper._ffi = ffiFunc;
        
        this._cache.set(cacheKey, wrapper);
        return wrapper;
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
        return super.func(name, returnType, argTypes, { abi: 'stdcall', ...options });
    }
}

/**
 * Crea un callback JS chiamabile da C
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
        _callback: cb
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
 * Legge una stringa C da un puntatore
 * @param {Buffer|BigInt|number} ptr - Puntatore alla stringa
 * @param {number} [maxLen] - Lunghezza massima da leggere
 * @returns {string|null} Stringa letta o null
 */
function readCString(ptr, maxLen) {
    return native.readCString(ptr, maxLen);
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
 * @param {string|CType} type - Tipo
 * @returns {number} Dimensione in bytes
 */
function sizeof(type) {
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
        writeValue(tempBuf, 'pointer', ptr);
        return readValue(tempBuf, 'pointer');
    }
    if (typeof ptr === 'bigint') {
        return ptr;
    }
    return BigInt(ptr);
}

/**
 * Helper per definire struct (semplificato)
 * Per strutture reali, considera di usare ref-struct-napi
 * @param {Object} fields - Definizione dei campi { name: type, ... }
 * @returns {Object} Definizione della struttura
 */
function struct(fields) {
    let totalSize = 0;
    const fieldDefs = [];
    
    for (const [name, type] of Object.entries(fields)) {
        const size = sizeof(type);
        fieldDefs.push({ name, type, offset: totalSize, size });
        totalSize += size;
    }
    
    return {
        size: totalSize,
        fields: fieldDefs,
        
        /**
         * Alloca e inizializza una nuova istanza
         * @param {Object} [values] - Valori iniziali
         * @returns {Buffer} Buffer con la struttura
         */
        create(values = {}) {
            const buf = alloc(totalSize);
            for (const field of fieldDefs) {
                if (values[field.name] !== undefined) {
                    writeValue(buf, field.type, values[field.name], field.offset);
                }
            }
            return buf;
        },
        
        /**
         * Legge un campo dalla struttura
         * @param {Buffer} buf - Buffer della struttura
         * @param {string} fieldName - Nome del campo
         * @returns {*} Valore del campo
         */
        get(buf, fieldName) {
            const field = fieldDefs.find(f => f.name === fieldName);
            if (!field) throw new Error(`Unknown field: ${fieldName}`);
            return readValue(buf, field.type, field.offset);
        },
        
        /**
         * Scrive un campo nella struttura
         * @param {Buffer} buf - Buffer della struttura
         * @param {string} fieldName - Nome del campo
         * @param {*} value - Valore da scrivere
         */
        set(buf, fieldName, value) {
            const field = fieldDefs.find(f => f.name === fieldName);
            if (!field) throw new Error(`Unknown field: ${fieldName}`);
            writeValue(buf, field.type, value, field.offset);
        },
        
        /**
         * Legge tutti i campi come oggetto
         * @param {Buffer} buf - Buffer della struttura
         * @returns {Object} Oggetto con tutti i campi
         */
        toObject(buf) {
            const obj = {};
            for (const field of fieldDefs) {
                obj[field.name] = readValue(buf, field.type, field.offset);
            }
            return obj;
        }
    };
}

// Alias per compatibilità con Python ctypes
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
const c_void_p = types.c_void_p;
const c_bool = types.c_bool;
const c_size_t = types.c_size_t;

module.exports = {
    // Classi
    Library,
    CDLL,
    WinDLL,
    FFIFunction,
    Callback,
    CType,
    
    // Funzioni
    load,
    callback,
    alloc,
    cstring,
    readCString,
    readValue,
    writeValue,
    sizeof,
    addressOf,
    struct,
    
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
    c_void_p,
    c_bool,
    c_size_t,
    
    // Costanti
    POINTER_SIZE: native.POINTER_SIZE,
    NULL: null
};
