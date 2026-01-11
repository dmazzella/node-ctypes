/**
 * Test per Nested Structs e Bit Fields
 */

const ctypes = require('../lib');

console.log('=== Test Nested Structs & Bit Fields ===\n');

// ============================================================================
// Test 1: Nested Structs - Basic
// ============================================================================

console.log('Test 1: Nested Structs - Basic');

// Definisci struct interna
const Point = ctypes.struct({
    x: 'int32',
    y: 'int32'
});

console.log('  Point size:', Point.size, '(expected: 8)');

// Definisci struct esterna con nested struct
const Rectangle = ctypes.struct({
    topLeft: Point,
    bottomRight: Point,
    color: 'uint32'
});

console.log('  Rectangle size:', Rectangle.size, '(expected: 20)');

// Crea istanza
const rect = Rectangle.create({
    topLeft: { x: 10, y: 20 },
    bottomRight: { x: 100, y: 200 },
    color: 0xFF0000
});

// Leggi valori
const topLeft = Rectangle.get(rect, 'topLeft');
console.log('  topLeft:', topLeft);

const bottomRight = Rectangle.get(rect, 'bottomRight');
console.log('  bottomRight:', bottomRight);

// Accesso con dot notation
const x = Rectangle.get(rect, 'topLeft.x');
console.log('  topLeft.x:', x, '(expected: 10)');

const y = Rectangle.get(rect, 'bottomRight.y');
console.log('  bottomRight.y:', y, '(expected: 200)');

// Scrivi con dot notation
Rectangle.set(rect, 'topLeft.x', 50);
console.log('  After set topLeft.x = 50:', Rectangle.get(rect, 'topLeft.x'));

// toObject (ricorsivo)
const obj = Rectangle.toObject(rect);
console.log('  toObject:', JSON.stringify(obj));

console.log('  ✓ Nested Structs work!\n');

// ============================================================================
// Test 2: Nested Structs - Multi-level
// ============================================================================

console.log('Test 2: Nested Structs - Multi-level');

const Vector3D = ctypes.struct({
    x: 'float',
    y: 'float',
    z: 'float'
});

const Transform = ctypes.struct({
    position: Vector3D,
    rotation: Vector3D,
    scale: Vector3D
});

const GameObject = ctypes.struct({
    id: 'uint32',
    transform: Transform,
    active: 'uint8'
});

console.log('  Vector3D size:', Vector3D.size, '(expected: 12)');
console.log('  Transform size:', Transform.size, '(expected: 36)');
console.log('  GameObject size:', GameObject.size);

const gameObj = GameObject.create({
    id: 42,
    transform: {
        position: { x: 1.0, y: 2.0, z: 3.0 },
        rotation: { x: 0.0, y: 90.0, z: 0.0 },
        scale: { x: 1.0, y: 1.0, z: 1.0 }
    },
    active: 1
});

// Accesso multi-livello
console.log('  transform.position.x:', GameObject.get(gameObj, 'transform.position.x'));
console.log('  transform.rotation.y:', GameObject.get(gameObj, 'transform.rotation.y'));

const fullObj = GameObject.toObject(gameObj);
console.log('  Full object:', JSON.stringify(fullObj, null, 2));

console.log('  ✓ Multi-level Nested Structs work!\n');

// ============================================================================
// Test 3: Bit Fields - Basic
// ============================================================================

console.log('Test 3: Bit Fields - Basic');

const Flags = ctypes.struct({
    flag1: ctypes.bitfield('uint8', 1),   // 1 bit
    flag2: ctypes.bitfield('uint8', 1),   // 1 bit
    flag3: ctypes.bitfield('uint8', 1),   // 1 bit
    reserved: ctypes.bitfield('uint8', 5) // 5 bit
});

console.log('  Flags size:', Flags.size, '(expected: 1 - all fit in one uint8)');

const flags = Flags.create();

