// @vitest-environment jsdom
import { pickSubmittedPassword, watchSubmissions } from "./formCapture";

function page(html: string): void {
  document.body.innerHTML = html;
}

const LOGIN = `<form id="f"><input id="u" type="text" value="me"><input id="p" type="password" value="pw"><button id="go" type="submit">Go</button></form>`;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pickSubmittedPassword", () => {
  test("uses the only filled password", () => {
    expect(pickSubmittedPassword(["pw"])).toBe("pw");
  });
  test("signup with a confirm field uses the first", () => {
    expect(pickSubmittedPassword(["new", "new"])).toBe("new");
  });
  test("a change-password form (current, new, confirm) uses the new password", () => {
    expect(pickSubmittedPassword(["old", "new", "new"])).toBe("new");
  });
  test("ignores empty fields and returns null when all are empty", () => {
    expect(pickSubmittedPassword(["", "pw"])).toBe("pw");
    expect(pickSubmittedPassword(["", ""])).toBeNull();
    expect(pickSubmittedPassword([])).toBeNull();
  });
});

test("a form submit event reports the username and password", () => {
  page(LOGIN);
  const onSubmit = vi.fn();
  watchSubmissions(onSubmit);
  document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(onSubmit).toHaveBeenCalledWith({ username: "me", password: "pw" });
});

test("Enter in the password field reports it, and the follow-up submit within a second is de-duplicated", () => {
  page(LOGIN);
  const onSubmit = vi.fn();
  watchSubmissions(onSubmit);
  const password = document.getElementById("p")!;
  password.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("clicking a submit button or a sign-in-looking button reports; a show-password toggle does not", () => {
  page(`<form>
    <input id="u" type="text" value="me"><input id="p" type="password" value="pw">
    <button id="eye" type="button" aria-label="Show password">eye</button>
    <button id="spa" type="button">Sign in</button>
  </form>`);
  const onSubmit = vi.fn();
  watchSubmissions(onSubmit);
  document.getElementById("eye")!.click();
  expect(onSubmit).not.toHaveBeenCalled();
  document.getElementById("spa")!.click();
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("nothing is reported when the password is empty", () => {
  page(`<form id="f"><input type="text" value="me"><input type="password" value=""></form>`);
  const onSubmit = vi.fn();
  watchSubmissions(onSubmit);
  document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(onSubmit).not.toHaveBeenCalled();
});

test("a signup form with a confirm field reports the first password", () => {
  page(`<form id="f"><input type="text" value="me"><input type="password" value="a1"><input type="password" value="a1"></form>`);
  const onSubmit = vi.fn();
  watchSubmissions(onSubmit);
  document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(onSubmit).toHaveBeenCalledWith({ username: "me", password: "a1" });
});

test("the returned function stops watching", () => {
  page(LOGIN);
  const onSubmit = vi.fn();
  const stop = watchSubmissions(onSubmit);
  stop();
  document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(onSubmit).not.toHaveBeenCalled();
});
