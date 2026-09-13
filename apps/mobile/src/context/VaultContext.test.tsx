import { render, screen, waitFor, act } from "@testing-library/react-native";
import { Text } from "react-native";
import { VaultProvider, useVault } from "./VaultContext";
import { useAuth } from "./AuthContext";
import { encryptEntry } from "@/crypto/cipher";

jest.mock("./AuthContext");
jest.mock("expo-sqlite");
jest.mock("@/sync/syncEngine");

import * as SQLite from "expo-sqlite";
import { sync as mockSync } from "@/sync/syncEngine";
import { createTestDatabase } from "@/db/testUtils";
import { initDatabase } from "@/db/schema";
import * as vaultCache from "@/db/vaultCache";

const VAULT_KEY = new Uint8Array(32).fill(3);

function Probe() {
  const { entries, isSyncing } = useVault();
  return (
    <>
      <Text testID="count">{entries.length}</Text>
      <Text testID="syncing">{String(isSyncing)}</Text>
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({
    vaultKey: VAULT_KEY,
    accessToken: "tok",
    status: "unlocked",
    user: { id: 1, email: "test@example.com" },
  });
  // expo-sqlite can't run under Jest (see plan Global Constraints); back
  // VaultProvider's openDatabaseAsync with the same real-SQLite test double
  // db/ and sync/ tests use.
  (SQLite.openDatabaseAsync as jest.Mock).mockImplementation(async () => createTestDatabase());
  (mockSync as jest.Mock).mockResolvedValue(undefined);
});

test("loads and decrypts cached entries on mount, and calls sync()", async () => {
  let auth: ReturnType<typeof useVault> | undefined;
  function Capture() {
    auth = useVault();
    return <Probe />;
  }

  await render(
    <VaultProvider>
      <Capture />
    </VaultProvider>
  );

  await waitFor(() => expect(mockSync).toHaveBeenCalled());
  expect(auth).toBeDefined();
});

test("createEntry encrypts the content, adds it to entries, and triggers a sync", async () => {
  let vault: ReturnType<typeof useVault> | undefined;
  function Capture() {
    vault = useVault();
    return <Probe />;
  }

  await render(
    <VaultProvider>
      <Capture />
    </VaultProvider>
  );
  await waitFor(() => expect(vault).toBeDefined());

  await act(async () => {
    await vault!.createEntry({ title: "GitHub", password: "hunter2" });
  });

  expect(vault!.entries).toHaveLength(1);
  expect(vault!.entries[0].content).toEqual({ title: "GitHub", password: "hunter2" });
  expect(vault!.entries[0].syncStatus).toBe("pending");
});

test("getConflict returns decrypted mine/theirs, resolveConflict('mine') clears it back to pending", async () => {
  let vault: ReturnType<typeof useVault> | undefined;
  function Capture() {
    vault = useVault();
    return <Probe />;
  }
  const db = createTestDatabase();
  (SQLite.openDatabaseAsync as jest.Mock).mockImplementation(async () => db);

  const mineCiphertext = encryptEntry(VAULT_KEY, JSON.stringify({ title: "Mine", password: "a" }));
  const theirsCiphertext = encryptEntry(VAULT_KEY, JSON.stringify({ title: "Theirs", password: "b" }));

  await initDatabase(db);
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: mineCiphertext,
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "conflict",
    conflictCiphertext: theirsCiphertext,
  });

  await render(
    <VaultProvider>
      <Capture />
    </VaultProvider>
  );
  await waitFor(() => expect(vault!.entries.some((e) => e.id === "1")).toBe(true));

  const conflict = vault!.getConflict("1");
  expect(conflict).toEqual({
    mine: { title: "Mine", password: "a" },
    theirs: { title: "Theirs", password: "b" },
  });

  await act(async () => {
    await vault!.resolveConflict("1", "mine");
  });

  const resolved = vault!.entries.find((e) => e.id === "1");
  expect(resolved?.syncStatus).toBe("pending");
  expect(resolved?.content).toEqual({ title: "Mine", password: "a" });
});
