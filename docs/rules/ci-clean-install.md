# AR005 — ci-clean-install

**Default severity:** warn

**Attack references:** ci-lockfile-bypass

CI installs with npm ci / pnpm install --frozen-lockfile.

A lockfile only protects you if CI actually honors it. `npm install`
in CI may re-resolve ranges and silently rewrite the lockfile,
installing versions nobody reviewed — exactly the window a freshly
poisoned release needs. `npm ci` and `pnpm install --frozen-lockfile`
fail instead of deviating from the committed lockfile.

This rule scans .github/workflows/*.yml run commands. pnpm does
default to a frozen lockfile when CI=true, but the explicit flag also
protects runs outside classic CI environments and makes the intent
reviewable — the rule asks for it explicitly.

No auto-fix (editing CI workflows is out of scope): replace
`npm install` with `npm ci`, add `--frozen-lockfile` to pnpm installs,
and consider `--ignore-scripts` as well (AR006, M2).
