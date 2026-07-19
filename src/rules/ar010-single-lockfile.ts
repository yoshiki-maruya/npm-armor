import type { Finding, Rule, RuleContext } from "../model.js";
import { finding } from "./util.js";

const FAMILIES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["npm", ["package-lock.json", "npm-shrinkwrap.json"]],
  ["pnpm", ["pnpm-lock.yaml"]],
  ["yarn", ["yarn.lock"]],
  ["bun", ["bun.lock", "bun.lockb"]],
];

export const ar010: Rule = {
  id: "AR010",
  meta: {
    name: "single-lockfile",
    defaultSeverity: "warn",
    docsSlug: "single-lockfile",
    attackRefs: ["effective-pm-ambiguity"],
    summary: "Only one package manager's lockfile exists",
    explain: [
      "When lockfiles of multiple package managers coexist, which one is",
      "actually honored depends on who runs what — and every defense this",
      "tool checks (cooldown, script blocking, trusted sources) is configured",
      "per package manager. An attacker can aim at the unconfigured one, or",
      "poison the lockfile nobody looks at because \"we use the other PM\".",
      "",
      "This rule warns when lockfiles from more than one package-manager",
      "family are present. Keep the one your project actually uses, delete",
      "the others, and pin the intended manager with the packageManager field",
      "so mixed usage fails fast (no auto-fix: deleting files is a human",
      "decision).",
    ].join("\n"),
  },

  check(ctx: RuleContext): Finding[] {
    const present = FAMILIES.map(([family, files]) => ({
      family,
      files: files.filter((f) => ctx.project.lockfiles.includes(f)),
    })).filter((f) => f.files.length > 0);

    if (present.length <= 1) return [];
    const listing = present.map((p) => `${p.family}: ${p.files.join(", ")}`).join("; ");
    return [
      finding(this, "warn", `lockfiles from ${present.length} package managers coexist (${listing}) — the effective package manager is ambiguous`, {
        detail: { families: present.map((p) => p.family).join(",") },
      }),
    ];
  },
};
