# Project Instructions for Claude Code

## Project
Password manager monorepo. Apps: FastAPI backend, Typer CLI client, browser extension
(Chrome + Zen), and a future Expo mobile app. Deployed on AWS, infrastructure managed
via Terraform (see restriction below — I write all Terraform myself).

## Monorepo structure

```
apps/
  api/         # FastAPI backend — source of truth, all vault CRUD + auth
  cli/         # Typer CLI client, talks to api/
  extension/   # Chrome + Zen browser extension, talks to api/
  mobile/      # future Expo app, talks to api/
infra/terraform/   # off-limits unless explicitly requested — see below
```

Each `apps/*` folder is independent — a change in one should never require touching
another unless explicitly working on a cross-cutting feature (e.g. an API contract
change that all clients depend on). Keep this boundary strict.

## Browser extension — phased scope, don't build ahead of the current phase

**Phase 1 (current):** the extension does NOT replace Chrome's/Zen's own password
manager. It detects when the browser saves/autofills a credential and mirrors it into
my vault via the API. Do not build autofill, save-prompt UI, or anything that competes
with the browser's native password manager unless I explicitly say we're starting
Phase 2. If a task seems to call for Phase 2 behavior, stop and ask me first.

**Phase 2 (future, not yet):** full replacement — the extension takes over saving and
autofilling itself. Do not scaffold this early "for convenience."

## Architecture rules — non-negotiable

1. **Strict modularity.** Every feature (auth, vault CRUD, encryption, browser import, etc.)
   must live in its own clearly bounded module/folder with a single responsibility.
   No feature's logic should leak into another's files. If Feature A breaks, it must be
   immediately obvious it's Feature A — not a guessing game across shared files.

2. **Zero-knowledge architecture.** Encryption/decryption of vault data happens
   client-side wherever possible. The backend should never receive or store plaintext
   passwords, only ciphertext. Flag clearly in your explanation any place this principle
   is at risk of being violated.

3. **Security-critical code gets extra explanation.** Anything touching hashing, key
   derivation, encryption, or auth must be explained in more depth than routine CRUD code.

## Explanation requirements — every single time you write or change code

After any code change, you MUST explain, in plain language:
- **What** you built or changed
- **How** it works (the approach/mechanism)
- **Why** you chose this approach over alternatives (especially for security-relevant code)
- **Where** the boundaries of this change are — what it touches, what it doesn't

Do not skip this even for small changes. I am learning backend/cloud engineering
deliberately and slowly — treat every response as a teaching moment, not just a
deliverable. Do not assume prior familiarity with a concept; briefly define new terms
the first time they appear.

Give this explanation in your chat response, not only as code comments — I read the
explanation before I read the code. Code comments are welcome in addition, not instead.

## Git — hard rule

**Never run `git commit`, `git push`, or `git add` on my behalf, under any
circumstance, even if it seems convenient or I seem to imply it.** I review and
commit everything myself. You may suggest a commit message, but never execute it.

## AWS / infrastructure — hard rule

**Never run AWS CLI commands, Terraform commands (init/plan/apply/destroy), or any
command that creates, modifies, or deletes real cloud resources or spends money.**

**Never write, edit, or create any file inside `infra/terraform/` unless I explicitly
ask you to in that specific message.** I am writing all Terraform myself as part of
learning it. Do not "help" by drafting `.tf` files proactively, even if it would be
faster or seem obviously correct. This applies even if a task seems to require new
infrastructure — see the workflow below instead.

When we reach a point where AWS infrastructure is needed:
1. Stop and explain exactly what resource(s) we need and why, in plain language
   (e.g. "this feature needs an S3 bucket for encrypted vault backups, because...")
2. Describe conceptually what the Terraform configuration should contain — the
   resource types, key settings, how they relate — WITHOUT writing the actual `.tf`
   code, unless I explicitly ask you to write it
3. Tell me what to go write myself, and wait for me to confirm it's done
4. If I explicitly ask you to write or review specific Terraform code, you may do so
   only for that request — this does not carry over to future infrastructure needs

Application code (Python, FastAPI, CLI, mobile) is not covered by this restriction —
write and edit that freely as normal.

## Working style

- Prefer small, incremental changes I can follow, over large multi-file generations
  I can't track.
- If a decision has real tradeoffs (e.g. library choice, architecture pattern),
  briefly present the alternatives and why you picked this one, rather than
  silently picking one.
- If you're about to implement something insecurely as a shortcut, say so explicitly
  rather than silently doing it.
