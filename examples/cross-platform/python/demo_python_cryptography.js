// demo_python_cryptography — pyca/cryptography from Node.js
//
// Uses the Python cryptography package through python.js: hashes and HMAC,
// RSA, EC and DSA key pairs, signatures, an X.509 certificate signing
// request and a self-signed certificate. Every result is checked with
// node:crypto: keys, signatures and certificates cross the two languages as
// PEM / DER bytes (Buffers), so this is also an interoperability test.
//
// Usage:
//   pip install cryptography
//   node examples/cross-platform/python/demo_python_cryptography.js
//   PYTHON=/path/to/venv/bin/python node examples/cross-platform/python/demo_python_cryptography.js

import crypto from "node:crypto";
import { Python, PythonError, kwargs } from "./python.js";

const python = Python.initialize();

console.log("═══════════════════════════════════════════════════════════");
console.log(` pyca/cryptography from Node.js (Python ${python.version})`);
console.log("═══════════════════════════════════════════════════════════\n");

let cryptography;
try {
  cryptography = python.import("cryptography");
} catch (error) {
  if (!(error instanceof PythonError) || error.type !== "ModuleNotFoundError") throw error;
  console.log("    cryptography is not installed (pip install cryptography): skipped");
  console.log("\n    Done!");
  process.exit(0);
}
console.log(`    cryptography ${cryptography.__version__}\n`);

const hashes = python.import("cryptography.hazmat.primitives.hashes");
const hmac = python.import("cryptography.hazmat.primitives.hmac");
const serialization = python.import("cryptography.hazmat.primitives.serialization");
const { rsa, ec, dsa, padding } = Object.fromEntries(["rsa", "ec", "dsa", "padding"].map((name) => [name, python.import(`cryptography.hazmat.primitives.asymmetric.${name}`)]));
const x509 = python.import("cryptography.x509");
const { NameOID } = python.import("cryptography.x509.oid");
const { InvalidSignature } = python.import("cryptography.exceptions");

const { Encoding, PrivateFormat, PublicFormat, NoEncryption, BestAvailableEncryption } = serialization;
const message = Buffer.from("node-ctypes ♥ pyca/cryptography");
const pem = (bytes) => bytes.toString("utf8");
const publicPem = (key) => pem(key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo));
const check = (ok) => (ok ? "✓" : "✗");

/** verify() of cryptography: true, or false on InvalidSignature. */
function pyVerify(publicKey, ...args) {
  try {
    publicKey.verify(...args);
    return true;
  } catch (error) {
    if (error instanceof PythonError && python.builtins.isinstance(error.exception, InvalidSignature)) return false;
    throw error;
  }
}

// [1] hashes and HMAC, compared with node:crypto
console.log("[1] hashes and HMAC");
for (const [name, algorithm, node] of [
  ["SHA-256", hashes.SHA256(), "sha256"],
  ["SHA-512", hashes.SHA512(), "sha512"],
  ["SHA3-256", hashes.SHA3_256(), "sha3-256"],
  ["BLAKE2b-512", hashes.BLAKE2b(64), "blake2b512"],
]) {
  const digest = hashes.Hash(algorithm);
  digest.update(message);
  const python_digest = digest.finalize(); // bytes → Buffer
  const node_digest = crypto.createHash(node).update(message).digest();
  console.log(`    ${name.padEnd(11)} ${python_digest.toString("hex").slice(0, 32)}… ${check(python_digest.equals(node_digest))} node:crypto`);
}
const key = crypto.randomBytes(32);
const mac = hmac.HMAC(key, hashes.SHA256());
mac.update(message);
const tag = mac.finalize();
console.log(`    HMAC-SHA256 ${tag.toString("hex").slice(0, 32)}… ${check(tag.equals(crypto.createHmac("sha256", key).update(message).digest()))} node:crypto\n`);

// [2] RSA: key pair, encrypted PKCS#8, RSA-PSS signatures both ways
console.log("[2] RSA 2048");
const rsaKey = rsa.generate_private_key(kwargs({ public_exponent: 65537, key_size: 2048 }));
const rsaPrivatePem = pem(rsaKey.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, BestAvailableEncryption(Buffer.from("s3cret"))));
const rsaPublicPem = publicPem(rsaKey);
console.log(`    private key: ${rsaPrivatePem.split("\n")[0]} (${rsaPrivatePem.length} chars), public key: ${rsaPublicPem.split("\n")[0]}`);
const pss = padding.PSS(kwargs({ mgf: padding.MGF1(hashes.SHA256()), salt_length: padding.PSS.MAX_LENGTH }));
const rsaSignature = rsaKey.sign(message, pss, hashes.SHA256());
const nodePss = { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_AUTO };
console.log(
  `    Python signs (RSA-PSS, ${rsaSignature.length} bytes): Python verifies ${check(pyVerify(rsaKey.public_key(), rsaSignature, message, pss, hashes.SHA256()))}, node:crypto verifies ${check(crypto.verify("sha256", message, { key: rsaPublicPem, ...nodePss }, rsaSignature))}`,
);
// The encrypted private key, opened by Node.js: Node.js signs, Python verifies.
const nodeRsaKey = crypto.createPrivateKey({ key: rsaPrivatePem, passphrase: "s3cret" });
const nodeSignature = crypto.sign("sha256", message, { key: nodeRsaKey, ...nodePss });
console.log(`    node:crypto signs with the encrypted PKCS#8 key: Python verifies ${check(pyVerify(rsaKey.public_key(), nodeSignature, message, pss, hashes.SHA256()))}`);
console.log(`    tampered message: rejected by Python ${check(!pyVerify(rsaKey.public_key(), rsaSignature, Buffer.from("tampered"), pss, hashes.SHA256()))} (InvalidSignature)\n`);

