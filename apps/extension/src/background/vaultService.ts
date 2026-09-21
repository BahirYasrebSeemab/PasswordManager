import type { login as apiLogin } from "../api/auth";
import { ApiError } from "../api/client";
import {
  createVaultEntry,
  deleteVaultEntry,
  getVaultEntry,
  listVaultEntries,
  updateVaultEntry,
  type VaultEntryResponse,
} from "../api/vault";
import { decryptEntry, encryptEntry } from "../crypto/cipher";
import type { EntrySummary, Failure, Result } from "../messaging/types";
import { validateEntryContent } from "../safety/limits";
import {
  decideSave,
  entryMatchesPage,
  hostnameOf,
  originOf,
  type DecryptedEntry,
  type SaveDecision,
} from "../shared/matching";
import type { VaultEntryContent } from "../vault/entry";
import type { Session } from "./session";

export interface VaultServiceDeps {
  getSession(): Promise<Session | null>;
  replaceSession(session: Session): Promise<void>;
  lock(): Promise<void>;
  api: {
    login: typeof apiLogin;
    list: typeof listVaultEntries;
    get: typeof getVaultEntry;
    create: typeof createVaultEntry;
    update: typeof updateVaultEntry;
    remove: typeof deleteVaultEntry;
  };
}

type Run<T> = { ok: true; value: T } | Failure;

function failureFor(error: unknown): Failure {
  if (error instanceof ApiError && error.status === 404) return { ok: false, error: "not_found" };
  if (error instanceof ApiError && error.status === 429) return { ok: false, error: "rate_limited" };
  return { ok: false, error: "network" };
}

function isContent(value: unknown): value is VaultEntryContent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && typeof v.password === "string";
}

function decryptRow(session: Session, row: VaultEntryResponse): DecryptedEntry | null {
  try {
    const content: unknown = JSON.parse(decryptEntry(session.vaultKey, row.ciphertext));
    return isContent(content) ? { id: row.id, content } : null;
  } catch {
    return null; // a corrupt or foreign row must not break the whole list
  }
}

function summarize({ id, content }: DecryptedEntry): EntrySummary {
  const summary: EntrySummary = { id, title: content.title };
  if (content.username) summary.username = content.username;
  if (content.url) summary.url = content.url;
  return summary;
}

const seal = (session: Session, content: VaultEntryContent) =>
  encryptEntry(session.vaultKey, JSON.stringify(content));

export function createVaultService(deps: VaultServiceDeps) {
  // Runs an authenticated operation. The JWT lasts 30 minutes but auto-lock can be
  // longer, so on a 401 we silently re-login with the retained authKey and retry once;
  // only if that is rejected too do we lock.
  async function run<T>(op: (session: Session) => Promise<T>): Promise<Run<T>> {
    const session = await deps.getSession();
    if (!session) return { ok: false, error: "locked" };
    try {
      return { ok: true, value: await op(session) };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) return failureFor(error);
    }
    try {
      const token = await deps.api.login(session.email, session.authKey);
      const refreshed = { ...session, accessToken: token.access_token };
      await deps.replaceSession(refreshed);
      return { ok: true, value: await op(refreshed) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await deps.lock();
        return { ok: false, error: "locked" };
      }
      return failureFor(error);
    }
  }

  const loadAll = () =>
    run(async (s) => {
      const rows = await deps.api.list(s.accessToken);
      return rows.map((row) => decryptRow(s, row)).filter((e): e is DecryptedEntry => e !== null);
    });

  const loadOne = (id: number) =>
    run(async (s) => decryptRow(s, await deps.api.get(s.accessToken, String(id))));

  function candidateContent(pageUrl: string, username: string, password: string): VaultEntryContent {
    const content: VaultEntryContent = {
      title: hostnameOf(pageUrl) ?? pageUrl,
      password,
      url: originOf(pageUrl) ?? pageUrl,
    };
    if (username) content.username = username;
    return content;
  }

  return {
    async listEntries(): Promise<Result<{ entries: EntrySummary[] }>> {
      const all = await loadAll();
      if (!all.ok) return all;
      const entries = all.value
        .map(summarize)
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
      return { ok: true, entries };
    },

    async getEntry(id: number): Promise<Result<{ entry: VaultEntryContent }>> {
      const one = await loadOne(id);
      if (!one.ok) return one;
      return one.value ? { ok: true, entry: one.value.content } : { ok: false, error: "not_found" };
    },

    async updateEntry(id: number, content: VaultEntryContent): Promise<Result> {
      if (!validateEntryContent(content).ok) return { ok: false, error: "invalid_input" };
      const result = await run((s) => deps.api.update(s.accessToken, String(id), seal(s, content)));
      return result.ok ? { ok: true } : result;
    },

    async deleteEntry(id: number): Promise<Result> {
      const result = await run((s) => deps.api.remove(s.accessToken, String(id)));
      return result.ok ? { ok: true } : result;
    },

    async findMatches(pageUrl: string): Promise<Result<{ matches: EntrySummary[] }>> {
      const all = await loadAll();
      if (!all.ok) return all;
      const matches = all.value
        .filter((e) => entryMatchesPage(e.content.url, pageUrl))
        .map(({ id, content }) => {
          const match: EntrySummary = { id, title: content.title };
          if (content.username) match.username = content.username;
          return match;
        });
      return { ok: true, matches };
    },

    async getCredentialForFill(
      id: number,
      pageUrl: string
    ): Promise<Result<{ username: string; password: string }>> {
      const one = await loadOne(id);
      if (!one.ok) return one;
      if (!one.value || !entryMatchesPage(one.value.content.url, pageUrl)) {
        return { ok: false, error: "forbidden" };
      }
      return { ok: true, username: one.value.content.username ?? "", password: one.value.content.password };
    },

    async evaluateSubmission(
      pageUrl: string,
      username: string,
      password: string
    ): Promise<Result<{ decision: SaveDecision }>> {
      if (!validateEntryContent(candidateContent(pageUrl, username, password)).ok) {
        return { ok: false, error: "invalid_input" };
      }
      const all = await loadAll();
      if (!all.ok) return all;
      return { ok: true, decision: decideSave(all.value, pageUrl, username, password) };
    },

    async saveNew(pageUrl: string, username: string, password: string): Promise<Result> {
      const content = candidateContent(pageUrl, username, password);
      if (!validateEntryContent(content).ok) return { ok: false, error: "invalid_input" };
      const result = await run((s) => deps.api.create(s.accessToken, seal(s, content)));
      return result.ok ? { ok: true } : result;
    },

    async saveUpdate(id: number, password: string): Promise<Result> {
      const result = await run(async (s) => {
        const existing = decryptRow(s, await deps.api.get(s.accessToken, String(id)));
        if (!existing) return "not_found" as const;
        // Spread keeps title, url, and notes; only the password changes.
        const updated = { ...existing.content, password };
        if (!validateEntryContent(updated).ok) return "invalid" as const;
        await deps.api.update(s.accessToken, String(id), seal(s, updated));
        return "done" as const;
      });
      if (!result.ok) return result;
      if (result.value === "not_found") return { ok: false, error: "not_found" };
      if (result.value === "invalid") return { ok: false, error: "invalid_input" };
      return { ok: true };
    },
  };
}

export type VaultService = ReturnType<typeof createVaultService>;
