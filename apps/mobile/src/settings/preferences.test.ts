import * as SecureStore from "expo-secure-store";
import { getBiometricEnabled, setBiometricEnabled, getAutoLockSeconds, setAutoLockSeconds } from "./preferences";

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
});

test("getBiometricEnabled defaults to true when nothing has been set", async () => {
  expect(await getBiometricEnabled()).toBe(true);
});

test("setBiometricEnabled then getBiometricEnabled round-trips false", async () => {
  await setBiometricEnabled(false);
  expect(await getBiometricEnabled()).toBe(false);
});

test("setBiometricEnabled then getBiometricEnabled round-trips true after being set false", async () => {
  await setBiometricEnabled(false);
  await setBiometricEnabled(true);
  expect(await getBiometricEnabled()).toBe(true);
});

test("getAutoLockSeconds defaults to 30 when nothing has been set", async () => {
  expect(await getAutoLockSeconds()).toBe(30);
});

test("setAutoLockSeconds then getAutoLockSeconds round-trips the value", async () => {
  await setAutoLockSeconds(300);
  expect(await getAutoLockSeconds()).toBe(300);
});

test("preferences are stored WITHOUT requireAuthentication", async () => {
  await setBiometricEnabled(false);
  await setAutoLockSeconds(60);

  const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    const options = call[2];
    expect(options?.requireAuthentication).toBeUndefined();
  }
});
