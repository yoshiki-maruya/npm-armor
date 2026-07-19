// `armor rules` — list the rule catalog.
import { allRules, RULESET_TAG } from "../rules/index.js";
import { parseArgs, boolFlag } from "./args.js";

export function runRulesCommand(argv: readonly string[]): number {
  const args = parseArgs(argv, [{ name: "json", hasValue: false }]);
  if (args.errors.length > 0 || args.positionals.length > 0) {
    for (const e of args.errors) console.error(`armor rules: ${e}`);
    for (const p of args.positionals) console.error(`armor rules: unexpected argument ${p}`);
    return 2;
  }

  if (boolFlag(args, "json")) {
    const doc = {
      schemaVersion: 1,
      ruleset: RULESET_TAG,
      rules: allRules.map((r) => ({
        id: r.id,
        name: r.meta.name,
        defaultSeverity: r.meta.defaultSeverity,
        summary: r.meta.summary,
        attackRefs: r.meta.attackRefs,
      })),
    };
    process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
    return 0;
  }

  const lines = [`ruleset: ${RULESET_TAG}`, ""];
  for (const r of allRules) {
    lines.push(`${r.id}  ${r.meta.name.padEnd(30)} ${r.meta.defaultSeverity.padEnd(5)}  ${r.meta.summary}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
