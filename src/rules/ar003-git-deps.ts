import type { Finding, Rule, RuleContext } from "../model.js";
import { exampleList, finding } from "./util.js";

export const ar003: Rule = {
  id: "AR003",
  meta: {
    name: "git-deps-restricted",
    defaultSeverity: "error",
    docsSlug: "git-deps-restricted",
    attackRefs: ["git-deps-npmrc-reactivation"],
    summary: "No git dependencies; npm additionally pins allow-git=none",
    explain: [
      "Git dependencies bypass every registry-side protection: no cooldown, no",
      "provenance, no immutable versions — the ref can be force-pushed after",
      "review. Worse, an installed git dependency brings its own repository",
      "content, including a possible .npmrc that re-enables lifecycle scripts",
      "for its own install tree.",
      "",
      "npm >= 11.10 can refuse them wholesale with allow-git=none in .npmrc;",
      "`armor fix` adds it when the lockfile shows no git dependencies. pnpm",
      "has no equivalent setting, so for pnpm this rule only verifies that the",
      "lockfile contains no git-sourced packages.",
      "",
      "If a git dependency is genuinely required, vendor the code or publish",
      "it to a registry you control instead.",
    ].join("\n"),
  },

  check(ctx: RuleContext): Finding[] {
    const { config, lockfile, project } = ctx;

    const gitDeps = lockfile.sources.filter((s) => s.kind === "git");
    if (gitDeps.length > 0) {
      const names = gitDeps.map((s) => s.name ?? s.url);
      return [
        finding(this, "error", `git dependencies present in the lockfile: ${exampleList(names)} — they bypass registry protections (cooldown, provenance, immutability)`, {
          ...(lockfile.file !== undefined ? { file: lockfile.file } : {}),
          detail: { count: gitDeps.length },
        }),
      ];
    }

    if (lockfile.status === "unparseable") {
      return [
        finding(this, "warn", `lockfile cannot be fully interpreted (${lockfile.reason ?? "unknown reason"}); git-dependency state is undeterminable`),
      ];
    }
    if (lockfile.status === "missing") {
      return []; // AR004 reports the missing lockfile; nothing to judge here
    }

    if (project.pm === "npm") {
      if (config.gitDepsPolicy === "none-allowed") return [];
      if (config.gitDepsPolicy === "unknown") {
        return [
          finding(this, "warn", `.npmrc cannot be read (${config.npmrcIssue ?? "unknown reason"}); allow-git policy is undeterminable`, { file: ".npmrc" }),
        ];
      }
      return [
        finding(this, "warn", "no git dependencies today, but nothing prevents one being added — set allow-git=none in .npmrc (npm >= 11.10)", {
          file: ".npmrc",
          fixable: config.npmrcStatus === "ok" || config.npmrcStatus === "missing",
        }),
      ];
    }
    return []; // pnpm: no allow-git equivalent; a clean lockfile is the pass condition
  },
};
