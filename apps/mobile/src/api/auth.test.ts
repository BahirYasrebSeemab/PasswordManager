import { register, login, getMe, deleteAccount, ApiError } from "./auth";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const AUTH_KEY = new Uint8Array(32).fill(7);

test("register sends base64 auth_key and returns the token", async () => {
  mockFetchOnce(201, { access_token: "abc123", token_type: "bearer" });

  const result = await register("test@example.com", AUTH_KEY);

  expect(result).toEqual({ access_token: "abc123", token_type: "bearer" });
  const [, options] = (global.fetch as jest.Mock).mock.calls[0];
  const body = JSON.parse(options.body as string);
  expect(body.email).toBe("test@example.com");
  expect(typeof body.auth_key).toBe("string");
  expect(body.auth_key.length).toBe(44); // 32 bytes base64-encoded
});

test("register throws ApiError with status 409 on duplicate email", async () => {
  mockFetchOnce(409, { detail: "Email already registered" });

  await expect(register("test@example.com", AUTH_KEY)).rejects.toMatchObject({
    status: 409,
  });
});

test("login returns the token on success", async () => {
  mockFetchOnce(200, { access_token: "xyz789", token_type: "bearer" });

  const result = await login("test@example.com", AUTH_KEY);

  expect(result.access_token).toBe("xyz789");
});

test("login throws ApiError with status 401 on invalid credentials", async () => {
  mockFetchOnce(401, { detail: "Invalid email or password" });

  await expect(login("test@example.com", AUTH_KEY)).rejects.toBeInstanceOf(ApiError);
});

test("getMe sends the bearer token and returns the user", async () => {
  mockFetchOnce(200, { id: 1, email: "test@example.com" });

  const result = await getMe("some-token");

  expect(result).toEqual({ id: 1, email: "test@example.com" });
  const [, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(options.headers.Authorization).toBe("Bearer some-token");
});

test("deleteAccount DELETEs /auth/me with the bearer token and base64 auth_key, resolving to undefined on 204", async () => {
  mockFetchOnce(204, undefined);

  await expect(deleteAccount("some-token", AUTH_KEY)).resolves.toBeUndefined();
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/auth/me");
  expect(options.method).toBe("DELETE");
  expect(options.headers.Authorization).toBe("Bearer some-token");
  const body = JSON.parse(options.body as string);
  expect(typeof body.auth_key).toBe("string");
  expect(body.auth_key.length).toBe(44); // 32 bytes base64-encoded
});

test("deleteAccount throws ApiError with status 401 on the wrong password", async () => {
  mockFetchOnce(401, { detail: "Incorrect password" });

  await expect(deleteAccount("some-token", AUTH_KEY)).rejects.toMatchObject({ status: 401 });
});
