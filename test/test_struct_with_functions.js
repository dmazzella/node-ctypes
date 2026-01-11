const { StructType, CDLL } = require('../lib/index.js');

console.log('=== Test Struct with C Functions ===\n');

// Define Point struct
const Point = new StructType();
Point.addField('x', 'int32');
Point.addField('y', 'int32');

console.log('Test 1: Create Point buffer');
const point = Point.create({ x: 10, y: 20 });
console.log(`  Point buffer: ${point.toString('hex')}`);
console.log(`  x = ${point.readInt32LE(0)}`);
console.log(`  y = ${point.readInt32LE(4)}`);

// TODO: Test passaggio a funzione C
// Python example:
// libc = CDLL("msvcrt.dll")
// 
// # Funzione che accetta struct by-reference
// # void set_point(Point *p, int x, int y) { p->x = x; p->y = y; }
// set_point = libc.func("set_point", "void", ["pointer", "int32", "int32"])
// set_point(byref(point_buf), 100, 200)
//
// # Funzione che ritorna struct by-value (problematic with some ABIs)
// # Point get_point(void) { Point p = {1, 2}; return p; }
// get_point = libc.func("get_point", "???", [])  # Need struct return type

console.log('\n=== Current Limitations ===');
console.log('1. Cannot pass struct to C function yet');
console.log('   - Need to integrate StructInfo in function.cc Call()');
console.log('   - byref() for Buffer already works (passes pointer)');
console.log('');
console.log('2. Cannot return struct by-value');
console.log('   - Need return_struct_info_ in FFIFunction');
console.log('   - ffi_call must use struct ffi_type');
console.log('');
console.log('3. Python ctypes approach:');
console.log('   - func.argtypes = [Point]  # by-value');
console.log('   - func.argtypes = [POINTER(Point)]  # by-reference');
console.log('   - func.restype = Point  # return by-value');
console.log('');
console.log('Current workaround: use pointer + manual packing');
console.log('  func("name", "pointer", ["pointer"])');
console.log('  func(point_buffer)  # buffer auto-converts to pointer');

console.log('\n=== Test Completato ===');
