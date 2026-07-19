// `armor check` — diagnosis only, strictly read-only.
import { analyzeProject } from "../detect/index.js";
import { runRules } from "../engine/index.js";
import { allRules } from "../rules/index.js";
import { isIoError } from "../io/index.js";
import { renderJson } from "../report/json.js";
import { colorEnabled, renderTty } from "../report/tty.js";
import { parseArgs, stringFlag } from "./args.js";
import { ConfigError, loadConfig } from "./config.js";
import { loadToolMeta } from "./meta.js";

export const CHECK_FLAGS = [
  { name: "dir", hasValue: true },
  { name: "format", hasValue: true },
  { name: "config", hasValue: true },
  { name: "max-file-size", hasValue: true },
] as const;

export function runCheck(argv: readonly string[]): number {
  const args = parseArgs(argv, CHECK_FLAGS);
  if (args.errors.length > 0 || args.positionals.length > 0) {
    for (const e of args.errors) console.error(`armor check: ${e}`);
    for (const p of args.positionals) console.error(`armor check: unexpected argument ${p}`);
    return 2;
  }
  const format = stringFlag(args, "format") ?? "tty";
  if (format !== "tty" && format !== "json") {
    console.error(`armor check: unsupported --format ${format} (tty|json)`);
    return 2;
  }
  const maxRaw = stringFlag(args, "max-file-size");
  let maxBytes: number | undefined;
  if (maxRaw !== undefined) {
    if (!/^\d+$/.test(maxRaw)) {
      console.error("armor check: --max-file-size must be a byte count");
      return 2;
    }
    maxBytes = Number(maxRaw);
  }

  const dir = stringFlag(args, "dir") ?? process.cwd();

  let analysis;
  try {
    analysis = analyzeProject(dir, maxBytes !== undefined ? { maxBytes } : undefined);
  } catch (e) {
    if (isIoError(e)) {
      console.error(`armor check: cannot analyze ${dir}: ${e.message}`);
      return 2;
    }
    throw e;
  }

  let config;
  try {
    config = loadConfig(analysis.io, stringFlag(args, "config"));
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`armor check: ${e.message}`);
      return 3;
    }
    throw e;
  }

  const findings = runRules(allRules, analysis, config.settings);
  const meta = loadToolMeta();

  if (format === "json") {
    process.stdout.write(
      renderJson({
        toolName: meta.name,
        toolVersion: meta.version,
        ruleset: config.ruleset,
        packageManager: analysis.project.pm,
        findings,
        notices: config.notices,
      }),
    );
  } else {
    process.stdout.write(
      renderTty(findings, {
        color: colorEnabled({ isTTY: process.stdout.isTTY === true }),
        ruleOrder: allRules,
        notices: config.notices,
      }),
    );
  }
  return findings.some((f) => f.severity === "error") ? 1 : 0;
}
