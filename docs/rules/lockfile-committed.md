# AR004 — lockfile-committed

**Default severity:** error

**Attack references:** nondeterministic-resolution

A lockfile exists, is under git control and is not gitignored.

Without a committed lockfile every install re-resolves version ranges,
so the code that runs on your machines is whatever the registry serves
at that moment — including a version poisoned five minutes ago. A
committed lockfile plus clean installs (see AR005) makes dependency
resolution deterministic and reviewable in pull requests.

This rule fails when no lockfile exists or when the lockfile is listed
in .gitignore. It cannot be auto-fixed: run your package manager's
install to generate the lockfile, remove it from .gitignore, and commit
it. Git state is judged from the presence of a .git directory and
.gitignore patterns (this tool never executes git).
