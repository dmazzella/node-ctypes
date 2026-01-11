const buf = Buffer.from([0x0A, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x1E, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00]);

console.log('buf[0]:', buf[0]);  // Byte at index 0
console.log('buf[1]:', buf[1]);  // Byte at index 1
console.log('buf[4]:', buf[4]);  // Byte at index 4

console.log('\nbuf["0"]:', buf["0"]);
console.log('buf["1"]:', buf["1"]);
console.log('buf["4"]:', buf["4"]);

console.log('\nBuffer has numeric properties that are bytes!');
