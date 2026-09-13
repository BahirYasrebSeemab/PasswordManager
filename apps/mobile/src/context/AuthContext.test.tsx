import { render, screen, waitFor, act } from "@testing-library/react-native";
import { Text, AppState } from "react-native";
import { AuthProvider, useAuth } from "./AuthContext";
import * as authApi from "@/api/auth";
import * as session from "./session";

// NOTE: deviates from the brief's `jest.mock("react-native", () => ({
// ...jest.requireActual("react-native"), AppState: {...} }))` factory.
// That factory crashes in THIS repo: react-native's index.js exposes each
// export (View, Text, Button, ...) as a lazy getter, and object-spreading
// `jest.requireActual("react-native")` eagerly invokes every one of those
// getters. That drags in Button -> Text -> Pressability -> RN's own
// jest-preset mockComponent helper, which (only in this project, because of
// the nativewind/react-native-css-interop Babel transform on every
// react-native import) re-enters itself circularly and crashes with
// "Cannot read properties of undefined (reading 'Component')" before any
// test runs. Verified in isolation: the identical factory crashes even in a
// standalone test file with no other imports, so this is a tooling
// incompatibility, not a mistake in the brief's AuthContext.tsx logic.
//
// jest.spyOn(AppState, "addEventListener") achieves the exact same test
// capability (stub the listener, capture it, control what "event" it
// receives) without spreading/eagerly-evaluating the rest of the
// react-native module, so it sidesteps the crash entirely. Everything else
// about the two new tests below is unchanged from the brief.
jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }));

// Keep the REAL ApiError class (re-exported by @/api/auth from ./client)
// rather than letting automock replace it with a no-op mock constructor.
// AuthContext.tsx does `err instanceof ApiError` against this same mocked
// module, so the class identity has to be the real one for that check to
// mean anything in tests below that construct ApiError instances.
jest.mock("@/api/auth", () => {
  const actual = jest.requireActual("@/api/auth");
  return {
    ...actual,
    register: jest.fn(),
    login: jest.fn(),
    getMe: jest.fn(),
  };
});
jest.mock("./session");
jest.mock("@/crypto/deriveKeys", () => ({
  deriveKeys: jest.fn(() => ({
    vaultKey: new Uint8Array(32).fill(1),
    authKey: new Uint8Array(32).fill(2),
  })),
}));

function Probe() {
  const auth = useAuth();
  return (
    <>
      <Text testID="status">{auth.status}</Text>
      <Text testID="email">{auth.user?.email ?? ""}</Text>
    </>
  );
}

beforeEach(() => {
  // NOTE: jest.resetAllMocks() would also strip the implementation set
  // inside the jest.mock("@/crypto/deriveKeys", factory) call above (Jest's
  // mockReset() clears a mock's implementation regardless of whether that
  // implementation came from a per-test .mockResolvedValue() call or from
  // the factory that created the mock in the first place). That leaves
  // deriveKeys() returning undefined on every test after the first,
  // breaking register()/login(). jest.clearAllMocks() clears call history
  // (mock.calls / mock.results) without touching implementations, and each
  // test below re-arms the authApi/session mocks it needs explicitly, so
  // this is the correct, safe choice here.
  jest.clearAllMocks();
});

test("starts in 'locked' status when no stored session exists", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);

  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
});

test("register() derives keys, calls the API, saves the session, and reaches 'unlocked'", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));

  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });

  expect(session.saveSession).toHaveBeenCalled();
  expect(screen.getByTestId("status").props.children).toBe("unlocked");
  expect(screen.getByTestId("email").props.children).toBe("test@example.com");
});

test("register() exposes the returned access token via accessToken", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok-abc", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));

  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });

  expect(auth!.accessToken).toBe("tok-abc");
});

test("logout() clears accessToken back to null", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok-abc", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);
  (session.clearSession as jest.Mock).mockResolvedValue(undefined);

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });
  expect(auth!.accessToken).toBe("tok-abc");

  await act(async () => {
    await auth!.logout();
  });

  expect(auth!.accessToken).toBeNull();
});

test("unlockWithStoredSession() takes the optimistic fast path when the cached token is still valid", async () => {
  const storedVaultKey = new Uint8Array(32).fill(9);
  const storedAuthKey = new Uint8Array(32).fill(8);
  (session.loadSession as jest.Mock).mockResolvedValue({
    vaultKey: storedVaultKey,
    authKey: storedAuthKey,
    accessToken: "still-good-token",
    email: "cached@example.com",
  });
  // getMe succeeds on the very first call — /auth/login must never be hit,
  // since it's the endpoint with the 5/minute backend rate limit.
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "cached@example.com" });

  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));
  expect(authApi.getMe).toHaveBeenCalledWith("still-good-token");
  expect(authApi.login).not.toHaveBeenCalled();
});

