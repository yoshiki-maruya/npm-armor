# Security Policy

npm-armor is a security tool that runs on potentially compromised
repositories; we treat every vulnerability report seriously.

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub Security Advisories
("Report a vulnerability" on the repository's Security tab). Do not open a
public issue for anything that could be exploitable.

- **Initial response target: 48 hours.**
- Please include reproduction steps and, if possible, a hostile fixture
  demonstrating the issue (see `test/fixtures/hostile/` for the format).

## Scope

In scope: everything that violates the guarantees the README states — code
execution triggered by checked repositories, network access of any kind,
symlink/path escapes out of the project root, prototype pollution through
parsed inputs, terminal-escape injection through reports, fixes that weaken
configuration, and denial of service through crafted inputs (beyond the
documented 64MB file cap).

Out of scope: vulnerabilities in the package managers themselves, and
malicious packages that npm-armor is not designed to detect (it checks
defense *configuration*, not package contents).

## Supported versions

Only the latest published minor release receives security fixes.

## Design references

The threat model (T1–T12) and the self-supply-chain rules this project
follows are documented in `docs/npm-armor-design-v0.1.md` (§5.1–§5.3).
