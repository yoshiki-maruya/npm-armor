# AR003 — git-deps-restricted

**Default severity:** error

**Attack references:** git-deps-npmrc-reactivation

No git dependencies; npm additionally pins allow-git=none.

Git dependencies bypass every registry-side protection: no cooldown, no
provenance, no immutable versions — the ref can be force-pushed after
review. Worse, an installed git dependency brings its own repository
content, including a possible .npmrc that re-enables lifecycle scripts
for its own install tree.

npm >= 11.10 can refuse them wholesale with allow-git=none in .npmrc;
`armor fix` adds it when the lockfile shows no git dependencies. pnpm
has no equivalent setting, so for pnpm this rule only verifies that the
lockfile contains no git-sourced packages.

If a git dependency is genuinely required, vendor the code or publish
it to a registry you control instead.
