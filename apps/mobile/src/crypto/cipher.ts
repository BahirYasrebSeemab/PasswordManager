import { gcm } from "@noble/ciphers/aes.js";
import { bytesToBase64, base64ToBytes } from "./base64";

const NONCE_LENGTH = 12; // standard AES-GCM nonce size

export function encryptEntry(vaultKey: Uint8Array, plaintext: string): string {
  const nonce = new Uint8Array(NONCE_LENGTH);
  crypto.getRandomValues(nonce);

  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextAndTag = gcm(vaultKey, nonce).encrypt(plaintextBytes);

  const combined = new Uint8Array(nonce.length + ciphertextAndTag.length);
  combined.set(nonce, 0);
  combined.set(ciphertextAndTag, nonce.length);

  return bytesToBase64(combined);
}

export function decryptEntry(vaultKey: Uint8Array, encoded: string): string {
  const combined = base64ToBytes(encoded);
  const nonce = combined.slice(0, NONCE_LENGTH);
  const ciphertextAndTag = combined.slice(NONCE_LENGTH);

  const plaintextBytes = gcm(vaultKey, nonce).decrypt(ciphertextAndTag);
  return new TextDecoder().decode(plaintextBytes);
}
