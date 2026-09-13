# Mobile Foundation, Crypto & Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the mobile app (`apps/mobile`): testing tooling, the "Vault" design system, the client-side crypto layer (key derivation + AES-GCM), and the full register/login/biometric-unlock/logout flow talking to the existing `apps/api` auth endpoints.

**Architecture:** Expo Router app. A pure-TypeScript crypto layer (`src/crypto/`) with no native dependencies computes `master_key`/`vault_key`/`auth_key` and does AES-GCM encrypt/decrypt. A typed `fetch`-based API client (`src/api/`) talks to `apps/api`. `AuthContext` (`src/context/`) orchestrates crypto + API + SecureStore-backed session persistence, exposed to screens via `app/`. This is Plan 1 of 2 — vault CRUD screens, the local SQLite cache, and offline sync are Plan 2, built after this plan is reviewed and complete.

**Tech Stack:** Expo SDK ~57, Expo Router ~57, React Native 0.86, TypeScript ~6, NativeWind 4 (Tailwind), `@noble/hashes`/`@noble/ciphers` (crypto), `expo-secure-store`, `expo-local-authentication`, Jest + `jest-expo` + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-11-mobile-app-design.md`

## Global Constraints

- Key derivation is **canonical and binding** — any deviation breaks cross-client login:
  ```
  master_key = PBKDF2-HMAC-SHA256(password=master_password, salt=lowercase(trim(email)), iterations=600_000, dkLen=32)
  prk        = HKDF-Extract-SHA256(salt=<32 zero bytes>, ikm=master_key)
  vault_key  = HKDF-Expand-SHA256(prk, info="password-manager/vault_key/v1", length=32)
  auth_key   = HKDF-Expand-SHA256(prk, info="password-manager/auth_key/v1",  length=32)
  ```
- `auth_key` is base64-encoded before being sent to the server (matches `AUTH_KEY_BYTE_LENGTH = 32` / 44-char wire format already enforced by `apps/api/app/auth/schemas.py`).
- `vault_key`, `auth_key`, and `access_token` are the only values ever persisted to device storage, and only via `expo-secure-store` with `{ requireAuthentication: true }`. `master_key` and the raw master password are never persisted anywhere, ever.
- Ciphertext-only principle: this plan's `crypto/cipher.ts` decrypt function returns plaintext only as an in-memory value — nothing this plan builds writes decrypted plaintext to any form of storage.
- Design tokens live only in `src/theme/`; components import tokens, screens import components — never a hardcoded hex color, font size, or spacing number outside `src/theme/`.
- The user runs every `bun add` / `bun x expo install` command themselves — every task that needs a new package says so explicitly and waits for confirmation rather than assuming it's present.
- The user runs every `git commit` themselves — every task ends with what to stage/commit, never a command to run it.

---

## File Structure

```
apps/mobile/
  jest.config.js                    # new — jest-expo preset
  tailwind.config.js                # new
  global.css                        # new — Tailwind directives + CSS var tokens
  babel.config.js                   # modified — add nativewind/babel preset
  metro.config.js                   # new — withNativeWind wrapper
  package.json                      # modified — "test" script, new devDependencies
  app/
    _layout.tsx                     # modified — polyfill import, AuthProvider, routing gate
    (auth)/
      login.tsx                     # new
      register.tsx                  # new
    (app)/
      _layout.tsx                   # new — biometric-gate check
      index.tsx                     # new — placeholder "unlocked" screen (Plan 2 replaces this)
  src/
    theme/
      colors.ts                     # new
      spacing.ts                    # new
      typography.ts                 # new
      radius.ts                     # new
      shadows.ts                    # new
      motion.ts                     # new
      index.ts                      # new — re-exports
    components/
      themed-text.tsx                # new
      button.tsx                     # new
    crypto/
      base64.ts                      # new
      base64.test.ts                 # new
      deriveKeys.ts                  # new
      deriveKeys.test.ts              # new
      cipher.ts                       # new
      cipher.test.ts                   # new
    api/
      client.ts                       # new — fetch wrapper, ApiError
      auth.ts                         # new — register/login/getMe
      auth.test.ts                     # new
    context/
      session.ts                       # new — SecureStore wrapper
      session.test.ts                   # new
      AuthContext.tsx                   # new
```

Old scaffold content (`create-expo-app`'s default `app/(tabs)/`, `components/`, `constants/`, template assets) is deleted as part of Task 1 — it's throwaway boilerplate, not something to preserve or merge with.

---

## Task 1: Project foundation — testing tooling, NativeWind, secure randomness

**Files:**
- Create: `apps/mobile/jest.config.js`, `apps/mobile/tailwind.config.js`, `apps/mobile/global.css`, `apps/mobile/metro.config.js`
- Modify: `apps/mobile/babel.config.js`, `apps/mobile/package.json`, `apps/mobile/app/_layout.tsx`
- Delete: `apps/mobile/app/(tabs)/` (entire directory), `apps/mobile/components/` (entire directory, default template components), `apps/mobile/constants/` (entire directory, default template constants)
- Test: `apps/mobile/src/__smoke__/render.test.tsx`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working `bun test` command; a `global.css` importable from `app/_layout.tsx`; `react-native-get-random-values` guaranteed loaded before any other app code runs (later crypto tasks depend on `crypto.getRandomValues` existing globally). No exported functions — this is infrastructure.

This task has no TDD RED/GREEN cycle in the usual sense — it's tooling setup. Verification is: the testing pipeline itself works, proven by one real render test, not just "zero tests ran without error."

- [ ] **Step 1: Tell the user to install dev dependencies**

Ask the user to run, from `apps/mobile`:

```bash
bun add -D jest jest-expo @testing-library/react-native react-test-renderer @types/jest
```

Wait for confirmation before continuing — later steps assume these are present.

- [ ] **Step 2: Delete the default scaffold content**

Delete these (they're `create-expo-app`'s default tabs template, not part of this app's design):
- `apps/mobile/app/(tabs)/` (the whole directory: `_layout.tsx`, `index.tsx`, `explore.tsx`)
- `apps/mobile/components/` (the whole directory)
- `apps/mobile/constants/` (the whole directory)

Leave `apps/mobile/app/_layout.tsx` in place — it's modified in Step 6, not deleted.

- [ ] **Step 3: Configure Jest**

Create `apps/mobile/jest.config.js`:

```js
module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)",
  ],
};
```

Add a `"test"` script. Modify `apps/mobile/package.json`'s `"scripts"` block to read:

```json
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "test": "jest"
  },
```

- [ ] **Step 4: Configure NativeWind + Tailwind**

Create `apps/mobile/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

Create `apps/mobile/global.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Modify `apps/mobile/babel.config.js`. Its current content (from the `create-expo-app` template) is:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
```

(If your copy differs — e.g. it's missing the `jsxImportSource`/`nativewind/babel` additions — add them now: `babel-preset-expo`'s options gain `{ jsxImportSource: "nativewind" }`, and `"nativewind/babel"` is added as a second preset.)

Create `apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
```

- [ ] **Step 5: Write the smoke test**

Create `apps/mobile/src/__smoke__/render.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

test("the testing pipeline can render and query a component", () => {
  render(<Text>Hello, vault.</Text>);
  expect(screen.getByText("Hello, vault.")).toBeTruthy();
});
```

