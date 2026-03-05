// =============================================================================
// GNS-AIP SDK — Cryptographic Primitives
// =============================================================================
// Ported from: identity_keypair.dart + crypto.ts
// Uses tweetnacl (same library as the GNS Node backend) for Ed25519.
// =============================================================================

import nacl from 'tweetnacl';
import { createHash } from 'crypto';
import { AgentIdentity, AgentIdentityPublic, GNS_CONSTANTS } from './types.js';

// =============================================================================
// Hex Utilities
// =============================================================================

/** Convert hex string to Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`Invalid hex string length: ${hex.length}`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Convert Uint8Array to hex string */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// =============================================================================
// Canonical JSON (deterministic serialization for signing)
// =============================================================================

/**
 * Create a canonical JSON string with sorted keys.
 * Identical to sortedJsonStringify in crypto.ts on the backend.
 * Critical: both client and server MUST produce the same canonical form.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(key => {
    const value = (obj as Record<string, unknown>)[key];
    return `"${key}":${canonicalJson(value)}`;
  });
  return '{' + pairs.join(',') + '}';
}

// =============================================================================
// Hashing
// =============================================================================

/**
 * SHA-256 hash using Web Crypto API (Node 18+).
 * Falls back to tweetnacl SHA-512 truncated to 32 bytes.
 */
export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

/** SHA-256 hash returned as hex string */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return bytesToHex(await sha256(data));
}

// =============================================================================
// Agent Identity — Keypair Generation
// =============================================================================
// Ported from GnsKeypair in identity_keypair.dart.
// Agents only need Ed25519 (no X25519 encryption — agents don't receive
// encrypted messages, they sign operations and verify delegations).
// =============================================================================

/**
 * Generate a new agent identity (Ed25519 keypair).
 *
 * The public key simultaneously serves as:
 * - The agent's GNS identity
 * - The agent's Stellar wallet address
 * - The signing key for all operations
 *
 * @returns Complete AgentIdentity with secret key
 */
export function generateAgentIdentity(): AgentIdentity {
  const keypair = nacl.sign.keyPair();
  const publicKey = bytesToHex(keypair.publicKey);
  const secretKey = bytesToHex(keypair.secretKey); // 64 bytes (NaCl expanded)

  return {
    publicKey,
    secretKey,
    gnsId: `gns_${publicKey.substring(0, 16)}`,
    stellarAddress: ed25519ToStellarAddress(keypair.publicKey),
    createdAt: new Date().toISOString(),
    type: 'agent',
  };
}

/**
 * Restore an agent identity from a stored secret key.
 *
 * @param secretKeyHex - 128 hex chars (64-byte NaCl expanded secret key)
 * @returns Complete AgentIdentity
 */
export function agentIdentityFromSecretKey(secretKeyHex: string): AgentIdentity {
  if (secretKeyHex.length !== 128) {
    throw new Error(`Invalid secret key length: ${secretKeyHex.length}, expected 128 hex chars`);
  }
  const secretKey = hexToBytes(secretKeyHex);
  const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
  const publicKey = bytesToHex(keypair.publicKey);

  return {
    publicKey,
    secretKey: secretKeyHex,
    gnsId: `gns_${publicKey.substring(0, 16)}`,
    stellarAddress: ed25519ToStellarAddress(keypair.publicKey),
    createdAt: new Date().toISOString(),
    type: 'agent',
  };
}

/**
 * Restore an agent identity from a 32-byte seed.
 *
 * @param seedHex - 64 hex chars (32-byte Ed25519 seed)
 * @returns Complete AgentIdentity
 */
export function agentIdentityFromSeed(seedHex: string): AgentIdentity {
  if (seedHex.length !== 64) {
    throw new Error(`Invalid seed length: ${seedHex.length}, expected 64 hex chars`);
  }
  const seed = hexToBytes(seedHex);
  const keypair = nacl.sign.keyPair.fromSeed(seed);
  const publicKey = bytesToHex(keypair.publicKey);
  const secretKey = bytesToHex(keypair.secretKey);

  return {
    publicKey,
    secretKey,
    gnsId: `gns_${publicKey.substring(0, 16)}`,
    stellarAddress: ed25519ToStellarAddress(keypair.publicKey),
    createdAt: new Date().toISOString(),
    type: 'agent',
  };
}

/**
 * Extract the public identity (safe for transmission/storage).
 */
export function toPublicIdentity(agent: AgentIdentity): AgentIdentityPublic {
  return {
    publicKey: agent.publicKey,
    gnsId: agent.gnsId,
    stellarAddress: agent.stellarAddress,
    createdAt: agent.createdAt,
    type: agent.type,
  };
}

// =============================================================================
// Ed25519 Signing & Verification
// =============================================================================

/**
 * Sign a message with an agent's Ed25519 secret key.
 *
 * @param secretKeyHex - 128 hex chars (NaCl expanded key)
 * @param message - String or bytes to sign
 * @returns Signature as 128 hex chars (64 bytes)
 */
