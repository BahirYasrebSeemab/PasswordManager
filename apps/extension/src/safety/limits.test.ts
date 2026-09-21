import { LIMITS, validateEntryContent, validateLoginInput } from "./limits";

const ok = { title: "Site", password: "pw" };

test("accepts a minimal valid entry", () => {
  expect(validateEntryContent(ok)).toEqual({ ok: true });
});

test("requires a non-blank title and a non-empty password", () => {
  expect(validateEntryContent({ ...ok, title: "   " }).ok).toBe(false);
  expect(validateEntryContent({ ...ok, password: "" }).ok).toBe(false);
});

test.each([
  ["title", { title: "x".repeat(LIMITS.title + 1), password: "pw" }],
  ["username", { ...ok, username: "x".repeat(LIMITS.username + 1) }],
  ["password", { ...ok, password: "x".repeat(LIMITS.password + 1) }],
  ["url", { ...ok, url: "x".repeat(LIMITS.url + 1) }],
  ["notes", { ...ok, notes: "x".repeat(LIMITS.notes + 1) }],
])("rejects an oversized %s", (_field, content) => {
  expect(validateEntryContent(content).ok).toBe(false);
});

test("accepts values exactly at the limit", () => {
  expect(validateEntryContent({ title: "x".repeat(LIMITS.title), password: "y".repeat(LIMITS.password) }).ok).toBe(true);
});

test("validateLoginInput accepts a normal email and password", () => {
  expect(validateLoginInput("me@example.com", "pw")).toEqual({ ok: true });
});

test.each([
  ["", "pw"],
  ["no-at-sign", "pw"],
  ["a b@example.com", "pw"],
  ["müller@example.com", "pw"],
  ["a@" + "x".repeat(LIMITS.email), "pw"],
  ["me@example.com", ""],
  ["me@example.com", "x".repeat(LIMITS.password + 1)],
])("validateLoginInput rejects (%s, password length %#)", (email, password) => {
  expect(validateLoginInput(email, password).ok).toBe(false);
});
