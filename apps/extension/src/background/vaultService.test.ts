import { ApiError } from "../api/client";
import { decryptEntry, encryptEntry } from "../crypto/cipher";
import type { VaultEntryContent } from "../vault/entry";
import type { Session } from "./session";
import { createVaultService } from "./vaultService";

const vaultKey = new Uint8Array(32).fill(3);
const session: Session = {
  email: "me@example.com",
  vaultKey,
  authKey: new Uint8Array(32).fill(4),
  accessToken: "tok1",
  lastActivityAt: 0,
};

const seal = (content: VaultEntryContent) => encryptEntry(vaultKey, JSON.stringify(content));
const row = (id: number, content: VaultEntryContent) => ({
  id,
  ciphertext: seal(content),
  created_at: "",
  updated_at: "",
});

const rows = [
  row(2, { title: "Zed", username: "z", password: "zp", url: "https://zed.com", notes: "keep me" }),
  row(1, { title: "alpha", username: "a", password: "ap", url: "https://example.com" }),
];

function setup(overrides: Partial<Parameters<typeof createVaultService>[0]["api"]> = {}, current: Session | null = session) {
  const base = {
    login: vi.fn().mockResolvedValue({ access_token: "tok2", token_type: "bearer" }),
    list: vi.fn().mockImplementation(async () => rows),
    get: vi.fn().mockImplementation(async (_t: string, id: string) => rows.find((r) => String(r.id) === id)),
    create: vi.fn().mockResolvedValue({ id: 9 }),
    update: vi.fn().mockResolvedValue({ id: 1 }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  // Cast keeps the vi.fn mock types (overrides widen each field to fn | Mock) so tests can read .mock.calls.
  const api = { ...base, ...overrides } as typeof base;
  const deps = {
    getSession: vi.fn().mockResolvedValue(current),
    replaceSession: vi.fn().mockResolvedValue(undefined),
    lock: vi.fn().mockResolvedValue(undefined),
    api,
  };
  return { service: createVaultService(deps as never), deps, api };
}

test("returns locked when there is no active session, without calling the API", async () => {
  const { service, api } = setup({}, null);
  expect(await service.listEntries()).toEqual({ ok: false, error: "locked" });
  expect(api.list).not.toHaveBeenCalled();
});

test("listEntries decrypts, sorts by title case-insensitively, and skips undecryptable rows", async () => {
  const { service } = setup({
    list: vi.fn().mockResolvedValue([...rows, { id: 3, ciphertext: "AAAA", created_at: "", updated_at: "" }]),
  });
  const result = await service.listEntries();
  expect(result.ok && result.entries.map((e) => e.title)).toEqual(["alpha", "Zed"]);
  expect(result.ok && result.entries[0]).not.toHaveProperty("password");
});

test("on a 401 it re-logs-in once with the retained authKey, stores the new token, and retries", async () => {
  const list = vi.fn().mockRejectedValueOnce(new ApiError(401, "expired")).mockResolvedValueOnce(rows);
  const { service, deps, api } = setup({ list });
  const result = await service.listEntries();
  expect(result.ok).toBe(true);
  expect(api.login).toHaveBeenCalledWith("me@example.com", session.authKey);
  expect(deps.replaceSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "tok2" }));
  expect(list).toHaveBeenLastCalledWith("tok2");
});

test("if the re-login is also rejected it locks and reports locked", async () => {
  const { service, deps } = setup({
    list: vi.fn().mockRejectedValue(new ApiError(401, "expired")),
    login: vi.fn().mockRejectedValue(new ApiError(401, "bad")),
  });
  expect(await service.listEntries()).toEqual({ ok: false, error: "locked" });
  expect(deps.lock).toHaveBeenCalled();
});

test("network failures and 404s map to error codes", async () => {
  const down = setup({ list: vi.fn().mockRejectedValue(new TypeError("fetch failed")) });
  expect(await down.service.listEntries()).toEqual({ ok: false, error: "network" });
  const missing = setup({ get: vi.fn().mockRejectedValue(new ApiError(404, "nope")) });
  expect(await missing.service.getEntry(5)).toEqual({ ok: false, error: "not_found" });
});

test("getEntry returns the decrypted content", async () => {
  const { service } = setup();
  const result = await service.getEntry(1);
  expect(result).toEqual({ ok: true, entry: expect.objectContaining({ title: "alpha", password: "ap" }) });
});

