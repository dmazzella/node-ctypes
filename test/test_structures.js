const { StructType } = require('../build/Release/node_ctypes.node');

console.log('=== Test Struct/Union ===\n');

// Test 1: Simple struct (Point)
console.log('Test 1: Simple struct Point(x: int32, y: int32)');
const Point = new StructType();
Point.addField('x', 'int32');
Point.addField('y', 'int32');
console.log(`  sizeof(Point) = ${Point.getSize()} bytes`);
console.log(`  alignment = ${Point.getAlignment()} bytes`);

// Test 2: Create Point instance
console.log('\nTest 2: Create Point instance {x: 10, y: 20}');
const point = Point.create({ x: 10, y: 20 });
console.log(`  Buffer length: ${point.length} bytes`);
console.log(`  Buffer hex: ${point.toString('hex')}`);

// Test 3: Nested struct (Rect)
console.log('\nTest 3: Nested struct Rect');
const Rect = new StructType();
Rect.addField('top_left', Point);
Rect.addField('bottom_right', Point);
console.log(`  sizeof(Rect) = ${Rect.getSize()} bytes`);
console.log(`  alignment = ${Rect.getAlignment()} bytes`);

const rect = Rect.create({
    top_left: { x: 0, y: 0 },
    bottom_right: { x: 100, y: 50 }
});
console.log(`  Rect buffer length: ${rect.length} bytes`);

// Test 4: Union (Value)
console.log('\nTest 4: Union Value(i: int32, f: float, p: pointer)');
const Value = new StructType({ union: true });
Value.addField('i', 'int32');
Value.addField('f', 'float');
Value.addField('p', 'pointer');
console.log(`  sizeof(Value) = ${Value.getSize()} bytes (should be max of members)`);
console.log(`  alignment = ${Value.getAlignment()} bytes`);

// Union con int
const val1 = Value.create({ i: 0x12345678 });
console.log(`\n  Union with i=0x12345678:`);
console.log(`  Buffer hex: ${val1.toString('hex')}`);

// Union con float
const val2 = Value.create({ f: 3.14159 });
console.log(`\n  Union with f=3.14159:`);
console.log(`  Buffer hex: ${val2.toString('hex')}`);

// Test 5: Mixed types struct
console.log('\nTest 5: Mixed types struct');
const Mixed = new StructType();
Mixed.addField('a', 'int8');
Mixed.addField('b', 'int16');  // alignment padding expected
Mixed.addField('c', 'int32');
Mixed.addField('d', 'int64');
console.log(`  sizeof(Mixed) = ${Mixed.getSize()} bytes`);
console.log(`  alignment = ${Mixed.getAlignment()} bytes`);

const mixed = Mixed.create({ a: 1, b: 2, c: 3, d: 4 });
console.log(`  Mixed buffer: ${mixed.toString('hex')}`);

console.log('\n=== Test Completati ===');
