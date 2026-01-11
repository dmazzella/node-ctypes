const { array } = require('../lib/index.js');

const IntArray5 = array('int32', 5);

console.log('IntArray5.create:', IntArray5.create);
console.log('IntArray5.wrap:', IntArray5.wrap);

const arr = IntArray5.create([10, 20, 30, 40, 50]);

console.log('\narr[Symbol.toStringTag]:', arr[Symbol.toStringTag]);
console.log('Object.getPrototypeOf(arr):', Object.getPrototypeOf(arr));
console.log('arr.constructor.name:', arr.constructor.name);

// Check if it's a Proxy by trying to access properties
console.log('\nDirect property access:');
console.log('arr[0]:', arr[0]);
console.log('arr[1]:', arr[1]);
console.log('arr.length:', arr.length);
