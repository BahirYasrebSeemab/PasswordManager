# Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/extension`, a Zen/Firefox Manifest V3 extension with login, vault browsing/editing, click-to-fill autofill, and a save/update prompt, all talking to the existing API with client-side encryption.

**Architecture:** A background script owns the session (keys in `browser.storage.session`) and is the only code that calls the API or handles key material. The popup/options pages (React) and the content script (plain TS, closed shadow DOM UI) talk to it through typed, validated, sender-checked messages. `crypto/` and `api/` are copied from `apps/mobile/src` (no imports across apps).

**Tech Stack:** TypeScript, Vite (multi-build via JS API), React 19 (popup/options only), `@noble/hashes` + `@noble/ciphers` (^2.4.0, same as mobile), Vitest + jsdom + Testing Library, `@types/firefox-webext-browser`, Bun as package manager.

**Spec:** `docs/superpowers/specs/2026-09-19-browser-extension-design.md`

## Global Constraints

- Manifest V3, hand-rolled `manifest.json`; Firefox `background.scripts` (not `service_worker`); `strict_min_version` `115.0` (needed for `storage.session`).
- No WXT/Plasmo. No state library in the popup. No `dangerouslySetInnerHTML` and no `innerHTML`/`insertAdjacentHTML` in shipped code (test fixtures may use `innerHTML`); UI text via `textContent`/React only.
- Keys (`vaultKey`, `authKey`), access token, and pending-save records live ONLY in `browser.storage.session`; never `storage.local`, never logged.
- Master password is used only inside the background login handler and discarded.
- Entry ciphertext format is identical to mobile: `encryptEntry(vaultKey, JSON.stringify(VaultEntryContent))`. Editing an entry must preserve fields the extension does not show (`notes`).
- Field limits: title 200, username 320, password 1024, url 2048, notes 10000, email 255 (3 minimum).
- Auto-lock presets 1 / 5 / 15 (default) / 30 / 60 minutes.
- Page eligibility: `https:` pages or `http://localhost`. Hostname match is exact, ignoring `www.` and case.
- Messages: unknown types, wrong shapes, foreign `sender.id`, and wrong sender kind are rejected. Popup-type messages only from extension pages; content-type messages only from content scripts.
- Tests: Vitest, default environment `node`; DOM tests opt in with `// @vitest-environment jsdom` on line 1. No `console.log` in shipped code.
- Commits: short message, NO author/Claude attribution lines. Stage only the files of the task.
- Do not touch `apps/mobile`, `apps/api`, or `infra/terraform`. Only `apps/extension/`, plus `CLAUDE.md` (Task 1) and `README.md` (Task 14).
- Explain what/how/why/boundaries of each change in the chat reply after each task (project rule in `CLAUDE.md`).

## File Structure

```
apps/extension/
  manifest.json                # base manifest (host_permissions injected at build)
  popup.html, options.html     # Vite HTML entries
  package.json, tsconfig.json, vitest.config.ts, .gitignore, .env.example
  scripts/
    build.ts                   # runs 3 Vite builds + writes dist/manifest.json
    manifest.ts                # buildManifest(base, apiUrl) pure function
  src/
    crypto/                    # base64, cipher, deriveKeys (copied from mobile)
    api/                       # client, auth (login only), vault
    vault/entry.ts             # VaultEntryContent type
    safety/                    # limits.ts, safeUrl.ts
    shared/matching.ts         # hostname/eligibility/entry-vs-page matching + decideSave
    messaging/                 # types.ts, validate.ts, client.ts
    testing/memoryStore.ts     # in-memory KeyValueStore fake for tests
    background/                # session.ts, settings.ts, auth.ts, vaultService.ts,
                               # pendingSave.ts, router.ts, index.ts
    content/                   # fieldDetector.ts, frames.ts, fill.ts, overlay.ts,
                               # formCapture.ts, index.ts
    popup/                     # main.tsx, App.tsx, styles.css, screens/*, clipboard.ts
    options/                   # main.tsx, OptionsApp.tsx
```

Deviation from the spec's tree: matching lives in `src/shared/` because both the background and the content script need it.

---

### Task 1: Scaffold the extension app

**Files:**
- Create: `apps/extension/package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `manifest.json`, `popup.html`, `options.html`
- Create: `apps/extension/scripts/manifest.ts`, `scripts/manifest.test.ts`, `scripts/build.ts`
- Create (stubs): `src/background/index.ts`, `src/content/index.ts`, `src/popup/main.tsx`, `src/options/main.tsx`
- Modify: `/home/yasreb/projects/password_manager/CLAUDE.md` (browser-extension section)

**Interfaces:**
- Produces: `buildManifest(base: Record<string, unknown>, apiUrl: string): Record<string, unknown>` in `scripts/manifest.ts`; `bun run build` writes `dist/{manifest.json,popup.html,options.html,background.js,content.js}`; `bun run test`, `bun run typecheck`.

- [ ] **Step 1: Create the package and install dependencies**

```bash
cd /home/yasreb/projects/password_manager/apps/extension
cat > package.json <<'EOF'
{
  "name": "extension",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "bun run scripts/build.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
EOF
bun add react react-dom @noble/hashes@^2.4.0 @noble/ciphers@^2.4.0
bun add -d vite @vitejs/plugin-react typescript vitest jsdom @testing-library/react @testing-library/user-event @types/react @types/react-dom @types/firefox-webext-browser
```

- [ ] **Step 2: Write config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["firefox-webext-browser", "vite/client", "vitest/globals", "node"]
  },
  "include": ["src", "scripts", "vitest.config.ts"]
}
```
(If `@types/node` is missing, run `bun add -d @types/node`.)

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
```

`.gitignore`:
```
node_modules/
dist/
.env
coverage/
*.tsbuildinfo
```

`.env.example`:
```
# Base URL of the API the extension talks to. Copy to .env (gitignored).
VITE_API_URL=https://api-development-7ebd.up.railway.app
```

`manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "Password Manager",
  "version": "0.1.0",
  "description": "Zero-knowledge password manager: autofill and save prompts.",
  "browser_specific_settings": {
    "gecko": { "id": "password-manager@yasreb.local", "strict_min_version": "115.0" }
  },
  "action": { "default_title": "Password Manager", "default_popup": "popup.html" },
  "options_ui": { "page": "options.html", "open_in_tab": true },
  "background": { "scripts": ["background.js"] },
  "permissions": ["storage", "alarms", "clipboardWrite"],
  "content_scripts": [
    {
      "matches": ["https://*/*", "http://localhost/*"],
      "js": ["content.js"],
      "all_frames": true,
      "run_at": "document_idle"
    }
  ]
}
```

`popup.html` (and `options.html` identical except the script path `/src/options/main.tsx`):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Password Manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/popup/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Write the failing manifest test**

`scripts/manifest.test.ts`:
```ts
import { buildManifest } from "./manifest";

test("adds the API origin as a host permission", () => {
  const manifest = buildManifest({ name: "x" }, "https://api.example.com/some/path/");
  expect(manifest.host_permissions).toEqual(["https://api.example.com/*"]);
  expect(manifest.name).toBe("x");
});

test("keeps a non-default port in the origin", () => {
  const manifest = buildManifest({}, "http://localhost:8000");
  expect(manifest.host_permissions).toEqual(["http://localhost:8000/*"]);
});

test("throws on an invalid API URL", () => {
  expect(() => buildManifest({}, "not a url")).toThrow();
});

test("does not mutate the base manifest", () => {
  const base = { name: "x" };
  buildManifest(base, "https://api.example.com");
  expect(base).toEqual({ name: "x" });
});
```

- [ ] **Step 4: Run it, confirm it fails**

Run: `bun run test scripts/manifest.test.ts`
Expected: FAIL (cannot find `./manifest`).

- [ ] **Step 5: Implement `scripts/manifest.ts`**

```ts
export function buildManifest(base: Record<string, unknown>, apiUrl: string): Record<string, unknown> {
  const origin = new URL(apiUrl).origin;
  return { ...base, host_permissions: [`${origin}/*`] };
}
```

- [ ] **Step 6: Run the test, confirm it passes**

Run: `bun run test scripts/manifest.test.ts` → PASS (4 tests).

- [ ] **Step 7: Write stubs and the build script**

`src/background/index.ts`: `export {};`
`src/content/index.ts`: `export {};`
`src/popup/main.tsx` and `src/options/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(<p>Password Manager</p>);
```

`scripts/build.ts`:
```ts
import { build, loadEnv, type InlineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildManifest } from "./manifest";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "dist");
const mode = process.env.NODE_ENV === "development" ? "development" : "production";

const apiUrl = loadEnv(mode, root, "VITE_").VITE_API_URL;
if (!apiUrl) {
  throw new Error("VITE_API_URL is not set. Copy .env.example to .env first.");
}

// Content and background scripts are classic scripts (no ES imports at runtime),
// so each is bundled on its own as a self-contained IIFE.
function scriptConfig(entry: string, name: string): InlineConfig {
  return {
    root,
    configFile: false,
    mode,
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: false,
      lib: { entry: resolve(root, entry), formats: ["iife"], name, fileName: () => `${name}.js` },
    },
  };
}

const pagesConfig: InlineConfig = {
  root,
  configFile: false,
  mode,
  base: "./",
  logLevel: "warn",
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: { input: { popup: resolve(root, "popup.html"), options: resolve(root, "options.html") } },
  },
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await build(pagesConfig);
await build(scriptConfig("src/background/index.ts", "background"));
await build(scriptConfig("src/content/index.ts", "content"));

const base = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as Record<string, unknown>;
await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(buildManifest(base, apiUrl), null, 2));
console.info(`Built extension to ${outDir}`);
```

- [ ] **Step 8: Verify the build, typecheck, and tests**

```bash
cp .env.example .env
bun run build && ls dist && cat dist/manifest.json
bun run typecheck
bun run test
```
Expected: `dist` contains `manifest.json popup.html options.html background.js content.js assets/`; `host_permissions` is `["https://api-development-7ebd.up.railway.app/*"]`; typecheck clean; 4 tests pass. Fix any typing issue with `import.meta.dirname` by keeping `"node"` in `types`.

- [ ] **Step 9: Update `CLAUDE.md`**

Replace the whole "Browser extension — phased scope, don't build ahead of the current phase" section (heading through the end of the "Phase 2" paragraph) with:

```markdown
## Browser extension — Phase 2 authorized

The extension builds its own password-field detection, autofill, and save-prompt UI (the
former "Phase 2"). Explicitly authorized on 2026-09-19; design:
`docs/superpowers/specs/2026-09-19-browser-extension-design.md`. Order: Zen/Firefox first,
then Chrome. Every other rule in this file (modularity, zero-knowledge, explanations) still applies.
```

- [ ] **Step 10: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension CLAUDE.md
git status --short   # confirm no .env, node_modules, or dist are staged
git commit -m "scaffold extension app"
```

---

### Task 2: Crypto module (copied from mobile) with interop vectors

**Files:**
- Create: `apps/extension/src/crypto/{base64,cipher,deriveKeys}.ts` and their three `.test.ts` files (copies)
- Create: `apps/extension/src/crypto/interop.test.ts`

**Interfaces:**
- Produces: `deriveKeys(email: string, masterPassword: string): { vaultKey: Uint8Array; authKey: Uint8Array }`, `encryptEntry(vaultKey: Uint8Array, plaintext: string): string`, `decryptEntry(vaultKey: Uint8Array, encoded: string): string`, `bytesToBase64(bytes: Uint8Array): string`, `base64ToBytes(b64: string): Uint8Array` (all under `src/crypto/`).

- [ ] **Step 1: Copy the modules and tests verbatim**

```bash
cd /home/yasreb/projects/password_manager/apps/extension
mkdir -p src/crypto
for f in base64 cipher deriveKeys; do
  cp ../mobile/src/crypto/$f.ts src/crypto/$f.ts
  cp ../mobile/src/crypto/$f.test.ts src/crypto/$f.test.ts
done
```
They use Jest-style globals (`test`, `expect`), which Vitest provides via `globals: true`; no edits needed.

- [ ] **Step 2: Write the interop test**

The expected values below were produced by running mobile's own `deriveKeys` and `encryptEntry`, so this test proves the extension is byte-compatible with mobile.

`src/crypto/interop.test.ts`:
```ts
import { deriveKeys } from "./deriveKeys";
import { decryptEntry } from "./cipher";

const EMAIL = "test@example.com";
const PASSWORD = "correct horse battery staple";
const VAULT_KEY_HEX = "721487cc265c5466347632b8e5819480597e7308b291b0897ee22a656ee2db7c";
const AUTH_KEY_HEX = "37ceb802860b8532d1ef5d86ec4555f1cc90a4bb8818b3891938369b30ce506f";
const MOBILE_CIPHERTEXT =
  "HK0OU1QJKxsybgtrgNSLcCSFZIlkwelSDPAbMTNDRB2UO0Qndvju7480je7RaQj54nRP2wcG8ymG9hwbHo3UnrqTlKGZnBrS6FrTz4M60HtEumSYq/YlAkC38yKoSii7P8yxRoVnEuktIhlGp17qR9xHh3aSQ3ZFK3vIOYrnT+aMdoJRv3SnXzN6";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

test("derives exactly the keys mobile derives for the same email and password", () => {
  const { vaultKey, authKey } = deriveKeys(EMAIL, PASSWORD);
  expect(hex(vaultKey)).toBe(VAULT_KEY_HEX);
  expect(hex(authKey)).toBe(AUTH_KEY_HEX);
});

test("decrypts a ciphertext that mobile's encryptEntry produced", () => {
  const vaultKey = Uint8Array.from(Buffer.from(VAULT_KEY_HEX, "hex"));
  const content = JSON.parse(decryptEntry(vaultKey, MOBILE_CIPHERTEXT));
  expect(content).toEqual({
    title: "Example",
    username: "me@example.com",
    password: "hunter2",
    url: "https://example.com",
    notes: "kat",
  });
});
```

- [ ] **Step 3: Run the crypto tests**

Run: `bun run test src/crypto`
Expected: PASS (copied tests + 2 interop tests; PBKDF2 tests take a second or two). If a copied test fails only because of the Node/`Uint8Array` realm, confirm the file has no `@vitest-environment jsdom` line (crypto tests must run in `node`).

- [ ] **Step 4: Typecheck and commit**

```bash
bun run typecheck
cd /home/yasreb/projects/password_manager
git add apps/extension/src/crypto
git commit -m "add extension crypto module with mobile interop tests"
```

---

### Task 3: API client module (copied and adapted from mobile)

**Files:**
- Create: `apps/extension/src/api/client.ts`, `client.test.ts`, `auth.ts`, `auth.test.ts`, `vault.ts`, `vault.test.ts`

**Interfaces:**
- Consumes: `bytesToBase64` from `src/crypto/base64.ts`.
- Produces: `ApiError` (`status: number`, `detail: unknown`), `apiRequest<T>(path, options)`; `login(email: string, authKey: Uint8Array): Promise<TokenResponse>` with `TokenResponse = { access_token: string; token_type: string }`; `VaultEntryResponse = { id: number; ciphertext: string; created_at: string; updated_at: string }`; `createVaultEntry(accessToken, ciphertext)`, `listVaultEntries(accessToken)`, `getVaultEntry(accessToken, id: string)`, `updateVaultEntry(accessToken, id: string, ciphertext)`, `deleteVaultEntry(accessToken, id: string)`.

Differences from mobile: base URL comes from `import.meta.env.VITE_API_URL`, read at call time (testable); `auth.ts` has `login` only (no registration in the extension); imports are relative, not the `@/` alias.

- [ ] **Step 1: Write the failing client test**

