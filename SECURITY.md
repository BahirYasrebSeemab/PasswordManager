# Security Policy

This is a password manager — security issues here are taken seriously, even though it's
a solo/hobby project rather than a company with a formal bug-bounty program.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.** Instead, email
**bahiryasreb@gmail.com** directly with:

- A description of the issue and its potential impact.
- Steps to reproduce it (a minimal example, if possible).
- Which app(s) it affects (`apps/api`, `apps/mobile`, `apps/extension`).

I'll acknowledge your report as soon as I can, and let you know once a fix is out so you
can decide when to disclose publicly. There's no bounty on offer — this is unpaid
personal work — but credit is always given.

## Scope

Particularly interested in reports about:

- Any path by which plaintext vault data, the master password, or the derived
  `vault_key` could reach the server or leave the device.
- Authentication/authorization bypasses (`apps/api/app/auth/`).
- Cryptographic weaknesses in the key-derivation or encryption scheme (see the README's
  "The crypto scheme" section for the exact algorithm — a deviation from that spec in the
  actual code is itself a bug worth reporting).
- Cross-client inconsistencies that would let one client silently produce vault data
  another client can't safely decrypt.

## Out of scope

- Issues that require physical access to an already-unlocked, unattended device.
- Denial-of-service reports against the author's personal hosted instance — the backend
  runs on a free tier with no uptime guarantee; that's an infrastructure limitation, not a
  vulnerability. (Self-hosting your own instance is unaffected either way.)
