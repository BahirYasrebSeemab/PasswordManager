import { deriveKeys } from "./deriveKeys";
import { decryptEntry } from "./cipher";

const EMAIL = "test@example.com";
const PASSWORD = "correct horse battery staple";
const VAULT_KEY_HEX = "721487cc265c5466347632b8e5819480597e7308b291b0897ee22a656ee2db7c";
const AUTH_KEY_HEX = "37ceb802860b8532d1ef5d86ec4555f1cc90a4bb8818b3891938369b30ce506f";
const MOBILE_CIPHERTEXT =
  "HK0OU1QJKxsybgtrgNSLcCSFZIlkwelSDPAbMTNDRB2UO0Qndvju7480je7RaQj54nRP2wcG8ymG9hwbHo3UnrqTlKGZnBrS6FrTz4M60HtEumSYq/YlAkC38yKoSii7P8yxRoVnEuktIhlGp17qR9xHh3aSQ3ZFK3vIOYrnT+aMdoJRv3SnXzN6";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

test("derives exactly the keys mobile derives for the same email and password", () => {
  const { vaultKey, authKey } = deriveKeys(EMAIL, PASSWORD);
  expect(hex(vaultKey)).toBe(VAULT_KEY_HEX);
  expect(hex(authKey)).toBe(AUTH_KEY_HEX);
});

test("decrypts a ciphertext that mobile's encryptEntry produced", () => {
  const vaultKey = Uint8Array.from(Buffer.from(VAULT_KEY_HEX, "hex"));
  const content = JSON.parse(decryptEntry(vaultKey, MOBILE_CIPHERTEXT));
  expect(content).toEqual({
    title: "Example",
    username: "me@example.com",
    password: "hunter2",
    url: "https://example.com",
    notes: "kat",
  });
});
