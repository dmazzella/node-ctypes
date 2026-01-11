const { StructType, array } = require('../lib/index.js');

console.log('=== Test Arrays in Structs ===\n');

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

// Test 1: Simple array in struct
test('Array field in struct', () => {
    const IntArray5 = array('int32', 5);
    const MyStruct = new StructType();
    MyStruct.addField('numbers', IntArray5);
    
    const size = MyStruct.getSize();
    console.log(`  Struct size: ${size} bytes (expected: 20 for 5 ints)`);
    if (size !== 20) throw new Error(`Expected size 20, got ${size}`);
    
    const obj = { numbers: [1, 2, 3, 4, 5] };
    const buf = MyStruct.create(obj);
    
    const result = MyStruct.read(buf);
    console.log(`  Written: [${obj.numbers}]`);
    console.log(`  Read:    [${result.numbers}]`);
    
    for (let i = 0; i < 5; i++) {
        if (result.numbers[i] !== obj.numbers[i]) {
            throw new Error(`Mismatch at index ${i}: ${result.numbers[i]} !== ${obj.numbers[i]}`);
        }
    }
});

// Test 2: Char array (string-like) in struct
test('Char array as string field', () => {
    const CharArray100 = array('char', 100);
    const Person = new StructType();
    Person.addField('age', 'int32');
    Person.addField('name', CharArray100);
    
    const size = Person.getSize();
    console.log(`  Person struct size: ${size} bytes`);
    
    // Create char array from string
    const nameChars = 'John Doe'.split('').map(c => c.charCodeAt(0));
    nameChars.push(0); // null terminator
    
    const personData = {
        age: 30,
        name: nameChars
    };
    
    const buf = Person.create(personData);
    const result = Person.read(buf);
    
    console.log(`  Age: ${result.age}`);
    console.log(`  Name bytes: [${result.name.slice(0, 10)}...]`);
    
    if (result.age !== 30) throw new Error('Age mismatch');
    
    // Verify first few characters
    const expectedChars = 'John'.split('').map(c => c.charCodeAt(0));
    for (let i = 0; i < expectedChars.length; i++) {
        if (result.name[i] !== expectedChars[i]) {
            throw new Error(`Name char mismatch at ${i}`);
        }
    }
});

// Test 3: Multiple array fields
test('Multiple array fields in struct', () => {
    const FloatArray3 = array('float', 3);
    const IntArray2 = array('int32', 2);
    
    const Data = new StructType();
    Data.addField('id', 'int32');
    Data.addField('position', FloatArray3);
    Data.addField('flags', IntArray2);
    
    const size = Data.getSize();
    console.log(`  Data struct size: ${size} bytes`);
    
    const data = {
        id: 42,
        position: [1.5, 2.5, 3.5],
        flags: [0x100, 0x200]
    };
    
    const buf = Data.create(data);
    const result = Data.read(buf);
    
    console.log(`  ID: ${result.id}`);
    console.log(`  Position: [${result.position}]`);
    console.log(`  Flags: [${result.flags.map(f => '0x' + f.toString(16))}]`);
    
    if (result.id !== 42) throw new Error('ID mismatch');
    
    for (let i = 0; i < 3; i++) {
        if (Math.abs(result.position[i] - data.position[i]) > 0.001) {
            throw new Error(`Position mismatch at ${i}`);
        }
    }
    
    for (let i = 0; i < 2; i++) {
        if (result.flags[i] !== data.flags[i]) {
            throw new Error(`Flags mismatch at ${i}`);
        }
    }
});

// Test 4: Nested struct with arrays
test('Nested struct with array fields', () => {
    const Vec3 = array('float', 3);
    
    const Point = new StructType();
    Point.addField('coords', Vec3);
    
    const Line = new StructType();
    Line.addField('start', Point);
    Line.addField('end', Point);
    
    const size = Line.getSize();
    console.log(`  Line struct size: ${size} bytes`);
    
    const lineData = {
        start: { coords: [0, 0, 0] },
        end: { coords: [10, 20, 30] }
    };
    
    const buf = Line.create(lineData);
    const result = Line.read(buf);
    
    console.log(`  Start: [${result.start.coords}]`);
    console.log(`  End:   [${result.end.coords}]`);
    
    for (let i = 0; i < 3; i++) {
        if (Math.abs(result.start.coords[i] - lineData.start.coords[i]) > 0.001) {
            throw new Error(`Start coords mismatch at ${i}`);
        }
        if (Math.abs(result.end.coords[i] - lineData.end.coords[i]) > 0.001) {
            throw new Error(`End coords mismatch at ${i}`);
        }
    }
});

// Test 5: Array alignment in struct
test('Array alignment in struct', () => {
    const DoubleArray2 = array('double', 2);
    
    const AlignTest = new StructType();
    AlignTest.addField('flag', 'char');
    AlignTest.addField('values', DoubleArray2);
    
    const size = AlignTest.getSize();
    const alignment = AlignTest.getAlignment();
    
    console.log(`  Struct size: ${size} bytes`);
    console.log(`  Struct alignment: ${alignment} bytes`);
    
    const data = {
        flag: 1,
        values: [3.14159, 2.71828]
    };
    
    const buf = AlignTest.create(data);
    const result = AlignTest.read(buf);
    
    console.log(`  Flag: ${result.flag}`);
    console.log(`  Values: [${result.values}]`);
    
    if (result.flag !== 1) throw new Error('Flag mismatch');
    
    for (let i = 0; i < 2; i++) {
        if (Math.abs(result.values[i] - data.values[i]) > 0.00001) {
            throw new Error(`Values mismatch at ${i}`);
        }
    }
});

console.log(`\n=== Results: ${passCount}/${testCount} tests passed ===`);
process.exit(passCount === testCount ? 0 : 1);

