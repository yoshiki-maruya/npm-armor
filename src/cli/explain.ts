// `armor explain <ruleId>` — why a rule exists and what it defends against.
import { ruleById } from "../rules/index.js";
import { renderRuleDoc } from "../report/docs.js";

export function runExplain(argv: readonly string[]): number {
  const target = argv[0];
  if (target === undefined || argv.length > 1) {
    console.error("usage: armor explain <ruleId>");
    return 2;
  }
  const rule = ruleById(target);
  if (rule === undefined) {
    console.error(`armor explain: unknown rule ${JSON.stringify(target)} (see \`armor rules\`)`);
    return 2;
  }
  process.stdout.write(renderRuleDoc(rule));
  return 0;
}
