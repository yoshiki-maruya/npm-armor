// `armor fix` — preview by default, --write to apply (design §4.1/§4.4).
import { analyzeProject } from "../detect/index.js";
import { allRules } from "../rules/index.js";
import { isIoError, sanitizeForTerminal } from "../io/index.js";
import { computeFixPlans, mergePlans, PatchError, writeChange } from "../fix/index.js";
import type { FixPreset } from "../fix/index.js";
import { boolFlag, listFlag, parseArgs, stringFlag } from "./args.js";
import { ConfigError, loadConfig } from "./config.js";
import { ruleById } from "../rules/index.js";

export const FIX_FLAGS = [
  { name: "dir", hasValue: true },
  { name: "write", hasValue: false },
  { name: "rule", hasValue: true, repeatable: true },
  { name: "preset", hasValue: true },
  { name: "config", hasValue: true },
] as const;

export function runFix(argv: readonly string[]): number {
  const args = parseArgs(argv, FIX_FLAGS);
  if (args.errors.length > 0 || args.positionals.length > 0) {
    for (const e of args.errors) console.error(`armor fix: ${e}`);
    for (const p of args.positionals) console.error(`armor fix: unexpected argument ${p}`);
    return 2;
  }
  const presetRaw = stringFlag(args, "preset") ?? "recommended";
  if (presetRaw !== "recommended" && presetRaw !== "strict") {
    console.error(`armor fix: unsupported --preset ${presetRaw} (recommended|strict)`);
    return 2;
  }
  const preset: FixPreset = presetRaw;

  let ruleFilter: Set<string> | undefined;
  const ruleArgs = listFlag(args, "rule");
  if (ruleArgs.length > 0) {
    ruleFilter = new Set();
    for (const r of ruleArgs) {
      const rule = ruleById(r);
      if (rule === undefined) {
        console.error(`armor fix: unknown rule ${JSON.stringify(r)} (see \`armor rules\`)`);
        return 2;
      }
      ruleFilter.add(rule.id);
    }
  }

  const dir = stringFlag(args, "dir") ?? process.cwd();
  let analysis;
  try {
    analysis = analyzeProject(dir);
  } catch (e) {
    if (isIoError(e)) {
      console.error(`armor fix: cannot analyze ${dir}: ${e.message}`);
      return 2;
    }
    throw e;
  }

  let config;
  try {
    config = loadConfig(analysis.io, stringFlag(args, "config"));
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`armor fix: ${e.message}`);
      return 3;
    }
    throw e;
  }

  const plans = computeFixPlans(allRules, analysis, config.settings, preset, ruleFilter);
  if (plans.length === 0) {
    process.stdout.write("nothing to fix\n");
    return 0;
  }

  let changes;
  try {
    changes = mergePlans(plans);
  } catch (e) {
    if (e instanceof PatchError) {
      console.error(`armor fix: ${e.message}`);
      return 2;
    }
    throw e;
  }

  const write = boolFlag(args, "write");
  const out: string[] = [];
  out.push(write ? "armor fix — applying:" : "armor fix — preview (use --write to apply):");
  out.push("");
  for (const change of changes) {
    out.push(`${sanitizeForTerminal(change.file)}  [${change.ruleIds.join(", ")}]${change.before === undefined ? "  (new file)" : ""}`);
    out.push(...renderLineDiff(change.before ?? "", change.after));
    if (change.constraints.length > 0) {
      out.push("  constraints:");
      for (const c of [...new Set(change.constraints)]) {
        out.push(`    - ${sanitizeForTerminal(c)}`);
      }
    }
    out.push("");
  }
  process.stdout.write(`${out.join("\n")}\n`);

  if (!write) return 0;

  let failed = false;
  for (const change of changes) {
    try {
      writeChange(analysis.project.root, change);
      process.stdout.write(`wrote ${sanitizeForTerminal(change.file)}\n`);
    } catch (e) {
      failed = true;
      const msg = isIoError(e) ? `${e.kind}: ${e.message}` : String(e);
      console.error(`armor fix: failed to write ${sanitizeForTerminal(change.file)}: ${sanitizeForTerminal(msg)}`);
    }
  }
  if (failed) return 2;

  // Fixpoint verification: a second pass must find nothing left to fix.
  const after = analyzeProject(dir);
  const remaining = computeFixPlans(allRules, after, config.settings, preset, ruleFilter);
  if (remaining.length > 0) {
    console.error("armor fix: internal error — fixes did not converge (please report)");
    return 2;
  }
  return 0;
}

/** Simple per-line diff for preview: removed lines with "-", added with "+". */
function renderLineDiff(before: string, after: string): string[] {
  const beforeLines = before === "" ? [] : before.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const afterLines = after === "" ? [] : after.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const out: string[] = [];
  for (const l of beforeLines) {
    if (!afterSet.has(l)) out.push(`  - ${sanitizeForTerminal(l)}`);
  }
  for (const l of afterLines) {
    if (!beforeSet.has(l)) out.push(`  + ${sanitizeForTerminal(l)}`);
  }
  return out;
}
