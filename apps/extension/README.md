# Password Manager: browser extension (Zen / Firefox)

Manifest V3 extension: login, vault browsing/editing, click-to-fill autofill, and a
save/update prompt. Design: `docs/superpowers/specs/2026-09-19-browser-extension-design.md`.

## Build and load

```bash
cd apps/extension
cp .env.example .env          # set VITE_API_URL to your API
bun install
bun run build                 # writes dist/
```

In Zen or Firefox: open `about:debugging#/runtime/this-firefox`, choose
**Load Temporary Add-on...**, and pick `apps/extension/dist/manifest.json`. After each
`bun run build`, click **Reload** on the extension there. Temporary add-ons are removed
when the browser closes.

## Commands

| Command | What it does |
|---|---|
| `bun run build` | Bundles popup/options (React) and the background/content scripts into `dist/` |
| `bun run test` | Vitest unit and component tests |
| `bun run typecheck` | `tsc --noEmit` |

## How it is put together

- `src/background/` owns the session and is the only code that calls the API.
- `src/popup/`, `src/options/` (React) and `src/content/` (plain TypeScript) talk to it through
  typed, validated messages (`src/messaging/`); the background checks who sent each one.
- `src/crypto/` and `src/api/` are copied from `apps/mobile` (kept byte-compatible; see
  `src/crypto/interop.test.ts`).

## Security model

- Keys and the access token live only in `browser.storage.session` (memory; wiped when the
  browser closes). Nothing secret is written to disk. The vault auto-locks after an idle timeout.
- The master password is used once to derive keys, then discarded.
- Content scripts never receive the vault key or the full vault. A password is released only
  for an entry whose URL matches the page, and only after a trusted click.
- The extension UI on pages lives in a closed shadow DOM; nothing renders untrusted strings as HTML.

## Known limitations (v1)

- HTTPS pages and `localhost` only; top frame and same-origin iframes only.
- Exact hostname matching (an entry for `example.com` is not offered on `accounts.example.com`).
- Login only (accounts are created in the mobile app); no manual "add entry" screen.
- Backend gap: the API does not cap `ciphertext` size yet.
