# Contributing

Thanks for considering it — this started as a solo learning project (backend, mobile,
and browser-extension engineering, built deliberately from scratch rather than off a
template), so contributions are welcome but the bar for security-sensitive code is high.

## Ground rules

- **Zero-knowledge is non-negotiable.** The server must never receive or store plaintext
  passwords, a master password, or unencrypted vault data — only ciphertext and a key
  derived from the master password that can't be reversed into it. Any change that risks
  this (even indirectly, e.g. logging a request body that might contain one) will be
  rejected. See `README.md`'s "The crypto scheme" section before touching auth or crypto
  code.
- **Every client implements the same key-derivation scheme.** If you change it in one
  app (`apps/mobile`, `apps/extension`, the future `apps/cli`), you must change it
  identically in the others, or accounts stop working across clients. The mobile app's
  `src/crypto/deriveKeys.ts` is the reference implementation.
- **Each `apps/*` directory stays independent.** Don't add imports between them. Shared
  logic (like the crypto scheme) is currently duplicated on purpose, not abstracted into
  a shared package — see `apps/*/CLAUDE.md`/`AGENTS.md` for the reasoning if you want to
  revisit that.

## Before you open a PR

1. **Security-sensitive changes** (auth, key derivation, encryption, anything touching
   the database or an API boundary) — explain your reasoning in the PR description, not
   just the diff. Reviewers need to understand *why* an approach is safe, not just read it.
2. **Tests.** Each app has its own suite:
   - `apps/api`: `uv run pytest`
   - `apps/mobile`: `bun x jest`
   - `apps/extension`: `bun test`
   Add tests for new behavior; don't rely on manual verification alone.
3. **Follow the existing patterns.** Read a neighboring file in the same directory before
   writing a new one — naming, error handling, and module boundaries are meant to be
   consistent within each app.

## Found a security issue?

Please don't open a public issue — see `SECURITY.md` for how to report it privately.

## Design history

Every feature in this repo was designed before it was built. If you're proposing a
non-trivial change, skim `docs/superpowers/specs/` and `docs/superpowers/plans/` first —
there's a good chance the tradeoff you're about to raise was already considered, and the
reasoning is written down.
