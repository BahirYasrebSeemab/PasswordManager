import { apiRequest, ApiError } from "./client";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.test");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function mockFetchOnce(status: number, body: unknown | undefined) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

test("returns the parsed body on a 200 and calls the configured base URL", async () => {
  const fetchMock = mockFetchOnce(200, { hello: "world" });
  await expect(apiRequest("/anything")).resolves.toEqual({ hello: "world" });
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/anything");
});

test("strips a trailing slash from the configured base URL", async () => {
  vi.stubEnv("VITE_API_URL", "https://api.test/");
  const fetchMock = mockFetchOnce(200, {});
  await apiRequest("/x");
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/x");
});

test("sends the bearer token and JSON body", async () => {
  const fetchMock = mockFetchOnce(200, {});
  await apiRequest("/x", { method: "POST", body: { a: 1 }, accessToken: "tok" });
  const init = fetchMock.mock.calls[0][1];
  expect(init.method).toBe("POST");
  expect(init.headers.Authorization).toBe("Bearer tok");
  expect(init.body).toBe(JSON.stringify({ a: 1 }));
});

test("throws ApiError with the parsed detail on a non-2xx response", async () => {
  mockFetchOnce(404, { detail: "not found" });
  await expect(apiRequest("/x")).rejects.toMatchObject({ status: 404, detail: "not found" });
});

test("returns undefined for a 204 without calling response.json()", async () => {
  mockFetchOnce(204, undefined);
  await expect(apiRequest("/x", { method: "DELETE" })).resolves.toBeUndefined();
});

test("throws ApiError for a non-ok empty 204-like response", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 204 }) as unknown as typeof fetch;
  await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiError);
});

test("throws a clear error when VITE_API_URL is not configured", async () => {
  vi.stubEnv("VITE_API_URL", "");
  await expect(apiRequest("/x")).rejects.toThrow("VITE_API_URL");
});
