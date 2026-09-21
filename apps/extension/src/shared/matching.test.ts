import { decideSave, entryMatchesPage, hostnameOf, isEligiblePageUrl, originOf } from "./matching";

test("hostnameOf lowercases, drops www and port, and tolerates a missing scheme", () => {
  expect(hostnameOf("https://WWW.Example.com:8443/login")).toBe("example.com");
  expect(hostnameOf("example.com/login")).toBe("example.com");
  expect(hostnameOf("")).toBeNull();
});

test("originOf returns the origin or null", () => {
  expect(originOf("https://example.com/a?b=1")).toBe("https://example.com");
  expect(originOf("nope")).toBeNull();
});

test("only https pages and http://localhost are eligible", () => {
  expect(isEligiblePageUrl("https://example.com")).toBe(true);
  expect(isEligiblePageUrl("http://localhost:3000/login")).toBe(true);
  expect(isEligiblePageUrl("http://example.com")).toBe(false);
  expect(isEligiblePageUrl("ftp://example.com")).toBe(false);
  expect(isEligiblePageUrl("about:blank")).toBe(false);
});

test("entryMatchesPage requires an exact hostname (ignoring www) on an eligible page", () => {
  expect(entryMatchesPage("https://example.com", "https://www.example.com/login")).toBe(true);
  expect(entryMatchesPage("example.com", "https://example.com/")).toBe(true);
  expect(entryMatchesPage("https://example.com", "https://accounts.example.com")).toBe(false);
  expect(entryMatchesPage("https://example.com", "https://evil-example.com")).toBe(false);
  expect(entryMatchesPage("https://example.com", "http://example.com")).toBe(false);
  expect(entryMatchesPage(undefined, "https://example.com")).toBe(false);
});

describe("decideSave", () => {
  const entries = [
    { id: 1, content: { title: "Ex", username: "me", password: "old", url: "https://example.com" } },
    { id: 2, content: { title: "Other", username: "me", password: "x", url: "https://other.com" } },
  ];
  const page = "https://example.com/login";

  test("offers to save when no entry exists for that site and username", () => {
    expect(decideSave(entries, page, "someone-else", "pw")).toEqual({ kind: "save" });
    expect(decideSave([], page, "me", "pw")).toEqual({ kind: "save" });
  });

  test("offers to update when the username matches but the password changed", () => {
    expect(decideSave(entries, page, "me", "new")).toEqual({ kind: "update", id: 1 });
  });

  test("does nothing when the same credential is already saved", () => {
    expect(decideSave(entries, page, "me", "old")).toEqual({ kind: "none" });
  });

  test("ignores entries saved for other sites", () => {
    expect(decideSave(entries, "https://other.com/", "me", "x")).toEqual({ kind: "none" });
  });

  test("with duplicate same-site same-username entries, any identical password means none", () => {
    const dupes = [
      { id: 1, content: { title: "A", username: "me", password: "old1", url: "https://example.com" } },
      { id: 3, content: { title: "B", username: "me", password: "old2", url: "https://example.com" } },
    ];
    expect(decideSave(dupes, page, "me", "old2")).toEqual({ kind: "none" });
    expect(decideSave(dupes, page, "me", "old1")).toEqual({ kind: "none" });
    expect(decideSave(dupes, page, "me", "new")).toEqual({ kind: "update", id: 1 });
  });
});
