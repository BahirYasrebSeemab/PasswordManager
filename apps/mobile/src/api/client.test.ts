import { apiRequest, ApiError } from "./client";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown | undefined) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) {
        throw new SyntaxError("Unexpected end of JSON input");
      }
      return body;
    },
  }) as unknown as typeof fetch;
}

test("apiRequest returns the parsed body on a normal 200 response", async () => {
  mockFetchOnce(200, { hello: "world" });

  const result = await apiRequest("/anything");

  expect(result).toEqual({ hello: "world" });
});

test("apiRequest throws ApiError with the parsed detail on a non-2xx JSON response", async () => {
  mockFetchOnce(404, { detail: "not found" });

  await expect(apiRequest("/anything")).rejects.toMatchObject({ status: 404, detail: "not found" });
});

test("apiRequest returns undefined for a 204 No Content response, without calling response.json()", async () => {
  mockFetchOnce(204, undefined);

  await expect(apiRequest("/anything", { method: "DELETE" })).resolves.toBeUndefined();
});

test("apiRequest throws ApiError for a non-ok 204-like empty response", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 204 }) as unknown as typeof fetch;

  await expect(apiRequest("/anything")).rejects.toBeInstanceOf(ApiError);
});
