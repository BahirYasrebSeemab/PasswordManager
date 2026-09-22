// @vitest-environment jsdom
import { createOverlay } from "./overlay";

function anchor(): HTMLInputElement {
  const el = document.createElement("input");
  document.body.appendChild(el);
  return el;
}

function root(overlay: ReturnType<typeof createOverlay>): ShadowRoot {
  return overlay.host.shadowRoot!;
}

afterEach(() => {
  document.documentElement.querySelectorAll("[data-pm-overlay]").forEach((n) => n.remove());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

test("renders inside a single shadow-root host attached to the document", () => {
  const overlay = createOverlay({ mode: "open", requireTrusted: false });
  overlay.addIcon(anchor(), vi.fn());
  overlay.showNotice("hi");
  expect(document.querySelectorAll("[data-pm-overlay]").length).toBe(1);
  expect(overlay.host.shadowRoot).not.toBeNull();
});

test("the default overlay uses a closed shadow root that the page cannot inspect", () => {
  const overlay = createOverlay();
  overlay.addIcon(anchor(), vi.fn());
  expect(overlay.host.shadowRoot).toBeNull();
});

test("clicking the icon calls back; a synthetic (untrusted) click is ignored by default", () => {
  const trusting = createOverlay({ mode: "open", requireTrusted: false });
  const onActivate = vi.fn();
  trusting.addIcon(anchor(), onActivate);
  root(trusting).querySelector<HTMLButtonElement>("button.icon")!.click();
  expect(onActivate).toHaveBeenCalledTimes(1);
  document.querySelectorAll("[data-pm-overlay]").forEach((n) => n.remove());

  const strict = createOverlay({ mode: "open" });
  const ignored = vi.fn();
  strict.addIcon(anchor(), ignored);
  root(strict).querySelector<HTMLButtonElement>("button.icon")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(ignored).not.toHaveBeenCalled();
});

test("the icon can be removed", () => {
  const overlay = createOverlay({ mode: "open", requireTrusted: false });
  const a = anchor();
  const remove = overlay.addIcon(a, vi.fn());
  expect(root(overlay).querySelectorAll("button.icon").length).toBe(1);
  remove();
  expect(root(overlay).querySelectorAll("button.icon").length).toBe(0);
});

test("the picker lists matches as text and picks by id", () => {
  const overlay = createOverlay({ mode: "open", requireTrusted: false });
  const onPick = vi.fn();
  overlay.showPicker(anchor(), [{ id: 3, title: "<img src=x onerror=alert(1)>", username: "me" }], onPick);
  const items = root(overlay).querySelectorAll("button.item");
  expect(items.length).toBe(1);
  expect(root(overlay).querySelector("img")).toBeNull();
  expect(items[0].textContent).toContain("<img src=x onerror=alert(1)>");
  (items[0] as HTMLButtonElement).click();
  expect(onPick).toHaveBeenCalledWith(3);
  expect(root(overlay).querySelectorAll("button.item").length).toBe(0);
});

test("the picker explains when there are no saved logins", () => {
  const overlay = createOverlay({ mode: "open", requireTrusted: false });
  overlay.showPicker(anchor(), [], vi.fn());
  expect(root(overlay).textContent).toContain("No saved logins for this site.");
});

test("the banner shows text and action buttons and can be hidden", () => {
  const overlay = createOverlay({ mode: "open", requireTrusted: false });
  const onSave = vi.fn();
  overlay.showBanner("Save password for example.com?", [
    { label: "Save", primary: true, onClick: onSave },
    { label: "Not now", onClick: vi.fn() },
  ]);
  expect(root(overlay).textContent).toContain("Save password for example.com?");
  const buttons = Array.from(root(overlay).querySelectorAll<HTMLButtonElement>(".banner button"));
  expect(buttons.map((b) => b.textContent)).toEqual(["Save", "Not now"]);
  buttons[0].click();
  expect(onSave).toHaveBeenCalled();
  overlay.hideBanner();
  expect(root(overlay).querySelector(".banner")).toBeNull();
});

test("a notice hides itself after its duration", () => {
  vi.useFakeTimers();
  const overlay = createOverlay({ mode: "open", requireTrusted: false });
  overlay.showNotice("Saved.", 3000);
  expect(root(overlay).textContent).toContain("Saved.");
  vi.advanceTimersByTime(3001);
  expect(root(overlay).querySelector(".banner")).toBeNull();
});
