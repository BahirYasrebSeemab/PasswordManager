# Browser Extension (Zen/Firefox first)

## Context

`apps/extension` is empty. This spec designs the browser extension as a new client of
the existing API (`apps/api`, live on Railway in a `development` environment),
alongside the mobile app. It builds the extension's **own** password-field detection,
autofill, and save-prompt UI (Phase 2 behavior in `CLAUDE.md`), which the user has
explicitly authorized from the start, superseding the original "Phase 1 only" note.

Target: Zen Browser / Firefox first via WebExtensions. Chrome later, optionally.

## Decisions made during brainstorming

- **Manifest V3, plain Vite, hand-rolled `manifest.json`.** No WXT/Plasmo: hiding the
  manifest and build wiring behind a framework works against the project's goal of
  learning the mechanism. Cost accepted: no automatic hot-reload of the loaded extension.
- **React (react-dom) for popup/options pages; plain TypeScript for the content script.**
  The popup has real stateful screens; a content script is injected into every page and
  must stay small.
- **Session model:** unlocked while the browser is open, auto-lock on idle, always locked
  after the browser closes. Keys are never written to disk.
- **Autofill trigger:** a small icon inside detected fields; fill only on an explicit
  click. No silent autofill on page load.
- **Save prompt:** on form submit, if the credential is new (offer save) or the password
  changed for a saved username (offer update).
- **Login only.** Accounts are created on mobile; the extension has no registration.
- **Always-online.** No local cache, no sync queue, no conflict resolution.
- **No manual "add entry" screen** in v1 (the save prompt creates entries; mobile covers
  manual add). No "never for this site" blocklist in v1.

## Architecture & file structure

```
apps/extension/
  manifest.json
  vite.config.ts              # multi-entry: background, content, popup, options
  src/
    background/
      index.ts                # message router; the only place that calls the API
      session.ts              # unlock/lock, idle check, storage.session (de)serialization
      vaultService.ts         # list/match/save/update/delete using ported api + crypto
    content/
      index.ts                # entry point injected into pages
      fieldDetector.ts        # username/password field heuristics
      overlay.ts              # closed shadow-DOM icon, picker, save banner
      formCapture.ts          # submit / Enter / button-click capture
    popup/                    # React: Login, VaultList, EntryDetail
    options/                  # React: auto-lock timeout, logout
    crypto/                   # copied from apps/mobile/src/crypto, unchanged
    api/                      # copied from apps/mobile/src/api, unchanged
    messaging/
      types.ts                # typed request/response contract
      validate.ts             # runtime shape checks for incoming messages
    safety/
      limits.ts               # field length limits + validators (see Input safety)
      safeUrl.ts              # http/https-only URL check
```

`crypto/` and `api/` are copied from mobile (they contain no React Native imports).
Copy-and-diverge is accepted for now; a shared package is deferred until duplication
actually hurts (YAGNI).

**All work routes through the background script.** Content scripts and the popup never
call the API or touch key material directly; they send typed messages to the background,
which holds the session. One owner avoids multiple contexts holding key copies.

## Session & lock model

Keys (`vaultKey`, `authKey`), `accessToken`, and email live in `browser.storage.session`:
in-memory, survives the background script being unloaded, wiped when the browser closes.
Bytes are base64-encoded (storage is JSON-only) using the ported `base64.ts`.

Rejected alternatives:
- **Module-level variable:** Firefox's MV3 background is non-persistent and can be
  unloaded while the browser is open, silently losing the key.
- **`storage.local`:** persists to disk. Storing `vaultKey` unencrypted on disk violates
  the zero-knowledge posture. Mobile persisted only behind biometric-gated SecureStore;
  the browser has no equivalent, so we never persist it.

**Idle auto-lock** is check-on-use, like mobile's check-on-resume: every vault-touching
request updates `lastActivityAt`; before serving anything the background compares
`now - lastActivityAt` to the timeout and clears the session if exceeded. A
`browser.alarms` backstop (every minute) also clears an expired session so a key does
not sit in memory past the timeout waiting for a request. Alarms survive background
unloads, `setTimeout` does not. Timeout is stored in `storage.local` (not secret);
presets 1 / 5 / **15 (default)** / 30 / 60 minutes.

**Login:** popup sends `{type:"login", email, masterPassword}`; the background runs
`deriveKeys`, calls `/auth/login` with `authKey`, stores the session, and discards the
master password. Derivation runs in the background (not the popup) because the popup is
destroyed when it loses focus, which would abort a 1-2 second PBKDF2 mid-flight.
`@noble/hashes` is kept (not WebCrypto) so derivation is byte-for-byte the same code as
mobile; swapping to native PBKDF2 later is an optimization, not a requirement.

**Token expiry:** JWTs last 30 minutes while auto-lock may be up to 60. On a 401 the
background re-logs-in silently with the retained `authKey`, retries once, and only locks
if that also fails.

**Logout:** clears `storage.session`.

## Content script

**Detection (`fieldDetector.ts`):** visible `input[type=password]` fields, each paired with
the closest preceding `type=email`/`text` input in the same `<form>` (or same container
when there is no form), preferring `autocomplete="username"`. A `MutationObserver`
re-scans for JS-rendered forms.