`src/api/client.test.ts`:
```ts
import { apiRequest, ApiError } from "./client";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.test");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function mockFetchOnce(status: number, body: unknown | undefined) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

test("returns the parsed body on a 200 and calls the configured base URL", async () => {
  const fetchMock = mockFetchOnce(200, { hello: "world" });
  await expect(apiRequest("/anything")).resolves.toEqual({ hello: "world" });
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/anything");
});

test("strips a trailing slash from the configured base URL", async () => {
  vi.stubEnv("VITE_API_URL", "https://api.test/");
  const fetchMock = mockFetchOnce(200, {});
  await apiRequest("/x");
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/x");
});

test("sends the bearer token and JSON body", async () => {
  const fetchMock = mockFetchOnce(200, {});
  await apiRequest("/x", { method: "POST", body: { a: 1 }, accessToken: "tok" });
  const init = fetchMock.mock.calls[0][1];
  expect(init.method).toBe("POST");
  expect(init.headers.Authorization).toBe("Bearer tok");
  expect(init.body).toBe(JSON.stringify({ a: 1 }));
});

test("throws ApiError with the parsed detail on a non-2xx response", async () => {
  mockFetchOnce(404, { detail: "not found" });
  await expect(apiRequest("/x")).rejects.toMatchObject({ status: 404, detail: "not found" });
});

test("returns undefined for a 204 without calling response.json()", async () => {
  mockFetchOnce(204, undefined);
  await expect(apiRequest("/x", { method: "DELETE" })).resolves.toBeUndefined();
});

test("throws ApiError for a non-ok empty 204-like response", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 204 }) as unknown as typeof fetch;
  await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiError);
});

test("throws a clear error when VITE_API_URL is not configured", async () => {
  vi.stubEnv("VITE_API_URL", "");
  await expect(apiRequest("/x")).rejects.toThrow("VITE_API_URL");
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `bun run test src/api/client.test.ts` → FAIL (cannot find `./client`).

- [ ] **Step 3: Implement `src/api/client.ts`**

```ts
export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(`API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function getBaseUrl(): string {
  const url = import.meta.env.VITE_API_URL as string | undefined;
  if (!url) {
    throw new Error("VITE_API_URL is not set");
  }
  return url.replace(/\/$/, "");
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // A 204 No Content response (vault DELETE success) has no body; calling
  // response.json() on it throws, so handle it before parsing.
  if (response.status === 204) {
    if (!response.ok) {
      throw new ApiError(response.status, undefined);
    }
    return undefined as T;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, (data as { detail?: unknown }).detail);
  }

  return data as T;
}
```

- [ ] **Step 4: Run the client test, confirm it passes**

Run: `bun run test src/api/client.test.ts` → PASS (7 tests).

- [ ] **Step 5: Write failing `auth`/`vault` tests**

`src/api/auth.test.ts`:
```ts
import { login } from "./auth";
import { bytesToBase64 } from "../crypto/base64";

beforeEach(() => vi.stubEnv("VITE_API_URL", "https://api.test"));
afterEach(() => vi.unstubAllEnvs());

test("login posts the email and base64 auth key", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ access_token: "t", token_type: "bearer" }),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const authKey = new Uint8Array(32).fill(7);

  const result = await login("me@example.com", authKey);

  expect(result.access_token).toBe("t");
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/auth/login");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    email: "me@example.com",
    auth_key: bytesToBase64(authKey),
  });
});
```

`src/api/vault.test.ts`:
```ts
import {
  createVaultEntry,
  deleteVaultEntry,
  getVaultEntry,
  listVaultEntries,
  updateVaultEntry,
} from "./vault";

beforeEach(() => vi.stubEnv("VITE_API_URL", "https://api.test"));
afterEach(() => vi.unstubAllEnvs());

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

test("createVaultEntry posts ciphertext with the bearer token", async () => {
  const fn = mockFetch(200, { id: 1 });
  await createVaultEntry("tok", "cipher");
  expect(fn.mock.calls[0][0]).toBe("https://api.test/vault");
  expect(fn.mock.calls[0][1].method).toBe("POST");
  expect(fn.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ ciphertext: "cipher" });
});

test("listVaultEntries and getVaultEntry hit the right paths", async () => {
  const fn = mockFetch(200, []);
  await listVaultEntries("tok");
  await getVaultEntry("tok", "5");
  expect(fn.mock.calls[0][0]).toBe("https://api.test/vault");
  expect(fn.mock.calls[1][0]).toBe("https://api.test/vault/5");
});

test("updateVaultEntry puts ciphertext to the entry path", async () => {
  const fn = mockFetch(200, { id: 5 });
  await updateVaultEntry("tok", "5", "new");
  expect(fn.mock.calls[0][0]).toBe("https://api.test/vault/5");
  expect(fn.mock.calls[0][1].method).toBe("PUT");
  expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ ciphertext: "new" });
});

test("deleteVaultEntry resolves to undefined on 204", async () => {
  const fn = mockFetch(204);
  await expect(deleteVaultEntry("tok", "5")).resolves.toBeUndefined();
  expect(fn.mock.calls[0][1].method).toBe("DELETE");
});
```

- [ ] **Step 6: Run them, confirm they fail** (`bun run test src/api` → cannot find `./auth` / `./vault`).

- [ ] **Step 7: Implement `src/api/auth.ts` and `src/api/vault.ts`**

`src/api/auth.ts`:
```ts
import { bytesToBase64 } from "../crypto/base64";
import { apiRequest, ApiError } from "./client";

export { ApiError };

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export function login(email: string, authKey: Uint8Array): Promise<TokenResponse> {
  return apiRequest<TokenResponse>("/auth/login", {
    method: "POST",
    body: { email, auth_key: bytesToBase64(authKey) },
  });
}
```

`src/api/vault.ts`: copy `apps/mobile/src/api/vault.ts` verbatim (its only import is `./client`):
```bash
cp ../mobile/src/api/vault.ts src/api/vault.ts
```

- [ ] **Step 8: Run tests and typecheck**

Run: `bun run test src/api && bun run typecheck` → PASS / clean. (`import.meta.env` typing comes from `vite/client` in tsconfig `types`.)

- [ ] **Step 9: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension/src/api
git commit -m "add extension api client"
```

### Task 4: Entry type and input-safety helpers

**Files:**
- Create: `apps/extension/src/vault/entry.ts`
- Create: `apps/extension/src/safety/limits.ts`, `limits.test.ts`, `safeUrl.ts`, `safeUrl.test.ts`

**Interfaces:**
- Produces: `VaultEntryContent { title: string; username?: string; password: string; url?: string; notes?: string }`; `LIMITS`; `ValidationResult = { ok: true } | { ok: false; reason: string }`; `validateEntryContent(content: VaultEntryContent): ValidationResult`; `validateLoginInput(email: string, masterPassword: string): ValidationResult`; `isSafeHttpUrl(value: string): boolean`.

- [ ] **Step 1: Create the entry type**

`src/vault/entry.ts`:
```ts
export interface VaultEntryContent {
  title: string;
  username?: string;
  password: string;
  url?: string;
  notes?: string;
}
```

- [ ] **Step 2: Write failing tests**

`src/safety/safeUrl.test.ts`:
```ts
import { isSafeHttpUrl } from "./safeUrl";

test.each(["https://example.com", "http://example.com/path?x=1", "https://localhost:3000"])(
  "accepts %s",
  (url) => expect(isSafeHttpUrl(url)).toBe(true)
);

test.each([
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "ftp://example.com",
  "file:///etc/passwd",
  "example.com",
  "",
])("rejects %s", (url) => expect(isSafeHttpUrl(url)).toBe(false));
```

`src/safety/limits.test.ts`:
```ts
import { LIMITS, validateEntryContent, validateLoginInput } from "./limits";

const ok = { title: "Site", password: "pw" };

test("accepts a minimal valid entry", () => {
  expect(validateEntryContent(ok)).toEqual({ ok: true });
});

test("requires a non-blank title and a non-empty password", () => {
  expect(validateEntryContent({ ...ok, title: "   " }).ok).toBe(false);
  expect(validateEntryContent({ ...ok, password: "" }).ok).toBe(false);
});

test.each([
  ["title", { title: "x".repeat(LIMITS.title + 1), password: "pw" }],
  ["username", { ...ok, username: "x".repeat(LIMITS.username + 1) }],
  ["password", { ...ok, password: "x".repeat(LIMITS.password + 1) }],
  ["url", { ...ok, url: "x".repeat(LIMITS.url + 1) }],
  ["notes", { ...ok, notes: "x".repeat(LIMITS.notes + 1) }],
])("rejects an oversized %s", (_field, content) => {
  expect(validateEntryContent(content).ok).toBe(false);
});

test("accepts values exactly at the limit", () => {
  expect(validateEntryContent({ title: "x".repeat(LIMITS.title), password: "y".repeat(LIMITS.password) }).ok).toBe(true);
});

test("validateLoginInput accepts a normal email and password", () => {
  expect(validateLoginInput("me@example.com", "pw")).toEqual({ ok: true });
});

test.each([
  ["", "pw"],
  ["no-at-sign", "pw"],
  ["a b@example.com", "pw"],
  ["müller@example.com", "pw"],
  ["a@" + "x".repeat(LIMITS.email), "pw"],
  ["me@example.com", ""],
  ["me@example.com", "x".repeat(LIMITS.password + 1)],
])("validateLoginInput rejects (%s, password length %#)", (email, password) => {
  expect(validateLoginInput(email, password).ok).toBe(false);
});
```

- [ ] **Step 3: Run, confirm failure** (`bun run test src/safety` → cannot find modules).

- [ ] **Step 4: Implement**

`src/safety/safeUrl.ts`:
```ts
// Only http(s) URLs may ever be rendered as a link; blocks javascript: and data: schemes.
export function isSafeHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
```

`src/safety/limits.ts`:
```ts
import type { VaultEntryContent } from "../vault/entry";

export const LIMITS = {
  title: 200,
  username: 320,
  password: 1024,
  url: 2048,
  notes: 10_000,
  email: 255,
} as const;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): ValidationResult => ({ ok: false, reason });

export function validateEntryContent(content: VaultEntryContent): ValidationResult {
  if (content.title.trim().length === 0) return fail("Title is required.");
  if (content.password.length === 0) return fail("Password is required.");

  const fields: Array<[string, string | undefined, number]> = [
    ["Title", content.title, LIMITS.title],
    ["Username", content.username, LIMITS.username],
    ["Password", content.password, LIMITS.password],
    ["URL", content.url, LIMITS.url],
    ["Notes", content.notes, LIMITS.notes],
  ];
  for (const [label, value, max] of fields) {
    if (value !== undefined && value.length > max) {
      return fail(`${label} is too long (max ${max} characters).`);
    }
  }
  return { ok: true };
}

// Mirrors the backend's email rules (apps/api/app/auth/schemas.py): ASCII only,
// 3-255 chars, contains "@", no spaces. ASCII keeps the PBKDF2 salt unambiguous.
export function validateLoginInput(email: string, masterPassword: string): ValidationResult {
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > LIMITS.email) return fail("Enter a valid email.");
  if (!normalized.includes("@") || /\s/.test(normalized)) return fail("Enter a valid email.");
  if (!/^[\x00-\x7F]*$/.test(normalized)) return fail("Email must contain only ASCII characters.");
  if (masterPassword.length === 0) return fail("Enter your master password.");
  if (masterPassword.length > LIMITS.password) return fail("Master password is too long.");
  return { ok: true };
}
```

- [ ] **Step 5: Run tests and typecheck** (`bun run test src/safety && bun run typecheck` → PASS / clean).

- [ ] **Step 6: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension/src/vault apps/extension/src/safety
git commit -m "add entry type and input safety helpers"
```

---

### Task 5: Messaging contract, validation, sender checks

**Files:**
- Create: `apps/extension/src/messaging/types.ts`, `validate.ts`, `validate.test.ts`, `client.ts`, `client.test.ts`

**Interfaces:**
- Consumes: `VaultEntryContent`.
- Produces (all exported from `types.ts`): `Message = PopupRequest | ContentRequest`; `ErrorCode = "locked" | "network" | "invalid_input" | "invalid_credentials" | "not_found" | "forbidden" | "rate_limited"`; `Failure`; `Result<T>`; `EntrySummary`; `PendingSave`; `ResponseMap` (message `type` → response); `POPUP_TYPES`, `CONTENT_TYPES`. From `validate.ts`: `parseMessage(raw: unknown): Message | null`; `SenderInfo { id?: string; url?: string; tab?: { id?: number } }`; `isAllowedSender(message: Message, sender: SenderInfo, ctx: { extensionId: string; extensionOrigin: string }): boolean`. From `client.ts`: `sendMessage<T extends Message["type"]>(message: Extract<Message, { type: T }>): Promise<ResponseMap[T]>`.

- [ ] **Step 1: Write `src/messaging/types.ts`** (types and constants only, nothing to test)

```ts
import type { VaultEntryContent } from "../vault/entry";

export type PopupRequest =
  | { type: "getStatus" }
  | { type: "login"; email: string; masterPassword: string }
  | { type: "logout" }
  | { type: "listEntries" }
  | { type: "getEntry"; id: number }
  | { type: "updateEntry"; id: number; content: VaultEntryContent }
  | { type: "deleteEntry"; id: number }
  | { type: "getAutoLockMinutes" }
  | { type: "setAutoLockMinutes"; minutes: number }
  | { type: "scheduleClipboardClear" };

export type ContentRequest =
  | { type: "findMatches" }
  | { type: "getCredentialForFill"; id: number }
  | { type: "credentialSubmitted"; username: string; password: string }
  | { type: "getPendingSave" }
  | { type: "confirmSave" }
  | { type: "dismissSave" };

export type Message = PopupRequest | ContentRequest;

export const POPUP_TYPES: ReadonlyArray<PopupRequest["type"]> = [
  "getStatus", "login", "logout", "listEntries", "getEntry", "updateEntry",
  "deleteEntry", "getAutoLockMinutes", "setAutoLockMinutes", "scheduleClipboardClear",
];

export const CONTENT_TYPES: ReadonlyArray<ContentRequest["type"]> = [
  "findMatches", "getCredentialForFill", "credentialSubmitted",
  "getPendingSave", "confirmSave", "dismissSave",
];

export type ErrorCode =
  | "locked"
  | "network"
  | "invalid_input"
  | "invalid_credentials"
  | "not_found"
  | "forbidden"
  | "rate_limited";

export interface Failure {
  ok: false;
  error: ErrorCode;
}

export type Result<T extends object = object> = ({ ok: true } & T) | Failure;

export interface EntrySummary {
  id: number;
  title: string;
  username?: string;
  url?: string;
}

export interface PendingSave {
  kind: "save" | "update";
  username: string;
  origin: string;
}

export interface ResponseMap {
  getStatus: { locked: boolean; email?: string };
  login: Result;
  logout: { ok: true };
  listEntries: Result<{ entries: EntrySummary[] }>;
  getEntry: Result<{ entry: VaultEntryContent }>;
  updateEntry: Result;
  deleteEntry: Result;
  getAutoLockMinutes: { minutes: number };
  setAutoLockMinutes: Result;
  scheduleClipboardClear: { ok: true };
  findMatches: Result<{ matches: EntrySummary[] }>;
  getCredentialForFill: Result<{ username: string; password: string }>;
  credentialSubmitted: Result;
  getPendingSave: { pending: PendingSave | null };
  confirmSave: Result;
  dismissSave: { ok: true };
}
```

- [ ] **Step 2: Write the failing validation test**

`src/messaging/validate.test.ts`:
```ts
import { isAllowedSender, parseMessage } from "./validate";

const ctx = { extensionId: "ext@id", extensionOrigin: "moz-extension://abc/" };
const popupSender = { id: "ext@id", url: "moz-extension://abc/popup.html" };
const optionsTabSender = { id: "ext@id", url: "moz-extension://abc/options.html", tab: { id: 4 } };
const contentSender = { id: "ext@id", url: "https://example.com/login", tab: { id: 7 } };

describe("parseMessage", () => {
  test("accepts well-formed messages and drops unknown extra fields", () => {
    expect(parseMessage({ type: "login", email: "a@b.co", masterPassword: "pw", evil: 1 })).toEqual({
      type: "login",
      email: "a@b.co",
      masterPassword: "pw",
    });
    expect(parseMessage({ type: "getEntry", id: 3 })).toEqual({ type: "getEntry", id: 3 });
    expect(parseMessage({ type: "findMatches" })).toEqual({ type: "findMatches" });
    expect(parseMessage({ type: "setAutoLockMinutes", minutes: 15 })).toEqual({
      type: "setAutoLockMinutes",
      minutes: 15,
    });
  });

  test("accepts an entry update and keeps only known content fields", () => {
    const parsed = parseMessage({
      type: "updateEntry",
      id: 2,
      content: { title: "T", password: "p", username: "u", url: "https://x.io", notes: "n", junk: true },
    });
    expect(parsed).toEqual({
      type: "updateEntry",
      id: 2,
      content: { title: "T", password: "p", username: "u", url: "https://x.io", notes: "n" },
    });
  });

  test.each([
    null,
    undefined,
    "login",
    42,
    {},
    { type: "nope" },
    { type: "login", email: "a@b.co" },
    { type: "login", email: 1, masterPassword: "pw" },
    { type: "getEntry", id: "3" },
    { type: "getEntry", id: -1 },
    { type: "getEntry", id: 1.5 },
    { type: "setAutoLockMinutes", minutes: "15" },
    { type: "updateEntry", id: 1, content: { title: "T" } },
    { type: "updateEntry", id: 1, content: { title: "T", password: "p", url: 5 } },
    { type: "credentialSubmitted", username: "u" },
  ])("rejects %j", (raw) => {
    expect(parseMessage(raw)).toBeNull();
  });
});

describe("isAllowedSender", () => {
  const login = { type: "login", email: "a@b.co", masterPassword: "pw" } as const;
  const find = { type: "findMatches" } as const;

  test("popup messages are allowed from the popup and from the options page in a tab", () => {
    expect(isAllowedSender(login, popupSender, ctx)).toBe(true);
    expect(isAllowedSender(login, optionsTabSender, ctx)).toBe(true);
  });

  test("popup messages are rejected from a content script", () => {
    expect(isAllowedSender(login, contentSender, ctx)).toBe(false);
  });

  test("content messages are allowed only from a content script with a tab", () => {
    expect(isAllowedSender(find, contentSender, ctx)).toBe(true);
    expect(isAllowedSender(find, popupSender, ctx)).toBe(false);
    expect(isAllowedSender(find, { id: "ext@id", url: "https://example.com/" }, ctx)).toBe(false);
  });

  test("a foreign extension id is rejected", () => {
    expect(isAllowedSender(login, { ...popupSender, id: "evil@id" }, ctx)).toBe(false);
    expect(isAllowedSender(find, { ...contentSender, id: undefined }, ctx)).toBe(false);
  });

  test("a sender without a url is rejected", () => {
    expect(isAllowedSender(login, { id: "ext@id" }, ctx)).toBe(false);
  });
});
```

