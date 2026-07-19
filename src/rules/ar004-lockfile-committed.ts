import type { Finding, Rule, RuleContext } from "../model.js";
import { isIoError } from "../io/index.js";
import { isRootFileIgnored } from "../engine/gitignore.js";
import { finding } from "./util.js";
import { NPM_LOCKFILES, PNPM_LOCKFILES } from "../detect/project.js";

export const ar004: Rule = {
  id: "AR004",
  meta: {
    name: "lockfile-committed",
    defaultSeverity: "error",
    docsSlug: "lockfile-committed",
    attackRefs: ["nondeterministic-resolution"],
    summary: "A lockfile exists, is under git control and is not gitignored",
    explain: [
      "Without a committed lockfile every install re-resolves version ranges,",
      "so the code that runs on your machines is whatever the registry serves",
      "at that moment — including a version poisoned five minutes ago. A",
      "committed lockfile plus clean installs (see AR005) makes dependency",
      "resolution deterministic and reviewable in pull requests.",
      "",
      "This rule fails when no lockfile exists or when the lockfile is listed",
      "in .gitignore. It cannot be auto-fixed: run your package manager's",
      "install to generate the lockfile, remove it from .gitignore, and commit",
      "it. Git state is judged from the presence of a .git directory and",
      ".gitignore patterns (this tool never executes git).",
    ].join("\n"),
  },

  check(ctx: RuleContext): Finding[] {
    const { io, project } = ctx;
    const managedLockfiles = project.lockfiles.filter((f) =>
      (NPM_LOCKFILES as readonly string[]).includes(f) || (PNPM_LOCKFILES as readonly string[]).includes(f),
    );

    if (managedLockfiles.length === 0) {
      const hint = project.pm === "pnpm" ? "pnpm install" : "npm install";
      return [
        finding(this, "error", `no lockfile found — run \`${hint}\` and commit the generated lockfile`),
      ];
    }

    let gitKind;
    try {
      gitKind = io.lstat(".git")?.kind;
    } catch {
      gitKind = undefined;
    }
    // A .git *file* (worktree/submodule pointer) also means git-managed.
    if (gitKind !== "dir" && gitKind !== "file") {
      return [
        finding(this, "warn", "no .git directory found; cannot determine whether the lockfile is committed"),
      ];
    }

    let gitignoreText: string;
    try {
      gitignoreText = io.readTextFile(".gitignore");
    } catch (e) {
      if (isIoError(e) && e.kind === "not-found") return []; // nothing ignored
      return [
        finding(this, "warn", ".gitignore cannot be read; cannot determine whether the lockfile is ignored", { file: ".gitignore" }),
      ];
    }

    const findings: Finding[] = [];
    for (const lf of managedLockfiles) {
      if (isRootFileIgnored(gitignoreText, lf)) {
        findings.push(
          finding(this, "error", `${lf} is listed in .gitignore — remove that entry and commit the lockfile`, { file: lf }),
        );
      }
    }
    return findings;
  },
};
