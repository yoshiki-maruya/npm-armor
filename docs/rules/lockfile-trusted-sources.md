# AR007 — lockfile-trusted-sources

**Default severity:** error

**Attack references:** lockfile-poisoning

Every lockfile source URL is https and from an allowed registry.

Lockfiles are reviewed as opaque blobs, which makes them a perfect
hiding place: one edited `resolved` URL redirects a single package to
an attacker-controlled server while everything else keeps installing
normally (lockfile poisoning). Http URLs additionally allow on-path
tampering at install time.

This rule verifies every source URL in package-lock.json /
pnpm-lock.yaml: https only, host within the allowlist (default:
registry.npmjs.org — extend with the allowedHosts option for private
mirrors), no embedded credentials, and integrity hashes present.
Git-sourced packages are judged by AR003, not here.

No auto-fix on purpose: a poisoned lockfile means the dependency tree
itself is suspect. Delete the lockfile and regenerate it from a
trusted registry, then diff the result.
