import { encryptEntry, decryptEntry } from "./cipher";

function randomKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

test("round-trips: decrypting what was just encrypted returns the original plaintext", () => {
  const key = randomKey();
  const plaintext = JSON.stringify({ site: "example.com", username: "me", password: "hunter2" });
  const encoded = encryptEntry(key, plaintext);
  expect(decryptEntry(key, encoded)).toBe(plaintext);
});

test("two encryptions of the same plaintext produce different ciphertext (fresh nonce each time)", () => {
  const key = randomKey();
  const plaintext = "same value both times";
  const first = encryptEntry(key, plaintext);
  const second = encryptEntry(key, plaintext);
  expect(first).not.toBe(second);
});

test("decrypting with the wrong key throws instead of returning garbage", () => {
  const encoded = encryptEntry(randomKey(), "sensitive value");
  expect(() => decryptEntry(randomKey(), encoded)).toThrow();
});

test("a tampered ciphertext fails to decrypt (authentication, not just encryption)", () => {
  const key = randomKey();
  const encoded = encryptEntry(key, "sensitive value");
  const tampered = encoded.slice(0, -4) + (encoded.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
  expect(() => decryptEntry(key, tampered)).toThrow();
});
