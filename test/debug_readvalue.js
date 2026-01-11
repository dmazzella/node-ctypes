const { readValue } = require('../lib/index.js');

const buf = Buffer.from([0x0A, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x1E, 0x00, 0x00, 0x00]);

console.log('Direct readValue tests:');
console.log('readValue(buf, "int32", 0):', readValue(buf, 'int32', 0));
console.log('readValue(buf, "int32", 4):', readValue(buf, 'int32', 4));
console.log('readValue(buf, "int32", 8):', readValue(buf, 'int32', 8));

console.log('\nbuf.readInt32LE comparison:');
console.log('buf.readInt32LE(0):', buf.readInt32LE(0));
console.log('buf.readInt32LE(4):', buf.readInt32LE(4));
console.log('buf.readInt32LE(8):', buf.readInt32LE(8));
