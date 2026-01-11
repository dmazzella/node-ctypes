const { array, sizeof } = require('../lib/index.js');

console.log('Debug array indexing:\n');

const IntArray5 = array('int32', 5);
console.log('IntArray5.getSize():', IntArray5.getSize());
console.log('IntArray5.getLength():', IntArray5.getLength());
console.log('sizeof(int32):', sizeof('int32'));

const arr = IntArray5.create([10, 20, 30, 40, 50]);

console.log('\nBuffer info:');
console.log('arr type:', typeof arr, arr.constructor.name);
console.log('arr.length:', arr.length);
console.log('Buffer content (hex):', arr.toString('hex'));

console.log('\nDirect Buffer reads:');
for (let i = 0; i < 5; i++) {
    console.log(`  buf.readInt32LE(${i * 4}):`, arr.readInt32LE(i * 4));
}

console.log('\nProxy index reads:');
for (let i = 0; i < 5; i++) {
    console.log(`  arr[${i}]:`, arr[i]);
    console.log(`    typeof prop: ${typeof i}, Number.isInteger: ${Number.isInteger(i)}`);
}

console.log('\nChecking what Number("0") returns:');
console.log('Number("0"):', Number("0"));
console.log('Number.isInteger(Number("0")):', Number.isInteger(Number("0")));
