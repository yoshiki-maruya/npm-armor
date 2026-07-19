// Fix pipeline: compute plans from rules, apply them grouped per file with
// TOCTOU verification and atomic writes. This module is the only importer of
// atomicWrite (enforced by scripts/check-restrictions.mts).
import { IoError, isIoError, readTextFile, resolveWithinRoot } from "../io/index.js";
import { atomicWrite } from "../io/write.js";
import type { Analysis } from "../detect/index.js";
import type { RuleSettings } from "../engine/index.js";
import type { PatchPlan, Rule, RuleContext } from "../model.js";
import { applyPlanToText, PatchError } from "./apply.js";

export type FixPreset = "recommended" | "strict";

export interface PlannedFix {
  rule: Rule;
  plan: PatchPlan;
}

export function computeFixPlans(
  rules: readonly Rule[],
  analysis: Analysis,
  settings: RuleSettings | undefined,
  preset: FixPreset,
  ruleFilter?: ReadonlySet<string>,
): PlannedFix[] {
  const plans: PlannedFix[] = [];
  for (const rule of rules) {
    if (rule.fix === undefined) continue;
    if (ruleFilter !== undefined && !ruleFilter.has(rule.id)) continue;
    const setting = settings?.get(rule.id);
    if (setting !== undefined && !setting.enabled) continue;

    const options: Record<string, unknown> = { ...(setting?.options ?? {}) };
    if (rule.id === "AR001" && options["min"] === undefined && preset === "strict") {
      options["min"] = "7d";
    }
    const ctx: RuleContext = {
      project: analysis.project,
      config: analysis.config,
      lockfile: analysis.lockfile,
      io: analysis.io,
      options,
    };
    let plan: PatchPlan | null;
    try {
      plan = rule.fix(ctx);
    } catch {
      plan = null; // a crashing fix() must never take down the tool; check() reports the state
    }
    if (plan !== null && plan.edits.length > 0) plans.push({ rule, plan });
  }
  return plans;
}

export interface FileChange {
  file: string;
  before: string | undefined; // undefined = file did not exist
  after: string;
  constraints: string[];
  ruleIds: string[];
}

/** Merge per-file: later plans patch the output of earlier ones (single write per file). */
export function mergePlans(plans: readonly PlannedFix[]): FileChange[] {
  const byFile = new Map<string, PlannedFix[]>();
  for (const p of plans) {
    const list = byFile.get(p.plan.file) ?? [];
    list.push(p);
    byFile.set(p.plan.file, list);
  }
  const changes: FileChange[] = [];
  for (const [file, filePlans] of byFile) {
    const first = filePlans[0];
    if (first === undefined) continue;
    const before = first.plan.baseContent;
    let text: string | undefined = before;
    const constraints: string[] = [];
    const ruleIds: string[] = [];
    for (const p of filePlans) {
      text = applyPlanToText(text, p.plan);
      constraints.push(...p.plan.constraints);
      ruleIds.push(p.rule.id);
    }
    changes.push({ file, before, after: text ?? "", constraints, ruleIds });
  }
  return changes;
}

/**
 * Write a merged change: re-read the target immediately before writing and
 * abort if it differs from what the plans were computed against (T7), then
 * write atomically (symlink targets are rejected inside the io layer, T6).
 */
export function writeChange(root: string, change: FileChange): void {
  const abs = resolveWithinRoot(root, change.file);
  let current: string | undefined;
  try {
    current = readTextFile(abs);
  } catch (e) {
    if (isIoError(e) && e.kind === "not-found") current = undefined;
    else throw e;
  }
  if (current !== change.before) {
    throw new IoError("changed", abs, "file changed between analysis and write — re-run armor fix");
  }
  atomicWrite(abs, change.after);
}

export { PatchError };
