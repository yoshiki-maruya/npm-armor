# AR001 — cooldown-enabled

**Default severity:** error

**Attack references:** axios-2026-03, shai-hulud-2025

A release cooldown (minimum release age) is configured and meets the threshold.

Freshly published package versions are the primary delivery vehicle for
supply-chain attacks: a hijacked maintainer account publishes a poisoned
version and every project that installs before the community reacts is
compromised. The March 2026 Axios incident delivered a RAT this way
within hours of publication.

A release cooldown makes your installs wait until a version has been
public for a minimum time, giving registries and researchers time to
yank malicious releases. npm calls this min-release-age (.npmrc, in
days, npm >= 11.10); pnpm calls it minimumReleaseAge
(pnpm-workspace.yaml, in minutes, pnpm >= 10.16).

This rule fails when no cooldown is configured or when it is below the
threshold (default 24h; option `min` accepts "1440", "24h", "7d").
`armor fix` can add or raise the setting; it never lowers an existing,
stricter value. Note: npm has no exclude-list equivalent of pnpm's
minimumReleaseAgeExclude — urgent security patches must be installed
with an explicit temporary override instead.
