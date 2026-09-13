import { createTestDatabase } from "./testUtils";
import { initDatabase } from "./schema";

test("initDatabase creates both tables and they accept inserts", async () => {
  const db = createTestDatabase();

  await initDatabase(db);

  await db.runAsync(
    "INSERT INTO vault_entries_cache (id, ciphertext, updated_at, base_updated_at, sync_status, conflict_ciphertext) VALUES (?, ?, ?, ?, ?, ?)",
    ["1", "ct", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "synced", null]
  );
  await db.runAsync(
    "INSERT INTO pending_operations (entry_id, op, payload, created_at) VALUES (?, ?, ?, ?)",
    ["1", "create", "ct", "2026-01-01T00:00:00Z"]
  );

  const entries = await db.getAllAsync("SELECT * FROM vault_entries_cache");
  const ops = await db.getAllAsync("SELECT * FROM pending_operations");
  expect(entries).toHaveLength(1);
  expect(ops).toHaveLength(1);
});

test("initDatabase is idempotent (safe to call twice)", async () => {
  const db = createTestDatabase();

  await initDatabase(db);
  await expect(initDatabase(db)).resolves.toBeUndefined();
});
