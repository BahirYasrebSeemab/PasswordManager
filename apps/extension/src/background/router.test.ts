import { handleMessage, type RouterDeps } from "./router";

const extension = { extensionId: "ext@id", extensionOrigin: "moz-extension://abc/" };
const popup = { id: "ext@id", url: "moz-extension://abc/popup.html" };
const page = { id: "ext@id", url: "https://example.com/login", tab: { id: 7 } };
const otherOriginPage = { id: "ext@id", url: "https://different-site.com/", tab: { id: 7 } };

function makeDeps(overrides: Partial<RouterDeps> = {}) {
  const base = {
    extension,
    auth: {
      login: vi.fn().mockResolvedValue({ ok: true }),
      logout: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ locked: false, email: "me@example.com" }),
    },
    settings: {
      getAutoLockMinutes: vi.fn().mockResolvedValue(15),
      setAutoLockMinutes: vi.fn().mockResolvedValue(true),
    },
    vault: {
      listEntries: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
      getEntry: vi.fn(),
      updateEntry: vi.fn(),
      deleteEntry: vi.fn(),
      findMatches: vi.fn().mockResolvedValue({ ok: true, matches: [] }),
      getCredentialForFill: vi.fn(),
      evaluateSubmission: vi.fn(),
      saveNew: vi.fn().mockResolvedValue({ ok: true }),
      saveUpdate: vi.fn().mockResolvedValue({ ok: true }),
    },
    pending: {
      park: vi.fn().mockResolvedValue(undefined),
      peek: vi.fn().mockResolvedValue(null),
      discard: vi.fn().mockResolvedValue(undefined),
      clearAll: vi.fn().mockResolvedValue(undefined),
    },
    scheduleClipboardClear: vi.fn().mockResolvedValue(undefined),
  };
  // Typed against `base` so the vi.fn() mocks keep their mock methods (overrides only widen the type).
  return { ...base, ...overrides } as unknown as RouterDeps & typeof base;
}

test("malformed messages are rejected as invalid_input", async () => {
  expect(await handleMessage({ type: "nope" }, popup, makeDeps())).toEqual({ ok: false, error: "invalid_input" });
});

test("a message from the wrong kind of sender is forbidden and does nothing", async () => {
  const deps = makeDeps();
  const result = await handleMessage({ type: "listEntries" }, page, deps);
  expect(result).toEqual({ ok: false, error: "forbidden" });
  expect(deps.vault.listEntries).not.toHaveBeenCalled();
  expect(await handleMessage({ type: "findMatches" }, popup, deps)).toEqual({ ok: false, error: "forbidden" });
});

test("login and status are proxied to the auth service", async () => {
  const deps = makeDeps();
  await handleMessage({ type: "login", email: "a@b.co", masterPassword: "pw" }, popup, deps);
  expect(deps.auth.login).toHaveBeenCalledWith("a@b.co", "pw");
  expect(await handleMessage({ type: "getStatus" }, popup, deps)).toEqual({ locked: false, email: "me@example.com" });
});

test("logout locks and clears pending saves", async () => {
  const deps = makeDeps();
  expect(await handleMessage({ type: "logout" }, popup, deps)).toEqual({ ok: true });
  expect(deps.auth.logout).toHaveBeenCalled();
  expect(deps.pending.clearAll).toHaveBeenCalled();
});

test("settings messages read and write the auto-lock timeout, rejecting non-presets", async () => {
  const deps = makeDeps();
  expect(await handleMessage({ type: "getAutoLockMinutes" }, popup, deps)).toEqual({ minutes: 15 });
  expect(await handleMessage({ type: "setAutoLockMinutes", minutes: 30 }, popup, deps)).toEqual({ ok: true });
  deps.settings.setAutoLockMinutes.mockResolvedValue(false);
  expect(await handleMessage({ type: "setAutoLockMinutes", minutes: 7 }, popup, deps)).toEqual({
    ok: false,
    error: "invalid_input",
  });
});

