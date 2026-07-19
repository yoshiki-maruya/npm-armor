// Single source of truth for rule documentation: `armor explain` prints this
// text and docs/rules/<slug>.md mirrors it (kept in sync by test/docs.test.ts).
import type { Rule } from "../model.js";

export function renderRuleDoc(rule: Rule): string {
  return [
    `# ${rule.id} — ${rule.meta.name}`,
    "",
    `**Default severity:** ${rule.meta.defaultSeverity}`,
    "",
    `**Attack references:** ${rule.meta.attackRefs.length > 0 ? rule.meta.attackRefs.join(", ") : "-"}`,
    "",
    `${rule.meta.summary}.`,
    "",
    rule.meta.explain,
    "",
  ].join("\n");
}