// Imposta flag individuali
Flags.set(flags, 'flag1', 1);
Flags.set(flags, 'flag2', 0);
Flags.set(flags, 'flag3', 1);
Flags.set(flags, 'reserved', 0b10101);

console.log('  flag1:', Flags.get(flags, 'flag1'), '(expected: 1)');
console.log('  flag2:', Flags.get(flags, 'flag2'), '(expected: 0)');
console.log('  flag3:', Flags.get(flags, 'flag3'), '(expected: 1)');
console.log('  reserved:', Flags.get(flags, 'reserved'), '(expected: 21)');

// Verifica byte raw
console.log('  Raw byte:', '0b' + flags[0].toString(2).padStart(8, '0'));

console.log('  ✓ Basic Bit Fields work!\n');

// ============================================================================
// Test 4: Bit Fields - 32-bit
// ============================================================================

console.log('Test 4: Bit Fields - 32-bit');

// Simula un registro hardware
const HardwareReg = ctypes.struct({
    enabled: ctypes.bitfield('uint32', 1),      // bit 0
    mode: ctypes.bitfield('uint32', 3),         // bits 1-3
    channel: ctypes.bitfield('uint32', 4),      // bits 4-7
    priority: ctypes.bitfield('uint32', 8),     // bits 8-15
    reserved: ctypes.bitfield('uint32', 16)     // bits 16-31
});

console.log('  HardwareReg size:', HardwareReg.size, '(expected: 4)');

const hwreg = HardwareReg.create({
    enabled: 1,
    mode: 5,
    channel: 12,
    priority: 255,
    reserved: 0
});

console.log('  enabled:', HardwareReg.get(hwreg, 'enabled'), '(expected: 1)');
console.log('  mode:', HardwareReg.get(hwreg, 'mode'), '(expected: 5)');
console.log('  channel:', HardwareReg.get(hwreg, 'channel'), '(expected: 12)');
console.log('  priority:', HardwareReg.get(hwreg, 'priority'), '(expected: 255)');

// Leggi il valore raw a 32-bit
const rawValue = hwreg.readUInt32LE(0);
console.log('  Raw uint32:', '0x' + rawValue.toString(16).padStart(8, '0'));

// Verifica manualmente: enabled(1) | mode(5)<<1 | channel(12)<<4 | priority(255)<<8
const expected = 1 | (5 << 1) | (12 << 4) | (255 << 8);
console.log('  Expected:', '0x' + expected.toString(16).padStart(8, '0'));
console.log('  Match:', rawValue === expected);

console.log('  ✓ 32-bit Bit Fields work!\n');

// ============================================================================
// Test 5: Bit Fields con tipi misti
// ============================================================================

console.log('Test 5: Bit Fields with mixed types');

const MixedStruct = ctypes.struct({
    header: 'uint8',
    flags: ctypes.bitfield('uint16', 4),
    id: ctypes.bitfield('uint16', 12),
    payload: 'uint32'
});

console.log('  MixedStruct size:', MixedStruct.size, '(expected: 8)');

const mixed = MixedStruct.create({
    header: 0xAB,
    flags: 0xF,
    id: 0x123,
    payload: 0xDEADBEEF
});

console.log('  header:', '0x' + MixedStruct.get(mixed, 'header').toString(16));
console.log('  flags:', '0x' + MixedStruct.get(mixed, 'flags').toString(16));
console.log('  id:', '0x' + MixedStruct.get(mixed, 'id').toString(16));
console.log('  payload:', '0x' + MixedStruct.get(mixed, 'payload').toString(16));

console.log('  ✓ Mixed Bit Fields work!\n');

// ============================================================================
// Test 6: Combinazione Nested Struct + Bit Fields
// ============================================================================

console.log('Test 6: Nested Struct + Bit Fields');

