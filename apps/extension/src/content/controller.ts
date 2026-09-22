import type { sendMessage } from "../messaging/client";
import type { PendingSave } from "../messaging/types";
import { findLoginFields, observeLoginFields, type LoginFields } from "./fieldDetector";
import { fillCredential } from "./fill";
import { watchSubmissions } from "./formCapture";
import type { Overlay } from "./overlay";

export interface ControllerEnv {
  send: typeof sendMessage;
  overlay: Overlay;
  doc?: Document;
  pendingCheckDelayMs?: number;
  checkPendingOnStart?: boolean;
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function startController(env: ControllerEnv): () => void {
  const { send, overlay, doc = document, pendingCheckDelayMs = 1500, checkPendingOnStart = true } = env;
  const handled = new WeakSet<HTMLInputElement>();
  const removeIcons: Array<() => void> = [];

  async function fill(fields: LoginFields, id: number): Promise<void> {
    const result = await send({ type: "getCredentialForFill", id }).catch(() => null);
    if (!result || !result.ok) {
      overlay.showNotice("Couldn't fill that login.");
      return;
    }
    fillCredential(fields, { username: result.username, password: result.password });
  }

  async function openPicker(fields: LoginFields): Promise<void> {
    const result = await send({ type: "findMatches" }).catch(() => null);
    if (!result) {
      overlay.showNotice("Couldn't reach Password Manager.");
      return;
    }
    if (!result.ok) {
      overlay.showNotice(
        result.error === "locked"
          ? "Unlock Password Manager from the toolbar first."
          : "Couldn't load saved logins."
      );
      return;
    }
    overlay.showPicker(fields.password, result.matches, (id) => void fill(fields, id));
  }

  function scan(): void {
    for (const fields of findLoginFields(doc)) {
      if (handled.has(fields.password)) continue;
      handled.add(fields.password);
      removeIcons.push(overlay.addIcon(fields.password, () => void openPicker(fields)));
    }
  }

  async function confirm(pending: PendingSave): Promise<void> {
    const result = await send({ type: "confirmSave" }).catch(() => null);
    if (result?.ok) {
      overlay.showNotice("Saved.");
      return;
    }
    showPending(pending, true);
  }

  function showPending(pending: PendingSave, failed = false): void {
    const verb = pending.kind === "update" ? "Update" : "Save";
    const text = failed ? "Couldn't save. Try again?" : `${verb} password for ${hostnameOf(pending.origin)}?`;
    overlay.showBanner(text, [
      { label: verb, primary: true, onClick: () => void confirm(pending) },
      {
        label: "Not now",
        onClick: () => {
          overlay.hideBanner();
          void send({ type: "dismissSave" }).catch(() => undefined);
        },
      },
    ]);
  }

  async function checkPending(): Promise<void> {
    const result = await send({ type: "getPendingSave" }).catch(() => null);
    if (result?.pending) showPending(result.pending);
  }

  scan();
  const stopObserving = observeLoginFields(scan, doc);
  const stopWatching = watchSubmissions((submission) => {
    void send({ type: "credentialSubmitted", ...submission })
      .then((result) => {
        if (!result.ok && result.error === "invalid_input") {
          overlay.showNotice("This credential is too large to save.");
        } else if (result.ok) {
          // Single-page apps never navigate, so look for the parked candidate shortly
          // after submit. A real navigation destroys this script and the NEXT page's
          // start-up check picks the candidate up instead.
          setTimeout(() => void checkPending(), pendingCheckDelayMs);
        }
      })
      .catch(() => undefined);
  }, doc);

  if (checkPendingOnStart) void checkPending();

  return () => {
    stopObserving();
    stopWatching();
    removeIcons.forEach((remove) => remove());
    overlay.hidePicker();
    overlay.hideBanner();
  };
}
