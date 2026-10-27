import * as ctypes from "node-ctypes";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ck from "./cryptoki.js";

if (process.argv.length > 2) throw new Error("This demo accepts no arguments and uses only the bundled SoftHSM with a temporary token");
const filename = process.platform === "win32" ? "softhsm2.dll" : process.platform === "darwin" ? "libsofthsm2.dylib" : "libsofthsm2.so";
const libraryPath = fileURLToPath(new URL(`./softhsm2/${process.platform}-${process.arch}/${filename}`, import.meta.url));
const utilityPath = fileURLToPath(new URL(`./softhsm2/${process.platform}-${process.arch}/softhsm2-util${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
const configurationPath = fileURLToPath(new URL("./softhsm2/config/softhsm2.conf", import.meta.url));

// Keep all SoftHSM state in an isolated temporary directory.
using cleanup = new DisposableStack();
const directory = mkdtempSync(join(tmpdir(), "node-ctypes-softhsm2-demo-"));
cleanup.defer(() => rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
mkdirSync(join(directory, "tokens"));

// SoftHSM resolves the configured token directory relative to the process cwd.
const previousDirectory = process.cwd();
cleanup.defer(() => process.chdir(previousDirectory));
process.chdir(directory);

const previousConfig = process.env.SOFTHSM2_CONF;
cleanup.defer(() => {
  if (previousConfig === undefined) delete process.env.SOFTHSM2_CONF;
  else process.env.SOFTHSM2_CONF = previousConfig;
});
process.env.SOFTHSM2_CONF = configurationPath;

// Prepare only this temporary token, using public example PINs.
const setup = spawnSync(utilityPath, ["--module", libraryPath, "--init-token", "--free", "--label", "node-ctypes-demo", "--so-pin", "12345678", "--pin", "1234"], { encoding: "utf8" });
if (setup.error) throw setup.error;
if (setup.status !== 0) throw new Error(`SoftHSM token setup failed (${setup.signal ?? setup.status}): ${setup.stderr || setup.stdout}`);

// Match the provider ABI and apply one error policy to every native call.
const types = ck.createTypes({ packing: process.platform === "win32" ? 1 : null });
const module = new ck.Cryptoki(libraryPath, { types, errcheck: (rv, func) => ck.checkRV(rv, func.funcName) });
cleanup.defer(() => module.close());

module.C_Initialize(null);
cleanup.defer(() => module.C_Finalize(null));

// Attribute pointers need backing ctypes scalars or buffers, not JS primitives.
function template(entries) {
  const attributes = entries.map(([type, value]) => {
    const data = typeof value === "boolean" ? new types.CK_BBOOL(value ? ck.CK_TRUE : ck.CK_FALSE) : typeof value === "bigint" ? new types.CK_ULONG(value) : value;
    return new types.CK_ATTRIBUTE(type, ctypes.cast(data, ctypes.c_void_p), BigInt(ctypes.sizeof(data)));
  });
  return ctypes.ARRAY(types.CK_ATTRIBUTE, attributes.length)(...attributes);
}

// PKCS #11 information strings are fixed-width, space-padded byte arrays.
function text(value) {
  return Buffer.from(Array.from(value)).toString("utf8").trimEnd();
}

// Zero means unlimited only for maximum session counts, not for current counts.
function quantity(value, unlimited = false) {
  if (value === ck.CK_UNAVAILABLE_INFORMATION) return "CK_UNAVAILABLE_INFORMATION";
  return unlimited && value === ck.CK_EFFECTIVELY_INFINITE ? "CK_EFFECTIVELY_INFINITE" : value;
}

function showKey(key, extra) {
  const fields = [["CKA_LABEL", null], ["CKA_CLASS", types.CK_OBJECT_CLASS], ["CKA_KEY_TYPE", types.CK_KEY_TYPE], ["CKA_TOKEN", types.CK_BBOOL], ...extra];
  const attributes = ctypes.ARRAY(types.CK_ATTRIBUTE, fields.length)(...fields.map(([name]) => new types.CK_ATTRIBUTE(ck[name], null, 0n)));

  // First request lengths, then provide owned buffers or correctly typed scalars.
  module.C_GetAttributeValue(session, key, attributes, BigInt(attributes.length));
  const values = fields.map(([name, Type], i) => {
    const length = attributes[i].ulValueLen;
    if (length === ck.CK_UNAVAILABLE_INFORMATION) throw new Error(`${name} is unavailable`);
    if (Type && length !== BigInt(ctypes.sizeof(Type))) throw new Error(`${name} has an unexpected native size`);
    const value = Type ? new Type() : Buffer.alloc(Number(length));
    attributes[i].pValue = ctypes.cast(value, ctypes.c_void_p);
    attributes[i].ulValueLen = BigInt(ctypes.sizeof(value));
    return value;
  });
  module.C_GetAttributeValue(session, key, attributes, BigInt(attributes.length));

  const info = Object.fromEntries(
    fields.map(([name, Type], i) => {
      if (attributes[i].ulValueLen !== BigInt(ctypes.sizeof(values[i]))) throw new Error(`${name} changed size while reading the key`);
      return [name, Type ? values[i].value : values[i].toString(name === "CKA_LABEL" ? "utf8" : "hex")];
    }),
  );
  console.log("Key attributes:", info);
}

// Find the initialized token by label instead of assuming a fixed slot ID.
const count = new types.CK_ULONG();
module.C_GetSlotList(ck.CK_TRUE, null, ctypes.byref(count));

const slots = ctypes.ARRAY(types.CK_SLOT_ID, Number(count.value))();
module.C_GetSlotList(ck.CK_TRUE, slots, ctypes.byref(count));

const slot = Array.from({ length: Number(count.value) }, (_, i) => slots[i]).find((slot) => {
  const token = new types.CK_TOKEN_INFO();
  module.C_GetTokenInfo(slot, ctypes.byref(token));
  return token.flags & ck.CKF_TOKEN_INITIALIZED && text(token.label) === "node-ctypes-demo";
});
if (slot === undefined) throw new Error("Temporary demo token was not found");

// Inspect the selected slot and token before opening a session.
const slotInfo = new types.CK_SLOT_INFO();
module.C_GetSlotInfo(slot, ctypes.byref(slotInfo));
console.log("Slot info:", {
  slotID: slot,
  slotDescription: text(slotInfo.slotDescription),
  manufacturerID: text(slotInfo.manufacturerID),
  flags: `0x${slotInfo.flags.toString(16)}`,
  hardwareVersion: `${slotInfo.hardwareVersion.major}.${slotInfo.hardwareVersion.minor}`,
  firmwareVersion: `${slotInfo.firmwareVersion.major}.${slotInfo.firmwareVersion.minor}`,
});

const tokenInfo = new types.CK_TOKEN_INFO();
module.C_GetTokenInfo(slot, ctypes.byref(tokenInfo));
console.log("Token info:", {
  label: text(tokenInfo.label),
  manufacturerID: text(tokenInfo.manufacturerID),
  model: text(tokenInfo.model),
  serialNumber: text(tokenInfo.serialNumber),
  flags: `0x${tokenInfo.flags.toString(16)}`,
  ulMaxSessionCount: quantity(tokenInfo.ulMaxSessionCount, true),
  ulSessionCount: quantity(tokenInfo.ulSessionCount),
  ulMaxRwSessionCount: quantity(tokenInfo.ulMaxRwSessionCount, true),
  ulRwSessionCount: quantity(tokenInfo.ulRwSessionCount),
  ulMaxPinLen: quantity(tokenInfo.ulMaxPinLen),
  ulMinPinLen: quantity(tokenInfo.ulMinPinLen),
  ulTotalPublicMemory: quantity(tokenInfo.ulTotalPublicMemory),
  ulFreePublicMemory: quantity(tokenInfo.ulFreePublicMemory),
  ulTotalPrivateMemory: quantity(tokenInfo.ulTotalPrivateMemory),
  ulFreePrivateMemory: quantity(tokenInfo.ulFreePrivateMemory),
  hardwareVersion: `${tokenInfo.hardwareVersion.major}.${tokenInfo.hardwareVersion.minor}`,
  firmwareVersion: `${tokenInfo.firmwareVersion.major}.${tokenInfo.firmwareVersion.minor}`,
  utcTime: tokenInfo.flags & ck.CKF_CLOCK_ON_TOKEN ? text(tokenInfo.utcTime) : "not available (CKF_CLOCK_ON_TOKEN not set)",
});

// A read-only token session still allows nonpersistent session keys.
const session = new types.CK_SESSION_HANDLE();
module.C_OpenSession(slot, ck.CKF_SERIAL_SESSION, null, null, ctypes.byref(session));
cleanup.defer(() => module.C_CloseSession(session));

const userPin = Buffer.from("1234");
cleanup.defer(() => userPin.fill(0));
module.C_Login(session, ck.CKU_USER, userPin, BigInt(userPin.length));
cleanup.defer(() => module.C_Logout(session));
console.log("Temporary SoftHSM token ready; USER login successful");

// RSA-2048: generate session keys, then sign and verify binary data.
const publicTemplate = template([
  [ck.CKA_LABEL, Buffer.from("demo-rsa-public")],
  [ck.CKA_TOKEN, false],
  [ck.CKA_VERIFY, true],
  [ck.CKA_MODULUS_BITS, 2048n],
  [ck.CKA_PUBLIC_EXPONENT, Buffer.from([1, 0, 1])],
]);

const privateAttributes = [
  [ck.CKA_TOKEN, false],
  [ck.CKA_PRIVATE, true],
  [ck.CKA_SIGN, true],
  [ck.CKA_SENSITIVE, true],
  [ck.CKA_EXTRACTABLE, false],
];
const privateTemplate = template([[ck.CKA_LABEL, Buffer.from("demo-rsa-private")], ...privateAttributes]);

const publicKey = new types.CK_OBJECT_HANDLE();
const privateKey = new types.CK_OBJECT_HANDLE();
const rsa = new types.CK_MECHANISM(ck.CKM_RSA_PKCS_KEY_PAIR_GEN, null, 0n);
module.C_GenerateKeyPair(session, ctypes.byref(rsa), publicTemplate, BigInt(publicTemplate.length), privateTemplate, BigInt(privateTemplate.length), ctypes.byref(publicKey), ctypes.byref(privateKey));

// Explicit lengths preserve the embedded NUL byte in this payload.
const data = Buffer.from("node-ctypes PKCS #11 demo\0binary payload", "utf8");
const signing = new types.CK_MECHANISM(ck.CKM_SHA256_RSA_PKCS, null, 0n);
module.C_SignInit(session, ctypes.byref(signing), privateKey);
const signature = Buffer.alloc(256);
const signatureLength = new types.CK_ULONG(BigInt(signature.length));
module.C_Sign(session, data, BigInt(data.length), signature, ctypes.byref(signatureLength));
if (signatureLength.value !== 256n) throw new Error("RSA-2048 signature must contain 256 bytes");

module.C_VerifyInit(session, ctypes.byref(signing), publicKey);
module.C_Verify(session, data, BigInt(data.length), signature, signatureLength);
console.log(`RSA-2048 / SHA-256: ${signatureLength.value}-byte signature verified`);

// EC P-256: encode the named curve OID as DER and reuse the private signing attributes.
const ecPublicTemplate = template([
  [ck.CKA_LABEL, Buffer.from("demo-ec-public")],
  [ck.CKA_TOKEN, false],
  [ck.CKA_VERIFY, true],
  [ck.CKA_EC_PARAMS, Buffer.from("06082a8648ce3d030107", "hex")],
]);
const ecPublicKey = new types.CK_OBJECT_HANDLE();
const ecPrivateKey = new types.CK_OBJECT_HANDLE();
const ecPrivateTemplate = template([[ck.CKA_LABEL, Buffer.from("demo-ec-private")], ...privateAttributes]);
const ecGeneration = new types.CK_MECHANISM(ck.CKM_EC_KEY_PAIR_GEN, null, 0n);
module.C_GenerateKeyPair(session, ctypes.byref(ecGeneration), ecPublicTemplate, BigInt(ecPublicTemplate.length), ecPrivateTemplate, BigInt(ecPrivateTemplate.length), ctypes.byref(ecPublicKey), ctypes.byref(ecPrivateKey));

// CKM_ECDSA signs a digest; the P-256 signature is 64-byte r || s, not ASN.1 DER.
const ecHash = createHash("sha256").update(data).digest();
const ecdsa = new types.CK_MECHANISM(ck.CKM_ECDSA, null, 0n);
const ecSignature = Buffer.alloc(64);
const ecSignatureLength = new types.CK_ULONG(BigInt(ecSignature.length));
module.C_SignInit(session, ctypes.byref(ecdsa), ecPrivateKey);
module.C_Sign(session, ecHash, BigInt(ecHash.length), ecSignature, ctypes.byref(ecSignatureLength));
if (ecSignatureLength.value !== 64n) throw new Error("ECDSA P-256 signature must contain 64 bytes");

module.C_VerifyInit(session, ctypes.byref(ecdsa), ecPublicKey);
module.C_Verify(session, ecHash, BigInt(ecHash.length), ecSignature, ecSignatureLength);
console.log(`ECDSA P-256 / SHA-256: ${ecSignatureLength.value}-byte signature verified`);

// AES-128-CBC-PAD round trip, with a fresh IV for each encryption.
const aesTemplate = template([
  [ck.CKA_LABEL, Buffer.from("demo-aes")],
  [ck.CKA_TOKEN, false],
  [ck.CKA_ENCRYPT, true],
  [ck.CKA_DECRYPT, true],
  [ck.CKA_SENSITIVE, true],
  [ck.CKA_EXTRACTABLE, false],
  [ck.CKA_VALUE_LEN, 16n],
]);

const aesKey = new types.CK_OBJECT_HANDLE();
const aesGeneration = new types.CK_MECHANISM(ck.CKM_AES_KEY_GEN, null, 0n);
module.C_GenerateKey(session, ctypes.byref(aesGeneration), aesTemplate, BigInt(aesTemplate.length), ctypes.byref(aesKey));

const iv = randomBytes(16);
const aes = new types.CK_MECHANISM(ck.CKM_AES_CBC_PAD, ctypes.cast(iv, ctypes.c_void_p), BigInt(iv.length));

module.C_EncryptInit(session, ctypes.byref(aes), aesKey);
const encrypted = Buffer.alloc(16 * (Math.floor(data.length / 16) + 1));
const encryptedLength = new types.CK_ULONG(BigInt(encrypted.length));
module.C_Encrypt(session, data, BigInt(data.length), encrypted, ctypes.byref(encryptedLength));
if (encryptedLength.value !== BigInt(encrypted.length)) throw new Error("AES-CBC-PAD ciphertext has an unexpected length");

module.C_DecryptInit(session, ctypes.byref(aes), aesKey);
const decrypted = Buffer.alloc(encrypted.length);
const decryptedLength = new types.CK_ULONG(BigInt(decrypted.length));
module.C_Decrypt(session, encrypted, encryptedLength, decrypted, ctypes.byref(decryptedLength));
if (decryptedLength.value !== BigInt(data.length) || !decrypted.subarray(0, Number(decryptedLength.value)).equals(data)) throw new Error("AES decryption did not reproduce the original binary data");
console.log(`AES-128-CBC-PAD: ${data.length} plaintext bytes -> ${encryptedLength.value} ciphertext bytes -> ${decryptedLength.value} matching plaintext bytes`);

// Check the token's SHA-256 result against an independent Node.js calculation.
const digest = new types.CK_MECHANISM(ck.CKM_SHA256, null, 0n);
const hash = Buffer.alloc(32);
const hashLength = new types.CK_ULONG(32n);
module.C_DigestInit(session, ctypes.byref(digest));
module.C_Digest(session, data, BigInt(data.length), hash, ctypes.byref(hashLength));
if (hashLength.value !== 32n || !hash.equals(createHash("sha256").update(data).digest())) throw new Error("Token SHA-256 digest differs from the Node.js reference");
console.log(`SHA-256: ${hash.toString("hex")} (matches Node.js)`);

// Obtain random bytes from the token, rather than from Node.js.
const random = Buffer.alloc(16);
module.C_GenerateRandom(session, random, BigInt(random.length));
console.log(`Token random (${random.length} bytes): ${random.toString("hex")}`);

// Find each session key by label and inspect the returned handle, not a new object.
const protectionAttributes = [
  ["CKA_SENSITIVE", types.CK_BBOOL],
  ["CKA_EXTRACTABLE", types.CK_BBOOL],
];
for (const [label, expected, extra] of [
  ["demo-rsa-public", publicKey, [["CKA_MODULUS_BITS", types.CK_ULONG]]],
  ["demo-rsa-private", privateKey, protectionAttributes],
  ["demo-ec-public", ecPublicKey, [["CKA_EC_PARAMS", null]]],
  ["demo-ec-private", ecPrivateKey, protectionAttributes],
  ["demo-aes", aesKey, [...protectionAttributes, ["CKA_VALUE_LEN", types.CK_ULONG]]],
]) {
  const filter = template([[ck.CKA_LABEL, Buffer.from(label)]]);
  module.C_FindObjectsInit(session, filter, BigInt(filter.length));
  try {
    const found = ctypes.ARRAY(types.CK_OBJECT_HANDLE, 1)();
    const foundCount = new types.CK_ULONG();
    module.C_FindObjects(session, found, 1n, ctypes.byref(foundCount));
    if (foundCount.value !== 1n || found[0] !== expected.value) throw new Error(`Could not find the generated key ${label}`);
    const key = found[0];

    // A one-element batch does not prove uniqueness: check for another match.
    module.C_FindObjects(session, found, 1n, ctypes.byref(foundCount));
    if (foundCount.value !== 0n) throw new Error(`Multiple keys have label ${label}`);
    showKey(key, extra);
  } finally {
    module.C_FindObjectsFinal(session);
  }
}

// Dispose in reverse acquisition order; this also happens on exceptions.
cleanup.dispose();
console.log("Cleanup completed: session closed, provider finalized, temporary token removed");
