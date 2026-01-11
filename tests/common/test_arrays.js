/**
 * Test Arrays - Cross Platform
 * Tests array creation, indexing, iteration, in structs, in functions
 */

const assert = require('assert');
const ctypes = require('../../lib');

describe('Arrays', function() {
    describe('Array Creation', function() {
        it('should create fixed-size arrays', function() {
            const IntArray5 = ctypes.array('int32', 5);
            
            assert.strictEqual(IntArray5.getSize(), 20);  // 5 * 4 bytes
            assert.strictEqual(IntArray5.getLength(), 5);
        });
        
        it('should initialize arrays with values', function() {
            const IntArray5 = ctypes.array('int32', 5);
            const arr = IntArray5.create([1, 2, 3, 4, 5]);
            
            assert.strictEqual(arr[0], 1);
            assert.strictEqual(arr[4], 5);
        });
        
        it('should support partial initialization', function() {
            const IntArray5 = ctypes.array('int32', 5);
            const arr = IntArray5.create([1, 2, 3]);  // Rest filled with 0
            
            assert.strictEqual(arr[0], 1);
            assert.strictEqual(arr[2], 3);
            assert.strictEqual(arr[3], 0);
            assert.strictEqual(arr[4], 0);
        });
    });
    
    describe('Array Indexing', function() {
        it('should support Python-like indexing for reading', function() {
            const IntArray5 = ctypes.array('int32', 5);
            const arr = IntArray5.create([10, 20, 30, 40, 50]);
            
            assert.strictEqual(arr[0], 10);
            assert.strictEqual(arr[1], 20);
            assert.strictEqual(arr[2], 30);
            assert.strictEqual(arr[3], 40);
            assert.strictEqual(arr[4], 50);
        });
        
        it('should support Python-like indexing for writing', function() {
            const IntArray5 = ctypes.array('int32', 5);
            const arr = IntArray5.create([1, 2, 3, 4, 5]);
            
            arr[0] = 100;
            arr[4] = 500;
            
            assert.strictEqual(arr[0], 100);
            assert.strictEqual(arr[4], 500);
        });
        
        it('should handle float arrays', function() {
            const FloatArray3 = ctypes.array('float', 3);
            const arr = FloatArray3.create([1.5, 2.5, 3.5]);
            
            assert(Math.abs(arr[0] - 1.5) < 0.0001);
            assert(Math.abs(arr[1] - 2.5) < 0.0001);
            assert(Math.abs(arr[2] - 3.5) < 0.0001);
            
            arr[1] = 99.9;
            assert(Math.abs(arr[1] - 99.9) < 0.0001);
        });
    });
    
    describe('Array Iteration', function() {
        it('should support for...of iteration', function() {
            const IntArray5 = ctypes.array('int32', 5);
            const arr = IntArray5.create([1, 2, 3, 4, 5]);
            
            const values = [];
            for (let v of arr) {
                values.push(v);
            }
            
            assert.deepStrictEqual(values, [1, 2, 3, 4, 5]);
        });
        
        it('should support spread operator', function() {
            const IntArray3 = ctypes.array('int32', 3);
            const arr = IntArray3.create([10, 20, 30]);
            
            const values = [...arr];
            assert.deepStrictEqual(values, [10, 20, 30]);
        });
    });
    
    describe('Arrays in Structs', function() {
        it('should support array fields in structs', function() {
            const IntArray10 = ctypes.array('int32', 10);
            
            const Data = ctypes.struct({
                count: 'int32',
                values: IntArray10
            });
            
            const data = Data.create({
                count: 5,
                values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
            });
            
            assert.strictEqual(Data.get(data, 'count'), 5);
            
            const values = Data.get(data, 'values');
            assert.strictEqual(values[0], 1);
            assert.strictEqual(values[9], 10);
        });
        
        it('should allow modifying array elements in structs', function() {
            const IntArray5 = ctypes.array('int32', 5);
            
            const Data = ctypes.struct({
                values: IntArray5
            });
            
            const data = Data.create({
                values: [1, 2, 3, 4, 5]
            });
            
            const arr = Data.get(data, 'values');
            arr[2] = 999;
            
            const updated = Data.get(data, 'values');
            assert.strictEqual(updated[2], 999);
        });
    });
    
    describe('Different Array Types', function() {
        it('should support uint8 arrays', function() {
            const ByteArray = ctypes.array('uint8', 4);
            const arr = ByteArray.create([0xFF, 0xAB, 0xCD, 0xEF]);
            
            assert.strictEqual(arr[0], 0xFF);
            assert.strictEqual(arr[1], 0xAB);
            assert.strictEqual(arr[2], 0xCD);
            assert.strictEqual(arr[3], 0xEF);
        });
        
        it('should support double arrays', function() {
            const DoubleArray = ctypes.array('double', 3);
            const arr = DoubleArray.create([3.14159, 2.71828, 1.61803]);
            
            assert(Math.abs(arr[0] - 3.14159) < 0.00001);
            assert(Math.abs(arr[1] - 2.71828) < 0.00001);
            assert(Math.abs(arr[2] - 1.61803) < 0.00001);
        });
    });
    
    describe('Array Edge Cases', function() {
        it('should handle empty array creation', function() {
            const IntArray5 = ctypes.array('int32', 5);
            const arr = IntArray5.create();  // All zeros
            
            assert.strictEqual(arr[0], 0);
            assert.strictEqual(arr[4], 0);
        });
        
        it('should handle bounds correctly', function() {
            const IntArray3 = ctypes.array('int32', 3);
            const arr = IntArray3.create([1, 2, 3]);
            
            // Valid indices
            assert.strictEqual(arr[0], 1);
            assert.strictEqual(arr[2], 3);
            
            // Invalid index should return undefined (JavaScript behavior)
            assert.strictEqual(arr[3], undefined);
            assert.strictEqual(arr[-1], undefined);
        });
    });
    
    describe('String as Byte Arrays', function() {
        it('should create arrays from strings', function() {
            const CharArray = ctypes.array('int8', 100);
            const arr = CharArray.create('Hello, World!');
            
            // Should contain ASCII values
            assert.strictEqual(arr[0], 'H'.charCodeAt(0));
            assert.strictEqual(arr[1], 'e'.charCodeAt(0));
            assert.strictEqual(arr[7], 'W'.charCodeAt(0));
        });
    });
});
