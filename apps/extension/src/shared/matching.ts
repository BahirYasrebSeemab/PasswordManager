import type { VaultEntryContent } from "../vault/entry";

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

function parse(url: string): URL | null {
  try {
    return new URL(HAS_SCHEME.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
}

export function hostnameOf(url: string): string | null {
  const parsed = parse(url);
  return parsed ? parsed.hostname.toLowerCase().replace(/^www\./, "") : null;
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isEligiblePageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

// Exact hostname match. Known limitation (see spec): no registrable-domain matching,
// so an entry for example.com is not offered on accounts.example.com.
export function entryMatchesPage(entryUrl: string | undefined, pageUrl: string): boolean {
  if (!entryUrl || !isEligiblePageUrl(pageUrl)) return false;
  const entryHost = hostnameOf(entryUrl);
  return entryHost !== null && entryHost === hostnameOf(pageUrl);
}

export interface DecryptedEntry {
  id: number;
  content: VaultEntryContent;
}

export type SaveDecision = { kind: "save" } | { kind: "update"; id: number } | { kind: "none" };

export function decideSave(
  entries: DecryptedEntry[],
  pageUrl: string,
  username: string,
  password: string
): SaveDecision {
  const sameSiteAndUser = entries.find(
    (entry) =>
      entryMatchesPage(entry.content.url, pageUrl) &&
      (entry.content.username ?? "").trim() === username.trim()
  );
  if (!sameSiteAndUser) return { kind: "save" };
  return sameSiteAndUser.content.password === password
    ? { kind: "none" }
    : { kind: "update", id: sameSiteAndUser.id };
}
