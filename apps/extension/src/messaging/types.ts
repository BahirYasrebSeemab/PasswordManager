import type { VaultEntryContent } from "../vault/entry";

export type PopupRequest =
  | { type: "getStatus" }
  | { type: "login"; email: string; masterPassword: string }
  | { type: "logout" }
  | { type: "listEntries" }
  | { type: "getEntry"; id: number }
  | { type: "updateEntry"; id: number; content: VaultEntryContent }
  | { type: "deleteEntry"; id: number }
  | { type: "getAutoLockMinutes" }
  | { type: "setAutoLockMinutes"; minutes: number }
  | { type: "scheduleClipboardClear" };

export type ContentRequest =
  | { type: "findMatches" }
  | { type: "getCredentialForFill"; id: number }
  | { type: "credentialSubmitted"; username: string; password: string }
  | { type: "getPendingSave" }
  | { type: "confirmSave" }
  | { type: "dismissSave" };

export type Message = PopupRequest | ContentRequest;

export const POPUP_TYPES: ReadonlyArray<PopupRequest["type"]> = [
  "getStatus", "login", "logout", "listEntries", "getEntry", "updateEntry",
  "deleteEntry", "getAutoLockMinutes", "setAutoLockMinutes", "scheduleClipboardClear",
];

export const CONTENT_TYPES: ReadonlyArray<ContentRequest["type"]> = [
  "findMatches", "getCredentialForFill", "credentialSubmitted",
  "getPendingSave", "confirmSave", "dismissSave",
];

export type ErrorCode =
  | "locked"
  | "network"
  | "invalid_input"
  | "invalid_credentials"
  | "not_found"
  | "forbidden"
  | "rate_limited";

export interface Failure {
  ok: false;
  error: ErrorCode;
}

export type Result<T extends object = object> = ({ ok: true } & T) | Failure;

export interface EntrySummary {
  id: number;
  title: string;
  username?: string;
  url?: string;
}

export interface PendingSave {
  kind: "save" | "update";
  username: string;
  origin: string;
}

export interface ResponseMap {
  getStatus: { locked: boolean; email?: string };
  login: Result;
  logout: { ok: true };
  listEntries: Result<{ entries: EntrySummary[] }>;
  getEntry: Result<{ entry: VaultEntryContent }>;
  updateEntry: Result;
  deleteEntry: Result;
  getAutoLockMinutes: { minutes: number };
  setAutoLockMinutes: Result;
  scheduleClipboardClear: { ok: true };
  findMatches: Result<{ matches: EntrySummary[] }>;
  getCredentialForFill: Result<{ username: string; password: string }>;
  credentialSubmitted: Result;
  getPendingSave: { pending: PendingSave | null };
  confirmSave: Result;
  dismissSave: { ok: true };
}