export function sign(secretKeyHex: string, message: string | Uint8Array): string {
  const secretKey = hexToBytes(secretKeyHex);
  const messageBytes = typeof message === 'string'
    ? new TextEncoder().encode(message)
    : message;
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return bytesToHex(signature);
}

/**
 * Sign canonical JSON data (sorted keys).
 * This is the standard signing pattern for GNS protocol messages.
 */
export function signCanonical(secretKeyHex: string, data: Record<string, unknown>): string {
  return sign(secretKeyHex, canonicalJson(data));
}

/**
 * Verify an Ed25519 signature.
 *
 * @param publicKeyHex - 64 hex chars (32 bytes)
 * @param message - Original message
 * @param signatureHex - 128 hex chars (64 bytes)
 * @returns true if valid
 */
export function verify(
  publicKeyHex: string,
  message: string | Uint8Array,
  signatureHex: string
): boolean {
  try {
    if (publicKeyHex.length !== GNS_CONSTANTS.PK_HEX_LENGTH) return false;
    if (signatureHex.length !== GNS_CONSTANTS.SIG_HEX_LENGTH) return false;

    const publicKey = hexToBytes(publicKeyHex);
    const signature = hexToBytes(signatureHex);
    const messageBytes = typeof message === 'string'
      ? new TextEncoder().encode(message)
      : message;

    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch {
    return false;
  }
}

/**
 * Verify a signature over canonical JSON data.
 */
export function verifyCanonical(
  publicKeyHex: string,
  data: Record<string, unknown>,
  signatureHex: string
): boolean {
  return verify(publicKeyHex, canonicalJson(data), signatureHex);
}

// =============================================================================
// Stellar Address Derivation
// =============================================================================
// From stellar_service.ts: Ed25519 public key → Stellar G... address.
// Implements StrKey encoding (version byte 6 << 3 = 48 + CRC16-XModem).
// =============================================================================

/**
 * Convert Ed25519 public key bytes to a Stellar G... address.
 * Implements Stellar StrKey encoding without requiring the full Stellar SDK.
 */
export function ed25519ToStellarAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Invalid public key length: ${publicKey.length}, expected 32`);
  }

  // Version byte for ED25519 public key = 6 << 3 = 48
  const versionByte = 6 << 3; // 48
  const payload = new Uint8Array(35); // 1 version + 32 key + 2 checksum
  payload[0] = versionByte;
  payload.set(publicKey, 1);

  // CRC16-XModem checksum over version + key
  const checksum = crc16xmodem(payload.subarray(0, 33));
  payload[33] = checksum & 0xff;        // Little-endian
  payload[34] = (checksum >> 8) & 0xff;

  return base32Encode(payload);
}

/**
 * Convert a Stellar G... address back to Ed25519 public key hex.
 */
export function stellarAddressToPublicKey(address: string): string {
  const decoded = base32Decode(address);
  if (decoded.length !== 35) throw new Error('Invalid Stellar address length');
  if (decoded[0] !== (6 << 3)) throw new Error('Not an Ed25519 public key address');

  // Verify checksum
  const expected = crc16xmodem(decoded.subarray(0, 33));
  const actual = decoded[33] | (decoded[34] << 8);
  if (expected !== actual) throw new Error('Invalid Stellar address checksum');

  return bytesToHex(decoded.subarray(1, 33));
}

// CRC16-XModem (used by Stellar StrKey)
function crc16xmodem(data: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    let code = (crc >>> 8) & 0xff;
    code ^= data[i] & 0xff;
    code ^= code >>> 4;
    crc = ((crc << 8) & 0xffff) ^ (code << 12) ^ (code << 5) ^ code;
    crc &= 0xffff;
  }
  return crc;
}

// RFC 4648 Base32 encoding (Stellar uses this alphabet)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(data: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;
  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i];
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  // Pad to multiple of 8
  while (result.length % 8 !== 0) result += '=';
  return result;
}

function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.replace(/=+$/, '');
  const output: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i].toUpperCase());
    if (idx === -1) throw new Error(`Invalid base32 character: ${cleaned[i]}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

// =============================================================================
// Validation Utilities
// =============================================================================

/** Validate a hex public key */
export function isValidPublicKey(pk: string): boolean {
  return typeof pk === 'string'
    && pk.length === GNS_CONSTANTS.PK_HEX_LENGTH
    && /^[0-9a-f]+$/i.test(pk);
}

/** Validate a hex signature */
export function isValidSignature(sig: string): boolean {
  return typeof sig === 'string'
    && sig.length === GNS_CONSTANTS.SIG_HEX_LENGTH
    && /^[0-9a-f]+$/i.test(sig);
}

/** Generate a random 32-byte nonce as hex */
export function generateNonce(): string {
  return bytesToHex(nacl.randomBytes(32));
}

/** Generate a random cert/breadcrumb ID as hex */
export function generateId(): string {
  return bytesToHex(nacl.randomBytes(16));
}