test("scheduleClipboardClear asks the background to schedule the clear", async () => {
  const deps = makeDeps();
  expect(await handleMessage({ type: "scheduleClipboardClear" }, popup, deps)).toEqual({ ok: true });
  expect(deps.scheduleClipboardClear).toHaveBeenCalled();
});

test("findMatches and getCredentialForFill use the SENDER's url, never a value from the message", async () => {
  const deps = makeDeps();
  await handleMessage({ type: "findMatches", url: "https://attacker.com" }, page, deps);
  expect(deps.vault.findMatches).toHaveBeenCalledWith("https://example.com/login");
  await handleMessage({ type: "getCredentialForFill", id: 4 }, page, deps);
  expect(deps.vault.getCredentialForFill).toHaveBeenCalledWith(4, "https://example.com/login");
});

describe("credentialSubmitted", () => {
  const submit = { type: "credentialSubmitted", username: "me", password: "pw" };

  test("parks a candidate for the sender's tab when the decision is save or update", async () => {
    const deps = makeDeps();
    deps.vault.evaluateSubmission.mockResolvedValue({ ok: true, decision: { kind: "update", id: 3 } });
    expect(await handleMessage(submit, page, deps)).toEqual({ ok: true });
    expect(deps.pending.park).toHaveBeenCalledWith(7, {
      kind: "update",
      username: "me",
      password: "pw",
      pageUrl: "https://example.com/login",
      existingId: 3,
    });
  });

  test("parks a save candidate without an existingId", async () => {
    const deps = makeDeps();
    deps.vault.evaluateSubmission.mockResolvedValue({ ok: true, decision: { kind: "save" } });
    await handleMessage(submit, page, deps);
    expect(deps.pending.park).toHaveBeenCalledWith(7, {
      kind: "save",
      username: "me",
      password: "pw",
      pageUrl: "https://example.com/login",
    });
  });

  test("does not park when the credential is already saved, or when locked or offline", async () => {
    for (const evaluation of [
      { ok: true, decision: { kind: "none" } },
      { ok: false, error: "locked" },
      { ok: false, error: "network" },
    ]) {
      const deps = makeDeps();
      deps.vault.evaluateSubmission.mockResolvedValue(evaluation);
      expect(await handleMessage(submit, page, deps)).toEqual({ ok: true });
      expect(deps.pending.park).not.toHaveBeenCalled();
    }
  });

  test("an oversized credential is reported as invalid_input so the page can tell the user", async () => {
    const deps = makeDeps();
    deps.vault.evaluateSubmission.mockResolvedValue({ ok: false, error: "invalid_input" });
    expect(await handleMessage(submit, page, deps)).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("pending save", () => {
  const record = { kind: "save", username: "me", password: "SECRET", pageUrl: "https://example.com/login", createdAt: 0 };

  test("getPendingSave never returns the password", async () => {
    const deps = makeDeps();
    deps.pending.peek.mockResolvedValue(record);
    const result = await handleMessage({ type: "getPendingSave" }, page, deps);
    expect(result).toEqual({ pending: { kind: "save", username: "me", origin: "https://example.com" } });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test("getPendingSave returns null when nothing is parked", async () => {
    expect(await handleMessage({ type: "getPendingSave" }, page, makeDeps())).toEqual({ pending: null });
  });

  test("confirmSave saves a new entry and discards the record on success", async () => {
    const deps = makeDeps();
    deps.pending.peek.mockResolvedValue(record);
    expect(await handleMessage({ type: "confirmSave" }, page, deps)).toEqual({ ok: true });
    expect(deps.vault.saveNew).toHaveBeenCalledWith("https://example.com/login", "me", "SECRET");
    expect(deps.pending.discard).toHaveBeenCalledWith(7);
  });

  test("confirmSave updates an existing entry for an update record", async () => {
    const deps = makeDeps();
    deps.pending.peek.mockResolvedValue({ ...record, kind: "update", existingId: 3 });
    await handleMessage({ type: "confirmSave" }, page, deps);
    expect(deps.vault.saveUpdate).toHaveBeenCalledWith(3, "SECRET");
  });

  test("confirmSave keeps the record parked when saving fails so the user can retry", async () => {
    const deps = makeDeps();
    deps.pending.peek.mockResolvedValue(record);
    deps.vault.saveNew.mockResolvedValue({ ok: false, error: "network" });
    expect(await handleMessage({ type: "confirmSave" }, page, deps)).toEqual({ ok: false, error: "network" });
    expect(deps.pending.discard).not.toHaveBeenCalled();
  });

  test("confirmSave with nothing parked is not_found; dismissSave discards", async () => {
    const deps = makeDeps();
    expect(await handleMessage({ type: "confirmSave" }, page, deps)).toEqual({ ok: false, error: "not_found" });
    expect(await handleMessage({ type: "dismissSave" }, page, deps)).toEqual({ ok: true });
    expect(deps.pending.discard).toHaveBeenCalledWith(7);
  });

  describe("cross-origin same-tab navigation must not leak or clear another origin's record", () => {
    test("getPendingSave returns null for a sender whose origin doesn't match the record's", async () => {
      const deps = makeDeps();
      deps.pending.peek.mockResolvedValue(record);
      expect(await handleMessage({ type: "getPendingSave" }, otherOriginPage, deps)).toEqual({ pending: null });
    });

    test("getPendingSave still returns the record for a matching-origin sender", async () => {
      const deps = makeDeps();
      deps.pending.peek.mockResolvedValue(record);
      expect(await handleMessage({ type: "getPendingSave" }, page, deps)).toEqual({
        pending: { kind: "save", username: "me", origin: "https://example.com" },
      });
    });

    test("confirmSave is not_found for a mismatched origin and does not save or discard", async () => {
      const deps = makeDeps();
      deps.pending.peek.mockResolvedValue(record);
      expect(await handleMessage({ type: "confirmSave" }, otherOriginPage, deps)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(deps.vault.saveNew).not.toHaveBeenCalled();
      expect(deps.vault.saveUpdate).not.toHaveBeenCalled();
      expect(deps.pending.discard).not.toHaveBeenCalled();
    });

    test("confirmSave still saves for a matching-origin sender", async () => {
      const deps = makeDeps();
      deps.pending.peek.mockResolvedValue(record);
      expect(await handleMessage({ type: "confirmSave" }, page, deps)).toEqual({ ok: true });
      expect(deps.vault.saveNew).toHaveBeenCalledWith("https://example.com/login", "me", "SECRET");
    });

    test("dismissSave is a no-op ok for a mismatched origin and does not discard", async () => {
      const deps = makeDeps();
      deps.pending.peek.mockResolvedValue(record);
      expect(await handleMessage({ type: "dismissSave" }, otherOriginPage, deps)).toEqual({ ok: true });
      expect(deps.pending.discard).not.toHaveBeenCalled();
    });

    test("dismissSave still discards for a matching-origin sender", async () => {
      const deps = makeDeps();
      deps.pending.peek.mockResolvedValue(record);
      expect(await handleMessage({ type: "dismissSave" }, page, deps)).toEqual({ ok: true });
      expect(deps.pending.discard).toHaveBeenCalledWith(7);
    });
  });
});

describe("unexpected exceptions resolve to a network error instead of a rejection", () => {
  test("a synchronous throw from a dep resolves to { ok: false, error: 'network' }", async () => {
    const deps = makeDeps();
    deps.vault.listEntries.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(handleMessage({ type: "listEntries" }, popup, deps)).resolves.toEqual({
      ok: false,
      error: "network",
    });
  });

  test("a rejected promise from a dep resolves to { ok: false, error: 'network' }", async () => {
    const deps = makeDeps();
    deps.auth.status.mockRejectedValue(new Error("boom"));
    await expect(handleMessage({ type: "getStatus" }, popup, deps)).resolves.toEqual({
      ok: false,
      error: "network",
    });
  });

  test("a throw deep in a content-type message (pending store) resolves to network, not a rejection", async () => {
    const deps = makeDeps();
    deps.pending.peek.mockRejectedValue(new Error("boom"));
    await expect(handleMessage({ type: "getPendingSave" }, page, deps)).resolves.toEqual({
      ok: false,
      error: "network",
    });
  });
});
