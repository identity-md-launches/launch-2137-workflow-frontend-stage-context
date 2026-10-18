/**
 * MNEMO's browser cryptography. Everything here runs locally; the contract only ever sees the
 * bytes these functions return. The same scheme is written out in public/llms.txt and used by
 * public/mnemo-agent.mjs, so an agent outside the browser derives the same keys.
 *
 *   vault key(epoch) = HKDF-SHA256(ikm = signature bytes of "MNEMO vault key v1 for {address}",
 *                                  salt = "MNEMO", info = "vault:{epoch}", 32 bytes)
 *   note             = 0x01 | nonce (24) | XChaCha20-Poly1305(vault key, nonce, utf8 text)
 *   agent secret     = HKDF-SHA256(ikm = signature bytes of "MNEMO agent key v1 for {address}",
 *                                  salt = "MNEMO", info = "agent", 32 bytes)   (x25519 secret key)
 *   sealed key       = 0x01 | ephemeral x25519 public (32) | nonce (24) |
 *                      XChaCha20-Poly1305(HKDF(x25519(eph, agent pub), salt = eph pub | agent pub,
 *                                         info = "MNEMO grant v1"), nonce, vault key)
 *
 * Signatures must be deterministic (RFC 6979), which holds for externally owned accounts; smart
 * contract wallets sign differently each time, so the site refuses them (EOAs only).
 */
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, type Hex } from "viem";

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const SALT = enc.encode("MNEMO");
const VERSION = 1;

export const MAX_NOTE_BYTES = 2048;
/** Plaintext room in one note after the version byte, nonce and tag. */
export const MAX_PLAINTEXT_BYTES = MAX_NOTE_BYTES - 1 - 24 - 16;

export const vaultMessage = (address: string) => `MNEMO vault key v1 for ${address}`;
export const agentMessage = (address: string) => `MNEMO agent key v1 for ${address}`;

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function vaultKey(signature: Hex, epoch: number): Uint8Array {
  return hkdf(sha256, hexToBytes(signature), SALT, enc.encode(`vault:${epoch}`), 32);
}

export function agentSecret(signature: Hex): Uint8Array {
  return hkdf(sha256, hexToBytes(signature), SALT, enc.encode("agent"), 32);
}

export function agentPublic(secret: Uint8Array): Hex {
  return bytesToHex(x25519.getPublicKey(secret));
}

export const plaintextBytes = (text: string) => enc.encode(text).length;

export function sealNote(key: Uint8Array, text: string, nonce: Uint8Array = randomBytes(24)): Hex {
  const pt = enc.encode(text);
  if (pt.length === 0) throw new Error("Write something before sealing.");
  if (pt.length > MAX_PLAINTEXT_BYTES) throw new Error(`Keep a note under ${MAX_PLAINTEXT_BYTES} bytes.`);
  const ct = xchacha20poly1305(key, nonce).encrypt(pt);
  const out = new Uint8Array(1 + 24 + ct.length);
  out[0] = VERSION;
  out.set(nonce, 1);
  out.set(ct, 25);
  return bytesToHex(out);
}

/** Returns the text, or null when this key cannot open the note (another epoch, or not ours). */
export function openNote(key: Uint8Array, ciphertext: Hex): string | null {
  try {
    const b = hexToBytes(ciphertext);
    if (b[0] !== VERSION || b.length < 1 + 24 + 16) return null;
    return dec.decode(xchacha20poly1305(key, b.slice(1, 25)).decrypt(b.slice(25)));
  } catch {
    return null;
  }
}

function grantKey(shared: Uint8Array, ephPub: Uint8Array, agentPub: Uint8Array) {
  const salt = new Uint8Array(64);
  salt.set(ephPub, 0);
  salt.set(agentPub, 32);
  return hkdf(sha256, shared, salt, enc.encode("MNEMO grant v1"), 32);
}

export function sealKeyFor(agentPubHex: Hex, key: Uint8Array, eph: Uint8Array = randomBytes(32), nonce: Uint8Array = randomBytes(24)): Hex {
  const agentPub = hexToBytes(agentPubHex);
  const ephPub = x25519.getPublicKey(eph);
  const k = grantKey(x25519.getSharedSecret(eph, agentPub), ephPub, agentPub);
  const ct = xchacha20poly1305(k, nonce).encrypt(key);
  const out = new Uint8Array(1 + 32 + 24 + ct.length);
  out[0] = VERSION;
  out.set(ephPub, 1);
  out.set(nonce, 33);
  out.set(ct, 57);
  return bytesToHex(out);
}

export function openSealedKey(secret: Uint8Array, sealed: Hex): Uint8Array | null {
  try {
    const b = hexToBytes(sealed);
    if (b[0] !== VERSION || b.length !== 1 + 32 + 24 + 48) return null;
    const ephPub = b.slice(1, 33);
    const k = grantKey(x25519.getSharedSecret(secret, ephPub), ephPub, x25519.getPublicKey(secret));
    return xchacha20poly1305(k, b.slice(33, 57)).decrypt(b.slice(57));
  } catch {
    return null;
  }
}
