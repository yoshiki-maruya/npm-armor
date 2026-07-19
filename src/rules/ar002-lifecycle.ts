import type { Finding, Rule, RuleContext } from "../model.js";
import { exampleList, finding } from "./util.js";

export const ar002: Rule = {
  id: "AR002",
  meta: {
    name: "lifecycle-scripts-restricted",
    defaultSeverity: "error",
    docsSlug: "lifecycle-scripts-restricted",
    attackRefs: ["axios-2026-03", "shai-hulud-2025"],
    summary: "Dependency lifecycle scripts (postinstall etc.) are blocked or allowlisted",
    explain: [
      "npm lifecycle scripts (preinstall/install/postinstall) hand every",
      "dependency — and every transitive dependency — arbitrary code execution",
      "on your machine at install time. They are how the Axios 2026-03",
      "compromise dropped its RAT and how the Shai-Hulud worm replicated",
      "itself through maintainer machines.",
      "",
      "npm: set ignore-scripts=true in .npmrc. pnpm >= 10 blocks dependency",
      "build scripts by default; keep it that way and declare the few packages",
      "that genuinely need builds in onlyBuiltDependencies",
      "(pnpm-workspace.yaml). Never set dangerouslyAllowAllBuilds: true.",
      "",
      "This rule fails when scripts run unrestricted, and reports",
      "undeterminable when the configuration cannot be read or the pnpm",
      "version (packageManager field) is unknown. Packages that need native",
      "builds still work: run their builds explicitly, or allowlist them",
      "(pnpm) / use a dedicated postinstall step you control (npm).",
    ].join("\n"),
  },

  check(ctx: RuleContext): Finding[] {
    const { config, project } = ctx;
    const file = project.pm === "pnpm" ? "pnpm-workspace.yaml" : ".npmrc";

    switch (config.lifecycleScripts) {
      case "blocked":
        return [];
      case "allowlisted":
        return [
          finding(
            this,
            "info",
            `lifecycle scripts are limited to an explicit allowlist: ${exampleList(config.scriptAllowlist ?? [])}`,
            { file },
          ),
        ];
      case "allowed":
        return [
          finding(this, "error", buildAllowedMessage(ctx), { file }),
        ];
      case "unknown":
        return [
          finding(this, "warn", buildUnknownMessage(ctx), { file }),
        ];
    }
  },
};

function buildAllowedMessage(ctx: RuleContext): string {
  if (ctx.project.pm === "pnpm") {
    return "dependency build scripts are fully enabled (dangerouslyAllowAllBuilds) — any dependency can execute code at install time";
  }
  return "dependency lifecycle scripts run unrestricted — add ignore-scripts=true to .npmrc so no dependency executes code at install time";
}

function buildUnknownMessage(ctx: RuleContext): string {
  const { config, project } = ctx;
  const issue = config.npmrcIssue ?? config.workspaceYamlIssue;
  if (issue !== undefined) {
    return `lifecycle-script policy is undeterminable (${issue})`;
  }
  if (project.pm === "pnpm" && project.pmVersion === undefined) {
    return "lifecycle-script policy is undeterminable: pnpm version unknown — pin it with the packageManager field (pnpm >= 10 blocks dependency scripts by default)";
  }
  return "lifecycle-script policy is undeterminable";
}
