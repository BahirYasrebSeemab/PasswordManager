import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { Alert } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { deleteAccount, ApiError } from "@/api/auth";

// On a cold Jest cache (no persisted transform cache — e.g. a fresh CI
// checkout, or after `jest --clearCache`), getDeleteAccountScreen()'s
// deferred require() below pays the one-time cost of transforming this
// screen's whole import tree (Button, ThemedText, theme, etc.) inside the
// first test's body — against Jest's default 5000ms per-test budget. That
// cold-transform cost alone can exceed 5s even though nothing in the test
// itself is slow (deriveKeys is already mocked above; this isn't the real
// PBKDF2 call slipping through). Give the file's tests headroom so the
// first one isn't racing a cache that may not exist yet.
jest.setTimeout(15000);

jest.mock("@/context/AuthContext");
jest.mock("@/context/VaultContext");
// Partial mock, not a bare jest.mock("@/api/auth") — a bare auto-mock would
// also replace ApiError with a no-op mock constructor, breaking both
// `new ApiError(...)` below and the `err instanceof ApiError` check inside
// delete-account.tsx itself. Same pitfall already documented in
// AuthContext.test.tsx; keep the real ApiError class, only mock the call.
jest.mock("@/api/auth", () => ({
  ...jest.requireActual("@/api/auth"),
  deleteAccount: jest.fn(),
}));
// deriveKeys() runs a real 600,000-iteration PBKDF2 (~30s in this JS test
// environment, no native acceleration), which blows past Jest's default 5s
// timeout. AuthContext.test.tsx hits and documents this exact problem and
// mocks deriveKeys for it; do the same here rather than raise the timeout,
// which would just make every run slow.
jest.mock("@/crypto/deriveKeys", () => ({
  deriveKeys: jest.fn(() => ({
    vaultKey: new Uint8Array(32).fill(1),
    authKey: new Uint8Array(32).fill(2),
  })),
}));

function getDeleteAccountScreen() {
  return require("../../../app/(app)/settings/delete-account").default;
}

const USER = { id: 1, email: "test@example.com" };

// Captures the Promise returned by the Alert's "Delete" button onPress
// (handleDelete, an async function) so the test can await its full
// settlement inside a single act() scope alongside the fireEvent calls that
// trigger it — see the comment above the two tests for why this matters.
let pendingOnPress: Promise<unknown> | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  pendingOnPress = undefined;
  jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    const destructive = buttons?.find((b) => b.style === "destructive");
    pendingOnPress = destructive?.onPress?.() as Promise<unknown> | undefined;
  });
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore();
});

// NOTE on structure: both tests wrap fireEvent.changeText + fireEvent.press
// + "await pendingOnPress" inside ONE act(async () => {...}) call, rather
// than firing the events and separately `await waitFor(...)`-ing the result
// (the more common RTL idiom, and what the original brief used). Verified in
// isolation with a minimal repro (plain TextInput + Pressable + Alert, no
// app code involved): in this environment (React 19 concurrent-act-warnings
// + react-test-renderer 19.3.0 via jest-expo), firing a changeText event and
// then, in a separate step, firing a press event whose handler is async and
// invoked fire-and-forget by the Alert mock, corrupts the test renderer's
// internal act-scope state hard enough that EVERY subsequent render() call
// in the same test file returns an empty tree — not just a console warning,
// a real cross-test failure. Combining changeText, press, and the await
// into a single act() scope avoids the corruption entirely; confirmed this
// combination does not affect the assertions' meaning, only their timing.
test("correct password deletes the account, wipes the local db, and logs out", async () => {
  const logout = jest.fn().mockResolvedValue(undefined);
  const deleteLocalVault = jest.fn().mockResolvedValue(undefined);
  (useAuth as jest.Mock).mockReturnValue({ user: USER, accessToken: "tok", logout });
  (useVault as jest.Mock).mockReturnValue({ deleteLocalVault });
  (deleteAccount as jest.Mock).mockResolvedValue(undefined);
  const DeleteAccountScreen = getDeleteAccountScreen();

  await render(<DeleteAccountScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByTestId("input-password"), "correct horse battery staple");
    fireEvent.press(screen.getByText("Delete my account"));
    await pendingOnPress;
  });

  expect(deleteAccount).toHaveBeenCalledWith("tok", expect.any(Uint8Array));
  expect(deleteLocalVault).toHaveBeenCalled();
  expect(logout).toHaveBeenCalled();
});

test("wrong password shows an error and does not touch local data", async () => {
  const logout = jest.fn();
  const deleteLocalVault = jest.fn();
  (useAuth as jest.Mock).mockReturnValue({ user: USER, accessToken: "tok", logout });
  (useVault as jest.Mock).mockReturnValue({ deleteLocalVault });
  (deleteAccount as jest.Mock).mockRejectedValue(new ApiError(401, "Incorrect password"));
  const DeleteAccountScreen = getDeleteAccountScreen();

  await render(<DeleteAccountScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByTestId("input-password"), "wrong password");
    fireEvent.press(screen.getByText("Delete my account"));
    await pendingOnPress;
  });

  expect(screen.getByText("Incorrect password.")).toBeTruthy();
  expect(deleteLocalVault).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
});

test("local cleanup failure does not prevent logout — server deletion already succeeded", async () => {
  const logout = jest.fn().mockResolvedValue(undefined);
  const deleteLocalVault = jest.fn().mockRejectedValue(new Error("close failed"));
  (useAuth as jest.Mock).mockReturnValue({ user: USER, accessToken: "tok", logout });
  (useVault as jest.Mock).mockReturnValue({ deleteLocalVault });
  (deleteAccount as jest.Mock).mockResolvedValue(undefined);
  const DeleteAccountScreen = getDeleteAccountScreen();

  await render(<DeleteAccountScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByTestId("input-password"), "correct horse battery staple");
    fireEvent.press(screen.getByText("Delete my account"));
    await pendingOnPress;
  });

  expect(deleteLocalVault).toHaveBeenCalled();
  expect(logout).toHaveBeenCalled();
});