- [ ] **Step 3: Run, confirm failure** (`bun run test src/messaging/validate.test.ts` → cannot find `./validate`).

- [ ] **Step 4: Implement `src/messaging/validate.ts`**

```ts
import type { VaultEntryContent } from "../vault/entry";
import { CONTENT_TYPES, POPUP_TYPES, type Message } from "./types";

const isString = (v: unknown): v is string => typeof v === "string";
const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isOptionalString = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

function parseContent(value: unknown): VaultEntryContent | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (!isString(c.title) || !isString(c.password)) return null;
  if (!isOptionalString(c.username) || !isOptionalString(c.url) || !isOptionalString(c.notes)) return null;
  const content: VaultEntryContent = { title: c.title, password: c.password };
  if (c.username !== undefined) content.username = c.username;
  if (c.url !== undefined) content.url = c.url;
  if (c.notes !== undefined) content.notes = c.notes;
  return content;
}

// Validates the runtime shape of an incoming message and returns a clean copy
// containing only known fields, or null if it is malformed or unknown.
export function parseMessage(raw: unknown): Message | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;

  switch (m.type) {
    case "getStatus":
    case "logout":
    case "listEntries":
    case "getAutoLockMinutes":
    case "scheduleClipboardClear":
    case "findMatches":
    case "getPendingSave":
    case "confirmSave":
    case "dismissSave":
      return { type: m.type };
    case "login":
      return isString(m.email) && isString(m.masterPassword)
        ? { type: "login", email: m.email, masterPassword: m.masterPassword }
        : null;
    case "getEntry":
    case "deleteEntry":
    case "getCredentialForFill":
      return isId(m.id) ? { type: m.type, id: m.id } : null;
    case "updateEntry": {
      const content = parseContent(m.content);
      return isId(m.id) && content ? { type: "updateEntry", id: m.id, content } : null;
    }
    case "setAutoLockMinutes":
      return typeof m.minutes === "number" ? { type: "setAutoLockMinutes", minutes: m.minutes } : null;
    case "credentialSubmitted":
      return isString(m.username) && isString(m.password)
        ? { type: "credentialSubmitted", username: m.username, password: m.password }
        : null;
    default:
      return null;
  }
}

export interface SenderInfo {
  id?: string;
  url?: string;
  tab?: { id?: number };
}

export interface SenderContext {
  extensionId: string;
  extensionOrigin: string;
}

// Popup-type messages must come from this extension's own pages (popup, or the
// options page even when opened in a tab). Content-type messages must come from
// a content script: a real tab whose url is NOT an extension page.
export function isAllowedSender(message: Message, sender: SenderInfo, ctx: SenderContext): boolean {
  if (sender.id !== ctx.extensionId || !sender.url) return false;
  const fromExtensionPage = sender.url.startsWith(ctx.extensionOrigin);

  if ((POPUP_TYPES as readonly string[]).includes(message.type)) return fromExtensionPage;
  if ((CONTENT_TYPES as readonly string[]).includes(message.type)) {
    return !fromExtensionPage && sender.tab?.id !== undefined;
  }
  return false;
}
```

- [ ] **Step 5: Write the client wrapper test and implementation**

`src/messaging/client.test.ts`:
```ts
import { sendMessage } from "./client";

afterEach(() => {
  delete (globalThis as { browser?: unknown }).browser;
});

test("sendMessage forwards the message to the background and returns its response", async () => {
  const send = vi.fn().mockResolvedValue({ locked: true });
  (globalThis as { browser?: unknown }).browser = { runtime: { sendMessage: send } };

  const response = await sendMessage({ type: "getStatus" });

  expect(send).toHaveBeenCalledWith({ type: "getStatus" });
  expect(response).toEqual({ locked: true });
});
```

`src/messaging/client.ts`:
```ts
import type { Message, ResponseMap } from "./types";

export function sendMessage<T extends Message["type"]>(
  message: Extract<Message, { type: T }>
): Promise<ResponseMap[T]> {
  return browser.runtime.sendMessage(message) as Promise<ResponseMap[T]>;
}
```

- [ ] **Step 6: Run tests and typecheck** (`bun run test src/messaging && bun run typecheck` → PASS / clean). If TypeScript will not narrow `m.type` in the grouped `case` labels, cast: `return { type: m.type } as Message;`.

- [ ] **Step 7: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension/src/messaging
git commit -m "add extension messaging contract with validation"
```

---

### Task 6: Session, settings, and login (background core)

**Files:**
- Create: `apps/extension/src/testing/memoryStore.ts`
- Create: `apps/extension/src/background/session.ts`, `session.test.ts`, `settings.ts`, `settings.test.ts`, `auth.ts`, `auth.test.ts`

**Interfaces:**
- Consumes: `bytesToBase64`/`base64ToBytes`, `deriveKeys`, `login` + `ApiError`, `validateLoginInput`, `Result`.
- Produces: `KeyValueStore { get(key: string | null): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void>; remove(key: string): Promise<void> }`; `Session { email: string; vaultKey: Uint8Array; authKey: Uint8Array; accessToken: string; lastActivityAt: number }`; `saveSession(store, session)`, `loadSession(store): Promise<Session | null>`, `clearSession(store)`, `getActiveSession(store, now: number, autoLockMinutes: number): Promise<Session | null>` (clears if idle, otherwise refreshes `lastActivityAt`), `expireIfIdle(store, now, autoLockMinutes): Promise<boolean>` (never extends the session); `AUTO_LOCK_PRESETS`, `DEFAULT_AUTO_LOCK_MINUTES`, `getAutoLockMinutes(store): Promise<number>`, `setAutoLockMinutes(store, minutes): Promise<boolean>`; `AuthDeps { store: KeyValueStore; now: () => number; login: typeof login }`, `performLogin(deps, email, masterPassword): Promise<Result>`; `createMemoryStore()`.

- [ ] **Step 1: Write the in-memory store fake**

`src/testing/memoryStore.ts`:
```ts
import type { KeyValueStore } from "../background/session";

export function createMemoryStore(): KeyValueStore & { dump(): Record<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    async get(key) {
      if (key === null) return structuredClone(Object.fromEntries(data));
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    },
    async remove(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data);
    },
  };
}
```

- [ ] **Step 2: Write the failing session test**

`src/background/session.test.ts`:
```ts
import { createMemoryStore } from "../testing/memoryStore";
import {
  clearSession,
  expireIfIdle,
  getActiveSession,
  loadSession,
  saveSession,
  type Session,
} from "./session";

const MINUTE = 60_000;
const session: Session = {
  email: "me@example.com",
  vaultKey: new Uint8Array(32).fill(1),
  authKey: new Uint8Array(32).fill(2),
  accessToken: "tok",
  lastActivityAt: 1_000,
};

test("round-trips a session, restoring the key bytes", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  const loaded = await loadSession(store);
  expect(loaded).toEqual(session);
  expect(loaded?.vaultKey).toBeInstanceOf(Uint8Array);
});

test("stores keys as base64 strings, never raw bytes", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  const stored = store.dump().session as Record<string, unknown>;
  expect(typeof stored.vaultKey).toBe("string");
  expect(typeof stored.authKey).toBe("string");
});

test("loadSession returns null when nothing is stored or the data is malformed", async () => {
  const store = createMemoryStore();
  expect(await loadSession(store)).toBeNull();
  await store.set({ session: { email: 5 } });
  expect(await loadSession(store)).toBeNull();
});

test("clearSession removes the session", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  await clearSession(store);
  expect(await loadSession(store)).toBeNull();
});

test("getActiveSession returns the session and refreshes lastActivityAt when within the timeout", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  const active = await getActiveSession(store, 1_000 + 10 * MINUTE, 15);
  expect(active?.lastActivityAt).toBe(1_000 + 10 * MINUTE);
  expect((await loadSession(store))?.lastActivityAt).toBe(1_000 + 10 * MINUTE);
});

test("getActiveSession clears and returns null once idle past the timeout", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  expect(await getActiveSession(store, 1_000 + 16 * MINUTE, 15)).toBeNull();
  expect(await loadSession(store)).toBeNull();
});

test("getActiveSession returns null when there is no session", async () => {
  expect(await getActiveSession(createMemoryStore(), 5, 15)).toBeNull();
});

test("expireIfIdle clears an expired session without extending a live one", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  expect(await expireIfIdle(store, 1_000 + 5 * MINUTE, 15)).toBe(false);
  expect((await loadSession(store))?.lastActivityAt).toBe(1_000);
  expect(await expireIfIdle(store, 1_000 + 16 * MINUTE, 15)).toBe(true);
  expect(await loadSession(store)).toBeNull();
});
```

- [ ] **Step 3: Run, confirm failure** (`bun run test src/background/session.test.ts` → cannot find `./session`).

- [ ] **Step 4: Implement `src/background/session.ts`**

```ts
import { base64ToBytes, bytesToBase64 } from "../crypto/base64";

// Subset of browser.storage.StorageArea that we use, so tests can inject a fake.
export interface KeyValueStore {
  get(key: string | null): Promise<Record<string, unknown>>; // null = everything
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Session {
  email: string;
  vaultKey: Uint8Array;
  authKey: Uint8Array;
  accessToken: string;
  lastActivityAt: number;
}

interface StoredSession {
  email: string;
  vaultKey: string;
  authKey: string;
  accessToken: string;
  lastActivityAt: number;
}

const SESSION_KEY = "session";
const MINUTE_MS = 60_000;

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.email === "string" &&
    typeof v.vaultKey === "string" &&
    typeof v.authKey === "string" &&
    typeof v.accessToken === "string" &&
    typeof v.lastActivityAt === "number"
  );
}

// storage.session only holds JSON, so key bytes are base64-encoded on the way in.
export async function saveSession(store: KeyValueStore, session: Session): Promise<void> {
  const stored: StoredSession = {
    email: session.email,
    vaultKey: bytesToBase64(session.vaultKey),
    authKey: bytesToBase64(session.authKey),
    accessToken: session.accessToken,
    lastActivityAt: session.lastActivityAt,
  };
  await store.set({ [SESSION_KEY]: stored });
}

export async function loadSession(store: KeyValueStore): Promise<Session | null> {
  const stored = (await store.get(SESSION_KEY))[SESSION_KEY];
  if (!isStoredSession(stored)) return null;
  return {
    email: stored.email,
    vaultKey: base64ToBytes(stored.vaultKey),
    authKey: base64ToBytes(stored.authKey),
    accessToken: stored.accessToken,
    lastActivityAt: stored.lastActivityAt,
  };
}

export async function clearSession(store: KeyValueStore): Promise<void> {
  await store.remove(SESSION_KEY);
}

function isIdle(session: Session, now: number, autoLockMinutes: number): boolean {
  return now - session.lastActivityAt > autoLockMinutes * MINUTE_MS;
}

// Check-on-use idle lock: returns the live session (and records the activity),
// or clears it and returns null when it has been idle past the timeout.
export async function getActiveSession(
  store: KeyValueStore,
  now: number,
  autoLockMinutes: number
): Promise<Session | null> {
  const session = await loadSession(store);
  if (!session) return null;
  if (isIdle(session, now, autoLockMinutes)) {
    await clearSession(store);
    return null;
  }
  const touched = { ...session, lastActivityAt: now };
  await saveSession(store, touched);
  return touched;
}

// Alarm backstop: clears an expired session so a key never lingers past the
// timeout. Deliberately does NOT record activity.
export async function expireIfIdle(
  store: KeyValueStore,
  now: number,
  autoLockMinutes: number
): Promise<boolean> {
  const session = await loadSession(store);
  if (!session || !isIdle(session, now, autoLockMinutes)) return false;
  await clearSession(store);
  return true;
}
```

- [ ] **Step 5: Run the session tests** (`bun run test src/background/session.test.ts` → PASS, 8 tests).

- [ ] **Step 6: Settings test and implementation**

`src/background/settings.test.ts`:
```ts
import { createMemoryStore } from "../testing/memoryStore";
import { DEFAULT_AUTO_LOCK_MINUTES, getAutoLockMinutes, setAutoLockMinutes } from "./settings";

test("defaults to 15 minutes", async () => {
  expect(DEFAULT_AUTO_LOCK_MINUTES).toBe(15);
  expect(await getAutoLockMinutes(createMemoryStore())).toBe(15);
});

test("stores a preset value", async () => {
  const store = createMemoryStore();
  expect(await setAutoLockMinutes(store, 30)).toBe(true);
  expect(await getAutoLockMinutes(store)).toBe(30);
});

test("rejects values that are not presets", async () => {
  const store = createMemoryStore();
  expect(await setAutoLockMinutes(store, 7)).toBe(false);
  expect(await getAutoLockMinutes(store)).toBe(15);
});

test("falls back to the default if the stored value is corrupt", async () => {
  const store = createMemoryStore();
  await store.set({ autoLockMinutes: "abc" });
  expect(await getAutoLockMinutes(store)).toBe(15);
});
```

`src/background/settings.ts`:
```ts
import type { KeyValueStore } from "./session";

