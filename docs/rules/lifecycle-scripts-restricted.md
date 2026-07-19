# AR002 — lifecycle-scripts-restricted

**Default severity:** error

**Attack references:** axios-2026-03, shai-hulud-2025

Dependency lifecycle scripts (postinstall etc.) are blocked or allowlisted.

npm lifecycle scripts (preinstall/install/postinstall) hand every
dependency — and every transitive dependency — arbitrary code execution
on your machine at install time. They are how the Axios 2026-03
compromise dropped its RAT and how the Shai-Hulud worm replicated
itself through maintainer machines.

npm: set ignore-scripts=true in .npmrc. pnpm >= 10 blocks dependency
build scripts by default; keep it that way and declare the few packages
that genuinely need builds in onlyBuiltDependencies
(pnpm-workspace.yaml). Never set dangerouslyAllowAllBuilds: true.

This rule fails when scripts run unrestricted, and reports
undeterminable when the configuration cannot be read or the pnpm
version (packageManager field) is unknown. Packages that need native
builds still work: run their builds explicitly, or allowlist them
(pnpm) / use a dedicated postinstall step you control (npm).
