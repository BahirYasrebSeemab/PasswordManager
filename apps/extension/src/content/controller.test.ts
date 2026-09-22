// @vitest-environment jsdom
import { startController } from "./controller";
import { createOverlay } from "./overlay";

const FORM = `<form id="f"><input id="u" type="text"><input id="p" type="password"></form>`;

let overlay: ReturnType<typeof createOverlay>;
let stops: Array<() => void> = [];

function shadowText(): string {
  return overlay.host.shadowRoot!.textContent ?? "";
}
function click(selector: string): void {
  overlay.host.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
}

function start(send: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) {
  overlay = createOverlay({ mode: "open", requireTrusted: false });
  const stop = startController({ send: send as never, overlay, pendingCheckDelayMs: 10, ...extra });
  stops.push(stop);
}

function backend(handlers: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation(async (message: { type: string }) => {
    if (message.type in handlers) {
      const value = handlers[message.type];
      return typeof value === "function" ? (value as (m: unknown) => unknown)(message) : value;
    }
    if (message.type === "getPendingSave") return { pending: null };
    return { ok: true };
  });
}

beforeEach(() => {
  document.body.innerHTML = FORM;
});

afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  document.querySelectorAll("[data-pm-overlay]").forEach((n) => n.remove());
  document.body.innerHTML = "";
});

test("adds an icon for each login field once, including forms added later", async () => {
  start(backend());
  expect(overlay.host.shadowRoot!.querySelectorAll("button.icon").length).toBe(1);
  document.body.insertAdjacentHTML("beforeend", `<form><input type="text"><input type="password"></form>`);
  await vi.waitFor(() => expect(overlay.host.shadowRoot!.querySelectorAll("button.icon").length).toBe(2));
  document.body.appendChild(document.createElement("div"));
  await new Promise((r) => setTimeout(r, 150));
  expect(overlay.host.shadowRoot!.querySelectorAll("button.icon").length).toBe(2);
});

test("clicking the icon lists matches; choosing one fetches the credential and fills both fields", async () => {
  const send = backend({
    findMatches: { ok: true, matches: [{ id: 5, title: "Example", username: "me" }] },
    getCredentialForFill: { ok: true, username: "me", password: "hunter2" },
  });
  start(send);
  click("button.icon");
  await vi.waitFor(() => expect(overlay.host.shadowRoot!.querySelector("button.item")).not.toBeNull());
  click("button.item");
  await vi.waitFor(() => expect((document.getElementById("p") as HTMLInputElement).value).toBe("hunter2"));
  expect((document.getElementById("u") as HTMLInputElement).value).toBe("me");
  expect(send).toHaveBeenCalledWith({ type: "getCredentialForFill", id: 5 });
});

test("a locked vault tells the user to unlock instead of showing an empty picker", async () => {
  start(backend({ findMatches: { ok: false, error: "locked" } }));
  click("button.icon");
  await vi.waitFor(() => expect(shadowText()).toContain("Unlock Password Manager"));
});

test("a failed credential fetch shows a notice and fills nothing", async () => {
  start(
    backend({
      findMatches: { ok: true, matches: [{ id: 5, title: "Example" }] },
      getCredentialForFill: { ok: false, error: "forbidden" },
    })
  );
  click("button.icon");
  await vi.waitFor(() => expect(overlay.host.shadowRoot!.querySelector("button.item")).not.toBeNull());
  click("button.item");
  await vi.waitFor(() => expect(shadowText()).toContain("Couldn't fill that login."));
  expect((document.getElementById("p") as HTMLInputElement).value).toBe("");
});

test("submitting a login sends it, then shows the save banner once the background has parked it", async () => {
  const pending = { pending: { kind: "save", username: "me", origin: "https://example.com" } };
  let parked = false;
  const send = backend({
    credentialSubmitted: () => {
      parked = true;
      return { ok: true };
    },
    getPendingSave: () => (parked ? pending : { pending: null }),
  });
  start(send);
  (document.getElementById("u") as HTMLInputElement).value = "me";
  (document.getElementById("p") as HTMLInputElement).value = "pw";
  document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(send).toHaveBeenCalledWith({ type: "credentialSubmitted", username: "me", password: "pw" });
  await vi.waitFor(() => expect(shadowText()).toContain("Save password for example.com?"));
});

test("an oversized credential shows a notice instead of a prompt", async () => {
  start(backend({ credentialSubmitted: { ok: false, error: "invalid_input" } }));
  (document.getElementById("p") as HTMLInputElement).value = "pw";
  document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(shadowText()).toContain("too large to save"));
});

test("on start a pending save is offered; Save confirms it and shows Saved.", async () => {
  const send = backend({
    getPendingSave: { pending: { kind: "update", username: "me", origin: "https://example.com" } },
  });
  start(send, { checkPendingOnStart: true });
  await vi.waitFor(() => expect(shadowText()).toContain("Update password for example.com?"));
  const buttons = Array.from(overlay.host.shadowRoot!.querySelectorAll<HTMLButtonElement>(".banner button"));
  expect(buttons.map((b) => b.textContent)).toEqual(["Update", "Not now"]);
  buttons[0].click();
  await vi.waitFor(() => expect(shadowText()).toContain("Saved."));
  expect(send).toHaveBeenCalledWith({ type: "confirmSave" });
});

test("a failed save keeps the prompt available for retry", async () => {
  const send = backend({
    getPendingSave: { pending: { kind: "save", username: "me", origin: "https://example.com" } },
    confirmSave: { ok: false, error: "network" },
  });
  start(send, { checkPendingOnStart: true });
  await vi.waitFor(() => expect(shadowText()).toContain("Save password"));
  click(".banner button.primary");
  await vi.waitFor(() => expect(shadowText()).toContain("Couldn't save. Try again?"));
});

test("Not now dismisses the pending save", async () => {
  const send = backend({
    getPendingSave: { pending: { kind: "save", username: "me", origin: "https://example.com" } },
  });
  start(send, { checkPendingOnStart: true });
  await vi.waitFor(() => expect(shadowText()).toContain("Save password"));
  const notNow = Array.from(overlay.host.shadowRoot!.querySelectorAll<HTMLButtonElement>(".banner button")).find(
    (b) => b.textContent === "Not now"
  )!;
  notNow.click();
  expect(send).toHaveBeenCalledWith({ type: "dismissSave" });
  expect(overlay.host.shadowRoot!.querySelector(".banner")).toBeNull();
});

test("pending saves are not checked on start when disabled (e.g. inside an iframe)", async () => {
  const send = backend();
  start(send, { checkPendingOnStart: false });
  await new Promise((r) => setTimeout(r, 30));
  expect(send).not.toHaveBeenCalledWith({ type: "getPendingSave" });
});