export const AUTO_LOCK_PRESETS = [1, 5, 15, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
const KEY = "autoLockMinutes";

// The timeout is not secret, so it lives in storage.local (persists across restarts).
export async function getAutoLockMinutes(store: KeyValueStore): Promise<number> {
  const value = (await store.get(KEY))[KEY];
  return typeof value === "number" && (AUTO_LOCK_PRESETS as readonly number[]).includes(value)
    ? value
    : DEFAULT_AUTO_LOCK_MINUTES;
}

export async function setAutoLockMinutes(store: KeyValueStore, minutes: number): Promise<boolean> {
  if (!(AUTO_LOCK_PRESETS as readonly number[]).includes(minutes)) return false;
  await store.set({ [KEY]: minutes });
  return true;
}
```

- [ ] **Step 7: Login test and implementation**

`src/background/auth.test.ts`:
```ts
import { ApiError } from "../api/client";
import { createMemoryStore } from "../testing/memoryStore";
import { performLogin } from "./auth";
import { loadSession } from "./session";

vi.mock("../crypto/deriveKeys", () => ({
  deriveKeys: vi.fn(() => ({ vaultKey: new Uint8Array(32).fill(9), authKey: new Uint8Array(32).fill(8) })),
}));

function deps(loginImpl: (email: string, authKey: Uint8Array) => Promise<{ access_token: string; token_type: string }>) {
  const store = createMemoryStore();
  return { store, deps: { store, now: () => 123, login: vi.fn(loginImpl) } };
}

test("a successful login stores the session and returns ok", async () => {
  const { store, deps: d } = deps(async () => ({ access_token: "tok", token_type: "bearer" }));
  await expect(performLogin(d, "  Me@Example.com ", "pw")).resolves.toEqual({ ok: true });
  expect(d.login).toHaveBeenCalledWith("me@example.com", new Uint8Array(32).fill(8));
  const session = await loadSession(store);
  expect(session).toMatchObject({ email: "me@example.com", accessToken: "tok", lastActivityAt: 123 });
});

test("invalid input never reaches key derivation or the network", async () => {
  const { deps: d } = deps(async () => ({ access_token: "x", token_type: "bearer" }));
  await expect(performLogin(d, "not-an-email", "pw")).resolves.toEqual({ ok: false, error: "invalid_input" });
  expect(d.login).not.toHaveBeenCalled();
});

test("a 401 maps to invalid_credentials and stores nothing", async () => {
  const { store, deps: d } = deps(async () => {
    throw new ApiError(401, "Incorrect");
  });
  await expect(performLogin(d, "me@example.com", "pw")).resolves.toEqual({
    ok: false,
    error: "invalid_credentials",
  });
  expect(await loadSession(store)).toBeNull();
});

test("a 429 maps to rate_limited and other failures to network", async () => {
  const limited = deps(async () => {
    throw new ApiError(429, "slow down");
  });
  await expect(performLogin(limited.deps, "me@example.com", "pw")).resolves.toEqual({
    ok: false,
    error: "rate_limited",
  });
  const down = deps(async () => {
    throw new TypeError("fetch failed");
  });
  await expect(performLogin(down.deps, "me@example.com", "pw")).resolves.toEqual({
    ok: false,
    error: "network",
  });
});
```

`src/background/auth.ts`:
```ts
import { ApiError, login as apiLogin } from "../api/auth";
import { deriveKeys } from "../crypto/deriveKeys";
import type { Result } from "../messaging/types";
import { validateLoginInput } from "../safety/limits";
import { saveSession, type KeyValueStore } from "./session";

export interface AuthDeps {
  store: KeyValueStore;
  now: () => number;
  login: typeof apiLogin;
}

// The master password exists only inside this function: it is turned into keys,
// the keys go to storage.session, and the password is never stored or logged.
export async function performLogin(deps: AuthDeps, email: string, masterPassword: string): Promise<Result> {
  if (!validateLoginInput(email, masterPassword).ok) {
    return { ok: false, error: "invalid_input" };
  }
  const normalizedEmail = email.trim().toLowerCase();
  const { vaultKey, authKey } = deriveKeys(normalizedEmail, masterPassword);

  try {
    const token = await deps.login(normalizedEmail, authKey);
    await saveSession(deps.store, {
      email: normalizedEmail,
      vaultKey,
      authKey,
      accessToken: token.access_token,
      lastActivityAt: deps.now(),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { ok: false, error: "invalid_credentials" };
    if (error instanceof ApiError && error.status === 429) return { ok: false, error: "rate_limited" };
    return { ok: false, error: "network" };
  }
}
```

- [ ] **Step 8: Run all new tests and typecheck** (`bun run test src/background && bun run typecheck` → PASS / clean).

- [ ] **Step 9: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension/src/testing apps/extension/src/background
git commit -m "add extension session, settings, and login"
```

### Task 7: Page matching and the vault service

**Files:**
- Create: `apps/extension/src/shared/matching.ts`, `matching.test.ts`
- Create: `apps/extension/src/background/vaultService.ts`, `vaultService.test.ts`

**Interfaces:**
- Consumes: `Session`, api functions, `encryptEntry`/`decryptEntry`, `validateEntryContent`, `EntrySummary`/`Result`/`Failure`.
- Produces from `matching.ts`: `hostnameOf(url: string): string | null`, `originOf(url: string): string | null`, `isEligiblePageUrl(url: string): boolean`, `entryMatchesPage(entryUrl: string | undefined, pageUrl: string): boolean`, `DecryptedEntry { id: number; content: VaultEntryContent }`, `SaveDecision = { kind: "save" } | { kind: "update"; id: number } | { kind: "none" }`, `decideSave(entries: DecryptedEntry[], pageUrl: string, username: string, password: string): SaveDecision`. From `vaultService.ts`: `VaultServiceDeps`, `createVaultService(deps): VaultService` with methods `listEntries()`, `getEntry(id: number)`, `updateEntry(id: number, content: VaultEntryContent)`, `deleteEntry(id: number)`, `findMatches(pageUrl: string)`, `getCredentialForFill(id: number, pageUrl: string)`, `evaluateSubmission(pageUrl, username, password)`, `saveNew(pageUrl, username, password)`, `saveUpdate(id: number, password: string)` (each returns a `Result<...>` from `messaging/types`, except `evaluateSubmission` which returns `Result<{ decision: SaveDecision }>`); `type VaultService = ReturnType<typeof createVaultService>`.

- [ ] **Step 1: Write the failing matching test**

`src/shared/matching.test.ts`:
```ts
import { decideSave, entryMatchesPage, hostnameOf, isEligiblePageUrl, originOf } from "./matching";

test("hostnameOf lowercases, drops www and port, and tolerates a missing scheme", () => {
  expect(hostnameOf("https://WWW.Example.com:8443/login")).toBe("example.com");
  expect(hostnameOf("example.com/login")).toBe("example.com");
  expect(hostnameOf("")).toBeNull();
});

test("originOf returns the origin or null", () => {
  expect(originOf("https://example.com/a?b=1")).toBe("https://example.com");
  expect(originOf("nope")).toBeNull();
});

test("only https pages and http://localhost are eligible", () => {
  expect(isEligiblePageUrl("https://example.com")).toBe(true);
  expect(isEligiblePageUrl("http://localhost:3000/login")).toBe(true);
  expect(isEligiblePageUrl("http://example.com")).toBe(false);
  expect(isEligiblePageUrl("ftp://example.com")).toBe(false);
  expect(isEligiblePageUrl("about:blank")).toBe(false);
});

test("entryMatchesPage requires an exact hostname (ignoring www) on an eligible page", () => {
  expect(entryMatchesPage("https://example.com", "https://www.example.com/login")).toBe(true);
  expect(entryMatchesPage("example.com", "https://example.com/")).toBe(true);
  expect(entryMatchesPage("https://example.com", "https://accounts.example.com")).toBe(false);
  expect(entryMatchesPage("https://example.com", "https://evil-example.com")).toBe(false);
  expect(entryMatchesPage("https://example.com", "http://example.com")).toBe(false);
  expect(entryMatchesPage(undefined, "https://example.com")).toBe(false);
});

describe("decideSave", () => {
  const entries = [
    { id: 1, content: { title: "Ex", username: "me", password: "old", url: "https://example.com" } },
    { id: 2, content: { title: "Other", username: "me", password: "x", url: "https://other.com" } },
  ];
  const page = "https://example.com/login";

  test("offers to save when no entry exists for that site and username", () => {
    expect(decideSave(entries, page, "someone-else", "pw")).toEqual({ kind: "save" });
    expect(decideSave([], page, "me", "pw")).toEqual({ kind: "save" });
  });

  test("offers to update when the username matches but the password changed", () => {
    expect(decideSave(entries, page, "me", "new")).toEqual({ kind: "update", id: 1 });
  });

  test("does nothing when the same credential is already saved", () => {
    expect(decideSave(entries, page, "me", "old")).toEqual({ kind: "none" });
  });

  test("ignores entries saved for other sites", () => {
    expect(decideSave(entries, "https://other.com/", "me", "x")).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run, confirm failure; then implement `src/shared/matching.ts`**

Run: `bun run test src/shared` → FAIL. Then:
```ts
import type { VaultEntryContent } from "../vault/entry";

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

function parse(url: string): URL | null {
  try {
    return new URL(HAS_SCHEME.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
}

export function hostnameOf(url: string): string | null {
  const parsed = parse(url);
  return parsed ? parsed.hostname.toLowerCase().replace(/^www\./, "") : null;
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isEligiblePageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

// Exact hostname match. Known limitation (see spec): no registrable-domain matching,
// so an entry for example.com is not offered on accounts.example.com.
export function entryMatchesPage(entryUrl: string | undefined, pageUrl: string): boolean {
  if (!entryUrl || !isEligiblePageUrl(pageUrl)) return false;
  const entryHost = hostnameOf(entryUrl);
  return entryHost !== null && entryHost === hostnameOf(pageUrl);
}

export interface DecryptedEntry {
  id: number;
  content: VaultEntryContent;
}

export type SaveDecision = { kind: "save" } | { kind: "update"; id: number } | { kind: "none" };

export function decideSave(
  entries: DecryptedEntry[],
  pageUrl: string,
  username: string,
  password: string
): SaveDecision {
  const sameSiteAndUser = entries.find(
    (entry) =>
      entryMatchesPage(entry.content.url, pageUrl) &&
      (entry.content.username ?? "").trim() === username.trim()
  );
  if (!sameSiteAndUser) return { kind: "save" };
  return sameSiteAndUser.content.password === password
    ? { kind: "none" }
    : { kind: "update", id: sameSiteAndUser.id };
}
```

Run: `bun run test src/shared` → PASS.

- [ ] **Step 3: Write the failing vault service test**

`src/background/vaultService.test.ts`:
```ts
import { ApiError } from "../api/client";
import { decryptEntry, encryptEntry } from "../crypto/cipher";
import type { VaultEntryContent } from "../vault/entry";
import type { Session } from "./session";
import { createVaultService } from "./vaultService";

const vaultKey = new Uint8Array(32).fill(3);
const session: Session = {
  email: "me@example.com",
  vaultKey,
  authKey: new Uint8Array(32).fill(4),
  accessToken: "tok1",
  lastActivityAt: 0,
};

const seal = (content: VaultEntryContent) => encryptEntry(vaultKey, JSON.stringify(content));
const row = (id: number, content: VaultEntryContent) => ({
  id,
  ciphertext: seal(content),
  created_at: "",
  updated_at: "",
});

const rows = [
  row(2, { title: "Zed", username: "z", password: "zp", url: "https://zed.com", notes: "keep me" }),
  row(1, { title: "alpha", username: "a", password: "ap", url: "https://example.com" }),
];

function setup(overrides: Partial<Parameters<typeof createVaultService>[0]["api"]> = {}, current: Session | null = session) {
  const api = {
    login: vi.fn().mockResolvedValue({ access_token: "tok2", token_type: "bearer" }),
    list: vi.fn().mockImplementation(async () => rows),
    get: vi.fn().mockImplementation(async (_t: string, id: string) => rows.find((r) => String(r.id) === id)),
    create: vi.fn().mockResolvedValue({ id: 9 }),
    update: vi.fn().mockResolvedValue({ id: 1 }),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const deps = {
    getSession: vi.fn().mockResolvedValue(current),
    replaceSession: vi.fn().mockResolvedValue(undefined),
    lock: vi.fn().mockResolvedValue(undefined),
    api,
  };
  return { service: createVaultService(deps as never), deps, api };
}

test("returns locked when there is no active session, without calling the API", async () => {
  const { service, api } = setup({}, null);
  expect(await service.listEntries()).toEqual({ ok: false, error: "locked" });
  expect(api.list).not.toHaveBeenCalled();
});

test("listEntries decrypts, sorts by title case-insensitively, and skips undecryptable rows", async () => {
  const { service } = setup({
    list: vi.fn().mockResolvedValue([...rows, { id: 3, ciphertext: "AAAA", created_at: "", updated_at: "" }]),
  });
  const result = await service.listEntries();
  expect(result.ok && result.entries.map((e) => e.title)).toEqual(["alpha", "Zed"]);
  expect(result.ok && result.entries[0]).not.toHaveProperty("password");
});

test("on a 401 it re-logs-in once with the retained authKey, stores the new token, and retries", async () => {
  const list = vi.fn().mockRejectedValueOnce(new ApiError(401, "expired")).mockResolvedValueOnce(rows);
  const { service, deps, api } = setup({ list });
  const result = await service.listEntries();
  expect(result.ok).toBe(true);
  expect(api.login).toHaveBeenCalledWith("me@example.com", session.authKey);
  expect(deps.replaceSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "tok2" }));
  expect(list).toHaveBeenLastCalledWith("tok2");
});

test("if the re-login is also rejected it locks and reports locked", async () => {
  const { service, deps } = setup({
    list: vi.fn().mockRejectedValue(new ApiError(401, "expired")),
    login: vi.fn().mockRejectedValue(new ApiError(401, "bad")),
  });
  expect(await service.listEntries()).toEqual({ ok: false, error: "locked" });
  expect(deps.lock).toHaveBeenCalled();
});

test("network failures and 404s map to error codes", async () => {
  const down = setup({ list: vi.fn().mockRejectedValue(new TypeError("fetch failed")) });
  expect(await down.service.listEntries()).toEqual({ ok: false, error: "network" });
  const missing = setup({ get: vi.fn().mockRejectedValue(new ApiError(404, "nope")) });
  expect(await missing.service.getEntry(5)).toEqual({ ok: false, error: "not_found" });
});

test("getEntry returns the decrypted content", async () => {
  const { service } = setup();
  const result = await service.getEntry(1);
  expect(result).toEqual({ ok: true, entry: expect.objectContaining({ title: "alpha", password: "ap" }) });
});

test("updateEntry validates first, then encrypts and sends", async () => {
  const { service, api } = setup();
  expect(await service.updateEntry(1, { title: "", password: "p" })).toEqual({ ok: false, error: "invalid_input" });
  expect(api.update).not.toHaveBeenCalled();

  expect(await service.updateEntry(1, { title: "New", password: "np" })).toEqual({ ok: true });
  const [, id, ciphertext] = api.update.mock.calls[0];
  expect(id).toBe("1");
  expect(JSON.parse(decryptEntry(vaultKey, ciphertext))).toEqual({ title: "New", password: "np" });
});

test("deleteEntry calls the API with the string id", async () => {
  const { service, api } = setup();
  expect(await service.deleteEntry(2)).toEqual({ ok: true });
  expect(api.remove).toHaveBeenCalledWith("tok1", "2");
});

test("findMatches returns only summaries for entries matching the page, with no passwords", async () => {
  const { service } = setup();
  const result = await service.findMatches("https://www.example.com/login");
  expect(result).toEqual({ ok: true, matches: [{ id: 1, title: "alpha", username: "a" }] });
});

test("getCredentialForFill refuses an entry that does not match the page's site", async () => {
  const { service } = setup();
  expect(await service.getCredentialForFill(1, "https://evil.com/")).toEqual({ ok: false, error: "forbidden" });
  expect(await service.getCredentialForFill(1, "https://example.com/")).toEqual({
    ok: true,
    username: "a",
    password: "ap",
  });
});

test("evaluateSubmission decides save / update / none and rejects oversized input", async () => {
  const { service } = setup();
  const page = "https://example.com/login";
  expect(await service.evaluateSubmission(page, "new-user", "pw")).toEqual({ ok: true, decision: { kind: "save" } });
  expect(await service.evaluateSubmission(page, "a", "changed")).toEqual({ ok: true, decision: { kind: "update", id: 1 } });
  expect(await service.evaluateSubmission(page, "a", "ap")).toEqual({ ok: true, decision: { kind: "none" } });
  expect(await service.evaluateSubmission(page, "a", "x".repeat(2000))).toEqual({ ok: false, error: "invalid_input" });
});

test("saveNew creates an encrypted entry titled by hostname with the origin as url", async () => {
  const { service, api } = setup();
  expect(await service.saveNew("https://www.newsite.com/login", "me", "pw")).toEqual({ ok: true });
  const ciphertext = api.create.mock.calls[0][1];
  expect(JSON.parse(decryptEntry(vaultKey, ciphertext))).toEqual({
    title: "newsite.com",
    username: "me",
    password: "pw",
    url: "https://www.newsite.com",
  });
});

test("saveUpdate changes only the password and preserves title, url, and notes", async () => {
  const { service, api } = setup();
  expect(await service.saveUpdate(2, "newpass")).toEqual({ ok: true });
  const [, id, ciphertext] = api.update.mock.calls[0];
  expect(id).toBe("2");
  expect(JSON.parse(decryptEntry(vaultKey, ciphertext))).toEqual({
    title: "Zed",
    username: "z",
    password: "newpass",
    url: "https://zed.com",
    notes: "keep me",
  });
});
```

- [ ] **Step 4: Run, confirm failure** (`bun run test src/background/vaultService.test.ts` → cannot find `./vaultService`).

- [ ] **Step 5: Implement `src/background/vaultService.ts`**

```ts
import type { login as apiLogin } from "../api/auth";
import { ApiError } from "../api/client";
import {
  createVaultEntry,
  deleteVaultEntry,
  getVaultEntry,
  listVaultEntries,
  updateVaultEntry,
  type VaultEntryResponse,
} from "../api/vault";
import { decryptEntry, encryptEntry } from "../crypto/cipher";
import type { EntrySummary, Failure, Result } from "../messaging/types";
import { validateEntryContent } from "../safety/limits";
import {
  decideSave,
  entryMatchesPage,
  hostnameOf,
  originOf,
  type DecryptedEntry,
  type SaveDecision,
} from "../shared/matching";
import type { VaultEntryContent } from "../vault/entry";
import type { Session } from "./session";

export interface VaultServiceDeps {
  getSession(): Promise<Session | null>;
  replaceSession(session: Session): Promise<void>;
  lock(): Promise<void>;
  api: {
    login: typeof apiLogin;
    list: typeof listVaultEntries;
    get: typeof getVaultEntry;
    create: typeof createVaultEntry;
    update: typeof updateVaultEntry;
    remove: typeof deleteVaultEntry;
  };
}

type Run<T> = { ok: true; value: T } | Failure;

function failureFor(error: unknown): Failure {
  if (error instanceof ApiError && error.status === 404) return { ok: false, error: "not_found" };
  if (error instanceof ApiError && error.status === 429) return { ok: false, error: "rate_limited" };
  return { ok: false, error: "network" };
}

function isContent(value: unknown): value is VaultEntryContent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && typeof v.password === "string";
}

function decryptRow(session: Session, row: VaultEntryResponse): DecryptedEntry | null {
  try {
    const content: unknown = JSON.parse(decryptEntry(session.vaultKey, row.ciphertext));
    return isContent(content) ? { id: row.id, content } : null;
  } catch {
    return null; // a corrupt or foreign row must not break the whole list
  }
}

function summarize({ id, content }: DecryptedEntry): EntrySummary {
  const summary: EntrySummary = { id, title: content.title };
  if (content.username) summary.username = content.username;
  if (content.url) summary.url = content.url;
  return summary;
}

const seal = (session: Session, content: VaultEntryContent) =>
  encryptEntry(session.vaultKey, JSON.stringify(content));

export function createVaultService(deps: VaultServiceDeps) {
  // Runs an authenticated operation. The JWT lasts 30 minutes but auto-lock can be
  // longer, so on a 401 we silently re-login with the retained authKey and retry once;
  // only if that is rejected too do we lock.
  async function run<T>(op: (session: Session) => Promise<T>): Promise<Run<T>> {
    const session = await deps.getSession();
    if (!session) return { ok: false, error: "locked" };
    try {
      return { ok: true, value: await op(session) };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) return failureFor(error);
    }
    try {
      const token = await deps.api.login(session.email, session.authKey);
      const refreshed = { ...session, accessToken: token.access_token };
      await deps.replaceSession(refreshed);
      return { ok: true, value: await op(refreshed) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await deps.lock();
        return { ok: false, error: "locked" };
      }
      return failureFor(error);
    }
  }

  const loadAll = () =>
    run(async (s) => {
      const rows = await deps.api.list(s.accessToken);
      return rows.map((row) => decryptRow(s, row)).filter((e): e is DecryptedEntry => e !== null);
    });

  const loadOne = (id: number) =>
    run(async (s) => decryptRow(s, await deps.api.get(s.accessToken, String(id))));

  function candidateContent(pageUrl: string, username: string, password: string): VaultEntryContent {
    const content: VaultEntryContent = {
      title: hostnameOf(pageUrl) ?? pageUrl,
      password,
      url: originOf(pageUrl) ?? pageUrl,
    };
    if (username) content.username = username;
    return content;
  }

  return {
    async listEntries(): Promise<Result<{ entries: EntrySummary[] }>> {
      const all = await loadAll();
      if (!all.ok) return all;
      const entries = all.value
        .map(summarize)
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
      return { ok: true, entries };
    },

    async getEntry(id: number): Promise<Result<{ entry: VaultEntryContent }>> {
      const one = await loadOne(id);
      if (!one.ok) return one;
      return one.value ? { ok: true, entry: one.value.content } : { ok: false, error: "not_found" };
    },

    async updateEntry(id: number, content: VaultEntryContent): Promise<Result> {
      if (!validateEntryContent(content).ok) return { ok: false, error: "invalid_input" };
      const result = await run((s) => deps.api.update(s.accessToken, String(id), seal(s, content)));
      return result.ok ? { ok: true } : result;
    },

    async deleteEntry(id: number): Promise<Result> {
      const result = await run((s) => deps.api.remove(s.accessToken, String(id)));
      return result.ok ? { ok: true } : result;
    },

    async findMatches(pageUrl: string): Promise<Result<{ matches: EntrySummary[] }>> {
      const all = await loadAll();
      if (!all.ok) return all;
      const matches = all.value
        .filter((e) => entryMatchesPage(e.content.url, pageUrl))
        .map(({ id, content }) => {
          const match: EntrySummary = { id, title: content.title };
          if (content.username) match.username = content.username;
          return match;
        });
      return { ok: true, matches };
    },

    async getCredentialForFill(
      id: number,
      pageUrl: string
    ): Promise<Result<{ username: string; password: string }>> {
      const one = await loadOne(id);
      if (!one.ok) return one;
      if (!one.value || !entryMatchesPage(one.value.content.url, pageUrl)) {
        return { ok: false, error: "forbidden" };
      }
      return { ok: true, username: one.value.content.username ?? "", password: one.value.content.password };
    },

    async evaluateSubmission(
      pageUrl: string,
      username: string,
      password: string
    ): Promise<Result<{ decision: SaveDecision }>> {
      if (!validateEntryContent(candidateContent(pageUrl, username, password)).ok) {
        return { ok: false, error: "invalid_input" };
      }
      const all = await loadAll();
      if (!all.ok) return all;
      return { ok: true, decision: decideSave(all.value, pageUrl, username, password) };
    },

    async saveNew(pageUrl: string, username: string, password: string): Promise<Result> {
      const content = candidateContent(pageUrl, username, password);
      if (!validateEntryContent(content).ok) return { ok: false, error: "invalid_input" };
      const result = await run((s) => deps.api.create(s.accessToken, seal(s, content)));
      return result.ok ? { ok: true } : result;
    },

    async saveUpdate(id: number, password: string): Promise<Result> {
      const result = await run(async (s) => {
        const existing = decryptRow(s, await deps.api.get(s.accessToken, String(id)));
        if (!existing) return "not_found" as const;
        // Spread keeps title, url, and notes; only the password changes.
        const updated = { ...existing.content, password };
        if (!validateEntryContent(updated).ok) return "invalid" as const;
        await deps.api.update(s.accessToken, String(id), seal(s, updated));
        return "done" as const;
      });
      if (!result.ok) return result;
      if (result.value === "not_found") return { ok: false, error: "not_found" };
      if (result.value === "invalid") return { ok: false, error: "invalid_input" };
      return { ok: true };
    },
  };
}

export type VaultService = ReturnType<typeof createVaultService>;
```

- [ ] **Step 6: Run tests and typecheck** (`bun run test src/shared src/background && bun run typecheck` → PASS / clean). If a mock-typing error appears in the test's `createVaultService(deps as never)`, keep the cast; do not weaken the production types.

- [ ] **Step 7: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension/src/shared apps/extension/src/background/vaultService.ts apps/extension/src/background/vaultService.test.ts
git commit -m "add page matching and vault service"
```

### Task 8: Pending-save store, message router, background wiring

**Files:**
- Create: `apps/extension/src/background/pendingSave.ts`, `pendingSave.test.ts`, `router.ts`, `router.test.ts`
- Modify: `apps/extension/src/background/index.ts` (replace the Task 1 stub)

**Interfaces:**
- Consumes: `KeyValueStore`, `VaultService`, `parseMessage`/`isAllowedSender`/`SenderInfo`/`SenderContext`, `originOf`, `Result`.
- Produces: `PendingRecord { kind: "save" | "update"; username: string; password: string; pageUrl: string; existingId?: number; createdAt: number }`, `PENDING_TTL_MS = 120_000`, `createPendingStore(store, now)` returning `{ park(tabId: number, record: Omit<PendingRecord, "createdAt">): Promise<void>; peek(tabId): Promise<PendingRecord | null>; discard(tabId): Promise<void>; clearAll(): Promise<void> }`, `type PendingStore`; `RouterDeps` and `handleMessage(raw: unknown, sender: SenderInfo, deps: RouterDeps): Promise<unknown>`.

- [ ] **Step 1: Write the failing pending-store test**

`src/background/pendingSave.test.ts`:
```ts
import { createMemoryStore } from "../testing/memoryStore";
import { createPendingStore, PENDING_TTL_MS } from "./pendingSave";

const record = { kind: "save" as const, username: "me", password: "pw", pageUrl: "https://example.com/login" };

test("parks and peeks a record per tab, without consuming it", async () => {
  let now = 1000;
  const pending = createPendingStore(createMemoryStore(), () => now);
  await pending.park(5, record);
  expect(await pending.peek(5)).toEqual({ ...record, createdAt: 1000 });
  expect(await pending.peek(5)).not.toBeNull();
  expect(await pending.peek(6)).toBeNull();
});

test("a record expires after the TTL and is removed", async () => {
  let now = 1000;
  const store = createMemoryStore();
  const pending = createPendingStore(store, () => now);
  await pending.park(5, record);
  now = 1000 + PENDING_TTL_MS + 1;
  expect(await pending.peek(5)).toBeNull();
  expect(store.dump()).toEqual({});
});

test("discard removes one tab's record and clearAll removes every pending record", async () => {
  const store = createMemoryStore();
  await store.set({ session: { keep: true } });
  const pending = createPendingStore(store, () => 0);
  await pending.park(1, record);
  await pending.park(2, record);
  await pending.discard(1);
  expect(await pending.peek(1)).toBeNull();
  expect(await pending.peek(2)).not.toBeNull();
  await pending.clearAll();
  expect(await pending.peek(2)).toBeNull();
  expect(store.dump()).toEqual({ session: { keep: true } });
});

test("a malformed stored record is treated as absent", async () => {
  const store = createMemoryStore();
  await store.set({ "pendingSave:3": { kind: "nope" } });
  expect(await createPendingStore(store, () => 0).peek(3)).toBeNull();
});
```

- [ ] **Step 2: Run, confirm failure; implement `src/background/pendingSave.ts`**

```ts
import type { KeyValueStore } from "./session";

export interface PendingRecord {
  kind: "save" | "update";
  username: string;
  password: string;
  pageUrl: string;
  existingId?: number;
  createdAt: number;
}

export const PENDING_TTL_MS = 2 * 60_000;
const PREFIX = "pendingSave:";
const keyFor = (tabId: number) => `${PREFIX}${tabId}`;

function isRecord(value: unknown): value is PendingRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === "save" || v.kind === "update") &&
    typeof v.username === "string" &&
    typeof v.password === "string" &&
    typeof v.pageUrl === "string" &&
    typeof v.createdAt === "number"
  );
}

// A submitted credential survives the post-login page navigation here (in
// storage.session, memory only) so the NEXT page can show the save banner. The
// plaintext password stays in the background and is never sent to a content script.
export function createPendingStore(store: KeyValueStore, now: () => number) {
  return {
    async park(tabId: number, record: Omit<PendingRecord, "createdAt">): Promise<void> {
      await store.set({ [keyFor(tabId)]: { ...record, createdAt: now() } });
    },

    async peek(tabId: number): Promise<PendingRecord | null> {
      const stored = (await store.get(keyFor(tabId)))[keyFor(tabId)];
      if (!isRecord(stored)) return null;
      if (now() - stored.createdAt > PENDING_TTL_MS) {
        await store.remove(keyFor(tabId));
        return null;
      }
      return stored;
    },

    async discard(tabId: number): Promise<void> {
      await store.remove(keyFor(tabId));
    },

    async clearAll(): Promise<void> {
      const all = await store.get(null);
      for (const key of Object.keys(all)) {
        if (key.startsWith(PREFIX)) await store.remove(key);
      }
    },
  };
}

export type PendingStore = ReturnType<typeof createPendingStore>;
```

Run: `bun run test src/background/pendingSave.test.ts` → PASS.

- [ ] **Step 3: Write the failing router test**

`src/background/router.test.ts`:
```ts
import { handleMessage, type RouterDeps } from "./router";

const extension = { extensionId: "ext@id", extensionOrigin: "moz-extension://abc/" };
const popup = { id: "ext@id", url: "moz-extension://abc/popup.html" };
const page = { id: "ext@id", url: "https://example.com/login", tab: { id: 7 } };

function makeDeps(overrides: Partial<RouterDeps> = {}) {
  const deps = {
    extension,
    auth: {
      login: vi.fn().mockResolvedValue({ ok: true }),
      logout: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ locked: false, email: "me@example.com" }),
    },
    settings: {
      getAutoLockMinutes: vi.fn().mockResolvedValue(15),
      setAutoLockMinutes: vi.fn().mockResolvedValue(true),
    },
    vault: {
      listEntries: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
      getEntry: vi.fn(),
      updateEntry: vi.fn(),
      deleteEntry: vi.fn(),
      findMatches: vi.fn().mockResolvedValue({ ok: true, matches: [] }),
      getCredentialForFill: vi.fn(),
      evaluateSubmission: vi.fn(),
      saveNew: vi.fn().mockResolvedValue({ ok: true }),
      saveUpdate: vi.fn().mockResolvedValue({ ok: true }),
    },
    pending: {
      park: vi.fn().mockResolvedValue(undefined),
      peek: vi.fn().mockResolvedValue(null),
      discard: vi.fn().mockResolvedValue(undefined),
      clearAll: vi.fn().mockResolvedValue(undefined),
    },
    scheduleClipboardClear: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return deps as unknown as RouterDeps & typeof deps;
}

test("malformed messages are rejected as invalid_input", async () => {
  expect(await handleMessage({ type: "nope" }, popup, makeDeps())).toEqual({ ok: false, error: "invalid_input" });
});

test("a message from the wrong kind of sender is forbidden and does nothing", async () => {
  const deps = makeDeps();
  const result = await handleMessage({ type: "listEntries" }, page, deps);
  expect(result).toEqual({ ok: false, error: "forbidden" });
  expect(deps.vault.listEntries).not.toHaveBeenCalled();
  expect(await handleMessage({ type: "findMatches" }, popup, deps)).toEqual({ ok: false, error: "forbidden" });
});

test("login and status are proxied to the auth service", async () => {
  const deps = makeDeps();
  await handleMessage({ type: "login", email: "a@b.co", masterPassword: "pw" }, popup, deps);
  expect(deps.auth.login).toHaveBeenCalledWith("a@b.co", "pw");
  expect(await handleMessage({ type: "getStatus" }, popup, deps)).toEqual({ locked: false, email: "me@example.com" });
});

test("logout locks and clears pending saves", async () => {
  const deps = makeDeps();
  expect(await handleMessage({ type: "logout" }, popup, deps)).toEqual({ ok: true });
  expect(deps.auth.logout).toHaveBeenCalled();
  expect(deps.pending.clearAll).toHaveBeenCalled();
});

test("settings messages read and write the auto-lock timeout, rejecting non-presets", async () => {
  const deps = makeDeps();
  expect(await handleMessage({ type: "getAutoLockMinutes" }, popup, deps)).toEqual({ minutes: 15 });
  expect(await handleMessage({ type: "setAutoLockMinutes", minutes: 30 }, popup, deps)).toEqual({ ok: true });
  deps.settings.setAutoLockMinutes.mockResolvedValue(false);
  expect(await handleMessage({ type: "setAutoLockMinutes", minutes: 7 }, popup, deps)).toEqual({
    ok: false,
    error: "invalid_input",
  });
});

test("scheduleClipboardClear asks the background to schedule the clear", async () => {
  const deps = makeDeps();
  expect(await handleMessage({ type: "scheduleClipboardClear" }, popup, deps)).toEqual({ ok: true });
  expect(deps.scheduleClipboardClear).toHaveBeenCalled();
});

test("findMatches and getCredentialForFill use the SENDER's url, never a value from the message", async () => {
  const deps = makeDeps();
  await handleMessage({ type: "findMatches", url: "https://attacker.com" }, page, deps);
  expect(deps.vault.findMatches).toHaveBeenCalledWith("https://example.com/login");
  await handleMessage({ type: "getCredentialForFill", id: 4 }, page, deps);
  expect(deps.vault.getCredentialForFill).toHaveBeenCalledWith(4, "https://example.com/login");
});

describe("credentialSubmitted", () => {
  const submit = { type: "credentialSubmitted", username: "me", password: "pw" };

  test("parks a candidate for the sender's tab when the decision is save or update", async () => {
    const deps = makeDeps();
    deps.vault.evaluateSubmission.mockResolvedValue({ ok: true, decision: { kind: "update", id: 3 } });
    expect(await handleMessage(submit, page, deps)).toEqual({ ok: true });
    expect(deps.pending.park).toHaveBeenCalledWith(7, {
      kind: "update",
      username: "me",
      password: "pw",
      pageUrl: "https://example.com/login",
      existingId: 3,
    });
  });

  test("parks a save candidate without an existingId", async () => {
    const deps = makeDeps();
    deps.vault.evaluateSubmission.mockResolvedValue({ ok: true, decision: { kind: "save" } });
    await handleMessage(submit, page, deps);
    expect(deps.pending.park).toHaveBeenCalledWith(7, {
      kind: "save",
      username: "me",
      password: "pw",
      pageUrl: "https://example.com/login",
    });
  });

  test("does not park when the credential is already saved, or when locked or offline", async () => {
    for (const evaluation of [
      { ok: true, decision: { kind: "none" } },
      { ok: false, error: "locked" },
      { ok: false, error: "network" },
    ]) {
      const deps = makeDeps();
      deps.vault.evaluateSubmission.mockResolvedValue(evaluation);
      expect(await handleMessage(submit, page, deps)).toEqual({ ok: true });
      expect(deps.pending.park).not.toHaveBeenCalled();
    }
  });

  test("an oversized credential is reported as invalid_input so the page can tell the user", async () => {
    const deps = makeDeps();
    deps.vault.evaluateSubmission.mockResolvedValue({ ok: false, error: "invalid_input" });
    expect(await handleMessage(submit, page, deps)).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("pending save", () => {
  const record = { kind: "save", username: "me", password: "SECRET", pageUrl: "https://example.com/login", createdAt: 0 };

  test("getPendingSave never returns the password", async () => {
    const deps = makeDeps();
    deps.pending.peek.mockResolvedValue(record);
    const result = await handleMessage({ type: "getPendingSave" }, page, deps);
    expect(result).toEqual({ pending: { kind: "save", username: "me", origin: "https://example.com" } });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test("getPendingSave returns null when nothing is parked", async () => {
    expect(await handleMessage({ type: "getPendingSave" }, page, makeDeps())).toEqual({ pending: null });
  });

  test("confirmSave saves a new entry and discards the record on success", async () => {
    const deps = makeDeps();
    deps.pending.peek.mockResolvedValue(record);
    expect(await handleMessage({ type: "confirmSave" }, page, deps)).toEqual({ ok: true });
    expect(deps.vault.saveNew).toHaveBeenCalledWith("https://example.com/login", "me", "SECRET");
    expect(deps.pending.discard).toHaveBeenCalledWith(7);
  });

  test("confirmSave updates an existing entry for an update record", async () => {
    const deps = makeDeps();
    deps.pending.peek.mockResolvedValue({ ...record, kind: "update", existingId: 3 });
    await handleMessage({ type: "confirmSave" }, page, deps);
    expect(deps.vault.saveUpdate).toHaveBeenCalledWith(3, "SECRET");
  });

  test("confirmSave keeps the record parked when saving fails so the user can retry", async () => {
    const deps = makeDeps();
    deps.pending.peek.mockResolvedValue(record);
    deps.vault.saveNew.mockResolvedValue({ ok: false, error: "network" });
    expect(await handleMessage({ type: "confirmSave" }, page, deps)).toEqual({ ok: false, error: "network" });
    expect(deps.pending.discard).not.toHaveBeenCalled();
  });

  test("confirmSave with nothing parked is not_found; dismissSave discards", async () => {
    const deps = makeDeps();
    expect(await handleMessage({ type: "confirmSave" }, page, deps)).toEqual({ ok: false, error: "not_found" });
    expect(await handleMessage({ type: "dismissSave" }, page, deps)).toEqual({ ok: true });
    expect(deps.pending.discard).toHaveBeenCalledWith(7);
  });
});
```

- [ ] **Step 4: Run, confirm failure; implement `src/background/router.ts`**

Run: `bun run test src/background/router.test.ts` → FAIL. Then:
```ts
import { parseMessage, isAllowedSender, type SenderContext, type SenderInfo } from "../messaging/validate";
import type { Result } from "../messaging/types";
import { originOf } from "../shared/matching";
import type { PendingStore } from "./pendingSave";
import type { VaultService } from "./vaultService";

export interface RouterDeps {
  extension: SenderContext;
  auth: {
    login(email: string, masterPassword: string): Promise<Result>;
    logout(): Promise<void>;
    status(): Promise<{ locked: boolean; email?: string }>;
  };
  settings: {
    getAutoLockMinutes(): Promise<number>;
    setAutoLockMinutes(minutes: number): Promise<boolean>;
  };
  vault: VaultService;
  pending: PendingStore;
  scheduleClipboardClear(): Promise<void>;
}

const forbidden = { ok: false, error: "forbidden" } as const;

export async function handleMessage(raw: unknown, sender: SenderInfo, deps: RouterDeps): Promise<unknown> {
  const message = parseMessage(raw);
  if (!message) return { ok: false, error: "invalid_input" };
  if (!isAllowedSender(message, sender, deps.extension)) return forbidden;

  // Content-script messages only: the page origin and tab come from the SENDER,
  // never from anything the message claims.
  const pageUrl = sender.url ?? "";
  const tabId = sender.tab?.id;

  switch (message.type) {
    case "getStatus":
      return deps.auth.status();
    case "login":
      return deps.auth.login(message.email, message.masterPassword);
    case "logout":
      await deps.auth.logout();
      await deps.pending.clearAll();
      return { ok: true };
    case "listEntries":
      return deps.vault.listEntries();
    case "getEntry":
      return deps.vault.getEntry(message.id);
    case "updateEntry":
      return deps.vault.updateEntry(message.id, message.content);
    case "deleteEntry":
      return deps.vault.deleteEntry(message.id);
    case "getAutoLockMinutes":
      return { minutes: await deps.settings.getAutoLockMinutes() };
    case "setAutoLockMinutes":
      return (await deps.settings.setAutoLockMinutes(message.minutes))
        ? { ok: true }
        : { ok: false, error: "invalid_input" };
    case "scheduleClipboardClear":
      await deps.scheduleClipboardClear();
      return { ok: true };
    case "findMatches":
      return deps.vault.findMatches(pageUrl);
    case "getCredentialForFill":
      return deps.vault.getCredentialForFill(message.id, pageUrl);
  }

  if (tabId === undefined) return forbidden;

  switch (message.type) {
    case "credentialSubmitted": {
      const evaluation = await deps.vault.evaluateSubmission(pageUrl, message.username, message.password);
      if (!evaluation.ok) {
        // Oversized input is reported so the page can tell the user; locked or
        // offline just means no prompt this time.
        return evaluation.error === "invalid_input" ? evaluation : { ok: true };
      }
      const { decision } = evaluation;
      if (decision.kind === "none") return { ok: true };
      await deps.pending.park(tabId, {
        kind: decision.kind,
        username: message.username,
        password: message.password,
        pageUrl,
        ...(decision.kind === "update" ? { existingId: decision.id } : {}),
      });
      return { ok: true };
    }
    case "getPendingSave": {
      const record = await deps.pending.peek(tabId);
      return {
        pending: record
          ? { kind: record.kind, username: record.username, origin: originOf(record.pageUrl) ?? record.pageUrl }
          : null,
      };
    }
    case "confirmSave": {
      const record = await deps.pending.peek(tabId);
      if (!record) return { ok: false, error: "not_found" };
      const result =
        record.kind === "update" && record.existingId !== undefined
          ? await deps.vault.saveUpdate(record.existingId, record.password)
          : await deps.vault.saveNew(record.pageUrl, record.username, record.password);
      if (result.ok) await deps.pending.discard(tabId);
      return result;
    }
    case "dismissSave":
      await deps.pending.discard(tabId);
      return { ok: true };
  }
  return forbidden;
}
```

Run: `bun run test src/background/router.test.ts` → PASS. If `tsc` complains that the second `switch` is not exhaustive or the trailing `return forbidden` is unreachable, keep the trailing return and adjust only the types, not the behavior.

- [ ] **Step 5: Wire the background entry point**

Replace the contents of `src/background/index.ts` with:
```ts
import { login } from "../api/auth";
import {
  createVaultEntry,
  deleteVaultEntry,
  getVaultEntry,
  listVaultEntries,
  updateVaultEntry,
} from "../api/vault";
import { performLogin } from "./auth";
import { createPendingStore } from "./pendingSave";
import { handleMessage, type RouterDeps } from "./router";
import {
  clearSession,
  expireIfIdle,
  getActiveSession,
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

async function activeSession() {
  return getActiveSession(sessionStore, now(), await getAutoLockMinutes(localStore));
}

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
```
- [ ] **Step 6: Verify everything**

```bash
cd /home/yasreb/projects/password_manager/apps/extension
bun run typecheck && bun run test && bun run build
```
Expected: all green; `dist/background.js` is a single self-contained file (`grep -c "import " dist/background.js` should show no top-level ES `import` statements). If `browser.storage.session` is missing from the type package, add `declare namespace browser.storage { const session: StorageArea }` in `src/types.d.ts`.

- [ ] **Step 7: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension/src/background
git commit -m "add background message router and wiring"
```

### Task 9: Popup building blocks: styles, error text, clipboard, entry detail screen

**Files:**
- Create: `apps/extension/src/popup/styles.css`, `errors.ts`, `clipboard.ts`, `clipboard.test.ts`
- Create: `apps/extension/src/popup/screens/EntryDetailScreen.tsx`, `EntryDetailScreen.test.tsx`

**Interfaces:**
- Consumes: `sendMessage`, `ErrorCode`, `validateEntryContent`, `LIMITS`, `isSafeHttpUrl`, `VaultEntryContent`.
- Produces: `errorText(code: ErrorCode): string`; `copyToClipboard(text: string): Promise<void>`; `EntryDetailScreen({ id, onBack, onLocked }: { id: number; onBack: () => void; onLocked: () => void })`.

- [ ] **Step 1: Write `errors.ts` and `styles.css`** (no tests: a string map and stylesheet)

`src/popup/errors.ts`:
```ts
import type { ErrorCode } from "../messaging/types";

const TEXT: Record<ErrorCode, string> = {
  locked: "Your vault is locked.",
  network: "Couldn't reach the server. Check your connection and try again.",
  invalid_input: "That input isn't valid.",
  invalid_credentials: "Incorrect email or master password.",
  not_found: "That entry no longer exists.",
  forbidden: "That action isn't allowed.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
};

export function errorText(code: ErrorCode): string {
  return TEXT[code];
}
```

`src/popup/styles.css`:
```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #666666;
  --line: #d8d8d8;
  --accent: #2456d6;
  --danger: #c62828;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1e;
    --fg: #f2f2f2;
    --muted: #a0a0a0;
    --line: #3a3a3c;
    --accent: #6b9bff;
    --danger: #ff6b6b;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px system-ui, sans-serif; }
#root { width: 340px; min-height: 200px; padding: 12px; }
.options-page #root { width: auto; max-width: 480px; margin: 0 auto; }
h1 { font-size: 16px; margin: 0 0 10px; }
label { display: block; margin: 8px 0 2px; color: var(--muted); font-size: 12px; }
input, textarea, select { width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; }
button { padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { color: var(--danger); border-color: var(--danger); }
button:disabled { opacity: 0.6; cursor: default; }
.row { display: flex; gap: 6px; align-items: center; justify-content: space-between; margin: 6px 0; }
.actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.list { list-style: none; margin: 8px 0 0; padding: 0; max-height: 320px; overflow-y: auto; }
.list button { width: 100%; text-align: left; margin-bottom: 4px; }
.muted { color: var(--muted); font-size: 12px; }
.error { color: var(--danger); margin: 8px 0 0; }
.notice { color: var(--muted); margin: 8px 0 0; }
pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; }
```

- [ ] **Step 2: Write the failing clipboard test, then implement**

`src/popup/clipboard.test.ts`:
```ts
import { sendMessage } from "../messaging/client";
import { copyToClipboard } from "./clipboard";

vi.mock("../messaging/client", () => ({ sendMessage: vi.fn().mockResolvedValue({ ok: true }) }));

test("writes the text to the clipboard and asks the background to clear it later", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  await copyToClipboard("secret");

  expect(writeText).toHaveBeenCalledWith("secret");
  expect(sendMessage).toHaveBeenCalledWith({ type: "scheduleClipboardClear" });
  vi.unstubAllGlobals();
});
```

`src/popup/clipboard.ts`:
```ts
import { sendMessage } from "../messaging/client";

// The popup is destroyed as soon as it loses focus, so it cannot run its own
// "clear after 30 s" timer. It asks the background, which clears via an alarm.
export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  await sendMessage({ type: "scheduleClipboardClear" });
}
```

Run: `bun run test src/popup/clipboard.test.ts` → FAIL first, then PASS after implementing.

- [ ] **Step 3: Write the failing entry detail test**

`src/popup/screens/EntryDetailScreen.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../../messaging/client";
import { copyToClipboard } from "../clipboard";
import { EntryDetailScreen } from "./EntryDetailScreen";

vi.mock("../../messaging/client", () => ({ sendMessage: vi.fn() }));
vi.mock("../clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(undefined) }));

const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

const entry = {
  title: "Example",
  username: "me@example.com",
  password: "hunter2",
  url: "https://example.com",
  notes: "keep",
};

function respond(overrides: Record<string, unknown> = {}) {
  send.mockImplementation(async (message: { type: string }) => {
    if (message.type in overrides) return overrides[message.type];
    if (message.type === "getEntry") return { ok: true, entry };
    return { ok: true };
  });
}

function setup() {
  const props = { id: 4, onBack: vi.fn(), onLocked: vi.fn() };
  render(<EntryDetailScreen {...props} />);
  return props;
}

beforeEach(() => vi.clearAllMocks());

test("shows the entry with the password hidden until Show is clicked", async () => {
  respond();
  setup();
  expect(await screen.findByText("Example")).toBeTruthy();
  expect(screen.getByText("me@example.com")).toBeTruthy();
  expect(screen.queryByText("hunter2")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(screen.getByText("hunter2")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Hide" }));
  expect(screen.queryByText("hunter2")).toBeNull();
});

test("copying the password uses the clipboard helper", async () => {
  respond();
  setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Copy password" }));
  expect(copyToClipboard).toHaveBeenCalledWith("hunter2");
});

test("an https url renders as a safe link; a javascript: url is plain text, never a link", async () => {
  respond();
  const { unmount } = render(<EntryDetailScreen id={4} onBack={vi.fn()} onLocked={vi.fn()} />);
  const link = await screen.findByRole("link");
  expect(link.getAttribute("href")).toBe("https://example.com");
  expect(link.getAttribute("rel")).toContain("noopener");
  unmount();

  respond({ getEntry: { ok: true, entry: { ...entry, url: "javascript:alert(1)" } } });
  render(<EntryDetailScreen id={4} onBack={vi.fn()} onLocked={vi.fn()} />);
  await screen.findByText("javascript:alert(1)");
  expect(screen.queryByRole("link")).toBeNull();
});

test("hostile markup in a field is rendered as text, never as elements", async () => {
  respond({ getEntry: { ok: true, entry: { ...entry, title: "<img src=x onerror=alert(1)>" } } });
  const { container } = render(<EntryDetailScreen id={4} onBack={vi.fn()} onLocked={vi.fn()} />);
  await screen.findByText("<img src=x onerror=alert(1)>");
  expect(container.querySelector("img")).toBeNull();
});

test("a locked response returns to the login flow", async () => {
  respond({ getEntry: { ok: false, error: "locked" } });
  const props = setup();
  await waitFor(() => expect(props.onLocked).toHaveBeenCalled());
});

test("editing sends the full content, preserving fields, and returns to the view", async () => {
  respond();
  setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const title = screen.getByLabelText("Title");
  await userEvent.clear(title);
  await userEvent.type(title, "Renamed");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "updateEntry",
      id: 4,
      content: { ...entry, title: "Renamed" },
    })
  );
  expect(await screen.findByText("Renamed")).toBeTruthy();
});

test("saving an invalid edit shows the reason and does not send", async () => {
  respond();
  setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.clear(screen.getByLabelText("Title"));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Title is required.")).toBeTruthy();
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateEntry" }));
});

test("delete needs a second confirming click, then deletes and goes back", async () => {
  respond();
  const props = setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "deleteEntry" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "deleteEntry", id: 4 }));
  await waitFor(() => expect(props.onBack).toHaveBeenCalled());
});
```

- [ ] **Step 4: Run, confirm failure** (`bun run test src/popup/screens/EntryDetailScreen.test.tsx` → cannot find the component).

- [ ] **Step 5: Implement `src/popup/screens/EntryDetailScreen.tsx`**

```tsx
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sendMessage } from "../../messaging/client";
import type { ErrorCode } from "../../messaging/types";
import { LIMITS, validateEntryContent } from "../../safety/limits";
import { isSafeHttpUrl } from "../../safety/safeUrl";
import type { VaultEntryContent } from "../../vault/entry";
import { copyToClipboard } from "../clipboard";
import { errorText } from "../errors";