test("updateEntry validates first, then encrypts and sends", async () => {
  const { service, api } = setup();
  expect(await service.updateEntry(1, { title: "", password: "p" })).toEqual({ ok: false, error: "invalid_input" });
  expect(api.update).not.toHaveBeenCalled();

  expect(await service.updateEntry(1, { title: "New", password: "np" })).toEqual({ ok: true });
  const [, id, ciphertext] = api.update.mock.calls[0];
  expect(id).toBe("1");
  expect(JSON.parse(decryptEntry(vaultKey, ciphertext))).toEqual({ title: "New", password: "np" });
});

test("deleteEntry calls the API with the string id", async () => {
  const { service, api } = setup();
  expect(await service.deleteEntry(2)).toEqual({ ok: true });
  expect(api.remove).toHaveBeenCalledWith("tok1", "2");
});

test("findMatches returns only summaries for entries matching the page, with no passwords", async () => {
  const { service } = setup();
  const result = await service.findMatches("https://www.example.com/login");
  expect(result).toEqual({ ok: true, matches: [{ id: 1, title: "alpha", username: "a" }] });
});

test("getCredentialForFill refuses an entry that does not match the page's site", async () => {
  const { service } = setup();
  expect(await service.getCredentialForFill(1, "https://evil.com/")).toEqual({ ok: false, error: "forbidden" });
  expect(await service.getCredentialForFill(1, "https://example.com/")).toEqual({
    ok: true,
    username: "a",
    password: "ap",
  });
});

test("evaluateSubmission decides save / update / none and rejects oversized input", async () => {
  const { service } = setup();
  const page = "https://example.com/login";
  expect(await service.evaluateSubmission(page, "new-user", "pw")).toEqual({ ok: true, decision: { kind: "save" } });
  expect(await service.evaluateSubmission(page, "a", "changed")).toEqual({ ok: true, decision: { kind: "update", id: 1 } });
  expect(await service.evaluateSubmission(page, "a", "ap")).toEqual({ ok: true, decision: { kind: "none" } });
  expect(await service.evaluateSubmission(page, "a", "x".repeat(2000))).toEqual({ ok: false, error: "invalid_input" });
});

test("saveNew creates an encrypted entry titled by hostname with the origin as url", async () => {
  const { service, api } = setup();
  expect(await service.saveNew("https://www.newsite.com/login", "me", "pw")).toEqual({ ok: true });
  const ciphertext = api.create.mock.calls[0][1];
  expect(JSON.parse(decryptEntry(vaultKey, ciphertext))).toEqual({
    title: "newsite.com",
    username: "me",
    password: "pw",
    url: "https://www.newsite.com",
  });
});

test("saveUpdate changes only the password and preserves title, url, and notes", async () => {
  const { service, api } = setup();
  expect(await service.saveUpdate(2, "newpass")).toEqual({ ok: true });
  const [, id, ciphertext] = api.update.mock.calls[0];
  expect(id).toBe("2");
  expect(JSON.parse(decryptEntry(vaultKey, ciphertext))).toEqual({
    title: "Zed",
    username: "z",
    password: "newpass",
    url: "https://zed.com",
    notes: "keep me",
  });
});

test("evaluateSubmission refuses ineligible pages as forbidden without calling the API", async () => {
  const { service, api } = setup();
  expect(await service.evaluateSubmission("http://example.com/login", "a", "pw")).toEqual({ ok: false, error: "forbidden" });
  expect(await service.evaluateSubmission("about:blank", "a", "pw")).toEqual({ ok: false, error: "forbidden" });
  expect(api.list).not.toHaveBeenCalled();
});

test("saveNew refuses ineligible pages as forbidden without calling the API", async () => {
  const { service, api } = setup();
  expect(await service.saveNew("http://example.com/", "me", "pw")).toEqual({ ok: false, error: "forbidden" });
  expect(await service.saveNew("about:blank", "me", "pw")).toEqual({ ok: false, error: "forbidden" });
  expect(api.create).not.toHaveBeenCalled();
});

test("http://localhost is still an eligible page for evaluateSubmission", async () => {
  const { service } = setup();
  expect(await service.evaluateSubmission("http://localhost:3000/login", "me", "pw")).toEqual({
    ok: true,
    decision: { kind: "save" },
  });
});
