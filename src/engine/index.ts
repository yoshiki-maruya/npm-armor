// Rule runner: every enabled rule sees the same immutable context; one rule's
// exception becomes that rule's "internal error" warn finding and never takes
// the tool down (work order §4 Phase 3).
import type { Analysis } from "../detect/index.js";
import type { Finding, Rule, RuleContext, Severity } from "../model.js";

export interface RuleSetting {
  enabled: boolean;
  severity?: Severity; // override applied to findings at the rule's default severity
  options: Record<string, unknown>;
}

export type RuleSettings = Map<string, RuleSetting>; // key: rule id ("AR001")

export function runRules(rules: readonly Rule[], analysis: Analysis, settings?: RuleSettings): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    const setting = settings?.get(rule.id);
    if (setting !== undefined && !setting.enabled) continue;

    const ctx: RuleContext = {
      project: analysis.project,
      config: analysis.config,
      lockfile: analysis.lockfile,
      io: analysis.io,
      options: setting?.options ?? {},
    };

    let ruleFindings: Finding[];
    try {
      ruleFindings = rule.check(ctx);
    } catch (e) {
      findings.push({
        ruleId: rule.id,
        severity: "warn",
        message: `internal error while evaluating this rule (please report): ${String(e)}`,
        fixable: false,
        detail: { internalError: true },
      });
      continue;
    }

    for (const f of ruleFindings) {
      if (setting?.severity !== undefined && f.severity === rule.meta.defaultSeverity) {
        findings.push({ ...f, severity: setting.severity });
      } else {
        findings.push(f);
      }
    }
  }
  return findings;
}

export function summarize(findings: readonly Finding[]): Record<Severity, number> {
  const summary: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) summary[f.severity] += 1;
  return summary;
}
