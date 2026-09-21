import {
  createVaultEntry,
  deleteVaultEntry,
  getVaultEntry,
  listVaultEntries,
  updateVaultEntry,
} from "./vault";

beforeEach(() => vi.stubEnv("VITE_API_URL", "https://api.test"));
afterEach(() => vi.unstubAllEnvs());

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

test("createVaultEntry posts ciphertext with the bearer token", async () => {
  const fn = mockFetch(200, { id: 1 });
  await createVaultEntry("tok", "cipher");
  expect(fn.mock.calls[0][0]).toBe("https://api.test/vault");
  expect(fn.mock.calls[0][1].method).toBe("POST");
  expect(fn.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ ciphertext: "cipher" });
});

test("listVaultEntries and getVaultEntry hit the right paths", async () => {
  const fn = mockFetch(200, []);
  await listVaultEntries("tok");
  await getVaultEntry("tok", "5");
  expect(fn.mock.calls[0][0]).toBe("https://api.test/vault");
  expect(fn.mock.calls[1][0]).toBe("https://api.test/vault/5");
});

test("updateVaultEntry puts ciphertext to the entry path", async () => {
  const fn = mockFetch(200, { id: 5 });
  await updateVaultEntry("tok", "5", "new");
  expect(fn.mock.calls[0][0]).toBe("https://api.test/vault/5");
  expect(fn.mock.calls[0][1].method).toBe("PUT");
  expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ ciphertext: "new" });
});

test("deleteVaultEntry resolves to undefined on 204", async () => {
  const fn = mockFetch(204);
  await expect(deleteVaultEntry("tok", "5")).resolves.toBeUndefined();
  expect(fn.mock.calls[0][1].method).toBe("DELETE");
});
