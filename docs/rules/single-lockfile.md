# AR010 — single-lockfile

**Default severity:** warn

**Attack references:** effective-pm-ambiguity

Only one package manager's lockfile exists.

When lockfiles of multiple package managers coexist, which one is
actually honored depends on who runs what — and every defense this
tool checks (cooldown, script blocking, trusted sources) is configured
per package manager. An attacker can aim at the unconfigured one, or
poison the lockfile nobody looks at because "we use the other PM".

This rule warns when lockfiles from more than one package-manager
family are present. Keep the one your project actually uses, delete
the others, and pin the intended manager with the packageManager field
so mixed usage fails fast (no auto-fix: deleting files is a human
decision).