// [3] EC P-256 and ECDSA
console.log("[3] EC P-256 and ECDSA");
const ecKey = ec.generate_private_key(ec.SECP256R1());
const ecPublicPem = publicPem(ecKey);
const ecdsa = ec.ECDSA(hashes.SHA256());
const ecSignature = ecKey.sign(message, ecdsa); // DER, as node:crypto expects
console.log(`    curve ${ecKey.curve.name}, ${ecKey.key_size}-bit key`);
console.log(`    Python signs (ECDSA, DER, ${ecSignature.length} bytes): Python verifies ${check(pyVerify(ecKey.public_key(), ecSignature, message, ecdsa))}, node:crypto verifies ${check(crypto.verify("sha256", message, ecPublicPem, ecSignature))}`);
const nodeEcSignature = crypto.sign("sha256", message, crypto.createPrivateKey(pem(ecKey.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))));
console.log(`    node:crypto signs: Python verifies ${check(pyVerify(ecKey.public_key(), nodeEcSignature, message, ecdsa))}\n`);

// [4] DSA
console.log("[4] DSA 2048");
const dsaKey = dsa.generate_private_key(kwargs({ key_size: 2048 }));
const dsaSignature = dsaKey.sign(message, hashes.SHA256());
const { p, q } = dsaKey.parameters().parameter_numbers(); // Python ints: BigInt in JavaScript
console.log(`    p is ${p.toString(2).length} bits, q is ${q.toString(2).length} bits`);
console.log(
  `    Python signs (${dsaSignature.length} bytes): Python verifies ${check(pyVerify(dsaKey.public_key(), dsaSignature, message, hashes.SHA256()))}, node:crypto verifies ${check(crypto.verify("sha256", message, publicPem(dsaKey), dsaSignature))}\n`,
);

// [5] X.509 certificate signing request, signed with the EC key
console.log("[5] X.509 CSR");
const subject = x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, "IT"), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "node-ctypes"), x509.NameAttribute(NameOID.COMMON_NAME, "example.com")]);
const altNames = x509.SubjectAlternativeName([x509.DNSName("example.com"), x509.DNSName("www.example.com")]);
const csr = x509
  .CertificateSigningRequestBuilder()
  .subject_name(subject)
  .add_extension(altNames, kwargs({ critical: false }))
  .sign(ecKey, hashes.SHA256());
const csrPem = pem(csr.public_bytes(Encoding.PEM));
const csrNames = csr.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName).toJS();
console.log(`    ${csrPem.split("\n")[0]} (${csrPem.length} chars), signature valid ${check(csr.is_signature_valid)}`);
console.log(`    subject ${csr.subject.rfc4514_string()}, SAN ${csrNames.join(", ")}\n`);

// [6] self-signed certificate (RSA key), read by node:crypto
console.log("[6] self-signed certificate");
const now = new Date(); // a Date is an aware datetime in Python
const certificate = x509
  .CertificateBuilder()
  .subject_name(subject)
  .issuer_name(subject)
  .public_key(rsaKey.public_key())
  .serial_number(x509.random_serial_number())
  .not_valid_before(now)
  .not_valid_after(new Date(now.getTime() + 365 * 24 * 3600 * 1000))
  .add_extension(x509.BasicConstraints(kwargs({ ca: true, path_length: null })), kwargs({ critical: true }))
  .add_extension(altNames, kwargs({ critical: false }))
  .sign(rsaKey, hashes.SHA256());
const certificatePem = pem(certificate.public_bytes(Encoding.PEM));
const nodeCertificate = new crypto.X509Certificate(certificatePem);
const pythonFingerprint = certificate.fingerprint(hashes.SHA256()).toString("hex").toUpperCase().match(/../g).join(":");
console.log(`    Python: serial ${certificate.serial_number.toString(16).slice(0, 16)}…, valid until ${new Date(certificate.not_valid_after_utc).toISOString()}`);
console.log(`    node:crypto: subject ${nodeCertificate.subject.replaceAll("\n", ", ")}, CA ${nodeCertificate.ca}`);
console.log(
  `    node:crypto: self-signature ${check(nodeCertificate.verify(nodeCertificate.publicKey))}, checkHost("www.example.com") ${check(nodeCertificate.checkHost("www.example.com"))}, same SHA-256 fingerprint ${check(nodeCertificate.fingerprint256 === pythonFingerprint)}`,
);

console.log("\n    Done!");
