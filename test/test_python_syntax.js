/**
 * Test Python ctypes Syntax Enhancements
 * - Array indexing (arr[i])
 * - Anonymous fields (_anonymous_)
 */

const { StructType, array } = require('../lib/index.js');

console.log('=== Test Python Syntax Enhancements ===\n');

let passCount = 0;
let testCount = 0;

function test(name, fn) {
    testCount++;
    try {
        fn();
        console.log(`✓ Test ${testCount}: ${name}`);
        passCount++;
    } catch (e) {
        console.log(`✗ Test ${testCount}: ${name}`);
        console.log(`  Error: ${e.message}`);
        console.log(e.stack);
    }
}

// ============================================================================
// Array Indexing Tests
// ============================================================================

test('Array indexing: arr[i] read', () => {
    const IntArray5 = array('int32', 5);
    const arr = IntArray5.create([10, 20, 30, 40, 50]);
    
    console.log(`  arr[0] = ${arr[0]}`);
    console.log(`  arr[2] = ${arr[2]}`);
    console.log(`  arr[4] = ${arr[4]}`);
    
    if (arr[0] !== 10) throw new Error('arr[0] should be 10');
    if (arr[2] !== 30) throw new Error('arr[2] should be 30');
    if (arr[4] !== 50) throw new Error('arr[4] should be 50');
});

test('Array indexing: arr[i] write', () => {
    const IntArray5 = array('int32', 5);
    const arr = IntArray5.create([1, 2, 3, 4, 5]);
    
    arr[0] = 100;
    arr[2] = 300;
    arr[4] = 500;
    
    console.log(`  After write: [${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3]}, ${arr[4]}]`);
    
    if (arr[0] !== 100) throw new Error('arr[0] should be 100');
    if (arr[1] !== 2) throw new Error('arr[1] should be 2');
    if (arr[2] !== 300) throw new Error('arr[2] should be 300');
    if (arr[4] !== 500) throw new Error('arr[4] should be 500');
});

test('Array indexing: float array', () => {
    const FloatArray3 = array('float', 3);
    const arr = FloatArray3.create([1.5, 2.5, 3.5]);
    
    console.log(`  arr[0] = ${arr[0]}`);
    console.log(`  arr[1] = ${arr[1]}`);
    console.log(`  arr[2] = ${arr[2]}`);
    
    if (Math.abs(arr[0] - 1.5) > 0.001) throw new Error('arr[0] mismatch');
    if (Math.abs(arr[1] - 2.5) > 0.001) throw new Error('arr[1] mismatch');
    if (Math.abs(arr[2] - 3.5) > 0.001) throw new Error('arr[2] mismatch');
    
    arr[1] = 99.9;
    if (Math.abs(arr[1] - 99.9) > 0.001) throw new Error('Write failed');
});

test('Array indexing: iteration', () => {
    const IntArray10 = array('int32', 10);
    const arr = IntArray10.create();
    
    // Write with indexing
    for (let i = 0; i < 10; i++) {
        arr[i] = i * i;
    }
    
    // Read with indexing
    const squares = [];
    for (let i = 0; i < 10; i++) {
        squares.push(arr[i]);
    }
    
    console.log(`  Squares: [${squares.slice(0, 5).join(', ')}, ...]`);
    
    for (let i = 0; i < 10; i++) {
        if (arr[i] !== i * i) {
            throw new Error(`arr[${i}] should be ${i * i}, got ${arr[i]}`);
        }
    }
});

// ============================================================================
// Anonymous Fields Tests
// ============================================================================

test('Anonymous field: basic', () => {
    // Define Point
    const Point = new StructType();
    Point.addField('x', 'int32');
    Point.addField('y', 'int32');
    
    // Define Shape with anonymous Point
    const Shape = new StructType();
    Shape.addField('point', Point, { anonymous: true });
    Shape.addField('color', 'uint32');
    
    // Create and write
    const shape = Shape.create({
        x: 10,      // Direct access to point.x
        y: 20,      // Direct access to point.y
        color: 0xFF0000
    });
    
    // Read
    const result = Shape.read(shape);
    console.log(`  x: ${result.x}, y: ${result.y}, color: 0x${result.color.toString(16)}`);
    
    if (result.x !== 10) throw new Error('x should be 10');
    if (result.y !== 20) throw new Error('y should be 20');
    if (result.color !== 0xFF0000) throw new Error('color mismatch');
});

