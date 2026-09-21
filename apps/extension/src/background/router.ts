import { parseMessage, isAllowedSender, type SenderContext, type SenderInfo } from "../messaging/validate";
import type { Result } from "../messaging/types";
import { originOf } from "../shared/matching";
import type { PendingStore } from "./pendingSave";
import type { VaultService } from "./vaultService";

export interface RouterDeps {
  extension: SenderContext;
  auth: {
    login(email: string, masterPassword: string): Promise<Result>;
    logout(): Promise<void>;
    status(): Promise<{ locked: boolean; email?: string }>;
  };
  settings: {
    getAutoLockMinutes(): Promise<number>;
    setAutoLockMinutes(minutes: number): Promise<boolean>;
  };
  vault: VaultService;
  pending: PendingStore;
  scheduleClipboardClear(): Promise<void>;
}

const forbidden = { ok: false, error: "forbidden" } as const;

export async function handleMessage(raw: unknown, sender: SenderInfo, deps: RouterDeps): Promise<unknown> {
  const message = parseMessage(raw);
  if (!message) return { ok: false, error: "invalid_input" };
  if (!isAllowedSender(message, sender, deps.extension)) return forbidden;

  // Content-script messages only: the page origin and tab come from the SENDER,
  // never from anything the message claims.
  const pageUrl = sender.url ?? "";
  const tabId = sender.tab?.id;

  switch (message.type) {
    case "getStatus":
      return deps.auth.status();
    case "login":
      return deps.auth.login(message.email, message.masterPassword);
    case "logout":
      await deps.auth.logout();
      await deps.pending.clearAll();
      return { ok: true };
    case "listEntries":
      return deps.vault.listEntries();
    case "getEntry":
      return deps.vault.getEntry(message.id);
    case "updateEntry":
      return deps.vault.updateEntry(message.id, message.content);
    case "deleteEntry":
      return deps.vault.deleteEntry(message.id);
    case "getAutoLockMinutes":
      return { minutes: await deps.settings.getAutoLockMinutes() };
    case "setAutoLockMinutes":
      return (await deps.settings.setAutoLockMinutes(message.minutes))
        ? { ok: true }
        : { ok: false, error: "invalid_input" };
    case "scheduleClipboardClear":
      await deps.scheduleClipboardClear();
      return { ok: true };
    case "findMatches":
      return deps.vault.findMatches(pageUrl);
    case "getCredentialForFill":
      return deps.vault.getCredentialForFill(message.id, pageUrl);
  }

  if (tabId === undefined) return forbidden;

  switch (message.type) {
    case "credentialSubmitted": {
      const evaluation = await deps.vault.evaluateSubmission(pageUrl, message.username, message.password);
      if (!evaluation.ok) {
        // Oversized input is reported so the page can tell the user; locked or
        // offline just means no prompt this time.
        return evaluation.error === "invalid_input" ? evaluation : { ok: true };
      }
      const { decision } = evaluation;
      if (decision.kind === "none") return { ok: true };
      await deps.pending.park(tabId, {
        kind: decision.kind,
        username: message.username,
        password: message.password,
        pageUrl,
        ...(decision.kind === "update" ? { existingId: decision.id } : {}),
      });
      return { ok: true };
    }
    case "getPendingSave": {
      const record = await deps.pending.peek(tabId);
      return {
        pending: record
          ? { kind: record.kind, username: record.username, origin: originOf(record.pageUrl) ?? record.pageUrl }
          : null,
      };
    }
    case "confirmSave": {
      const record = await deps.pending.peek(tabId);
      if (!record) return { ok: false, error: "not_found" };
      const result =
        record.kind === "update" && record.existingId !== undefined
          ? await deps.vault.saveUpdate(record.existingId, record.password)
          : await deps.vault.saveNew(record.pageUrl, record.username, record.password);
      if (result.ok) await deps.pending.discard(tabId);
      return result;
    }
    case "dismissSave":
      await deps.pending.discard(tabId);
      return { ok: true };
  }
  return forbidden;
}
