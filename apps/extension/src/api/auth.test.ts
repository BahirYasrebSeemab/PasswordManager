import { login } from "./auth";
import { bytesToBase64 } from "../crypto/base64";

beforeEach(() => vi.stubEnv("VITE_API_URL", "https://api.test"));
afterEach(() => vi.unstubAllEnvs());

test("login posts the email and base64 auth key", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ access_token: "t", token_type: "bearer" }),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const authKey = new Uint8Array(32).fill(7);

  const result = await login("me@example.com", authKey);

  expect(result.access_token).toBe("t");
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/auth/login");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    email: "me@example.com",
    auth_key: bytesToBase64(authKey),
  });
});