interface Props {
  id: number;
  onBack: () => void;
  onLocked: () => void;
}

type Mode = "view" | "edit" | "confirmDelete";

interface Draft {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
}

const toDraft = (e: VaultEntryContent): Draft => ({
  title: e.title,
  username: e.username ?? "",
  password: e.password,
  url: e.url ?? "",
  notes: e.notes ?? "",
});

function toContent(d: Draft): VaultEntryContent {
  const content: VaultEntryContent = { title: d.title, password: d.password };
  if (d.username) content.username = d.username;
  if (d.url) content.url = d.url;
  if (d.notes) content.notes = d.notes;
  return content;
}

export function EntryDetailScreen({ id, onBack, onLocked }: Props) {
  const [entry, setEntry] = useState<VaultEntryContent | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (code: ErrorCode) => {
      if (code === "locked") onLocked();
      else setMessage(errorText(code));
    },
    [onLocked]
  );

  useEffect(() => {
    let cancelled = false;
    sendMessage({ type: "getEntry", id })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setEntry(result.entry);
        else fail(result.error);
      })
      .catch(() => {
        if (!cancelled) setMessage(errorText("network"));
      });
    return () => {
      cancelled = true;
    };
  }, [id, fail]);

  async function copy(value: string, label: string) {
    try {
      await copyToClipboard(value);
      setMessage(`${label} copied. It will be cleared in 30 seconds.`);
    } catch {
      setMessage("Couldn't copy to the clipboard.");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const content = toContent(draft);
    const check = validateEntryContent(content);
    if (!check.ok) {
      setMessage(check.reason);
      return;
    }
    setBusy(true);
    try {
      const result = await sendMessage({ type: "updateEntry", id, content });
      if (result.ok) {
        setEntry(content);
        setMode("view");
        setMessage("Saved.");
      } else fail(result.error);
    } catch {
      setMessage(errorText("network"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const result = await sendMessage({ type: "deleteEntry", id });
      if (result.ok) onBack();
      else fail(result.error);
    } catch {
      setMessage(errorText("network"));
    } finally {
      setBusy(false);
    }
  }

  if (!entry) {
    return (
      <div>
        <button onClick={onBack}>Back</button>
        <p className={message ? "error" : "muted"}>{message ?? "Loading…"}</p>
      </div>
    );
  }

  if (mode === "edit" && draft) {
    const field = (key: keyof Draft, label: string, max: number) => (
      <>
        <label htmlFor={`f-${key}`}>{label}</label>
        <input
          id={`f-${key}`}
          value={draft[key]}
          maxLength={max}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      </>
    );
    return (
      <form onSubmit={save}>
        <h1>Edit entry</h1>
        {field("title", "Title", LIMITS.title)}
        {field("username", "Username", LIMITS.username)}
        {field("password", "Password", LIMITS.password)}
        {field("url", "URL", LIMITS.url)}
        <label htmlFor="f-notes">Notes</label>
        <textarea
          id="f-notes"
          rows={3}
          value={draft.notes}
          maxLength={LIMITS.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
        {message && <p className="error">{message}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
          <button type="button" onClick={() => { setMode("view"); setMessage(null); }}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <div className="row">
        <button onClick={onBack}>Back</button>
      </div>
      <h1>{entry.title}</h1>
      {entry.username && (
        <div className="row">
          <span>{entry.username}</span>
          <button onClick={() => copy(entry.username ?? "", "Username")}>Copy username</button>
        </div>
      )}
      <div className="row">
        <span>{reveal ? entry.password : "••••••••"}</span>
        <span>
          <button onClick={() => setReveal(!reveal)}>{reveal ? "Hide" : "Show"}</button>{" "}
          <button onClick={() => copy(entry.password, "Password")}>Copy password</button>
        </span>
      </div>
      {entry.url &&
        (isSafeHttpUrl(entry.url) ? (
          <p>
            <a href={entry.url} target="_blank" rel="noopener noreferrer">
              {entry.url}
            </a>
          </p>
        ) : (
          <p>{entry.url}</p>
        ))}
      {entry.notes && <pre>{entry.notes}</pre>}
      {message && <p className="notice">{message}</p>}
      <div className="actions">
        <button onClick={() => { setDraft(toDraft(entry)); setMode("edit"); setMessage(null); }}>Edit</button>
        {mode === "confirmDelete" ? (
          <>
            <button className="danger" disabled={busy} onClick={remove}>
              Confirm delete
            </button>
            <button onClick={() => setMode("view")}>Cancel</button>
          </>
        ) : (
          <button className="danger" onClick={() => setMode("confirmDelete")}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests and typecheck** (`bun run test src/popup && bun run typecheck` → PASS / clean).

- [ ] **Step 7: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension/src/popup
git commit -m "add popup entry detail screen"
```

### Task 10: Popup app shell (login, vault list) and options page

**Files:**
- Create: `apps/extension/src/popup/screens/LoginScreen.tsx`, `LoginScreen.test.tsx`, `VaultListScreen.tsx`, `VaultListScreen.test.tsx`
- Create: `apps/extension/src/popup/App.tsx`, `App.test.tsx`
- Create: `apps/extension/src/options/OptionsApp.tsx`, `OptionsApp.test.tsx`
- Modify: `apps/extension/src/popup/main.tsx`, `apps/extension/src/options/main.tsx` (replace the Task 1 stubs)

**Interfaces:**
- Consumes: `sendMessage`, `errorText`, `EntryDetailScreen`, `AUTO_LOCK_PRESETS` from `src/background/settings.ts` (a plain constant; that module only has a type import, so it adds nothing to the options bundle).
- Produces: `LoginScreen({ onLoggedIn })`, `VaultListScreen({ onSelect(id: number), onLocked() })`, `App()`, `OptionsApp()`.

- [ ] **Step 1: Write the failing login screen test**

`src/popup/screens/LoginScreen.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../../messaging/client";
import { LoginScreen } from "./LoginScreen";

vi.mock("../../messaging/client", () => ({ sendMessage: vi.fn() }));
const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
  await userEvent.type(screen.getByLabelText("Master password"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
}

beforeEach(() => vi.clearAllMocks());

test("sends the credentials and calls onLoggedIn on success", async () => {
  send.mockResolvedValue({ ok: true });
  const onLoggedIn = vi.fn();
  render(<LoginScreen onLoggedIn={onLoggedIn} />);
  await fillAndSubmit();
  await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
  expect(send).toHaveBeenCalledWith({ type: "login", email: "me@example.com", masterPassword: "pw" });
});

test.each([
  ["invalid_credentials", "Incorrect email or master password."],
  ["rate_limited", "Too many attempts. Wait a minute and try again."],
  ["network", "Couldn't reach the server. Check your connection and try again."],
])("shows a message for %s and does not log in", async (error, text) => {
  send.mockResolvedValue({ ok: false, error });
  const onLoggedIn = vi.fn();
  render(<LoginScreen onLoggedIn={onLoggedIn} />);
  await fillAndSubmit();
  expect(await screen.findByText(text)).toBeTruthy();
  expect(onLoggedIn).not.toHaveBeenCalled();
});

test("the button is disabled with a progress label while logging in", async () => {
  let resolve!: (value: unknown) => void;
  send.mockReturnValue(new Promise((r) => (resolve = r)));
  render(<LoginScreen onLoggedIn={vi.fn()} />);
  await fillAndSubmit();
  const button = await screen.findByRole("button", { name: "Logging in…" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  resolve({ ok: false, error: "network" });
});
```

- [ ] **Step 2: Run, confirm failure; implement `LoginScreen.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { sendMessage } from "../../messaging/client";
import { LIMITS } from "../../safety/limits";
import { errorText } from "../errors";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await sendMessage({ type: "login", email, masterPassword });
      if (result.ok) {
        setMasterPassword("");
        onLoggedIn();
        return;
      }
      setError(errorText(result.error));
    } catch {
      setError(errorText("network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Password Manager</h1>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} maxLength={LIMITS.email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="master">Master password</label>
      <input
        id="master"
        type="password"
        value={masterPassword}
        maxLength={LIMITS.password}
        onChange={(e) => setMasterPassword(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </div>
      <p className="muted">Accounts are created in the mobile app.</p>
    </form>
  );
}
```
Run: `bun run test src/popup/screens/LoginScreen.test.tsx` → PASS.

- [ ] **Step 3: Write the failing vault list test**

`src/popup/screens/VaultListScreen.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../../messaging/client";
import { VaultListScreen } from "./VaultListScreen";

vi.mock("../../messaging/client", () => ({ sendMessage: vi.fn() }));
const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

const entries = [
  { id: 1, title: "GitHub", username: "octo", url: "https://github.com" },
  { id: 2, title: "Bank", username: "me@bank.com", url: "https://bank.example" },
];

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(async (m: { type: string }) =>
    m.type === "listEntries" ? { ok: true, entries } : { ok: true }
  );
});

test("lists entries and opens one on click", async () => {
  const onSelect = vi.fn();
  render(<VaultListScreen onSelect={onSelect} onLocked={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
  expect(onSelect).toHaveBeenCalledWith(1);
});

test("filters by title, username, or url as you type", async () => {
  render(<VaultListScreen onSelect={vi.fn()} onLocked={vi.fn()} />);
  await screen.findByText("GitHub");
  await userEvent.type(screen.getByPlaceholderText("Search"), "bank");
  expect(screen.queryByText("GitHub")).toBeNull();
  expect(screen.getByText("Bank")).toBeTruthy();
});

test("shows an empty state", async () => {
  send.mockResolvedValue({ ok: true, entries: [] });
  render(<VaultListScreen onSelect={vi.fn()} onLocked={vi.fn()} />);
  expect(await screen.findByText("No saved logins yet.")).toBeTruthy();
});

test("a locked response calls onLocked; other errors are shown", async () => {
  send.mockResolvedValueOnce({ ok: false, error: "locked" });
  const onLocked = vi.fn();
  const first = render(<VaultListScreen onSelect={vi.fn()} onLocked={onLocked} />);
  await waitFor(() => expect(onLocked).toHaveBeenCalled());
  first.unmount();

  send.mockResolvedValueOnce({ ok: false, error: "network" });
  render(<VaultListScreen onSelect={vi.fn()} onLocked={vi.fn()} />);
  expect(await screen.findByText(/Couldn't reach the server/)).toBeTruthy();
});

test("Log out sends logout and calls onLocked", async () => {
  const onLocked = vi.fn();
  render(<VaultListScreen onSelect={vi.fn()} onLocked={onLocked} />);
  await screen.findByText("GitHub");
  await userEvent.click(screen.getByRole("button", { name: "Log out" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "logout" }));
  await waitFor(() => expect(onLocked).toHaveBeenCalled());
});
```

- [ ] **Step 4: Run, confirm failure; implement `VaultListScreen.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { sendMessage } from "../../messaging/client";
import type { EntrySummary } from "../../messaging/types";
import { errorText } from "../errors";

interface Props {
  onSelect: (id: number) => void;
  onLocked: () => void;
}

export function VaultListScreen({ onSelect, onLocked }: Props) {
  const [entries, setEntries] = useState<EntrySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    sendMessage({ type: "listEntries" })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setEntries(result.entries);
        else if (result.error === "locked") onLocked();
        else setError(errorText(result.error));
      })
      .catch(() => {
        if (!cancelled) setError(errorText("network"));
      });
    return () => {
      cancelled = true;
    };
  }, [onLocked]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!entries || !q) return entries ?? [];
    return entries.filter((e) =>
      [e.title, e.username ?? "", e.url ?? ""].some((field) => field.toLowerCase().includes(q))
    );
  }, [entries, query]);

  async function logout() {
    await sendMessage({ type: "logout" });
    onLocked();
  }

  return (
    <div>
      <div className="row">
        <h1>Vault</h1>
        <span>
          <button onClick={() => void browser.runtime.openOptionsPage()}>Settings</button>{" "}
          <button onClick={logout}>Log out</button>
        </span>
      </div>
      <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      {error && <p className="error">{error}</p>}
      {entries === null && !error && <p className="muted">Loading…</p>}
      {entries !== null && entries.length === 0 && <p className="muted">No saved logins yet.</p>}
      <ul className="list">
        {visible.map((entry) => (
          <li key={entry.id}>
            <button onClick={() => onSelect(entry.id)}>
              <div>{entry.title}</div>
              {entry.username && <div className="muted">{entry.username}</div>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```
Run: `bun run test src/popup/screens/VaultListScreen.test.tsx` → PASS.

- [ ] **Step 5: Write the failing App test, then implement `App.tsx` and `main.tsx`**

`src/popup/App.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../messaging/client";
import { App } from "./App";

vi.mock("../messaging/client", () => ({ sendMessage: vi.fn() }));
const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

const entry = { title: "GitHub", password: "pw", username: "octo" };

function backend(locked: boolean) {
  send.mockImplementation(async (m: { type: string }) => {
    switch (m.type) {
      case "getStatus": return { locked };
      case "login": return { ok: true };
      case "listEntries": return { ok: true, entries: [{ id: 1, title: "GitHub", username: "octo" }] };
      case "getEntry": return { ok: true, entry };
      default: return { ok: true };
    }
  });
}

beforeEach(() => vi.clearAllMocks());

test("shows the login screen when locked, then the vault after logging in", async () => {
  backend(true);
  render(<App />);
  await userEvent.type(await screen.findByLabelText("Email"), "me@example.com");
  await userEvent.type(screen.getByLabelText("Master password"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByText("GitHub")).toBeTruthy();
});

test("shows the vault directly when already unlocked, and can open then leave an entry", async () => {
  backend(false);
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
  expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByPlaceholderText("Search")).toBeTruthy();
});

test("falls back to the login screen if the status check fails", async () => {
  send.mockRejectedValue(new Error("no background"));
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy());
});
```

`src/popup/App.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { sendMessage } from "../messaging/client";
import { EntryDetailScreen } from "./screens/EntryDetailScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { VaultListScreen } from "./screens/VaultListScreen";

type View = { name: "loading" } | { name: "login" } | { name: "list" } | { name: "entry"; id: number };

export function App() {
  const [view, setView] = useState<View>({ name: "loading" });

  useEffect(() => {
    sendMessage({ type: "getStatus" })
      .then((status) => setView({ name: status.locked ? "login" : "list" }))
      .catch(() => setView({ name: "login" }));
  }, []);

  const goLogin = useCallback(() => setView({ name: "login" }), []);
  const goList = useCallback(() => setView({ name: "list" }), []);

  switch (view.name) {
    case "loading":
      return <p className="muted">Loading…</p>;
    case "login":
      return <LoginScreen onLoggedIn={goList} />;
    case "list":
      return <VaultListScreen onSelect={(id) => setView({ name: "entry", id })} onLocked={goLogin} />;
    case "entry":
      return <EntryDetailScreen id={view.id} onBack={goList} onLocked={goLogin} />;
  }
}
```

Replace `src/popup/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
```

Run: `bun run test src/popup` → PASS.

- [ ] **Step 6: Options page test and implementation**

`src/options/OptionsApp.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../messaging/client";
import { OptionsApp } from "./OptionsApp";

vi.mock("../messaging/client", () => ({ sendMessage: vi.fn() }));
const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(async (m: { type: string }) =>
    m.type === "getAutoLockMinutes" ? { minutes: 15 } : { ok: true }
  );
});

test("shows the current timeout and saves a new preset", async () => {
  render(<OptionsApp />);
  const select = (await screen.findByLabelText("Lock after")) as HTMLSelectElement;
  await waitFor(() => expect(select.value).toBe("15"));
  await userEvent.selectOptions(select, "30");
  await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "setAutoLockMinutes", minutes: 30 }));
  expect(await screen.findByText("Saved.")).toBeTruthy();
});

test("Log out sends logout", async () => {
  render(<OptionsApp />);
  await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "logout" }));
  expect(await screen.findByText("Logged out.")).toBeTruthy();
});
```

`src/options/OptionsApp.tsx`:
```tsx
import { useEffect, useState } from "react";
import { AUTO_LOCK_PRESETS, DEFAULT_AUTO_LOCK_MINUTES } from "../background/settings";
import { sendMessage } from "../messaging/client";
import { errorText } from "../popup/errors";

export function OptionsApp() {
  const [minutes, setMinutes] = useState<number>(DEFAULT_AUTO_LOCK_MINUTES);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    sendMessage({ type: "getAutoLockMinutes" })
      .then((r) => setMinutes(r.minutes))
      .catch(() => setMessage(errorText("network")));
  }, []);

  async function change(value: number) {
    setMinutes(value);
    const result = await sendMessage({ type: "setAutoLockMinutes", minutes: value });
    setMessage(result.ok ? "Saved." : errorText(result.error));
  }

  async function logout() {
    await sendMessage({ type: "logout" });
    setMessage("Logged out.");
  }

  return (
    <div>
      <h1>Password Manager settings</h1>
      <label htmlFor="autolock">Lock after</label>
      <select id="autolock" value={minutes} onChange={(e) => void change(Number(e.target.value))}>
        {AUTO_LOCK_PRESETS.map((m) => (
          <option key={m} value={m}>
            {m} {m === 1 ? "minute" : "minutes"} of inactivity
          </option>
        ))}
      </select>
      <p className="muted">The vault also locks whenever the browser closes.</p>
      <div className="actions">
        <button onClick={logout}>Log out</button>
      </div>
      {message && <p className="notice">{message}</p>}
    </div>
  );
}
```

Replace `src/options/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";
import "../popup/styles.css";
import { OptionsApp } from "./OptionsApp";

document.body.classList.add("options-page");
createRoot(document.getElementById("root")!).render(<OptionsApp />);
```

- [ ] **Step 7: Verify and commit**

```bash
cd /home/yasreb/projects/password_manager/apps/extension
bun run typecheck && bun run test && bun run build
cd /home/yasreb/projects/password_manager
git add apps/extension/src/popup apps/extension/src/options
git commit -m "add popup app shell and options page"
```
Expected: all tests pass; `dist/popup.html` and `dist/options.html` reference `./assets/...`.

### Task 11: Login field detection and frame check

**Files:**
- Create: `apps/extension/src/content/fieldDetector.ts`, `fieldDetector.test.ts`, `frames.ts`, `frames.test.ts`

**Interfaces:**
- Produces: `LoginFields { password: HTMLInputElement; username: HTMLInputElement | null }`; `findLoginFields(root?: ParentNode): LoginFields[]`; `observeLoginFields(onChange: () => void, root?: Node, delayMs?: number): () => void` (returns a disconnect function); `isTopOrSameOriginFrame(win?: Window): boolean`.

- [ ] **Step 1: Write the failing detector test**

`src/content/fieldDetector.test.ts`:
```ts
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

test("works without a <form> tag by looking in nearby containers", () => {
  page(`<div><div><input id="u" type="text"></div><div><input id="p" type="password"></div></div>`);
  const [fields] = findLoginFields();
  expect(fields.username?.id).toBe("u");
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
```

- [ ] **Step 2: Run, confirm failure; implement `fieldDetector.ts`**

Run: `bun run test src/content/fieldDetector.test.ts` → FAIL. Then:
```ts
export interface LoginFields {
  password: HTMLInputElement;
  username: HTMLInputElement | null;
}

const TEXT_TYPES = new Set(["text", "email", "tel"]);
const MAX_ANCESTOR_HOPS = 4;
const USERNAME_HINT = /(^|\s)(username|email)(\s|$)/;

function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function isUsable(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly && isVisible(input);
}

function precedingTextInputs(scope: ParentNode, password: HTMLInputElement): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll("input")).filter(
    (candidate) =>
      candidate !== password &&
      TEXT_TYPES.has(candidate.type) &&
      isUsable(candidate) &&
      (candidate.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

function scopesFor(password: HTMLInputElement): ParentNode[] {
  if (password.form) return [password.form];
  const scopes: ParentNode[] = [];
  let node = password.parentElement;
  for (let hops = 0; node && hops < MAX_ANCESTOR_HOPS; hops++) {
    scopes.push(node);
    node = node.parentElement;
  }
  return scopes;
}

function findUsername(password: HTMLInputElement): HTMLInputElement | null {
  for (const scope of scopesFor(password)) {
    const candidates = precedingTextInputs(scope, password);
    if (candidates.length === 0) continue;
    return candidates.find((c) => USERNAME_HINT.test(c.autocomplete)) ?? candidates[candidates.length - 1];
  }
  return null;
}

export function findLoginFields(root: ParentNode = document): LoginFields[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>("input[type=password]"))
    .filter(isUsable)
    .map((password) => ({ password, username: findUsername(password) }));
}

// Many login forms are rendered by JavaScript after load, so rescan (debounced)
// whenever the page adds or removes nodes.
export function observeLoginFields(onChange: () => void, root: Node = document, delayMs = 100): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(onChange, delayMs);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}
```
Run: `bun run test src/content/fieldDetector.test.ts` → PASS.

- [ ] **Step 3: Frame check test and implementation**

`src/content/frames.test.ts`:
```ts
import { isTopOrSameOriginFrame } from "./frames";

function fakeTop(origin: string) {
  const top: Record<string, unknown> = { location: { origin } };
  top.top = top;
  return top;
}

test("the top frame is eligible", () => {
  expect(isTopOrSameOriginFrame(fakeTop("https://a.com") as unknown as Window)).toBe(true);
});

test("a same-origin iframe is eligible", () => {
  const top = fakeTop("https://a.com");
  const frame = { top, location: { origin: "https://a.com" } };
  expect(isTopOrSameOriginFrame(frame as unknown as Window)).toBe(true);
});

test("a different-origin iframe is not eligible", () => {
  const top = fakeTop("https://a.com");
  const frame = { top, location: { origin: "https://ads.example" } };
  expect(isTopOrSameOriginFrame(frame as unknown as Window)).toBe(false);
});

test("a cross-origin iframe whose top.location access throws is not eligible", () => {
  const top = {
    get location(): never {
      throw new DOMException("blocked", "SecurityError");
    },
  };
  const frame = { top, location: { origin: "https://ads.example" } };
  expect(isTopOrSameOriginFrame(frame as unknown as Window)).toBe(false);
});
```

`src/content/frames.ts`:
```ts
// Filling into third-party iframes is a classic credential-theft vector, so only
// the top frame and same-origin iframes are handled.
export function isTopOrSameOriginFrame(win: Window = window): boolean {
  try {
    if (win === win.top) return true;
    return win.top !== null && win.top.location.origin === win.location.origin;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Verify and commit**

```bash
cd /home/yasreb/projects/password_manager/apps/extension
bun run test src/content && bun run typecheck
cd /home/yasreb/projects/password_manager
git add apps/extension/src/content
git commit -m "add login field detection"
```

---

### Task 12: Filling inputs and the shadow-DOM overlay

**Files:**
- Create: `apps/extension/src/content/fill.ts`, `fill.test.ts`, `overlay.ts`, `overlay.test.ts`

**Interfaces:**
- Consumes: `LoginFields`, `EntrySummary`.
- Produces: `setInputValue(input: HTMLInputElement, value: string): void`; `fillCredential(fields: LoginFields, credential: { username: string; password: string }): void`; `BannerAction { label: string; primary?: boolean; onClick: () => void }`; `Overlay { host: HTMLElement; addIcon(anchor: HTMLInputElement, onActivate: () => void): () => void; showPicker(anchor: HTMLInputElement, items: EntrySummary[], onPick: (id: number) => void): void; hidePicker(): void; showBanner(text: string, actions: BannerAction[]): void; hideBanner(): void; showNotice(text: string, durationMs?: number): void }`; `createOverlay(options?: { mode?: ShadowRootMode; requireTrusted?: boolean }): Overlay` (defaults: `mode: "closed"`, `requireTrusted: true`).

- [ ] **Step 1: Write the failing fill test**

`src/content/fill.test.ts`:
```ts
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
```

- [ ] **Step 2: Run, confirm failure; implement `fill.ts`**

```ts
import type { LoginFields } from "./fieldDetector";

// React/Vue-controlled inputs track their value on the element instance, so a plain
// `input.value = x` is ignored on the next render. Calling the native prototype setter
// and then dispatching input/change events makes the framework see a real edit.
export function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillCredential(
  fields: LoginFields,
  credential: { username: string; password: string }
): void {
  if (fields.username && credential.username) setInputValue(fields.username, credential.username);
  setInputValue(fields.password, credential.password);
}
```
Run: `bun run test src/content/fill.test.ts` → PASS.

- [ ] **Step 3: Write the failing overlay test**

`src/content/overlay.test.ts`:
```ts
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
```

- [ ] **Step 4: Run, confirm failure; implement `overlay.ts`**

```ts
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
```
Note: `showNotice` calls `this.showBanner` (which clears any earlier timer), then sets a new timer.

- [ ] **Step 5: Run tests and typecheck**

Run: `bun run test src/content && bun run typecheck` → PASS / clean. In the "removed when its input leaves the page" test only removal via the returned function is asserted (the disconnected-anchor path is exercised by `reposition` and verified manually).

- [ ] **Step 6: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension/src/content
git commit -m "add input filling and shadow-dom overlay"
```

### Task 13: Form submission capture and the content-script controller

**Files:**
- Create: `apps/extension/src/content/formCapture.ts`, `formCapture.test.ts`, `controller.ts`, `controller.test.ts`
- Modify: `apps/extension/src/content/index.ts` (replace the Task 1 stub)

**Interfaces:**
- Consumes: `findLoginFields`/`observeLoginFields`/`LoginFields`, `fillCredential`, `Overlay`/`createOverlay`, `sendMessage`, `isTopOrSameOriginFrame`, `isEligiblePageUrl`, `PendingSave`.
- Produces: `Submission { username: string; password: string }`; `pickSubmittedPassword(values: string[]): string | null`; `watchSubmissions(onSubmit: (s: Submission) => void, doc?: Document): () => void`; `ControllerEnv { send: typeof sendMessage; overlay: Overlay; doc?: Document; pendingCheckDelayMs?: number; checkPendingOnStart?: boolean }`; `startController(env: ControllerEnv): () => void`.

- [ ] **Step 1: Write the failing form capture test**

`src/content/formCapture.test.ts`:
```ts
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
```

- [ ] **Step 2: Run, confirm failure; implement `formCapture.ts`**

```ts
import { findLoginFields } from "./fieldDetector";

export interface Submission {
  username: string;
  password: string;
}

const DEDUPE_WINDOW_MS = 1000;
const SUBMIT_WORDS = /sign\s?in|log\s?in|submit|continue|next|register|sign\s?up|create account|save/i;

// Signup forms repeat the password as a confirm field (use the first); change-password
// forms have current + new + confirm (use the second, the NEW one). Empty fields are ignored.
export function pickSubmittedPassword(values: string[]): string | null {
  const filled = values.filter((value) => value.length > 0);
  if (filled.length === 0) return null;
  return filled.length >= 3 ? filled[1] : filled[0];
}

function collect(form: HTMLFormElement | null, doc: Document): Submission | null {
  const groups = findLoginFields(doc).filter((g) => g.password.form === form);
  if (groups.length === 0) return null;
  const password = pickSubmittedPassword(groups.map((g) => g.password.value));
  if (password === null) return null;
  const group = groups.find((g) => g.password.value === password) ?? groups[0];
  return { username: group.username?.value.trim() ?? "", password };
}

function looksLikeSubmit(button: Element): boolean {
  if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) {
    if (button.type === "submit") return true;
  }
  const label = [button.textContent, button.getAttribute("aria-label"), (button as HTMLInputElement).value]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return SUBMIT_WORDS.test(label);
}

// SPAs often never fire a real `submit`, so we also watch Enter in an input and
// clicks on submit-looking buttons.
export function watchSubmissions(onSubmit: (submission: Submission) => void, doc: Document = document): () => void {
  let last: { key: string; at: number } | null = null;

  function report(form: HTMLFormElement | null): void {
    const submission = collect(form, doc);
    if (!submission) return;
    const key = `${submission.username} ${submission.password}`;
    const now = Date.now();
    if (last && last.key === key && now - last.at < DEDUPE_WINDOW_MS) return;
    last = { key, at: now };
    onSubmit(submission);
  }

  const onFormSubmit = (event: Event) => {
    if (event.target instanceof HTMLFormElement) report(event.target);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return;
    if (event.target instanceof HTMLInputElement) report(event.target.form);
  };
  const onClick = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button, input[type=submit], input[type=button], [role=button]");
    if (button && looksLikeSubmit(button)) report(button.closest("form"));
  };

  doc.addEventListener("submit", onFormSubmit, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("click", onClick, true);
  return () => {
    doc.removeEventListener("submit", onFormSubmit, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("click", onClick, true);
  };
}
```
Run: `bun run test src/content/formCapture.test.ts` → PASS.

- [ ] **Step 3: Write the failing controller test**

`src/content/controller.test.ts`:
```ts
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
```

- [ ] **Step 4: Run, confirm failure; implement `controller.ts`**

```ts
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
```
Run: `bun run test src/content/controller.test.ts` → PASS. (If `credentialSubmitted` spreads extra fields type-check-wise, keep `...submission` since `Submission` has exactly `username` and `password`.)

- [ ] **Step 5: Wire `src/content/index.ts`**

```ts
import { sendMessage } from "../messaging/client";
import { isEligiblePageUrl } from "../shared/matching";
import { startController } from "./controller";
import { isTopOrSameOriginFrame } from "./frames";
import { createOverlay } from "./overlay";

// HTTPS pages (and localhost) only; top frame and same-origin iframes only.
if (isEligiblePageUrl(location.href) && isTopOrSameOriginFrame()) {
  startController({
    send: sendMessage,
    overlay: createOverlay(),
    // Only the top window shows the save banner; iframes just report submissions.
    checkPendingOnStart: window === window.top,
  });
}
```

- [ ] **Step 6: Verify and commit**

```bash
cd /home/yasreb/projects/password_manager/apps/extension
bun run typecheck && bun run test && bun run build
cd /home/yasreb/projects/password_manager
git add apps/extension/src/content
git commit -m "add form capture and content controller"
```
Expected: everything green; `dist/content.js` is one self-contained file.

---

### Task 14: Documentation, final gates, and manual verification checklist

**Files:**
- Create: `apps/extension/README.md`
- Modify: `/home/yasreb/projects/password_manager/README.md` (extension status)

- [ ] **Step 1: Run the automated gates**

```bash
cd /home/yasreb/projects/password_manager/apps/extension
bun run typecheck
bun run test
bun run build
# Shipped code must never parse strings as HTML or log:
grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|console\.log" src --include=*.ts --include=*.tsx | grep -v "\.test\." || echo "clean"
# Content and background bundles must be classic scripts (no ES import/export statements):
grep -cE "^(import|export) " dist/content.js dist/background.js
```
Expected: typecheck clean; all tests pass; build succeeds; grep prints `clean`; the last command prints `0` for both files. Fix anything that fails before continuing.

- [ ] **Step 2: Write `apps/extension/README.md`** (the outer fence below uses four backticks because the README contains its own code fences)

````markdown
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
````

- [ ] **Step 3: Update the root `README.md`**

Make these edits (read the file first and match its wording):
- In the architecture block, change `extension/   Chrome + Zen/Firefox browser extension (not yet started)` to `extension/   Zen/Firefox browser extension (Manifest V3): login, vault, autofill, save prompt`.
- Replace the `### apps/extension: Browser extension (not started)` section body with a short description: implemented for Zen/Firefox (login, vault browse/edit, click-to-fill autofill, save/update prompt, idle auto-lock), reusing the mobile crypto scheme and the same API, Chrome build planned; link to `apps/extension/README.md`.
- In the status table, change the `apps/extension` row to `Zen/Firefox build complete (login, vault, autofill, save prompt); Chrome not started`.

- [ ] **Step 4: Commit**

```bash
cd /home/yasreb/projects/password_manager
git add apps/extension/README.md README.md
git commit -m "document the browser extension"
```

- [ ] **Step 5: Manual verification checklist (the user runs this in Zen)**

The automated tests cannot cover a real browser. Report each item as pass or fail:

1. Load `dist/manifest.json` as a temporary add-on. Note whether Zen asks you to grant site permissions (spec open question: host permissions). Grant them if it does.
2. Click the toolbar icon, log in with your mobile account. Your mobile entries appear; opening one shows title, username, hidden password.
3. Serve a local test page and open it (`localhost` is eligible):
   ```bash
   mkdir -p /tmp/pm-test && cd /tmp/pm-test
   printf '<form><input name="u" type="text" autocomplete="username"><input name="p" type="password"><button type="submit">Sign in</button></form>' > index.html
   python3 -m http.server 8123
   ```
   Open `http://localhost:8123/`. Expected: a small "PM" icon appears inside the password field.
4. In the mobile app (or the popup Edit screen) give an entry the URL `http://localhost`. Click the icon: the picker shows it; choosing it fills both fields.
5. Type a NEW username and password and press Sign in: after a moment the "Save password for localhost?" banner appears; Save it; confirm it shows in the popup list and on mobile after sync.
6. Repeat with the same username and a different password: the banner says "Update password".
7. Settings: set auto-lock to 1 minute, wait 2 minutes idle, click the toolbar icon: it asks for login again.
8. Copy a password from the popup, wait about 35 seconds, paste somewhere: it should be empty (clipboard clear via alarm; spec open question).
9. Fully quit and restart the browser: the extension needs the master password again (session is memory-only).
10. Confirm the icon does NOT appear on a plain `http://` non-localhost page.
```

(After the final task, dispatch the whole-branch review; then record any failed manual checks as follow-ups.)