test("unlockWithStoredSession() falls back to a full login when the cached token is rejected with 401", async () => {
  const storedVaultKey = new Uint8Array(32).fill(9);
  const storedAuthKey = new Uint8Array(32).fill(8);
  (session.loadSession as jest.Mock).mockResolvedValue({
    vaultKey: storedVaultKey,
    authKey: storedAuthKey,
    accessToken: "stale-token",
    email: "cached@example.com",
  });
  (authApi.getMe as jest.Mock)
    .mockRejectedValueOnce(new authApi.ApiError(401, "expired"))
    .mockResolvedValueOnce({ id: 1, email: "cached@example.com" });
  (authApi.login as jest.Mock).mockResolvedValue({ access_token: "fresh-token", token_type: "bearer" });
  (session.updateAccessToken as jest.Mock).mockResolvedValue(undefined);

  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));
  expect(authApi.login).toHaveBeenCalledWith("cached@example.com", storedAuthKey);
  expect(session.updateAccessToken).toHaveBeenCalledWith("fresh-token");
  expect(authApi.getMe).toHaveBeenCalledTimes(2);
  expect(authApi.getMe).toHaveBeenNthCalledWith(2, "fresh-token");
});

test("unlockWithStoredSession() routes to 'locked' (not stuck on 'loading') when the refresh fails", async () => {
  const storedVaultKey = new Uint8Array(32).fill(9);
  const storedAuthKey = new Uint8Array(32).fill(8);
  (session.loadSession as jest.Mock).mockResolvedValue({
    vaultKey: storedVaultKey,
    authKey: storedAuthKey,
    accessToken: "stale-token",
    email: "cached@example.com",
  });
  // A non-401 failure on the cached token must NOT trigger the login
  // fallback — it should fall straight through to "locked".
  (authApi.getMe as jest.Mock).mockRejectedValue(new authApi.ApiError(500, "server error"));

  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  expect(screen.getByTestId("status").props.children).not.toBe("loading");
  expect(authApi.login).not.toHaveBeenCalled();
});

test("logout() clears the stored session and returns to 'locked'", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);
  (session.clearSession as jest.Mock).mockResolvedValue(undefined);

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));

  await act(async () => {
    await auth!.logout();
  });

  expect(session.clearSession).toHaveBeenCalled();
  expect(screen.getByTestId("status").props.children).toBe("locked");
});

test("auto-lock: backgrounding for >= 30s and returning to active clears vaultKey and locks", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);

  let capturedListener: ((state: string) => void) | undefined;
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, listener) => {
    capturedListener = listener;
    return { remove: jest.fn() };
  });

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));

  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  const now = Date.now();
  jest.setSystemTime(now);
  // NOTE: deviates from the brief's synchronous `act(() => {...})` here.
  // In this repo's React 19 + react-test-renderer + jest fake-timers
  // combination, a synchronous act() does not flush the setState calls
  // made inside handleAppStateChange when fake timers are active — verified
  // by instrumenting AuthContext.tsx directly: the "active" branch runs and
  // computes elapsed=31000 correctly, but the component never re-renders,
  // so screen.getByTestId("status") still reads the pre-transition value.
  // Making act() async (`await act(async () => {...})`) lets React's
  // scheduler flush via the real (unfaked) microtask queue, and the update
  // is applied. This changes nothing about what's being tested.
  await act(async () => {
    capturedListener!("background");
  });
  jest.setSystemTime(now + 31_000);
  await act(async () => {
    capturedListener!("active");
  });
  jest.useRealTimers();

  expect(screen.getByTestId("status").props.children).toBe("locked");
  expect(auth!.vaultKey).toBeNull();
  expect(auth!.accessToken).toBeNull();
  expect(auth!.user).toBeNull();
});

test("auto-lock: backgrounding for < 30s and returning to active stays unlocked", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);

  let capturedListener: ((state: string) => void) | undefined;
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, listener) => {
    capturedListener = listener;
    return { remove: jest.fn() };
  });

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));

  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  const now = Date.now();
  jest.setSystemTime(now);
  // See the async-act note in the >= 30s test above — same reasoning
  // applies here for consistency, even though this path makes no state
  // change to flush.
  await act(async () => {
    capturedListener!("background");
  });
  jest.setSystemTime(now + 5_000);
  await act(async () => {
    capturedListener!("active");
  });
  jest.useRealTimers();

  expect(screen.getByTestId("status").props.children).toBe("unlocked");
  expect(auth!.vaultKey).not.toBeNull();
});

test("auto-lock: backgrounding for EXACTLY 30s and returning to active locks (boundary)", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);

  let capturedListener: ((state: string) => void) | undefined;
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, listener) => {
    capturedListener = listener;
    return { remove: jest.fn() };
  });

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));

  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  const now = Date.now();
  jest.setSystemTime(now);
  // See the async-act note on the >= 30s test above — same reasoning
  // applies here (state set inside handleAppStateChange needs the real
  // microtask queue to flush under fake timers in this repo).
  await act(async () => {
    capturedListener!("background");
  });
  jest.setSystemTime(now + 30_000);
  await act(async () => {
    capturedListener!("active");
  });
  jest.useRealTimers();

  expect(screen.getByTestId("status").props.children).toBe("locked");
});
