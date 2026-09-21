import type { VaultEntryContent } from "../vault/entry";
import { CONTENT_TYPES, POPUP_TYPES, type Message } from "./types";

const isString = (v: unknown): v is string => typeof v === "string";
const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isOptionalString = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

function parseContent(value: unknown): VaultEntryContent | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (!isString(c.title) || !isString(c.password)) return null;
  if (!isOptionalString(c.username) || !isOptionalString(c.url) || !isOptionalString(c.notes)) return null;
  const content: VaultEntryContent = { title: c.title, password: c.password };
  if (c.username !== undefined) content.username = c.username;
  if (c.url !== undefined) content.url = c.url;
  if (c.notes !== undefined) content.notes = c.notes;
  return content;
}

// Validates the runtime shape of an incoming message and returns a clean copy
// containing only known fields, or null if it is malformed or unknown.
export function parseMessage(raw: unknown): Message | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;

  switch (m.type) {
    case "getStatus":
    case "logout":
    case "listEntries":
    case "getAutoLockMinutes":
    case "scheduleClipboardClear":
    case "findMatches":
    case "getPendingSave":
    case "confirmSave":
    case "dismissSave":
      return { type: m.type };
    case "login":
      return isString(m.email) && isString(m.masterPassword)
        ? { type: "login", email: m.email, masterPassword: m.masterPassword }
        : null;
    case "getEntry":
    case "deleteEntry":
    case "getCredentialForFill":
      return isId(m.id) ? { type: m.type, id: m.id } : null;
    case "updateEntry": {
      const content = parseContent(m.content);
      return isId(m.id) && content ? { type: "updateEntry", id: m.id, content } : null;
    }
    case "setAutoLockMinutes":
      return typeof m.minutes === "number" ? { type: "setAutoLockMinutes", minutes: m.minutes } : null;
    case "credentialSubmitted":
      return isString(m.username) && isString(m.password)
        ? { type: "credentialSubmitted", username: m.username, password: m.password }
        : null;
    default:
      return null;
  }
}

export interface SenderInfo {
  id?: string;
  url?: string;
  tab?: { id?: number };
}

export interface SenderContext {
  extensionId: string;
  extensionOrigin: string;
}

// Popup-type messages must come from this extension's own pages (popup, or the
// options page even when opened in a tab). Content-type messages must come from
// a content script: a real tab whose url is NOT an extension page.
export function isAllowedSender(message: Message, sender: SenderInfo, ctx: SenderContext): boolean {
  if (sender.id !== ctx.extensionId || !sender.url) return false;
  const fromExtensionPage = sender.url.startsWith(ctx.extensionOrigin);

  if ((POPUP_TYPES as readonly string[]).includes(message.type)) return fromExtensionPage;
  if ((CONTENT_TYPES as readonly string[]).includes(message.type)) {
    return !fromExtensionPage && sender.tab?.id !== undefined;
  }
  return false;
}
