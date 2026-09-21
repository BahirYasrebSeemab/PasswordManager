import { login } from "../api/auth";
import {
  createVaultEntry,
  deleteVaultEntry,
  getVaultEntry,
  listVaultEntries,
  updateVaultEntry,
} from "../api/vault";
import { createActiveSessionReader } from "./activeSession";
import { performLogin } from "./auth";
import { createPendingStore } from "./pendingSave";
import { handleMessage, type RouterDeps } from "./router";
import {
  clearSession,
  expireIfIdle,
  saveSession,
  type KeyValueStore,
} from "./session";
import { getAutoLockMinutes, setAutoLockMinutes } from "./settings";
import { createVaultService } from "./vaultService";

const IDLE_ALARM = "idle-check";
const CLIPBOARD_ALARM = "clipboard-clear";
const CLIPBOARD_CLEAR_MS = 30_000;

// Keys and tokens go ONLY to storage.session (memory, wiped when the browser closes).
// The non-secret auto-lock setting goes to storage.local.
const sessionStore: KeyValueStore = browser.storage.session;
const localStore: KeyValueStore = browser.storage.local;
const now = () => Date.now();

const pending = createPendingStore(sessionStore, now);

async function lock(): Promise<void> {
  await clearSession(sessionStore);
  await pending.clearAll();
}

// Every "is the vault unlocked?" read goes through this, so an idle expiry
// discovered on use also wipes any parked plaintext pending saves.
const activeSession = createActiveSessionReader({
  store: sessionStore,
  pending,
  now,
  getAutoLockMinutes: () => getAutoLockMinutes(localStore),
});

const vault = createVaultService({
  getSession: activeSession,
  replaceSession: (session) => saveSession(sessionStore, session),
  lock,
  api: {
    login,
    list: listVaultEntries,
    get: getVaultEntry,
    create: createVaultEntry,
    update: updateVaultEntry,
    remove: deleteVaultEntry,
  },
});

const deps: RouterDeps = {
  extension: { extensionId: browser.runtime.id, extensionOrigin: browser.runtime.getURL("") },
  auth: {
    login: (email, masterPassword) => performLogin({ store: sessionStore, now, login }, email, masterPassword),
    logout: lock,
    status: async () => {
      const session = await activeSession();
      return session ? { locked: false, email: session.email } : { locked: true };
    },
  },
  settings: {
    getAutoLockMinutes: () => getAutoLockMinutes(localStore),
    setAutoLockMinutes: (minutes) => setAutoLockMinutes(localStore, minutes),
  },
  vault,
  pending,
  scheduleClipboardClear: async () => {
    await browser.alarms.create(CLIPBOARD_ALARM, { when: now() + CLIPBOARD_CLEAR_MS });
  },
};

browser.runtime.onMessage.addListener((message: unknown, sender) => handleMessage(message, sender, deps));

// Backstop for the idle lock: alarms survive the background script being unloaded,
// setTimeout does not.
void browser.alarms.create(IDLE_ALARM, { periodInMinutes: 1 });
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === IDLE_ALARM) {
    if (await expireIfIdle(sessionStore, now(), await getAutoLockMinutes(localStore))) {
      await pending.clearAll();
    }
  } else if (alarm.name === CLIPBOARD_ALARM) {
    await navigator.clipboard.writeText("");
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  void pending.discard(tabId);
});
