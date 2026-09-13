import { deriveKeys } from "./deriveKeys";

const EMAIL = "test@example.com";
const PASSWORD = "correct horse battery staple";

test("returns 32-byte vaultKey and authKey", () => {
  const { vaultKey, authKey } = deriveKeys(EMAIL, PASSWORD);
  expect(vaultKey).toBeInstanceOf(Uint8Array);
  expect(vaultKey.length).toBe(32);
  expect(authKey).toBeInstanceOf(Uint8Array);
  expect(authKey.length).toBe(32);
});

test("vaultKey and authKey are different values (domain separation)", () => {
  const { vaultKey, authKey } = deriveKeys(EMAIL, PASSWORD);
  expect(Buffer.from(vaultKey).equals(Buffer.from(authKey))).toBe(false);
});

test("is deterministic: same email+password always derives the same keys", () => {
  const first = deriveKeys(EMAIL, PASSWORD);
  const second = deriveKeys(EMAIL, PASSWORD);
  expect(Buffer.from(first.vaultKey).equals(Buffer.from(second.vaultKey))).toBe(true);
  expect(Buffer.from(first.authKey).equals(Buffer.from(second.authKey))).toBe(true);
});

test("a different password produces different keys", () => {
  const a = deriveKeys(EMAIL, PASSWORD);
  const b = deriveKeys(EMAIL, "a different password entirely");
  expect(Buffer.from(a.vaultKey).equals(Buffer.from(b.vaultKey))).toBe(false);
  expect(Buffer.from(a.authKey).equals(Buffer.from(b.authKey))).toBe(false);
});

test("email casing and surrounding whitespace do not change the derived keys", () => {
  const a = deriveKeys("Test@Example.com", PASSWORD);
  const b = deriveKeys("  test@example.com  ", PASSWORD);
  expect(Buffer.from(a.vaultKey).equals(Buffer.from(b.vaultKey))).toBe(true);
  expect(Buffer.from(a.authKey).equals(Buffer.from(b.authKey))).toBe(true);
});

test("a different email produces different keys, even with the same password", () => {
  const a = deriveKeys(EMAIL, PASSWORD);
  const b = deriveKeys("someone-else@example.com", PASSWORD);
  expect(Buffer.from(a.vaultKey).equals(Buffer.from(b.vaultKey))).toBe(false);
});
