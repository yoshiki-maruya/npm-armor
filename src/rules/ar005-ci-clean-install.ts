import type { Finding, Rule, RuleContext } from "../model.js";
import { isIoError } from "../io/index.js";
import { extractRunCommands } from "../adapters/workflows.js";
import { finding } from "./util.js";

type InstallClass = "clean" | "unclean";

/** Token-based classification (word-boundary regexes misfire on things like install-ci-test). */
export function classifyInstallCommand(command: string): InstallClass | undefined {
  const tokens = command.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const tool = tokens[i];
    const sub = tokens[i + 1];
    if (tool === "npm") {
      if (sub === "ci" || sub === "install-ci-test" || sub === "cit") return "clean";
      if (sub === "install" || sub === "i" || sub === "isntall" || sub === "add") return "unclean";
    }
    if (tool === "pnpm" && (sub === "install" || sub === "i")) {
      const frozen = tokens.includes("--frozen-lockfile");
      const unfrozen = tokens.includes("--no-frozen-lockfile");
      return frozen && !unfrozen ? "clean" : "unclean";
    }
  }
  return undefined;
}

export const ar005: Rule = {
  id: "AR005",
  meta: {
    name: "ci-clean-install",
    defaultSeverity: "warn",
    docsSlug: "ci-clean-install",
    attackRefs: ["ci-lockfile-bypass"],
    summary: "CI installs with npm ci / pnpm install --frozen-lockfile",
    explain: [
      "A lockfile only protects you if CI actually honors it. `npm install`",
      "in CI may re-resolve ranges and silently rewrite the lockfile,",
      "installing versions nobody reviewed — exactly the window a freshly",
      "poisoned release needs. `npm ci` and `pnpm install --frozen-lockfile`",
      "fail instead of deviating from the committed lockfile.",
      "",
      "This rule scans .github/workflows/*.yml run commands. pnpm does",
      "default to a frozen lockfile when CI=true, but the explicit flag also",
      "protects runs outside classic CI environments and makes the intent",
      "reviewable — the rule asks for it explicitly.",
      "",
      "No auto-fix (editing CI workflows is out of scope): replace",
      "`npm install` with `npm ci`, add `--frozen-lockfile` to pnpm installs,",
      "and consider `--ignore-scripts` as well (AR006, M2).",
    ].join("\n"),
  },

  check(ctx: RuleContext): Finding[] {
    const { io } = ctx;
    const dir = ".github/workflows";
    let entries;
    try {
      entries = io.listDir(dir);
    } catch {
      return [finding(this, "warn", `${dir} cannot be listed; CI install method is undeterminable`)];
    }
    const workflowFiles = entries
      .filter((e) => e.kind === "file" && (e.name.endsWith(".yml") || e.name.endsWith(".yaml")))
      .map((e) => `${dir}/${e.name}`);

    if (workflowFiles.length === 0) {
      return [
        finding(this, "info", "no GitHub Actions workflows found — when you add CI, install with npm ci / pnpm install --frozen-lockfile"),
      ];
    }

    const findings: Finding[] = [];
    for (const file of workflowFiles) {
      let text: string;
      try {
        text = io.readTextFile(file);
      } catch (e) {
        const reason = isIoError(e) ? e.kind : "unreadable";
        findings.push(finding(this, "warn", `workflow cannot be read (${reason}); CI install method is undeterminable`, { file }));
        continue;
      }
      for (const cmd of extractRunCommands(text)) {
        if (classifyInstallCommand(cmd.command) === "unclean") {
          findings.push(
            finding(this, "warn", `CI installs without honoring the lockfile: \`${cmd.command}\` (line ${cmd.line}) — use npm ci / pnpm install --frozen-lockfile`, {
              file,
              detail: { line: cmd.line },
            }),
          );
        }
      }
    }
    return findings;
  },
};
