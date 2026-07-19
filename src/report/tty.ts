// Terminal reporter. Every data-derived string crosses sanitizeForTerminal
// immediately before rendering (T4) — no exceptions, including file paths.
import { sanitizeForTerminal } from "../io/index.js";
import type { Finding, Severity } from "../model.js";
import type { Rule } from "../model.js";

export interface TtyOptions {
  color: boolean;
  ruleOrder: readonly Rule[];
  notices?: readonly string[];
}

const COLOR: Record<Severity, string> = { error: "31", warn: "33", info: "36" };

export function colorEnabled(env: { isTTY: boolean }): boolean {
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== "" && force !== "0") return true;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.CI !== undefined) return false;
  return env.isTTY;
}

export function renderTty(findings: readonly Finding[], opts: TtyOptions): string {
  const paint = (sev: Severity, text: string): string =>
    opts.color ? `\u001b[${COLOR[sev]}m${text}\u001b[0m` : text;
  const lines: string[] = [];

  for (const notice of opts.notices ?? []) {
    lines.push(`note: ${sanitizeForTerminal(notice)}`);
  }
  if (opts.notices !== undefined && opts.notices.length > 0) lines.push("");

  const known = new Map(opts.ruleOrder.map((r) => [r.id, r] as const));
  const orderedIds = [
    ...opts.ruleOrder.map((r) => r.id).filter((id) => findings.some((f) => f.ruleId === id)),
    ...[...new Set(findings.map((f) => f.ruleId))].filter((id) => !known.has(id)),
  ];

  for (const ruleId of orderedIds) {
    const ruleFindings = findings.filter((f) => f.ruleId === ruleId);
    const rule = known.get(ruleId);
    lines.push(sanitizeForTerminal(rule !== undefined ? `${ruleId} ${rule.meta.name}` : ruleId));
    for (const f of ruleFindings) {
      const location = f.file !== undefined ? `  [${sanitizeForTerminal(f.file)}]` : "";
      const fixNote = f.fixable ? "  (fixable via `armor fix`)" : "";
      lines.push(`  ${paint(f.severity, f.severity.padEnd(5))}  ${sanitizeForTerminal(f.message)}${location}${fixNote}`);
    }
    lines.push("");
  }

  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  if (findings.length === 0) {
    lines.push(`all checks passed (${opts.ruleOrder.length} rules)`);
  } else {
    lines.push(
      `${counts.error} error(s), ${counts.warn} warning(s), ${counts.info} info — ${opts.ruleOrder.length} rules evaluated`,
    );
  }
  return `${lines.join("\n")}\n`;
}
