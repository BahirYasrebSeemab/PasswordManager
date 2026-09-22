import type { EntrySummary } from "../messaging/types";

export interface BannerAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface OverlayOptions {
  mode?: ShadowRootMode;
  requireTrusted?: boolean;
}

export interface Overlay {
  host: HTMLElement;
  addIcon(anchor: HTMLInputElement, onActivate: () => void): () => void;
  showPicker(anchor: HTMLInputElement, items: EntrySummary[], onPick: (id: number) => void): void;
  hidePicker(): void;
  showBanner(text: string, actions: BannerAction[]): void;
  hideBanner(): void;
  showNotice(text: string, durationMs?: number): void;
}

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font: 13px system-ui, sans-serif; }
  button.icon { position: fixed; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px;
    background: #2456d6; color: #fff; font-size: 9px; font-weight: 700; cursor: pointer; }
  .picker { position: fixed; min-width: 220px; max-width: 320px; background: #fff; color: #1a1a1a;
    border: 1px solid #c8c8c8; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.2); padding: 4px; }
  .picker .empty { padding: 8px; color: #555; }
  button.item { display: block; width: 100%; text-align: left; padding: 6px 8px; border: 0; border-radius: 6px;
    background: transparent; color: inherit; cursor: pointer; }
  button.item:hover { background: #eef2ff; }
  button.item .sub { color: #666; font-size: 12px; }
  .banner { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; align-items: center;
    max-width: 380px; padding: 10px 12px; background: #fff; color: #1a1a1a; border: 1px solid #c8c8c8;
    border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
  .banner button { padding: 4px 10px; border: 1px solid #c8c8c8; border-radius: 6px; background: #fff; color: #1a1a1a; cursor: pointer; }
  .banner button.primary { background: #2456d6; border-color: #2456d6; color: #fff; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent only: page/vault strings are never parsed as HTML
  return node;
}

export function createOverlay(options: OverlayOptions = {}): Overlay {
  const { mode = "closed", requireTrusted = true } = options;
  const host = document.createElement("div");
  host.setAttribute("data-pm-overlay", "");
  const shadow = host.attachShadow({ mode });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const iconLayer = el("div");
  const pickerLayer = el("div");
  const bannerLayer = el("div");
  shadow.append(style, iconLayer, pickerLayer, bannerLayer);

  const icons = new Map<HTMLInputElement, HTMLButtonElement>();
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let removeOutsideListeners: (() => void) | null = null;
  let listening = false;

  const accept = (event: Event) => !requireTrusted || event.isTrusted;

  function attach(): void {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }

  function reposition(): void {
    for (const [anchor, button] of icons) {
      if (!anchor.isConnected) {
        button.remove();
        icons.delete(anchor);
        continue;
      }
      const rect = anchor.getBoundingClientRect();
      button.style.left = `${Math.max(0, rect.right - 26)}px`;
      button.style.top = `${rect.top + Math.max(0, (rect.height - 22) / 2)}px`;
    }
  }

  function startListening(): void {
    if (listening) return;
    listening = true;
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        reposition();
      });
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
  }

  function hidePicker(): void {
    pickerLayer.replaceChildren();
    removeOutsideListeners?.();
    removeOutsideListeners = null;
  }

  return {
    host,

    addIcon(anchor, onActivate) {
      attach();
      startListening();
      const button = el("button", "icon", "PM");
      button.type = "button";
      button.setAttribute("aria-label", "Fill with Password Manager");
      button.addEventListener("click", (event) => {
        if (accept(event)) onActivate();
      });
      iconLayer.appendChild(button);
      icons.set(anchor, button);
      reposition();
      return () => {
        button.remove();
        icons.delete(anchor);
      };
    },

    showPicker(anchor, items, onPick) {
      attach();
      hidePicker();
      const picker = el("div", "picker");
      const rect = anchor.getBoundingClientRect();
      picker.style.left = `${rect.left}px`;
      picker.style.top = `${rect.bottom + 4}px`;
      if (items.length === 0) {
        picker.appendChild(el("div", "empty", "No saved logins for this site."));
      }
      for (const item of items) {
        const button = el("button", "item");
        button.type = "button";
        button.appendChild(el("div", undefined, item.title));
        if (item.username) button.appendChild(el("div", "sub", item.username));
        button.addEventListener("click", (event) => {
          if (!accept(event)) return;
          hidePicker();
          onPick(item.id);
        });
        picker.appendChild(button);
      }
      pickerLayer.appendChild(picker);

      // Clicks inside the closed shadow root are retargeted to `host`, so any click
      // whose target is not the host is an outside click.
      const onOutside = (event: Event) => {
        if (event.target !== host) hidePicker();
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") hidePicker();
      };
      document.addEventListener("click", onOutside, true);
      document.addEventListener("keydown", onKey, true);
      removeOutsideListeners = () => {
        document.removeEventListener("click", onOutside, true);
        document.removeEventListener("keydown", onKey, true);
      };
    },

    hidePicker,

    showBanner(text, actions) {
      attach();
      clearTimeout(noticeTimer);
      const banner = el("div", "banner");
      banner.appendChild(el("span", undefined, text));
      for (const action of actions) {
        const button = el("button", action.primary ? "primary" : undefined, action.label);
        button.type = "button";
        button.addEventListener("click", (event) => {
          if (accept(event)) action.onClick();
        });
        banner.appendChild(button);
      }
      bannerLayer.replaceChildren(banner);
    },

    hideBanner() {
      clearTimeout(noticeTimer);
      bannerLayer.replaceChildren();
    },

    showNotice(text, durationMs = 3000) {
      this.showBanner(text, []);
      noticeTimer = setTimeout(() => bannerLayer.replaceChildren(), durationMs);
    },
  };
}
