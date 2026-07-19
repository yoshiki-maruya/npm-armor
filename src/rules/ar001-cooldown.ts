import type { Finding, Rule, RuleContext } from "../model.js";
import { formatMinutes } from "../engine/duration.js";
import { durationOption, finding } from "./util.js";

const DEFAULT_MIN_MINUTES = 1440; // 24h (work order §0); --preset strict raises to 7d

export const ar001: Rule = {
  id: "AR001",
  meta: {
    name: "cooldown-enabled",
    defaultSeverity: "error",
    docsSlug: "cooldown-enabled",
    attackRefs: ["axios-2026-03", "shai-hulud-2025"],
    summary: "A release cooldown (minimum release age) is configured and meets the threshold",
    explain: [
      "Freshly published package versions are the primary delivery vehicle for",
      "supply-chain attacks: a hijacked maintainer account publishes a poisoned",
      "version and every project that installs before the community reacts is",
      "compromised. The March 2026 Axios incident delivered a RAT this way",
      "within hours of publication.",
      "",
      "A release cooldown makes your installs wait until a version has been",
      "public for a minimum time, giving registries and researchers time to",
      "yank malicious releases. npm calls this min-release-age (.npmrc, in",
      "days, npm >= 11.10); pnpm calls it minimumReleaseAge",
      "(pnpm-workspace.yaml, in minutes, pnpm >= 10.16).",
      "",
      "This rule fails when no cooldown is configured or when it is below the",
      "threshold (default 24h; option `min` accepts \"1440\", \"24h\", \"7d\").",
      "`armor fix` can add or raise the setting; it never lowers an existing,",
      "stricter value. Note: npm has no exclude-list equivalent of pnpm's",
      "minimumReleaseAgeExclude — urgent security patches must be installed",
      "with an explicit temporary override instead.",
    ].join("\n"),
  },

  check(ctx: RuleContext): Finding[] {
    const min = durationOption(ctx.options, "min", DEFAULT_MIN_MINUTES);
    const { config, project } = ctx;

    if (project.pm === "unknown") {
      return [
        finding(this, "warn", "cannot determine the package manager, so the cooldown state is undeterminable"),
      ];
    }

    const file = project.pm === "npm" ? ".npmrc" : "pnpm-workspace.yaml";
    const canPatch =
      project.pm === "npm"
        ? config.npmrcStatus === "ok" || config.npmrcStatus === "missing"
        : config.workspaceYamlStatus === "ok" || config.workspaceYamlStatus === "missing";

    if (project.pm === "npm" && config.npmrcStatus === "unreadable") {
      return [
        finding(this, "warn", `.npmrc cannot be read (${config.npmrcIssue ?? "unknown reason"}); cooldown state is undeterminable`, { file }),
      ];
    }
    if (
      project.pm === "pnpm" &&
      (config.workspaceYamlStatus === "unreadable" || config.workspaceYamlStatus === "unparseable")
    ) {
      return [
        finding(this, "warn", `pnpm-workspace.yaml cannot be interpreted (${config.workspaceYamlIssue ?? "unknown reason"}); cooldown state is undeterminable`, { file }),
      ];
    }

    if (config.cooldownUnparseable === true) {
      return [
        finding(this, "warn", "the configured cooldown value cannot be interpreted; treat as unprotected", {
          file,
          fixable: canPatch,
        }),
      ];
    }
    if (config.cooldownMinutes === undefined) {
      return [
        finding(this, "error", `no release cooldown is configured (recommended: at least ${formatMinutes(min)})`, {
          file,
          fixable: canPatch,
          detail: { requiredMinutes: min },
        }),
      ];
    }
    if (config.cooldownMinutes < min) {
      return [
        finding(
          this,
          "error",
          `release cooldown is ${formatMinutes(config.cooldownMinutes)}, below the recommended minimum ${formatMinutes(min)}`,
          {
            file,
            fixable: canPatch,
            detail: { currentMinutes: config.cooldownMinutes, requiredMinutes: min },
          },
        ),
      ];
    }
    return [];
  },
};
