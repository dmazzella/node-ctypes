const {CDLL, alloc, cstring, readCString} = require('../lib');

console.log('=== Variadic Functions Performance ===\n');

const libc = new CDLL('msvcrt.dll');
const sprintf = libc.func('sprintf', 'int32', ['pointer', 'pointer']);
const buf = alloc(256);

// Test 1: Chiamate ripetute con stesso pattern (beneficia di cache)
console.log('Test 1: sprintf con 1 argomento extra (stesso pattern)');
console.log('Iterations: 100,000');
console.time('sprintf-1arg-cached');
for(let i=0; i<100000; i++) {
    sprintf(buf, cstring('Test %d'), 42);
}
console.timeEnd('sprintf-1arg-cached');
console.log('');

// Test 2: Chiamate ripetute con pattern diversi
console.log('Test 2: sprintf con pattern variabili');
console.log('Iterations: 50,000');
console.time('sprintf-varied');
for(let i=0; i<50000; i++) {
    if (i % 3 === 0) {
        sprintf(buf, cstring('Test %d'), 42);
    } else if (i % 3 === 1) {
        sprintf(buf, cstring('Test %s'), cstring('hello'));
    } else {
        sprintf(buf, cstring('Test %f'), 3.14);
    }
}
console.timeEnd('sprintf-varied');
console.log('');

// Test 3: Chiamate con multipli argomenti (cache hit)
console.log('Test 3: sprintf con 3 argomenti extra (cache)');
console.log('Iterations: 50,000');
console.time('sprintf-3args-cached');
for(let i=0; i<50000; i++) {
    sprintf(buf, cstring('%d + %d = %d'), 10, 20, 30);
}
console.timeEnd('sprintf-3args-cached');
console.log('');

console.log('=== Cache Hit Rate Test ===');
console.log('Chiamate successive con stesso pattern dovrebbero essere più veloci');
console.log('grazie alla cache del CIF variadico.\n');