- [ ] **Step 6: Wire the secure-randomness polyfill and run the smoke test**

Modify `apps/mobile/app/_layout.tsx`. Its current content (from the `create-expo-app` template) references the deleted `(tabs)` group and default fonts/splash-screen logic — replace the whole file for now with a minimal placeholder that Task 10 will properly build out:

```tsx
import "react-native-get-random-values";

import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

The `import "react-native-get-random-values"` line **must be the first line of this file** — it's a side-effect-only import that patches the global `crypto.getRandomValues` before any other module (including any `@noble/*` code in later tasks) can run. This is not a style preference; importing it anywhere else, or after another import that transitively uses crypto, risks the polyfill installing too late.

Run: `cd apps/mobile && bun test`
Expected: PASS (1 passed) — this proves Jest, `jest-expo`, and React Native Testing Library are correctly wired together before any later task depends on them.

- [ ] **Step 7: Commit**

Tell the user: stage `jest.config.js`, `tailwind.config.js`, `global.css`, `metro.config.js`, `babel.config.js`, `package.json`, `app/_layout.tsx`, `src/__smoke__/render.test.tsx`, and the deletions of `app/(tabs)/`, `components/`, `constants/`, then commit with a message like:

```
chore: set up Jest, NativeWind, and secure-randomness polyfill
```

---

## Task 2: Design tokens ("Vault" theme)

**Files:**
- Create: `apps/mobile/src/theme/colors.ts`, `apps/mobile/src/theme/spacing.ts`, `apps/mobile/src/theme/typography.ts`, `apps/mobile/src/theme/radius.ts`, `apps/mobile/src/theme/shadows.ts`, `apps/mobile/src/theme/motion.ts`, `apps/mobile/src/theme/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `colors`, `useBrandColors()`, `spacing`, `type` (typography ramp), `radius`, `shadows`, `motion` — all re-exported from `src/theme/index.ts`. Task 4 (`ThemedText`, `Button`) imports these directly: `import { colors, spacing, type, radius, useBrandColors } from "@/theme"`.

This is a pure-values task (no logic to unit-test beyond "the file exports what it claims to"). Verification is a type-check, not a runtime test.

- [ ] **Step 1: Semantic platform colors**

Create `apps/mobile/src/theme/colors.ts`:

```ts
import { Platform } from "react-native";
import { useColorScheme } from "react-native";

export const colors = {
  label: Platform.select({
    ios: "#FFFFFF",
    android: "#FFFFFF",
    default: "#FFFFFF",
  })!,
  secondaryLabel: Platform.select({
    ios: "#A0A0A8",
    android: "#A0A0A8",
    default: "#A0A0A8",
  })!,
  separator: Platform.select({
    ios: "#2C2C30",
    android: "#2C2C30",
    default: "#2C2C30",
  })!,
  systemBackground: Platform.select({
    ios: "#0B0B0E",
    android: "#0B0B0E",
    default: "#0B0B0E",
  })!,
};

const brandPalette = {
  light: { accent: "#8A5A1E", accentContrast: "#FFFFFF" },
  dark: { accent: "#C9974C", accentContrast: "#1A1206" },
} as const;

export function useBrandColors() {
  const scheme = useColorScheme();
  return brandPalette[scheme === "light" ? "light" : "dark"];
}
```

This deliberately defaults every semantic color to the **dark** ("obsidian") palette per the spec's dark-first direction — `colors.systemBackground` is a near-black `#0B0B0E`, not white. `useBrandColors()` is the one place light-mode support lives: light mode gets a warm off-white background — that piece is added in Step 2 once we have the pattern in place from `Button`/`ThemedText`'s actual usage (see the self-review note at the end of this task).

Actually — write light-mode support now, don't defer it. Replace the file above with:

```ts
import { Platform, useColorScheme } from "react-native";

const palette = {
  dark: {
    label: "#FFFFFF",
    secondaryLabel: "#A0A0A8",
    separator: "#2C2C30",
    systemBackground: "#0B0B0E",
  },
  light: {
    label: "#1A1612",
    secondaryLabel: "#6B6560",
    separator: "#E8E2D8",
    systemBackground: "#FAF6EE",
  },
} as const;

export function useThemeColors() {
  const scheme = useColorScheme();
  return palette[scheme === "light" ? "light" : "dark"];
}

const brandPalette = {
  light: { accent: "#8A5A1E", accentContrast: "#FFFFFF" },
  dark: { accent: "#C9974C", accentContrast: "#1A1206" },
} as const;

export function useBrandColors() {
  const scheme = useColorScheme();
  return brandPalette[scheme === "light" ? "light" : "dark"];
}

// Static-safe default (dark), for token files that need a color at module
// scope rather than inside a component — see theme/typography.ts.
export const colors = palette.dark;
```

`useThemeColors()` and `useBrandColors()` are hook-only (read `useColorScheme()` at render time) — only usable inside components. `colors` is the static-safe dark-mode fallback for files like `typography.ts` that build objects at module scope. Never mix the two in one file (per the design-system skill's rule) — a component wanting light/dark-correct colors uses the hooks; a static ramp object uses `colors`.

- [ ] **Step 2: Spacing**

Create `apps/mobile/src/theme/spacing.ts`:

```ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;
```

- [ ] **Step 3: Typography**

Create `apps/mobile/src/theme/typography.ts`:

```ts
import { TextStyle } from "react-native";
import { colors } from "./colors";

export const type = {
  largeTitle: { fontSize: 34, fontWeight: "700", color: colors.label } as TextStyle,
  title: { fontSize: 22, fontWeight: "600", color: colors.label } as TextStyle,
  headline: { fontSize: 17, fontWeight: "600", color: colors.label } as TextStyle,
  body: { fontSize: 17, fontWeight: "400", color: colors.label } as TextStyle,
  subhead: { fontSize: 15, fontWeight: "400", color: colors.secondaryLabel } as TextStyle,
  caption: { fontSize: 12, fontWeight: "400", color: colors.secondaryLabel } as TextStyle,
  mono: {
    fontSize: 13,
    fontWeight: "400",
    color: colors.secondaryLabel,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  } as TextStyle,
} as const;
```

Add the `Platform` import at the top: `import { Platform, TextStyle } from "react-native";` (replacing the plain `TextStyle` import).

`type.mono` is the spec's "monospace accent for entry metadata" — used for timestamps/sync-status text, not for the whole UI. It falls back to the OS's built-in monospace font (`Menlo` on iOS, `monospace` on Android) rather than bundling a custom font file, keeping this task dependency-free.

- [ ] **Step 4: Radius**

Create `apps/mobile/src/theme/radius.ts`:

```ts
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
} as const;
```

- [ ] **Step 5: Shadows**

Create `apps/mobile/src/theme/shadows.ts`:

```ts
export const shadows = {
  card: "0 1px 2px rgba(0, 0, 0, 0.24)",
  raised: "0 4px 12px rgba(0, 0, 0, 0.32)",
  overlay: "0 8px 24px rgba(0, 0, 0, 0.45)",
} as const;
```

(Opacity values are higher than a typical light-mode shadow scale since these sit against the near-black obsidian background where a subtle light-mode shadow would be invisible.)

- [ ] **Step 6: Motion**

Create `apps/mobile/src/theme/motion.ts`:

```ts
export const motion = {
  fast: 150,
  base: 250,
  slow: 400,
} as const;
```

- [ ] **Step 7: Re-export index**

Create `apps/mobile/src/theme/index.ts`:

```ts
export { colors, useThemeColors, useBrandColors } from "./colors";
export { spacing } from "./spacing";
export { type } from "./typography";
export { radius } from "./radius";
export { shadows } from "./shadows";
export { motion } from "./motion";
```

- [ ] **Step 8: Verify with a type-check**

Run: `cd apps/mobile && bunx tsc --noEmit`
Expected: no errors referencing any file under `src/theme/`.

- [ ] **Step 9: Commit**

Tell the user: stage `src/theme/`, then commit with a message like:

```
feat: add Vault design system tokens (colors, spacing, typography, radius, shadows, motion)
```

---

## Task 3: Base64 encoding helper

**Files:**
- Create: `apps/mobile/src/crypto/base64.ts`
- Test: `apps/mobile/src/crypto/base64.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `bytesToBase64(bytes: Uint8Array): string` and `base64ToBytes(b64: string): Uint8Array`. Task 5 (`deriveKeys.ts`, for encoding `auth_key`), Task 6 (`cipher.ts`, for encoding the nonce+ciphertext blob), and Task 8 (`session.ts`, for storing `Uint8Array` keys in SecureStore's string-only storage) all import these two functions as `import { bytesToBase64, base64ToBytes } from "@/crypto/base64"`.

React Native doesn't reliably provide `btoa`/`atob` for arbitrary binary data across all engines, and pulling in Node's `Buffer` polyfill is an extra dependency this project doesn't otherwise need — a small standalone implementation avoids both problems.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/crypto/base64.test.ts`. These are RFC 4648 §10's own published test vectors — genuinely independent ground truth, not self-referential:

```ts
import { bytesToBase64, base64ToBytes } from "./base64";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("bytesToBase64", () => {
  test.each([
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ])("encodes %j to %j (RFC 4648 test vector)", (input, expected) => {
    expect(bytesToBase64(utf8(input))).toBe(expected);
  });
});

describe("base64ToBytes", () => {
  test.each([
    ["", ""],
    ["Zg==", "f"],
    ["Zm8=", "fo"],
    ["Zm9v", "foo"],
    ["Zm9vYg==", "foob"],
    ["Zm9vYmE=", "fooba"],
    ["Zm9vYmFy", "foobar"],
  ])("decodes %j to %j (RFC 4648 test vector)", (input, expected) => {
    expect(new TextDecoder().decode(base64ToBytes(input))).toBe(expected);
  });
});

test("round-trips arbitrary binary data, not just text", () => {
  const original = new Uint8Array([0, 1, 2, 253, 254, 255, 127, 128]);
  expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/mobile && bun test src/crypto/base64.test.ts`
Expected: FAIL with `Cannot find module './base64'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/crypto/base64.ts`:

```ts
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    result += CHARS[b0 >> 2];
    result += CHARS[((b0 & 0x03) << 4) | (b1 !== undefined ? b1 >> 4 : 0)];
    result += b1 !== undefined ? CHARS[((b1 & 0x0f) << 2) | (b2 !== undefined ? b2 >> 6 : 0)] : "=";
    result += b2 !== undefined ? CHARS[b2 & 0x3f] : "=";
  }
  return result;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (const char of clean) {
    const value = CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/mobile && bun test src/crypto/base64.test.ts`
Expected: PASS (15 passed)

- [ ] **Step 5: Commit**

Tell the user: stage `src/crypto/base64.ts` and `src/crypto/base64.test.ts`, then commit with a message like:

```
feat: add base64 encode/decode helpers (RFC 4648-verified)
```

---

## Task 4: Core UI primitives — ThemedText and Button

**Files:**
- Create: `apps/mobile/src/components/themed-text.tsx`, `apps/mobile/src/components/button.tsx`
- Test: `apps/mobile/src/components/button.test.tsx`

**Interfaces:**
- Consumes: `colors`, `spacing`, `type`, `radius`, `useBrandColors` from `@/theme` (Task 2).
- Produces: `<ThemedText variant="body" | "headline" | ... />` and `<Button variant="primary" | "secondary" size="sm" | "md" title loading disabled onPress style />`. Screens built in Task 10 import both as `import { ThemedText } from "@/components/themed-text"` / `import { Button } from "@/components/button"`.

- [ ] **Step 1: Write ThemedText (no dedicated test — a thin, near-declarative wrapper; exercised indirectly by Button's tests below)**

Create `apps/mobile/src/components/themed-text.tsx`:

```tsx
import { Text, TextProps } from "react-native";
import { type } from "@/theme";

export function ThemedText({
  variant = "body",
  style,
  ...props
}: TextProps & { variant?: keyof typeof type }) {
  return <Text style={[type[variant], style]} {...props} />;
}
```

- [ ] **Step 2: Write the failing test for Button**

Create `apps/mobile/src/components/button.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "./button";

test("renders the given title", () => {
  render(<Button title="Unlock" onPress={() => {}} />);
  expect(screen.getByText("Unlock")).toBeTruthy();
});

test("calls onPress when tapped", () => {
  const onPress = jest.fn();
  render(<Button title="Unlock" onPress={onPress} />);
  fireEvent.press(screen.getByText("Unlock"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("does not call onPress when disabled", () => {
  const onPress = jest.fn();
  render(<Button title="Unlock" onPress={onPress} disabled />);
  fireEvent.press(screen.getByText("Unlock"));
  expect(onPress).not.toHaveBeenCalled();
});

test("does not call onPress while loading", () => {
  const onPress = jest.fn();
  render(<Button title="Unlock" onPress={onPress} loading />);
  expect(screen.queryByText("Unlock")).toBeNull();
  expect(onPress).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/mobile && bun test src/components/button.test.tsx`
Expected: FAIL with `Cannot find module './button'`

- [ ] **Step 4: Write the implementation**

Create `apps/mobile/src/components/button.tsx`:

```tsx
import { ActivityIndicator, Pressable, StyleProp, ViewStyle } from "react-native";
import { radius, spacing, useBrandColors } from "@/theme";
import { ThemedText } from "./themed-text";

const sizes = {
  sm: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  md: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
} as const;

export function Button({
  variant = "primary",
  size = "md",
  title,
  loading,
  disabled,
  style,
  onPress,
}: {
  variant?: "primary" | "secondary";
  size?: keyof typeof sizes;
  title: string;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const brand = useBrandColors();
  const variants = {
    primary: { backgroundColor: brand.accent, textColor: brand.accentContrast },
    secondary: { backgroundColor: "transparent", textColor: brand.accent },
  } as const;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: variants[variant].backgroundColor,
          borderRadius: radius.md,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
          ...sizes[size],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variants[variant].textColor} />
      ) : (
        <ThemedText variant="headline" style={{ color: variants[variant].textColor }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/mobile && bun test src/components/button.test.tsx`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

Tell the user: stage `src/components/`, then commit with a message like:

```
feat: add ThemedText and Button design-system primitives
```

---

## Task 5: Crypto — key derivation (PBKDF2 + HKDF)

**Files:**
- Create: `apps/mobile/src/crypto/deriveKeys.ts`
- Test: `apps/mobile/src/crypto/deriveKeys.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (the global `crypto.getRandomValues` polyfill from Task 1 is required at runtime by `@noble/hashes` internals, but this task's code doesn't call it directly).
- Produces: `deriveKeys(email: string, masterPassword: string): { vaultKey: Uint8Array; authKey: Uint8Array }`. Task 7 (`api/auth.ts`) and Task 9 (`AuthContext.tsx`) import this as `import { deriveKeys } from "@/crypto/deriveKeys"`.

This is the security-critical core of the whole app — read this task's rationale carefully, not just the code.

**On testing a KDF without hand-computed "known answer" vectors:** hand-verifying real PBKDF2-HMAC-SHA256/HKDF-SHA256 output for our *specific* salt/info strings isn't something that can be done reliably by inspection — a wrong "expected" value in a test is worse than no test, since it would make correct code look broken (or, worse, could be adjusted to match incorrect code). Instead, this task tests the **properties** a correct KDF must have, which are independently verifiable without needing precomputed ground truth: determinism, correct output length, and — the property that actually matters for this design — that `vault_key` and `auth_key` are different values (domain separation is the entire reason this uses HKDF with two `info` strings instead of one PBKDF2 call). Before implementing, read `@noble/hashes`'s own README/type definitions in `node_modules/@noble/hashes` to confirm the exact import paths and function signatures used below — the versions in this task were written from the plan author's best knowledge of the `@noble/hashes` v2 API, but exact subpath names have changed across versions before; if an import fails, that's the signal to check the installed package's actual `exports` field rather than guessing further.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/crypto/deriveKeys.test.ts`:

```ts
import { deriveKeys } from "./deriveKeys";

const EMAIL = "test@example.com";
const PASSWORD = "correct horse battery staple";

test("returns 32-byte vaultKey and authKey", () => {
  const { vaultKey, authKey } = deriveKeys(EMAIL, PASSWORD);
  expect(vaultKey).toBeInstanceOf(Uint8Array);
  expect(vaultKey.length).toBe(32);
  expect(authKey).toBeInstanceOf(Uint8Array);
  expect(authKey.length).toBe(32);
});

test("vaultKey and authKey are different values (domain separation)", () => {
  const { vaultKey, authKey } = deriveKeys(EMAIL, PASSWORD);
  expect(Buffer.from(vaultKey).equals(Buffer.from(authKey))).toBe(false);
});

test("is deterministic: same email+password always derives the same keys", () => {
  const first = deriveKeys(EMAIL, PASSWORD);
  const second = deriveKeys(EMAIL, PASSWORD);
  expect(Buffer.from(first.vaultKey).equals(Buffer.from(second.vaultKey))).toBe(true);
  expect(Buffer.from(first.authKey).equals(Buffer.from(second.authKey))).toBe(true);
});

test("a different password produces different keys", () => {
  const a = deriveKeys(EMAIL, PASSWORD);
  const b = deriveKeys(EMAIL, "a different password entirely");
  expect(Buffer.from(a.vaultKey).equals(Buffer.from(b.vaultKey))).toBe(false);
  expect(Buffer.from(a.authKey).equals(Buffer.from(b.authKey))).toBe(false);
});

test("email casing and surrounding whitespace do not change the derived keys", () => {
  const a = deriveKeys("Test@Example.com", PASSWORD);
  const b = deriveKeys("  test@example.com  ", PASSWORD);
  expect(Buffer.from(a.vaultKey).equals(Buffer.from(b.vaultKey))).toBe(true);
  expect(Buffer.from(a.authKey).equals(Buffer.from(b.authKey))).toBe(true);
});

test("a different email produces different keys, even with the same password", () => {
  const a = deriveKeys(EMAIL, PASSWORD);
  const b = deriveKeys("someone-else@example.com", PASSWORD);
  expect(Buffer.from(a.vaultKey).equals(Buffer.from(b.vaultKey))).toBe(false);
});
```

(`jest-expo`'s Node test environment provides `Buffer` for these comparisons — the app code itself never uses `Buffer`, only these tests do, for convenient byte-array equality.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/mobile && bun test src/crypto/deriveKeys.test.ts`
Expected: FAIL with `Cannot find module './deriveKeys'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/crypto/deriveKeys.ts`:

```ts
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { extract, expand } from "@noble/hashes/hkdf.js";

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 32;
const HKDF_EXTRACT_SALT = new Uint8Array(32); // 32 zero bytes — see spec for why
const VAULT_KEY_INFO = new TextEncoder().encode("password-manager/vault_key/v1");
const AUTH_KEY_INFO = new TextEncoder().encode("password-manager/auth_key/v1");

export interface DerivedKeys {
  vaultKey: Uint8Array;
  authKey: Uint8Array;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function deriveKeys(email: string, masterPassword: string): DerivedKeys {
  const salt = new TextEncoder().encode(normalizeEmail(email));
  const password = new TextEncoder().encode(masterPassword);

  const masterKey = pbkdf2(sha256, password, salt, { c: PBKDF2_ITERATIONS, dkLen: KEY_LENGTH });
  const prk = extract(sha256, masterKey, HKDF_EXTRACT_SALT);

  return {
    vaultKey: expand(sha256, prk, VAULT_KEY_INFO, KEY_LENGTH),
    authKey: expand(sha256, prk, AUTH_KEY_INFO, KEY_LENGTH),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/mobile && bun test src/crypto/deriveKeys.test.ts`
Expected: PASS (6 passed). Note: with 600,000 real PBKDF2 iterations per call and 8 calls across the test file, this test file may take several seconds to run — that's expected, not a hang.

If any import fails (`Cannot find module '@noble/hashes/pbkdf2.js'` or similar), open `node_modules/@noble/hashes/package.json` and check its `"exports"` field for the actual current subpath names, then adjust the three import lines accordingly — do not change the derivation logic itself, only the import paths.

- [ ] **Step 5: Commit**

Tell the user: stage `src/crypto/deriveKeys.ts` and `src/crypto/deriveKeys.test.ts`, then commit with a message like:

```
feat: add canonical PBKDF2/HKDF key derivation (vault_key, auth_key)
```

---

## Task 6: Crypto — AES-GCM encrypt/decrypt

**Files:**
- Create: `apps/mobile/src/crypto/cipher.ts`
- Test: `apps/mobile/src/crypto/cipher.test.ts`

**Interfaces:**
- Consumes: `bytesToBase64`, `base64ToBytes` from `@/crypto/base64` (Task 3).
- Produces: `encryptEntry(vaultKey: Uint8Array, plaintext: string): string` and `decryptEntry(vaultKey: Uint8Array, encoded: string): string`. Not wired into any screen in this plan — Plan 2's vault CRUD screens are the first consumers. Built now because it's part of "the client-side crypto layer" this plan's scope explicitly covers, and because `AuthContext` (Task 9) needs `vaultKey` to exist and be well-typed even though it doesn't call these functions yet.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/crypto/cipher.test.ts`:

```ts
import { encryptEntry, decryptEntry } from "./cipher";

function randomKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

test("round-trips: decrypting what was just encrypted returns the original plaintext", () => {
  const key = randomKey();
  const plaintext = JSON.stringify({ site: "example.com", username: "me", password: "hunter2" });
  const encoded = encryptEntry(key, plaintext);
  expect(decryptEntry(key, encoded)).toBe(plaintext);
});

test("two encryptions of the same plaintext produce different ciphertext (fresh nonce each time)", () => {
  const key = randomKey();
  const plaintext = "same value both times";
  const first = encryptEntry(key, plaintext);
  const second = encryptEntry(key, plaintext);
  expect(first).not.toBe(second);
});

test("decrypting with the wrong key throws instead of returning garbage", () => {
  const encoded = encryptEntry(randomKey(), "sensitive value");
  expect(() => decryptEntry(randomKey(), encoded)).toThrow();
});

test("a tampered ciphertext fails to decrypt (authentication, not just encryption)", () => {
  const key = randomKey();
  const encoded = encryptEntry(key, "sensitive value");
  const tampered = encoded.slice(0, -4) + (encoded.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
  expect(() => decryptEntry(key, tampered)).toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/mobile && bun test src/crypto/cipher.test.ts`
Expected: FAIL with `Cannot find module './cipher'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/crypto/cipher.ts`:

```ts
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToBase64, base64ToBytes } from "./base64";

const NONCE_LENGTH = 12; // standard AES-GCM nonce size

export function encryptEntry(vaultKey: Uint8Array, plaintext: string): string {
  const nonce = new Uint8Array(NONCE_LENGTH);
  crypto.getRandomValues(nonce);

  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextAndTag = gcm(vaultKey, nonce).encrypt(plaintextBytes);

  const combined = new Uint8Array(nonce.length + ciphertextAndTag.length);
  combined.set(nonce, 0);
  combined.set(ciphertextAndTag, nonce.length);

  return bytesToBase64(combined);
}

export function decryptEntry(vaultKey: Uint8Array, encoded: string): string {
  const combined = base64ToBytes(encoded);
  const nonce = combined.slice(0, NONCE_LENGTH);
  const ciphertextAndTag = combined.slice(NONCE_LENGTH);

  const plaintextBytes = gcm(vaultKey, nonce).decrypt(ciphertextAndTag);
  return new TextDecoder().decode(plaintextBytes);
}
```

Wire format matches the spec exactly: nonce, then ciphertext+auth-tag (which `gcm(...).encrypt()` already produces as one combined output — AES-GCM's authentication tag is appended to the ciphertext, not a separate value), concatenated, then base64-encoded as one opaque string — this is exactly what `POST /vault`'s `ciphertext` field receives.

If `@noble/ciphers/aes.js` fails to import, check `node_modules/@noble/ciphers/package.json`'s `"exports"` field the same way as Task 5's note.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/mobile && bun test src/crypto/cipher.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

Tell the user: stage `src/crypto/cipher.ts` and `src/crypto/cipher.test.ts`, then commit with a message like:

```
feat: add AES-GCM encrypt/decrypt for vault entries
```

---

## Task 7: API client — register, login, me

**Files:**
- Create: `apps/mobile/src/api/client.ts`, `apps/mobile/src/api/auth.ts`
- Test: `apps/mobile/src/api/auth.test.ts`

**Interfaces:**
- Consumes: `bytesToBase64` from `@/crypto/base64` (Task 3, to encode `authKey` for the wire).
- Produces: `register(email: string, authKey: Uint8Array): Promise<TokenResponse>`, `login(email: string, authKey: Uint8Array): Promise<TokenResponse>`, `getMe(accessToken: string): Promise<{ id: number; email: string }>`, and the `ApiError` class (with `.status: number` and `.detail: unknown`). Task 9 (`AuthContext.tsx`) imports all of these from `@/api/auth`.

**Environment setup needed before this task's tests can hit a real server (not needed for the tests themselves, which mock `fetch` — but needed before Task 10's screens can be manually verified):** create `apps/mobile/.env` with `EXPO_PUBLIC_API_URL=http://<your-dev-machine's-LAN-IP>:8000` — `localhost` won't reach your machine's API from a physical device or most emulators. Tell the user this now; it's not part of this task's automated tests, but it blocks manually trying the app later.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/api/auth.test.ts`:

```ts
import { register, login, getMe, ApiError } from "./auth";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const AUTH_KEY = new Uint8Array(32).fill(7);

test("register sends base64 auth_key and returns the token", async () => {
  mockFetchOnce(201, { access_token: "abc123", token_type: "bearer" });

  const result = await register("test@example.com", AUTH_KEY);

  expect(result).toEqual({ access_token: "abc123", token_type: "bearer" });
  const [, options] = (global.fetch as jest.Mock).mock.calls[0];
  const body = JSON.parse(options.body as string);
  expect(body.email).toBe("test@example.com");
  expect(typeof body.auth_key).toBe("string");
  expect(body.auth_key.length).toBe(44); // 32 bytes base64-encoded
});

test("register throws ApiError with status 409 on duplicate email", async () => {
  mockFetchOnce(409, { detail: "Email already registered" });

  await expect(register("test@example.com", AUTH_KEY)).rejects.toMatchObject({
    status: 409,
  });
});

test("login returns the token on success", async () => {
  mockFetchOnce(200, { access_token: "xyz789", token_type: "bearer" });

  const result = await login("test@example.com", AUTH_KEY);

  expect(result.access_token).toBe("xyz789");
});

test("login throws ApiError with status 401 on invalid credentials", async () => {
  mockFetchOnce(401, { detail: "Invalid email or password" });

  await expect(login("test@example.com", AUTH_KEY)).rejects.toBeInstanceOf(ApiError);
});

test("getMe sends the bearer token and returns the user", async () => {
  mockFetchOnce(200, { id: 1, email: "test@example.com" });

  const result = await getMe("some-token");

  expect(result).toEqual({ id: 1, email: "test@example.com" });
  const [, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(options.headers.Authorization).toBe("Bearer some-token");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/mobile && bun test src/api/auth.test.ts`
Expected: FAIL with `Cannot find module './auth'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/api/client.ts`:

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

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, (data as { detail?: unknown }).detail);
  }

  return data as T;
}
```

Create `apps/mobile/src/api/auth.ts`:

```ts
import { bytesToBase64 } from "@/crypto/base64";
import { apiRequest, ApiError } from "./client";

export { ApiError };

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface UserResponse {
  id: number;
  email: string;
}

export function register(email: string, authKey: Uint8Array): Promise<TokenResponse> {
  return apiRequest<TokenResponse>("/auth/register", {
    method: "POST",
    body: { email, auth_key: bytesToBase64(authKey) },
  });
}

export function login(email: string, authKey: Uint8Array): Promise<TokenResponse> {
  return apiRequest<TokenResponse>("/auth/login", {
    method: "POST",
    body: { email, auth_key: bytesToBase64(authKey) },
  });
}

export function getMe(accessToken: string): Promise<UserResponse> {
  return apiRequest<UserResponse>("/auth/me", { accessToken });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/mobile && bun test src/api/auth.test.ts`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

Tell the user: stage `src/api/client.ts`, `src/api/auth.ts`, `src/api/auth.test.ts`, then commit with a message like:

```
feat: add typed API client for register/login/me
```

Also remind the user (if not already done): create `apps/mobile/.env` with `EXPO_PUBLIC_API_URL` pointing at their running `apps/api` instance, needed before Task 10's screens can be tried against the real backend.

---

## Task 8: Session storage (SecureStore wrapper)

**Files:**
- Create: `apps/mobile/src/context/session.ts`
- Test: `apps/mobile/src/context/session.test.ts`

**Interfaces:**
- Consumes: `bytesToBase64`, `base64ToBytes` from `@/crypto/base64` (Task 3) — `Uint8Array` keys must be encoded to strings for SecureStore, which only stores strings.
- Produces: `saveSession({ vaultKey, authKey, accessToken }): Promise<void>`, `loadSession(): Promise<StoredSession | null>`, `updateAccessToken(accessToken: string): Promise<void>`, `clearSession(): Promise<void>`. Task 9 (`AuthContext.tsx`) imports all four from `@/context/session`.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/context/session.test.ts`:

```ts
import * as SecureStore from "expo-secure-store";
import { saveSession, loadSession, updateAccessToken, clearSession } from "./session";

jest.mock("expo-secure-store");

const mockedStore = new Map<string, string>();

beforeEach(() => {
  mockedStore.clear();
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    mockedStore.set(key, value);
  });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    return mockedStore.get(key) ?? null;
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    mockedStore.delete(key);
  });
});

const VAULT_KEY = new Uint8Array(32).fill(1);
const AUTH_KEY = new Uint8Array(32).fill(2);

test("loadSession returns null when nothing has been saved yet", async () => {
  expect(await loadSession()).toBeNull();
});

test("saveSession then loadSession round-trips vaultKey, authKey, and accessToken", async () => {
  await saveSession({ vaultKey: VAULT_KEY, authKey: AUTH_KEY, accessToken: "token-1" });

  const loaded = await loadSession();

  expect(loaded).not.toBeNull();
  expect(Buffer.from(loaded!.vaultKey).equals(Buffer.from(VAULT_KEY))).toBe(true);
  expect(Buffer.from(loaded!.authKey).equals(Buffer.from(AUTH_KEY))).toBe(true);
  expect(loaded!.accessToken).toBe("token-1");
});

test("saveSession requires biometric authentication on every stored key", async () => {
  await saveSession({ vaultKey: VAULT_KEY, authKey: AUTH_KEY, accessToken: "token-1" });

  const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls;
  expect(calls.length).toBe(3);
  for (const [, , options] of calls) {
    expect(options.requireAuthentication).toBe(true);
  }
});

test("updateAccessToken replaces only the access token, leaving the keys intact", async () => {
  await saveSession({ vaultKey: VAULT_KEY, authKey: AUTH_KEY, accessToken: "old-token" });

  await updateAccessToken("new-token");
  const loaded = await loadSession();

  expect(loaded!.accessToken).toBe("new-token");
  expect(Buffer.from(loaded!.vaultKey).equals(Buffer.from(VAULT_KEY))).toBe(true);
});

test("clearSession removes all three stored values", async () => {
  await saveSession({ vaultKey: VAULT_KEY, authKey: AUTH_KEY, accessToken: "token-1" });

  await clearSession();

  expect(await loadSession()).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/mobile && bun test src/context/session.test.ts`
Expected: FAIL with `Cannot find module './session'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/context/session.ts`:

```ts
import * as SecureStore from "expo-secure-store";
import { bytesToBase64, base64ToBytes } from "@/crypto/base64";

const KEYS = {
  vaultKey: "vault_key",
  authKey: "auth_key",
  accessToken: "access_token",
} as const;

const SECURE_STORE_OPTIONS = { requireAuthentication: true } as const;

export interface StoredSession {
  vaultKey: Uint8Array;
  authKey: Uint8Array;
  accessToken: string;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(KEYS.vaultKey, bytesToBase64(session.vaultKey), SECURE_STORE_OPTIONS);
  await SecureStore.setItemAsync(KEYS.authKey, bytesToBase64(session.authKey), SECURE_STORE_OPTIONS);
  await SecureStore.setItemAsync(KEYS.accessToken, session.accessToken, SECURE_STORE_OPTIONS);
}

export async function loadSession(): Promise<StoredSession | null> {
  const [vaultKeyB64, authKeyB64, accessToken] = await Promise.all([
    SecureStore.getItemAsync(KEYS.vaultKey, SECURE_STORE_OPTIONS),
    SecureStore.getItemAsync(KEYS.authKey, SECURE_STORE_OPTIONS),
    SecureStore.getItemAsync(KEYS.accessToken, SECURE_STORE_OPTIONS),
  ]);

  if (!vaultKeyB64 || !authKeyB64 || !accessToken) {
    return null;
  }

  return {
    vaultKey: base64ToBytes(vaultKeyB64),
    authKey: base64ToBytes(authKeyB64),
    accessToken,
  };
}

export async function updateAccessToken(accessToken: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.accessToken, accessToken, SECURE_STORE_OPTIONS);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.vaultKey, SECURE_STORE_OPTIONS),
    SecureStore.deleteItemAsync(KEYS.authKey, SECURE_STORE_OPTIONS),
    SecureStore.deleteItemAsync(KEYS.accessToken, SECURE_STORE_OPTIONS),
  ]);
}
```

`requireAuthentication: true` is what makes iOS/Android trigger the biometric prompt on every `getItemAsync` call for these keys — the OS enforces the gate, this code just declares the requirement. If TypeScript reports `requireAuthentication` as an unknown option, check the installed `expo-secure-store` version's type definitions (`node_modules/expo-secure-store/build/SecureStore.types.d.ts`) for the current option name — it's been stable for several Expo SDK versions but worth a quick confirmation during self-review given how security-relevant getting this option right is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/mobile && bun test src/context/session.test.ts`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

Tell the user: stage `src/context/session.ts` and `src/context/session.test.ts`, then commit with a message like:

```
feat: add SecureStore session persistence (biometric-gated)
```

---

## Task 9: AuthContext

**Files:**
- Create: `apps/mobile/src/context/AuthContext.tsx`
- Test: `apps/mobile/src/context/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `deriveKeys` (Task 5), `register`, `login`, `getMe`, `ApiError` (Task 7), `saveSession`, `loadSession`, `updateAccessToken`, `clearSession` (Task 8).
- Produces: `<AuthProvider>` and `useAuth()` returning `{ status: "loading" | "locked" | "unlocked", user: {id, email} | null, vaultKey: Uint8Array | null, register(email, password), login(email, password), unlockWithStoredSession(), logout() }`. Task 10's screens and root layout import this as `import { AuthProvider, useAuth } from "@/context/AuthContext"`.

`status` starts `"loading"` (checking for an existing session), becomes `"locked"` if no valid session was loaded (send the user to login/register) or after `logout()`, and becomes `"unlocked"` once `vaultKey` and `user` are both populated. `unlockWithStoredSession()` is what Task 10's biometric gate calls — it reads the SecureStore session (which itself triggers the OS biometric prompt, per Task 8), and if found, uses the stored `authKey` to silently refresh `access_token` via `login()` in the background.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/context/AuthContext.test.tsx`:

```tsx
import { render, screen, waitFor, act } from "@testing-library/react-native";
import { Text } from "react-native";
import { AuthProvider, useAuth } from "./AuthContext";
import * as authApi from "@/api/auth";
import * as session from "./session";

jest.mock("@/api/auth");
jest.mock("./session");
jest.mock("@/crypto/deriveKeys", () => ({
  deriveKeys: jest.fn(() => ({
    vaultKey: new Uint8Array(32).fill(1),
    authKey: new Uint8Array(32).fill(2),
  })),
}));

function Probe() {
  const auth = useAuth();
  return (
    <>
      <Text testID="status">{auth.status}</Text>
      <Text testID="email">{auth.user?.email ?? ""}</Text>
    </>
  );
}

beforeEach(() => {
  jest.resetAllMocks();
});

test("starts in 'locked' status when no stored session exists", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
});

test("register() derives keys, calls the API, saves the session, and reaches 'unlocked'", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));

  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });

  expect(session.saveSession).toHaveBeenCalled();
  expect(screen.getByTestId("status").props.children).toBe("unlocked");
  expect(screen.getByTestId("email").props.children).toBe("test@example.com");
});

test("unlockWithStoredSession() refreshes the access token silently and reaches 'unlocked'", async () => {
  const storedVaultKey = new Uint8Array(32).fill(9);
  const storedAuthKey = new Uint8Array(32).fill(8);
  (session.loadSession as jest.Mock).mockResolvedValue({
    vaultKey: storedVaultKey,
    authKey: storedAuthKey,
    accessToken: "stale-token",
  });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "cached@example.com" });
  (authApi.login as jest.Mock).mockResolvedValue({ access_token: "fresh-token", token_type: "bearer" });
  (session.updateAccessToken as jest.Mock).mockResolvedValue(undefined);

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));
  expect(authApi.login).toHaveBeenCalled();
  expect(session.updateAccessToken).toHaveBeenCalledWith("fresh-token");
});

test("logout() clears the stored session and returns to 'locked'", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);
  (session.clearSession as jest.Mock).mockResolvedValue(undefined);

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));

  await act(async () => {
    await auth!.logout();
  });

  expect(session.clearSession).toHaveBeenCalled();
  expect(screen.getByTestId("status").props.children).toBe("locked");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/mobile && bun test src/context/AuthContext.test.tsx`
Expected: FAIL with `Cannot find module './AuthContext'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/context/AuthContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { deriveKeys } from "@/crypto/deriveKeys";
import { register as apiRegister, login as apiLogin, getMe } from "@/api/auth";
import { saveSession, loadSession, updateAccessToken, clearSession } from "./session";

type Status = "loading" | "locked" | "unlocked";

interface User {
  id: number;
  email: string;
}

interface AuthContextValue {
  status: Status;
  user: User | null;
  vaultKey: Uint8Array | null;
  register: (email: string, masterPassword: string) => Promise<void>;
  login: (email: string, masterPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);

  const unlockWithStoredSession = useCallback(async () => {
    const stored = await loadSession();
    if (!stored) {
      setStatus("locked");
      return;
    }

    setVaultKey(stored.vaultKey);

    try {
      const me = await getMe(stored.accessToken);
      setUser(me);
      setStatus("unlocked");
    } catch {
      // access_token expired or invalid — silently refresh it with the
      // stored auth_key rather than asking for the master password again.
      const fresh = await apiLogin("", stored.authKey as unknown as string); // placeholder, replaced below
    }
  }, []);

  useEffect(() => {
    unlockWithStoredSession();
  }, [unlockWithStoredSession]);

  const register = useCallback(async (email: string, masterPassword: string) => {
    const { vaultKey: newVaultKey, authKey } = deriveKeys(email, masterPassword);
    const { access_token } = await apiRegister(email, authKey);
    await saveSession({ vaultKey: newVaultKey, authKey, accessToken: access_token });
    const me = await getMe(access_token);
    setVaultKey(newVaultKey);
    setUser(me);
    setStatus("unlocked");
  }, []);

  const login = useCallback(async (email: string, masterPassword: string) => {
    const { vaultKey: newVaultKey, authKey } = deriveKeys(email, masterPassword);
    const { access_token } = await apiLogin(email, authKey);
    await saveSession({ vaultKey: newVaultKey, authKey, accessToken: access_token });
    const me = await getMe(access_token);
    setVaultKey(newVaultKey);
    setUser(me);
    setStatus("unlocked");
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
    setVaultKey(null);
    setUser(null);
    setStatus("locked");
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, vaultKey, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
```

The `unlockWithStoredSession` function above has a bug flagged inline (`apiLogin("", stored.authKey as unknown as string)`) — it's deliberately wrong as written, because the correct fix needs one more piece of information this plan hasn't asked the implementer to invent: **the stored session doesn't include the user's email**, and `login()` needs it. Fix this properly, don't just silence the type error:

Modify `apps/mobile/src/context/session.ts` (from Task 8) to also store and return `email` — add `email: "email"` to `KEYS`, accept and store `session.email` in `saveSession`, and include `email` in `loadSession`'s return type and returned object (plain string, no encoding needed, `requireAuthentication: true` same as the others). Then in `AuthContext.tsx`, replace the `unlockWithStoredSession` catch block with:

```ts
    } catch {
      const { access_token } = await apiLogin(stored.email, stored.authKey);
      await updateAccessToken(access_token);
      const me = await getMe(access_token);
      setUser(me);
      setStatus("unlocked");
    }
```

And update `register`/`login` to pass `email` into `saveSession` too: `await saveSession({ vaultKey: newVaultKey, authKey, accessToken: access_token, email });`.

This kind of fix-a-flagged-gap-in-an-earlier-task is unusual for this plan's style (every other task is meant to be followed as exact, complete code) — call this out specifically in your self-review and in the task report, since it means Task 8's `session.test.ts` also needs a small update (add `email` to the `saveSession`/`loadSession` round-trip test) to keep covering the real interface.

- [ ] **Step 4: Update Task 8's session test for the `email` field**

Modify `apps/mobile/src/context/session.test.ts`'s round-trip test to also pass and assert `email`:

```ts
test("saveSession then loadSession round-trips vaultKey, authKey, accessToken, and email", async () => {
  await saveSession({ vaultKey: VAULT_KEY, authKey: AUTH_KEY, accessToken: "token-1", email: "test@example.com" });

  const loaded = await loadSession();

  expect(loaded).not.toBeNull();
  expect(Buffer.from(loaded!.vaultKey).equals(Buffer.from(VAULT_KEY))).toBe(true);
  expect(Buffer.from(loaded!.authKey).equals(Buffer.from(AUTH_KEY))).toBe(true);
  expect(loaded!.accessToken).toBe("token-1");
  expect(loaded!.email).toBe("test@example.com");
});
```

(Replace the old version of this test, don't add a duplicate.)

- [ ] **Step 5: Run all the tests to verify they pass**

Run: `cd apps/mobile && bun test src/context/`
Expected: PASS (session.test.ts: 5 passed, AuthContext.test.tsx: 4 passed)

- [ ] **Step 6: Commit**

Tell the user: stage `src/context/session.ts`, `src/context/session.test.ts`, `src/context/AuthContext.tsx`, `src/context/AuthContext.test.tsx`, then commit with a message like:

```
feat: add AuthContext orchestrating crypto, API, and session persistence
```

---

## Task 10: Auth screens, root layout, and biometric gate

**Files:**
- Create: `apps/mobile/app/(auth)/login.tsx`, `apps/mobile/app/(auth)/register.tsx`, `apps/mobile/app/(app)/_layout.tsx`, `apps/mobile/app/(app)/index.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `AuthProvider`, `useAuth` (Task 9), `Button`, `ThemedText` (Task 4), `colors`, `spacing` (Task 2).
- Produces: the full navigable app — this is the last task in this plan; nothing later in this plan depends on it, but Plan 2's vault screens replace `app/(app)/index.tsx`'s placeholder content.

This is a UI-wiring task, not a new-logic task — no dedicated unit tests for the screens themselves (they're thin compositions of already-tested `Button`/`ThemedText`/`useAuth`), verified instead by the manual walkthrough in Step 4.

- [ ] **Step 1: Login and register screens**

Create `apps/mobile/app/(auth)/login.tsx`:

```tsx
import { useState } from "react";
import { View, TextInput } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.systemBackground,
        justifyContent: "center",
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <ThemedText variant="largeTitle">Unlock your vault</ThemedText>
      <TextInput
        placeholder="Email"
        placeholderTextColor={colors.secondaryLabel}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={{ color: colors.label, borderBottomWidth: 1, borderColor: colors.separator, paddingVertical: spacing.sm }}
      />
      <TextInput
        placeholder="Master password"
        placeholderTextColor={colors.secondaryLabel}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{ color: colors.label, borderBottomWidth: 1, borderColor: colors.separator, paddingVertical: spacing.sm }}
      />
      {error && <ThemedText variant="subhead" style={{ color: "#E5484D" }}>{error}</ThemedText>}
      <Button title="Log in" onPress={handleSubmit} loading={loading} />
      <Link href="/(auth)/register" asChild>
        <ThemedText variant="subhead" style={{ textAlign: "center" }}>
          Need an account? Register
        </ThemedText>
      </Link>
    </View>
  );
}
```

Create `apps/mobile/app/(auth)/register.tsx`:

```tsx
import { useState } from "react";
import { View, TextInput } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function RegisterScreen() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await register(email, password);
    } catch {
      setError("That email is already registered, or something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.systemBackground,
        justifyContent: "center",
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <ThemedText variant="largeTitle">Create your vault</ThemedText>
      <TextInput
        placeholder="Email"
        placeholderTextColor={colors.secondaryLabel}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={{ color: colors.label, borderBottomWidth: 1, borderColor: colors.separator, paddingVertical: spacing.sm }}
      />
      <TextInput
        placeholder="Master password"
        placeholderTextColor={colors.secondaryLabel}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{ color: colors.label, borderBottomWidth: 1, borderColor: colors.separator, paddingVertical: spacing.sm }}
      />
      <ThemedText variant="caption">
        Your master password never leaves this device — losing it means losing access to your vault, with no
        recovery. Choose something you'll remember.
      </ThemedText>
      {error && <ThemedText variant="subhead" style={{ color: "#E5484D" }}>{error}</ThemedText>}
      <Button title="Register" onPress={handleSubmit} loading={loading} />
      <Link href="/(auth)/login" asChild>
        <ThemedText variant="subhead" style={{ textAlign: "center" }}>
          Already have an account? Log in
        </ThemedText>
      </Link>
    </View>
  );
}
```

- [ ] **Step 2: Biometric-gated (app) group**

Create `apps/mobile/app/(app)/_layout.tsx`:

```tsx
import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/theme";

export default function AppLayout() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.systemBackground, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === "locked") {
    return <Redirect href="/(auth)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`status` is read from `AuthContext`, which already runs `unlockWithStoredSession()` on mount (Task 9) — that's where the actual `requireAuthentication: true` SecureStore read happens, which is what triggers the OS's Face ID/fingerprint prompt. This layout only reacts to the resulting status; it doesn't call any biometric API directly.

Create `apps/mobile/app/(app)/index.tsx` (placeholder — Plan 2 replaces this with the real vault list):

```tsx
import { View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function VaultPlaceholder() {
  const { user, logout } = useAuth();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.systemBackground,
        justifyContent: "center",
        alignItems: "center",
        gap: spacing.md,
        padding: spacing.lg,
      }}
    >
      <ThemedText variant="title">You're in, {user?.email}.</ThemedText>
      <ThemedText variant="subhead">Vault entries are Plan 2 — this screen is a placeholder.</ThemedText>
      <Button title="Log out" variant="secondary" onPress={logout} />
    </View>
  );
}
```

- [ ] **Step 3: Wire the root layout**

Modify `apps/mobile/app/_layout.tsx` (replacing Task 1's placeholder version):

```tsx
import "react-native-get-random-values";
import "../global.css";

import { Stack } from "expo-router";
import { AuthProvider } from "@/context/AuthContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </AuthProvider>
  );
}
```

The `react-native-get-random-values` import stays first, unchanged from Task 1 — that requirement doesn't go away just because the file grew.

- [ ] **Step 4: Manual verification**

This task has no automated tests of its own (see the note above the task). Verify manually:

1. Confirm `apps/mobile/.env` has `EXPO_PUBLIC_API_URL` set (Task 7's reminder) and `apps/api`'s dev server is running and reachable at that address from your device/simulator.
2. Run: `cd apps/mobile && bun start`, open the app.
3. Register a new account (a fresh email) — expect to land on the placeholder "You're in" screen.
4. Force-close and reopen the app — expect a biometric prompt (or the OS's configured fallback), then landing back on the same screen without re-entering the master password.
5. Tap "Log out" — expect to land back on the login screen.
6. Log in again with the same email/master password — expect to reach the placeholder screen again.

Report the outcome of this walkthrough in the task report, including any step that didn't behave as described.

- [ ] **Step 5: Run the full test suite one more time**

Run: `cd apps/mobile && bun test`
Expected: all tests across every task in this plan PASS.

- [ ] **Step 6: Commit**

Tell the user: stage `app/(auth)/`, `app/(app)/`, `app/_layout.tsx`, then commit with a message like:

```
feat: add login/register screens, biometric-gated app shell, and root layout wiring
```

---

## Self-Review Notes

**Spec coverage:** every section of `docs/superpowers/specs/2026-09-11-mobile-app-design.md` that's in this plan's scope maps to a task — key derivation (Task 5), crypto library choice and RNG polyfill (Tasks 1, 5, 6), auth/unlock flow including the `auth_key`-persistence tradeoff (Tasks 8, 9), design system (Tasks 2, 4), project structure (all tasks collectively). Vault CRUD, local SQLite cache, and offline sync are explicitly Plan 2's scope, not gaps in this plan.

**Placeholder scan:** one intentional exception is documented and handled, not left as a gap: Task 9's first-draft `unlockWithStoredSession` deliberately contains a flagged, broken line, which the same task then walks through fixing correctly (including the necessary `email`-field addition back in Task 8's `session.ts`) — this is presented as a real, worked example of catching and fixing a design gap mid-implementation, not a "TBD" left for the implementer to invent. No other placeholders found.

**Type consistency:** `DerivedKeys { vaultKey, authKey }` (Task 5) flows unchanged into `StoredSession` (Task 8, plus `accessToken` and — after Task 9's fix — `email`) and into `AuthContextValue.vaultKey` (Task 9). `TokenResponse { access_token, token_type }` (Task 7) matches the field names actually returned by `apps/api`'s `TokenResponse` Pydantic schema (snake_case, matching the API, not camelCase). `Button`'s `variant`/`size`/`loading`/`disabled`/`style` props (Task 4) are used consistently by both auth screens (Task 10).
