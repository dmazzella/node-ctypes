const { array, readValue, writeValue, sizeof } = require('../lib/index.js');

const IntArray5 = array('int32', 5);
const arr = IntArray5.create([10, 20, 30, 40, 50]);

console.log('Testing Proxy get trap directly:\n');

// Create a manual proxy with logging
const elementSize = sizeof('int32');
const count = 5;

const proxied = new Proxy(arr, {
    get(target, prop) {
        const index = Number(prop);
        console.log(`  get trap: prop="${prop}", index=${index}, isInt=${Number.isInteger(index)}, count=${count}`);
        
        if (Number.isInteger(index) && !isNaN(index) && index >= 0 && index < count) {
            const offset = index * elementSize;
            const value = readValue(target, 'int32', offset);
            console.log(`    -> Reading int32 at offset ${offset}: ${value}`);
            return value;
        }
        
        const value = Reflect.get(target, prop, target);
        console.log(`    -> Reflect.get returned: ${typeof value === 'function' ? 'function' : value}`);
        return typeof value === 'function' ? value.bind(target) : value;
    }
});

console.log('\nAccessing proxied[1]:');
const val = proxied[1];
console.log(`Result: ${val}\n`);

console.log('Accessing proxied[2]:');
const val2 = proxied[2];
console.log(`Result: ${val2}`);
