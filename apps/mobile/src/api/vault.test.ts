import { createVaultEntry, listVaultEntries, getVaultEntry, updateVaultEntry, deleteVaultEntry } from "./vault";
import { ApiError } from "./client";

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
      if (body === undefined) throw new SyntaxError("no body");
      return body;
    },
  }) as unknown as typeof fetch;
}

const ENTRY = { id: 1, ciphertext: "ct", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };

test("createVaultEntry POSTs to /vault with the bearer token and ciphertext body", async () => {
  mockFetchOnce(201, ENTRY);

  const result = await createVaultEntry("tok", "ct");

  expect(result).toEqual(ENTRY);
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/vault");
  expect(options.method).toBe("POST");
  expect(options.headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(options.body)).toEqual({ ciphertext: "ct" });
});

test("listVaultEntries GETs /vault and returns the array", async () => {
  mockFetchOnce(200, [ENTRY]);

  const result = await listVaultEntries("tok");

  expect(result).toEqual([ENTRY]);
});

test("getVaultEntry GETs /vault/{id}", async () => {
  mockFetchOnce(200, ENTRY);

  const result = await getVaultEntry("tok", "1");

  expect(result).toEqual(ENTRY);
  const [url] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/vault/1");
});

test("getVaultEntry throws ApiError with status 404 when the entry doesn't exist", async () => {
  mockFetchOnce(404, { detail: "Vault entry not found" });

  await expect(getVaultEntry("tok", "999")).rejects.toMatchObject({ status: 404 });
});

test("updateVaultEntry PUTs /vault/{id} with the new ciphertext", async () => {
  mockFetchOnce(200, ENTRY);

  await updateVaultEntry("tok", "1", "ct-new");

  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/vault/1");
  expect(options.method).toBe("PUT");
  expect(JSON.parse(options.body)).toEqual({ ciphertext: "ct-new" });
});

test("deleteVaultEntry DELETEs /vault/{id} and resolves to undefined on 204", async () => {
  mockFetchOnce(204, undefined);

  await expect(deleteVaultEntry("tok", "1")).resolves.toBeUndefined();
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/vault/1");
  expect(options.method).toBe("DELETE");
});

test("deleteVaultEntry throws ApiError instance on failure", async () => {
  mockFetchOnce(404, { detail: "Vault entry not found" });

  await expect(deleteVaultEntry("tok", "999")).rejects.toBeInstanceOf(ApiError);
});