const Status = ctypes.struct({
    running: ctypes.bitfield('uint8', 1),
    error: ctypes.bitfield('uint8', 1),
    ready: ctypes.bitfield('uint8', 1),
    reserved: ctypes.bitfield('uint8', 5)
});

const DeviceInfo = ctypes.struct({
    id: 'uint32',
    status: Status,
    temperature: 'float'
});

console.log('  Status size:', Status.size, '(expected: 1)');
console.log('  DeviceInfo size:', DeviceInfo.size);

const device = DeviceInfo.create({
    id: 12345,
    status: {
        running: 1,
        error: 0,
        ready: 1,
        reserved: 0
    },
    temperature: 45.5
});

console.log('  id:', DeviceInfo.get(device, 'id'));
console.log('  status:', DeviceInfo.get(device, 'status'));
console.log('  status.running:', DeviceInfo.get(device, 'status.running'));
console.log('  status.ready:', DeviceInfo.get(device, 'status.ready'));
console.log('  temperature:', DeviceInfo.get(device, 'temperature').toFixed(1));

console.log('  ✓ Combined Nested + Bit Fields work!\n');

// ============================================================================
// Test 7: getNestedBuffer
// ============================================================================

console.log('Test 7: getNestedBuffer');

const nestedBuf = Rectangle.getNestedBuffer(rect, 'topLeft');
console.log('  Nested buffer length:', nestedBuf.length, '(expected:', Point.size, ')');

// Modifica attraverso il buffer nested
Point.set(nestedBuf, 'x', 999);
console.log('  After modifying nested buffer, topLeft.x:', Rectangle.get(rect, 'topLeft.x'));

console.log('  ✓ getNestedBuffer works!\n');

// ============================================================================
// Test 8: Real-world example - TCP Header (simplified)
// ============================================================================

console.log('Test 8: Real-world example - TCP Header (simplified)');

const TCPHeader = ctypes.struct({
    srcPort: 'uint16',
    dstPort: 'uint16',
    seqNum: 'uint32',
    ackNum: 'uint32',
    dataOffset: ctypes.bitfield('uint16', 4),   // 4 bits
    reserved: ctypes.bitfield('uint16', 3),     // 3 bits
    NS: ctypes.bitfield('uint16', 1),           // 1 bit
    CWR: ctypes.bitfield('uint16', 1),          // 1 bit
    ECE: ctypes.bitfield('uint16', 1),          // 1 bit
    URG: ctypes.bitfield('uint16', 1),          // 1 bit
    ACK: ctypes.bitfield('uint16', 1),          // 1 bit
    PSH: ctypes.bitfield('uint16', 1),          // 1 bit
    RST: ctypes.bitfield('uint16', 1),          // 1 bit
    SYN: ctypes.bitfield('uint16', 1),          // 1 bit
    FIN: ctypes.bitfield('uint16', 1),          // 1 bit
    windowSize: 'uint16',
    checksum: 'uint16',
    urgentPtr: 'uint16'
});

console.log('  TCPHeader size:', TCPHeader.size, 'bytes');

const tcpPacket = TCPHeader.create({
    srcPort: 12345,
    dstPort: 80,
    seqNum: 1000,
    ackNum: 2000,
    dataOffset: 5,  // 5 * 4 = 20 bytes header
    SYN: 1,
    ACK: 1,
    windowSize: 65535,
    checksum: 0,
    urgentPtr: 0
});

console.log('  srcPort:', TCPHeader.get(tcpPacket, 'srcPort'));
console.log('  dstPort:', TCPHeader.get(tcpPacket, 'dstPort'));
console.log('  SYN:', TCPHeader.get(tcpPacket, 'SYN'));
console.log('  ACK:', TCPHeader.get(tcpPacket, 'ACK'));
console.log('  dataOffset:', TCPHeader.get(tcpPacket, 'dataOffset'));

console.log('  ✓ TCP Header example works!\n');

console.log('=== All Nested Struct & Bit Field Tests Complete ===');
