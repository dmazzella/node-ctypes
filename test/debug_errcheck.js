const ctypes = require('../lib');

console.log('Testing errcheck availability...\n');

const dll = new ctypes.CDLL('msvcrt.dll');
const strlen = dll.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);

console.log('strlen properties:');
console.log('  _ffi:', strlen._ffi);
console.log('  _ffi.setErrcheck:', strlen._ffi.setErrcheck);

// Prova a chiamare setErrcheck direttamente
console.log('\nCalling setErrcheck directly on FFI object...');
strlen._ffi.setErrcheck(function(result, func, args) {
    console.log('  ERRCHECK CALLED!');
    console.log('    result:', result);
    console.log('    func:', func);
    console.log('    args:', args);
    return result;
});

console.log('\nCalling strlen("hello")...');
const result = strlen("hello");
console.log('Result:', result);

dll.close();