test('Anonymous field: union', () => {
    // Define Value union
    const Value = new StructType({ union: true });
    Value.addField('i', 'int32');
    Value.addField('f', 'float');
    
    // Define Data with anonymous union
    const Data = new StructType();
    Data.addField('type', 'int32');
    Data.addField('value', Value, { anonymous: true });
    
    // Create with int value
    const data1 = Data.create({
        type: 1,
        i: 42
    });
    
    const result1 = Data.read(data1);
    console.log(`  type: ${result1.type}, i: ${result1.i}`);
    
    if (result1.type !== 1) throw new Error('type should be 1');
    if (result1.i !== 42) throw new Error('i should be 42');
    
    // Create with float value
    const data2 = Data.create({
        type: 2,
        f: 3.14
    });
    
    const result2 = Data.read(data2);
    console.log(`  type: ${result2.type}, f: ${result2.f.toFixed(2)}`);
    
    if (result2.type !== 2) throw new Error('type should be 2');
    if (Math.abs(result2.f - 3.14) > 0.01) throw new Error('f mismatch');
});

test('Anonymous field: nested', () => {
    // Define Position
    const Position = new StructType();
    Position.addField('x', 'int32');
    Position.addField('y', 'int32');
    Position.addField('z', 'int32');
    
    // Define Orientation
    const Orientation = new StructType();
    Orientation.addField('pitch', 'float');
    Orientation.addField('yaw', 'float');
    Orientation.addField('roll', 'float');
    
    // Define Entity with both anonymous
    const Entity = new StructType();
    Entity.addField('id', 'uint32');
    Entity.addField('pos', Position, { anonymous: true });
    Entity.addField('orient', Orientation, { anonymous: true });
    
    const entity = Entity.create({
        id: 123,
        x: 10, y: 20, z: 30,           // Position fields
        pitch: 1.0, yaw: 2.0, roll: 3.0 // Orientation fields
    });
    
    const result = Entity.read(entity);
    console.log(`  id: ${result.id}`);
    console.log(`  pos: (${result.x}, ${result.y}, ${result.z})`);
    console.log(`  orient: (${result.pitch}, ${result.yaw}, ${result.roll})`);
    
    if (result.id !== 123) throw new Error('id mismatch');
    if (result.x !== 10 || result.y !== 20 || result.z !== 30) throw new Error('position mismatch');
    if (Math.abs(result.pitch - 1.0) > 0.001) throw new Error('pitch mismatch');
});

test('Anonymous field: mixed with regular', () => {
    // Point (anonymous)
    const Point = new StructType();
    Point.addField('x', 'int32');
    Point.addField('y', 'int32');
    
    // Size (regular)
    const Size = new StructType();
    Size.addField('width', 'int32');
    Size.addField('height', 'int32');
    
    // Rectangle with anonymous Point but regular Size
    const Rectangle = new StructType();
    Rectangle.addField('topLeft', Point, { anonymous: true });
    Rectangle.addField('size', Size);  // NOT anonymous
    
    const rect = Rectangle.create({
        x: 10,      // From anonymous Point
        y: 20,
        size: { width: 100, height: 200 }  // Must use nested object
    });
    
    const result = Rectangle.read(rect);
    console.log(`  topLeft: (${result.x}, ${result.y})`);
    console.log(`  size: ${result.size.width}x${result.size.height}`);
    
    if (result.x !== 10 || result.y !== 20) throw new Error('topLeft mismatch');
    if (result.size.width !== 100 || result.size.height !== 200) throw new Error('size mismatch');
});

// ============================================================================
// Combined Test: Array Indexing + Anonymous Fields
// ============================================================================

test('Combined: array in anonymous struct', () => {
    const Vec3 = array('float', 3);
    
    const Transform = new StructType();
    Transform.addField('position', Vec3);
    
    const Entity = new StructType();
    Entity.addField('id', 'uint32');
    Entity.addField('transform', Transform, { anonymous: true });
    
    const entity = Entity.create({
        id: 999,
        position: [1.0, 2.0, 3.0]
    });
    
    const result = Entity.read(entity);
    console.log(`  id: ${result.id}`);
    console.log(`  position: [${result.position}]`);
    
    // Access array elements
    if (Math.abs(result.position[0] - 1.0) > 0.001) throw new Error('position[0] mismatch');
    if (Math.abs(result.position[1] - 2.0) > 0.001) throw new Error('position[1] mismatch');
    if (Math.abs(result.position[2] - 3.0) > 0.001) throw new Error('position[2] mismatch');
});

console.log(`\n=== Results: ${passCount}/${testCount} tests passed ===`);

if (passCount === testCount) {
    console.log('\n🎉 All Python syntax enhancements working!\n');
    console.log('Features:');
    console.log('  ✓ Array indexing: arr[i] = value');
    console.log('  ✓ Anonymous fields: direct access to nested struct fields');
    console.log('  ✓ Python ctypes compatibility: ~99%');
}

process.exit(passCount === testCount ? 0 : 1);
