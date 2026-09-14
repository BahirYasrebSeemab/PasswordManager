import * as SecureStore from "expo-secure-store";
import { saveSession, loadSession, updateAccessToken, clearSession, shouldPersistSession } from "./session";

jest.mock("expo-secure-store");

const mockedStore = new Map<string, string>();

beforeEach(() => {
  jest.clearAllMocks();
  mockedStore.clear();
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    mockedStore.set(key, value);
  });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    return mockedStore.get(key) ?? null;
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    mockedStore.delete(key);
  });
});

const VAULT_KEY = new Uint8Array(32).fill(1);
const AUTH_KEY = new Uint8Array(32).fill(2);

test("loadSession returns null when nothing has been saved yet", async () => {
  expect(await loadSession()).toBeNull();
});

test("saveSession then loadSession round-trips vaultKey, authKey, accessToken, and email", async () => {
  await saveSession({ vaultKey: VAULT_KEY, authKey: AUTH_KEY, accessToken: "token-1", email: "test@example.com" });

  const loaded = await loadSession();

  expect(loaded).not.toBeNull();
  expect(Buffer.from(loaded!.vaultKey).equals(Buffer.from(VAULT_KEY))).toBe(true);
  expect(Buffer.from(loaded!.authKey).equals(Buffer.from(AUTH_KEY))).toBe(true);
  expect(loaded!.accessToken).toBe("token-1");
  expect(loaded!.email).toBe("test@example.com");
});

test("saveSession requires biometric authentication on every stored key", async () => {
  await saveSession({ vaultKey: VAULT_KEY, authKey: AUTH_KEY, accessToken: "token-1", email: "test@example.com" });

  const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls;
  expect(calls.length).toBe(4);
  for (const [, , options] of calls) {
    expect(options.requireAuthentication).toBe(true);
  }
});

test("updateAccessToken replaces only the access token, leaving the keys intact", async () => {
  await saveSession({ vaultKey: VAULT_KEY, authKey: AUTH_KEY, accessToken: "old-token", email: "test@example.com" });

  await updateAccessToken("new-token");
  const loaded = await loadSession();

  expect(loaded!.accessToken).toBe("new-token");
  expect(Buffer.from(loaded!.vaultKey).equals(Buffer.from(VAULT_KEY))).toBe(true);
});

test("clearSession removes all stored values", async () => {
  await saveSession({ vaultKey: VAULT_KEY, authKey: AUTH_KEY, accessToken: "token-1", email: "test@example.com" });

  await clearSession();

  expect(await loadSession()).toBeNull();
});

// NOTE: deviates from the brief's `const { shouldPersistSession } = await
// import("./session")`. That crashes in THIS repo with "TypeError: A dynamic
// import callback was invoked without --experimental-vm-modules" — verified
// in isolation, unrelated to whether shouldPersistSession is exported.
// babel-preset-expo (this project's babel config) doesn't transform
// import() to a require()-based interop for Jest's CJS runtime, and Jest
// itself only supports native dynamic import under --experimental-vm-modules
// (which this project's jest config does not enable). The module is already
// statically imported above, so asserting on that binding exercises the same
// "is exported and callable" behavior without the incompatible dynamic
// import. Same class of tooling deviation as the AppState.addEventListener
// note near the top of AuthContext.test.tsx.
test("shouldPersistSession is exported and callable", async () => {
  expect(typeof shouldPersistSession).toBe("function");
});
