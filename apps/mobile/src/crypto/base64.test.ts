import { bytesToBase64, base64ToBytes } from "./base64";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("bytesToBase64", () => {
  test.each([
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ])("encodes %j to %j (RFC 4648 test vector)", (input, expected) => {
    expect(bytesToBase64(utf8(input))).toBe(expected);
  });
});

describe("base64ToBytes", () => {
  test.each([
    ["", ""],
    ["Zg==", "f"],
    ["Zm8=", "fo"],
    ["Zm9v", "foo"],
    ["Zm9vYg==", "foob"],
    ["Zm9vYmE=", "fooba"],
    ["Zm9vYmFy", "foobar"],
  ])("decodes %j to %j (RFC 4648 test vector)", (input, expected) => {
    expect(new TextDecoder().decode(base64ToBytes(input))).toBe(expected);
  });
});

test("round-trips arbitrary binary data, not just text", () => {
  const original = new Uint8Array([0, 1, 2, 253, 254, 255, 127, 128]);
  expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
});
