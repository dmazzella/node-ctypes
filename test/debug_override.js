const { ArrayType, sizeof, readValue, writeValue } = require('../lib/index.js');

// Simulate the wrapper manually
const elementType = 'int32';
const count = 5;

const nativeArray = new ArrayType(elementType, count);
const elementSize = sizeof(elementType);

console.log('Before wrapping:');
console.log('nativeArray.create:', nativeArray.create);

// Add wrap method
nativeArray.wrap = function(buffer) {
    console.log('wrap() called with buffer of length', buffer.length);
    return new Proxy(buffer, {
        get(target, prop) {
            const index = Number(prop);
            if (Number.isInteger(index) && !isNaN(index) && index >= 0 && index < count) {
                return readValue(target, elementType, index * elementSize);
            }
            const value = Reflect.get(target, prop, target);
            if (typeof value === 'function') {
                return value.bind(target);
            }
            return value;
        }
    });
};

// Override create
const originalCreate = nativeArray.create.bind(nativeArray);
console.log('originalCreate:', originalCreate);

nativeArray.create = function(values) {
    console.log('Overridden create() called with:', values);
    const buffer = originalCreate(values);
    console.log('Got buffer, calling wrap...');
    return nativeArray.wrap(buffer);
};

console.log('\nAfter wrapping:');
console.log('nativeArray.create:', nativeArray.create);

console.log('\nCalling create:');
const arr = nativeArray.create([10, 20, 30, 40, 50]);

console.log('\nAccessing arr[1]:', arr[1]);
console.log('Accessing arr[2]:', arr[2]);