**UI (`overlay.ts`):** icon, picker, and save banner render in a **closed Shadow DOM** so
page CSS/JS cannot restyle, read, or click them. Filling uses the native `value` setter
plus dispatched `input`/`change` events (React/Vue-controlled inputs ignore plain
assignment).

**Security rules (enforced in the background):**
- The content script never receives `vaultKey` or the full vault. It requests entries for
  the page; the background derives the origin from `sender.tab.url` itself (never from a
  value the content script supplies) and returns only `id + title + username` for matches.
- The password is returned by a **second call at fill time**, only after a trusted click
  (`event.isTrusted`) and only if that entry's URL matches the sender's origin.
- **HTTPS only** (plus `localhost`); nothing is offered on plain HTTP pages.
- **Top frame and same-origin iframes only.** Cross-origin iframes are skipped.
- **Exact hostname match** (ignoring `www.`), not registrable-domain matching (that needs
  the Public Suffix List). Known limitation: a login saved for `example.com` is not offered
  on `accounts.example.com`.

**Save prompt (`formCapture.ts`):** listens for `submit`, Enter in a password field, and
clicks on submit-like buttons (SPAs often never fire `submit`). It sends
`{username, password}` to the background, which compares against entries for that origin:
none → **Save**; same username with a different password → **Update**; identical → nothing.
The post-login redirect destroys the content script, so the background parks the pending
candidate in `storage.session` keyed by tab id (expires after ~2 minutes); the next page's
content script asks "anything pending for this tab?" and shows the banner. Locked vault →
no prompt in v1. Banner: **Save** / **Not now**.

## Popup, API, errors

**Popup:** asks the background "locked or unlocked?" on open and renders **Login**,
**Vault list** (search), or **Entry detail** (show/hide, copy, edit, delete). Copy clears
the clipboard after 30 seconds. **Options page:** auto-lock timeout, logout. State is plain
`useState` plus a small hook that talks to the background; no state library.

**API:** background only, via the ported client. Base URL comes from build-time
`VITE_API_URL`. Extension background fetches are governed by manifest `host_permissions`,
not CORS, so **no backend CORS change is required**.

**Errors:** network failure → inline popup error / banner "couldn't save, try again"
(never silently drop a credential); 401 → silent re-login once, else lock; locked
mid-action → popup returns to the login screen.

## Input safety

**What the server can receive:** only `email`, `auth_key`, and `ciphertext`. A script string
typed into the master password becomes 32 derived bytes; entry fields are encrypted before
sending, so the server stores opaque ciphertext and never interprets it. SQLAlchemy
parameterizes queries. Email is already validated (ASCII, 3-255 chars, contains `@`).

**The real risk is stored XSS on the display side.** A hostile string can enter the vault
(the save prompt captures whatever a malicious page's form contains) and later be rendered
inside the extension, a privileged context. Defenses:

1. React only; `dangerouslySetInnerHTML` is banned (lint rule).
2. The overlay uses `createElement`/`textContent` only, never `innerHTML`.
3. An entry's `url` renders as a link only if `safeUrl.ts` confirms an `http:`/`https:`
   scheme (blocks `javascript:` and `data:`).
4. Keep the MV3 default extension-page CSP (`script-src 'self'`); never add
   `unsafe-inline` or `unsafe-eval`.
5. Client-side limits before encrypting or sending (`limits.ts`): title 200, username 320,
   password 1024, url 2048; email validated to mirror the backend. Oversized captures from
   the save prompt are rejected with a message, not truncated silently.
6. The background rejects any message whose `sender.id` is not this extension, and
   runtime-validates message shape (`validate.ts`), dropping unknown types.

**Backend gap (out of scope, flagged):** `VaultEntryCreate.ciphertext` is only checked for
non-empty, with no maximum length, so an authenticated client can store arbitrarily large
blobs. Recommend a separate small API change (server-side size cap mirroring the client
limits). This is a cross-cutting API contract change, so it is not bundled into this work.

## Testing

Vitest + jsdom. Unit tests: field detection (HTML fixtures), lock/idle logic (mocked
`storage.session`/`alarms`), origin matching, save/update/ignore comparison, `safeUrl`,
message validation and sender checks. React Testing Library for popup screens. The ported
crypto tests carry over with the same test vectors, proving byte-identical derivation with
mobile. Real-browser behavior (icon placement, fill on real sites) is verified manually in
Zen. Automated browser E2E is out of scope for v1.

## To verify during implementation

- Whether Firefox/Zen MV3 requires the user to grant `host_permissions` after install, and
  what that means for the install experience (affects both the API origin and content-script
  matches).
- Real-world behavior of `event.isTrusted` and closed shadow DOM inside Zen.

## Also in scope

Update `CLAUDE.md`'s browser-extension section to record that Phase 2 is authorized.

## Out of scope

- Chrome build (later, optional).
- Registration from the extension; manual add-entry screen; "never for this site" list.
- Offline cache, sync queue, conflict resolution.
- Registrable-domain matching; cross-origin iframe filling.
- Backend `ciphertext` size cap (separate API change).
- Shared crypto/api package between mobile and extension.
