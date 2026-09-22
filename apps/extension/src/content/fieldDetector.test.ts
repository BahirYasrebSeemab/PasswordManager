// @vitest-environment jsdom
import { findLoginFields, observeLoginFields } from "./fieldDetector";

function page(html: string): void {
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("pairs a password field with the email input before it in the same form", () => {
  page(`<form><input id="u" type="email"><input id="p" type="password"></form>`);
  const [fields] = findLoginFields();
  expect(fields.password.id).toBe("p");
  expect(fields.username?.id).toBe("u");
});

test("prefers an autocomplete=username input over a nearer plain text input", () => {
  page(`<form>
    <input id="user" type="text" autocomplete="username">
    <input id="search" type="text">
    <input id="p" type="password">
  </form>`);
  expect(findLoginFields()[0].username?.id).toBe("user");
});

test("falls back to the closest preceding text input when there is no hint", () => {
  page(`<form><input id="a" type="text"><input id="b" type="text"><input id="p" type="password"></form>`);
  expect(findLoginFields()[0].username?.id).toBe("b");
});

test("works without a <form> tag by looking in the immediate container", () => {
  page(`<div><input id="u" type="text"><input id="p" type="password"></div>`);
  const [fields] = findLoginFields();
  expect(fields.username?.id).toBe("u");
});

test("does not escalate beyond the immediate parent to an unrelated sibling section", () => {
  page(`
    <div id="page">
      <header><input id="header-search" type="text"></header>
      <main><section><div><input id="p" type="password"></div></section></main>
    </div>`);
  expect(findLoginFields()[0].username).toBeNull();
});

test("does not pick an input that comes after the password field", () => {
  page(`<form><input id="p" type="password"><input id="later" type="text"></form>`);
  expect(findLoginFields()[0].username).toBeNull();
});

test("ignores hidden, disabled, and read-only inputs", () => {
  page(`<form>
    <input id="h" type="hidden">
    <input id="d" type="text" disabled>
    <input id="r" type="text" readonly>
    <input id="u" type="text">
    <input id="p" type="password">
  </form>`);
  expect(findLoginFields()[0].username?.id).toBe("u");
});

test("ignores password fields that are not visible", () => {
  page(`<form><input id="p" type="password" style="display:none"></form>`);
  expect(findLoginFields()).toEqual([]);
});

test("ignores password fields hidden via opacity:0", () => {
  page(`<form><input id="p" type="password" style="opacity:0"></form>`);
  expect(findLoginFields()).toEqual([]);
});

// A zero-size-but-display:block password field (e.g. `width:0;height:0`) is not
// covered by a test here: jsdom does not implement CSS layout, so
// getBoundingClientRect()/offsetWidth/offsetHeight return an all-zero box for every
// element regardless of its actual styling (verified directly against this
// project's jsdom version). A size-based check could not be told apart from a
// false positive on every other input in this suite, so it was deliberately left
// out of `isVisible` rather than shipped untested — see the Task 11 fix report for
// details.

test("handles several forms independently", () => {
  page(`
    <form id="a"><input id="ua" type="text"><input id="pa" type="password"></form>
    <form id="b"><input id="ub" type="email"><input id="pb" type="password"></form>`);
  const result = findLoginFields();
  expect(result.map((r) => [r.username?.id, r.password.id])).toEqual([
    ["ua", "pa"],
    ["ub", "pb"],
  ]);
});

test("a password-only page yields a null username", () => {
  page(`<input id="p" type="password">`);
  expect(findLoginFields()[0].username).toBeNull();
});

test("observeLoginFields reports fields added after the initial scan and can be stopped", async () => {
  const onChange = vi.fn();
  const stop = observeLoginFields(onChange, document.body, 10);
  const input = document.createElement("input");
  input.type = "password";
  document.body.appendChild(input);
  await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

  stop();
  onChange.mockClear();
  document.body.appendChild(document.createElement("div"));
  await new Promise((r) => setTimeout(r, 40));
  expect(onChange).not.toHaveBeenCalled();
});
