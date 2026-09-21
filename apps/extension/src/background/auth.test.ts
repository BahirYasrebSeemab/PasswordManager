import { ApiError } from "../api/client";
import { createMemoryStore } from "../testing/memoryStore";
import { performLogin } from "./auth";
import { loadSession } from "./session";

vi.mock("../crypto/deriveKeys", () => ({
  deriveKeys: vi.fn(() => ({ vaultKey: new Uint8Array(32).fill(9), authKey: new Uint8Array(32).fill(8) })),
}));

function deps(loginImpl: (email: string, authKey: Uint8Array) => Promise<{ access_token: string; token_type: string }>) {
  const store = createMemoryStore();
  return { store, deps: { store, now: () => 123, login: vi.fn(loginImpl) } };
}

test("a successful login stores the session and returns ok", async () => {
  const { store, deps: d } = deps(async () => ({ access_token: "tok", token_type: "bearer" }));
  await expect(performLogin(d, "  Me@Example.com ", "pw")).resolves.toEqual({ ok: true });
  expect(d.login).toHaveBeenCalledWith("me@example.com", new Uint8Array(32).fill(8));
  const session = await loadSession(store);
  expect(session).toMatchObject({ email: "me@example.com", accessToken: "tok", lastActivityAt: 123 });
});

test("invalid input never reaches key derivation or the network", async () => {
  const { deps: d } = deps(async () => ({ access_token: "x", token_type: "bearer" }));
  await expect(performLogin(d, "not-an-email", "pw")).resolves.toEqual({ ok: false, error: "invalid_input" });
  expect(d.login).not.toHaveBeenCalled();
});

test("a 401 maps to invalid_credentials and stores nothing", async () => {
  const { store, deps: d } = deps(async () => {
    throw new ApiError(401, "Incorrect");
  });
  await expect(performLogin(d, "me@example.com", "pw")).resolves.toEqual({
    ok: false,
    error: "invalid_credentials",
  });
  expect(await loadSession(store)).toBeNull();
});

test("a 429 maps to rate_limited and other failures to network", async () => {
  const limited = deps(async () => {
    throw new ApiError(429, "slow down");
  });
  await expect(performLogin(limited.deps, "me@example.com", "pw")).resolves.toEqual({
    ok: false,
    error: "rate_limited",
  });
  const down = deps(async () => {
    throw new TypeError("fetch failed");
  });
  await expect(performLogin(down.deps, "me@example.com", "pw")).resolves.toEqual({
    ok: false,
    error: "network",
  });
});
