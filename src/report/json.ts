// JSON reporter. schemaVersion 1 is a stability contract (design §5.5).
// String values are sanitized so raw control bytes cannot reach the consumer
// even before JSON escaping (T4/T5).
import { sanitizeForTerminal } from "../io/index.js";
import type { Finding, Severity } from "../model.js";

export interface JsonReportInput {
  toolName: string;
  toolVersion: string;
  ruleset: string;
  packageManager: string;
  findings: readonly Finding[];
  notices: readonly string[];
}

function sanitizeDetail(detail: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(detail)) {
    out[sanitizeForTerminal(k)] = typeof v === "string" ? sanitizeForTerminal(v) : v;
  }
  return out;
}

export function renderJson(input: JsonReportInput): string {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of input.findings) counts[f.severity] += 1;

  const doc = {
    schemaVersion: 1,
    tool: { name: input.toolName, version: input.toolVersion },
    ruleset: input.ruleset,
    packageManager: input.packageManager,
    findings: input.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      message: sanitizeForTerminal(f.message),
      ...(f.file !== undefined ? { file: sanitizeForTerminal(f.file) } : {}),
      fixable: f.fixable,
      ...(f.detail !== undefined ? { detail: sanitizeDetail(f.detail) } : {}),
    })),
    summary: counts,
    notices: input.notices.map((n) => sanitizeForTerminal(n)),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
