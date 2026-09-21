import { isAllowedSender, parseMessage } from "./validate";

const ctx = { extensionId: "ext@id", extensionOrigin: "moz-extension://abc/" };
const popupSender = { id: "ext@id", url: "moz-extension://abc/popup.html" };
const optionsTabSender = { id: "ext@id", url: "moz-extension://abc/options.html", tab: { id: 4 } };
const contentSender = { id: "ext@id", url: "https://example.com/login", tab: { id: 7 } };

describe("parseMessage", () => {
  test("accepts well-formed messages and drops unknown extra fields", () => {
    expect(parseMessage({ type: "login", email: "a@b.co", masterPassword: "pw", evil: 1 })).toEqual({
      type: "login",
      email: "a@b.co",
      masterPassword: "pw",
    });
    expect(parseMessage({ type: "getEntry", id: 3 })).toEqual({ type: "getEntry", id: 3 });
    expect(parseMessage({ type: "findMatches" })).toEqual({ type: "findMatches" });
    expect(parseMessage({ type: "setAutoLockMinutes", minutes: 15 })).toEqual({
      type: "setAutoLockMinutes",
      minutes: 15,
    });
  });

  test("accepts an entry update and keeps only known content fields", () => {
    const parsed = parseMessage({
      type: "updateEntry",
      id: 2,
      content: { title: "T", password: "p", username: "u", url: "https://x.io", notes: "n", junk: true },
    });
    expect(parsed).toEqual({
      type: "updateEntry",
      id: 2,
      content: { title: "T", password: "p", username: "u", url: "https://x.io", notes: "n" },
    });
  });

  test.each([
    null,
    undefined,
    "login",
    42,
    {},
    { type: "nope" },
    { type: "login", email: "a@b.co" },
    { type: "login", email: 1, masterPassword: "pw" },
    { type: "getEntry", id: "3" },
    { type: "getEntry", id: -1 },
    { type: "getEntry", id: 1.5 },
    { type: "setAutoLockMinutes", minutes: "15" },
    { type: "updateEntry", id: 1, content: { title: "T" } },
    { type: "updateEntry", id: 1, content: { title: "T", password: "p", url: 5 } },
    { type: "credentialSubmitted", username: "u" },
  ])("rejects %j", (raw) => {
    expect(parseMessage(raw)).toBeNull();
  });
});

describe("isAllowedSender", () => {
  const login = { type: "login", email: "a@b.co", masterPassword: "pw" } as const;
  const find = { type: "findMatches" } as const;

  test("popup messages are allowed from the popup and from the options page in a tab", () => {
    expect(isAllowedSender(login, popupSender, ctx)).toBe(true);
    expect(isAllowedSender(login, optionsTabSender, ctx)).toBe(true);
  });

  test("popup messages are rejected from a content script", () => {
    expect(isAllowedSender(login, contentSender, ctx)).toBe(false);
  });

  test("content messages are allowed only from a content script with a tab", () => {
    expect(isAllowedSender(find, contentSender, ctx)).toBe(true);
    expect(isAllowedSender(find, popupSender, ctx)).toBe(false);
    expect(isAllowedSender(find, { id: "ext@id", url: "https://example.com/" }, ctx)).toBe(false);
  });

  test("a foreign extension id is rejected", () => {
    expect(isAllowedSender(login, { ...popupSender, id: "evil@id" }, ctx)).toBe(false);
    expect(isAllowedSender(find, { ...contentSender, id: undefined }, ctx)).toBe(false);
  });

  test("a sender without a url is rejected", () => {
    expect(isAllowedSender(login, { id: "ext@id" }, ctx)).toBe(false);
  });
});
