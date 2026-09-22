// @vitest-environment jsdom
import { fillCredential, setInputValue } from "./fill";

function input(): HTMLInputElement {
  const el = document.createElement("input");
  document.body.appendChild(el);
  return el;
}

test("sets the value and fires bubbling input and change events", () => {
  const el = input();
  const events: string[] = [];
  document.addEventListener("input", (e) => events.push(`${e.type}:${e.bubbles}`));
  document.addEventListener("change", (e) => events.push(`${e.type}:${e.bubbles}`));
  setInputValue(el, "hello");
  expect(el.value).toBe("hello");
  expect(events).toEqual(["input:true", "change:true"]);
});

test("uses the prototype setter so a framework's per-instance value tracker is not updated", () => {
  const el = input();
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  let trackerWrites = 0;
  Object.defineProperty(el, "value", {
    configurable: true,
    get() {
      return proto.get!.call(this);
    },
    set(v: string) {
      trackerWrites++;
      proto.set!.call(this, v);
    },
  });
  setInputValue(el, "x");
  expect(el.value).toBe("x");
  expect(trackerWrites).toBe(0);
});

test("fillCredential fills both fields, and skips a missing or empty username", () => {
  const username = input();
  const password = input();
  fillCredential({ username, password }, { username: "me", password: "pw" });
  expect([username.value, password.value]).toEqual(["me", "pw"]);

  const p2 = input();
  fillCredential({ username: null, password: p2 }, { username: "me", password: "pw2" });
  expect(p2.value).toBe("pw2");

  const u3 = input();
  u3.value = "keep";
  fillCredential({ username: u3, password: input() }, { username: "", password: "x" });
  expect(u3.value).toBe("keep");
});
