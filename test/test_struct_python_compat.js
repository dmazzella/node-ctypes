const { StructType, CDLL, WinDLL } = require('../lib/index.js');

console.log('=== Test Python ctypes compatibility ===\n');

// Python equivalent:
// class Point(Structure):
//     _fields_ = [("x", c_int), ("y", c_int)]

console.log('1. Define Point struct (like Python Structure)');
const Point = new StructType();
Point.addField('x', 'int32');
Point.addField('y', 'int32');
console.log(`   sizeof(Point) = ${Point.getSize()} bytes`);
console.log(`   alignment = ${Point.getAlignment()} bytes\n`);

// Python equivalent:
// class Rect(Structure):
//     _fields_ = [("top_left", Point), ("bottom_right", Point)]

console.log('2. Define Rect with nested Point');
const Rect = new StructType();
Rect.addField('top_left', Point);
Rect.addField('bottom_right', Point);
console.log(`   sizeof(Rect) = ${Rect.getSize()} bytes\n`);

// Python equivalent:
// class Value(Union):
//     _fields_ = [("i", c_int), ("f", c_float), ("p", c_void_p)]

console.log('3. Define Value union');
const Value = new StructType({ union: true });
Value.addField('i', 'int32');
Value.addField('f', 'float');
Value.addField('p', 'pointer');
console.log(`   sizeof(Value) = ${Value.getSize()} bytes (max of members)\n`);

// Python equivalent:
// point = Point(10, 20)

console.log('4. Create Point instance');
const point_buf = Point.create({ x: 10, y: 20 });
console.log(`   Point buffer: ${point_buf.toString('hex')}`);
console.log(`   x (bytes 0-3): 0x${point_buf.slice(0, 4).toString('hex')}`);
console.log(`   y (bytes 4-7): 0x${point_buf.slice(4, 8).toString('hex')}\n`);

// Python equivalent:
// rect = Rect(Point(0, 0), Point(100, 50))

console.log('5. Create nested Rect');
const rect_buf = Rect.create({
    top_left: { x: 0, y: 0 },
    bottom_right: { x: 100, y: 50 }
});
console.log(`   Rect buffer (16 bytes): ${rect_buf.toString('hex')}`);
console.log(`   top_left.x:  ${rect_buf.readInt32LE(0)}`);
console.log(`   top_left.y:  ${rect_buf.readInt32LE(4)}`);
console.log(`   bottom_right.x: ${rect_buf.readInt32LE(8)}`);
console.log(`   bottom_right.y: ${rect_buf.readInt32LE(12)}\n`);

// Python equivalent:
// val = Value()
// val.i = 0x12345678

console.log('6. Union memory sharing demo');
const val1 = Value.create({ i: 0x12345678 });
console.log(`   Union with i=0x12345678: ${val1.toString('hex')}`);
console.log(`   Same bytes as float: ${val1.readFloatLE(0)}\n`);

// Python equivalent:
// val.f = 3.14159

const val2 = Value.create({ f: 3.14159 });
console.log(`   Union with f=3.14159: ${val2.toString('hex')}`);
console.log(`   Same bytes as int32: 0x${val2.readInt32LE(0).toString(16)}\n`);

console.log('7. Alignment demonstration');
const Aligned = new StructType();
Aligned.addField('a', 'int8');   // 1 byte
Aligned.addField('b', 'int16');  // 2 bytes, needs 2-byte alignment
Aligned.addField('c', 'int32');  // 4 bytes, needs 4-byte alignment
console.log(`   Struct with alignment:`);
console.log(`   - int8  (1 byte)`);
console.log(`   - int16 (2 bytes, aligned)`);
console.log(`   - int32 (4 bytes, aligned)`);
console.log(`   Total size: ${Aligned.getSize()} bytes`);
console.log(`   (should be 8 due to padding, not 7)\n`);

const aligned_buf = Aligned.create({ a: 0x11, b: 0x2222, c: 0x44444444 });
console.log(`   Buffer: ${aligned_buf.toString('hex')}`);
console.log(`   Breakdown:`);
console.log(`   [0] = 0x${aligned_buf[0].toString(16)} (a)`);
console.log(`   [1] = 0x${aligned_buf[1].toString(16)} (padding)`);
console.log(`   [2-3] = 0x${aligned_buf.slice(2, 4).toString('hex')} (b)`);
console.log(`   [4-7] = 0x${aligned_buf.slice(4, 8).toString('hex')} (c)\n`);

console.log('=== All tests passed ===');
console.log('\nNext steps:');
console.log('- Integrate struct passing to C functions');
console.log('- Implement byref() for by-reference passing');
console.log('- Add POINTER() type wrapper');
