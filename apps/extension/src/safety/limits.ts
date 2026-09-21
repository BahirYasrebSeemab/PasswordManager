import type { VaultEntryContent } from "../vault/entry";

export const LIMITS = {
  title: 200,
  username: 320,
  password: 1024,
  url: 2048,
  notes: 10_000,
  email: 255,
} as const;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): ValidationResult => ({ ok: false, reason });

export function validateEntryContent(content: VaultEntryContent): ValidationResult {
  if (content.title.trim().length === 0) return fail("Title is required.");
  if (content.password.length === 0) return fail("Password is required.");

  const fields: Array<[string, string | undefined, number]> = [
    ["Title", content.title, LIMITS.title],
    ["Username", content.username, LIMITS.username],
    ["Password", content.password, LIMITS.password],
    ["URL", content.url, LIMITS.url],
    ["Notes", content.notes, LIMITS.notes],
  ];
  for (const [label, value, max] of fields) {
    if (value !== undefined && value.length > max) {
      return fail(`${label} is too long (max ${max} characters).`);
    }
  }
  return { ok: true };
}

// Mirrors the backend's email rules (apps/api/app/auth/schemas.py): ASCII only,
// 3-255 chars, contains "@", no spaces. ASCII keeps the PBKDF2 salt unambiguous.
export function validateLoginInput(email: string, masterPassword: string): ValidationResult {
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > LIMITS.email) return fail("Enter a valid email.");
  if (!normalized.includes("@") || /\s/.test(normalized)) return fail("Enter a valid email.");
  if (!/^[\x00-\x7F]*$/.test(normalized)) return fail("Email must contain only ASCII characters.");
  if (masterPassword.length === 0) return fail("Enter your master password.");
  if (masterPassword.length > LIMITS.password) return fail("Master password is too long.");
  return { ok: true };
}
