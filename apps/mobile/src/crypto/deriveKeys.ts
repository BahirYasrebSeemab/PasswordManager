import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { extract, expand } from "@noble/hashes/hkdf.js";

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 32;
const HKDF_EXTRACT_SALT = new Uint8Array(32); // 32 zero bytes — see spec for why
const VAULT_KEY_INFO = new TextEncoder().encode("password-manager/vault_key/v1");
const AUTH_KEY_INFO = new TextEncoder().encode("password-manager/auth_key/v1");

export interface DerivedKeys {
  vaultKey: Uint8Array;
  authKey: Uint8Array;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function deriveKeys(email: string, masterPassword: string): DerivedKeys {
  const salt = new TextEncoder().encode(normalizeEmail(email));
  const password = new TextEncoder().encode(masterPassword);

  const masterKey = pbkdf2(sha256, password, salt, { c: PBKDF2_ITERATIONS, dkLen: KEY_LENGTH });
  const prk = extract(sha256, masterKey, HKDF_EXTRACT_SALT);

  return {
    vaultKey: expand(sha256, prk, VAULT_KEY_INFO, KEY_LENGTH),
    authKey: expand(sha256, prk, AUTH_KEY_INFO, KEY_LENGTH),
  };
}
