// Small shared helpers for rule implementations.
import type { Finding, Rule, Severity } from "../model.js";
import { parseDurationToMinutes } from "../engine/duration.js";

export function finding(
  rule: Rule | { id: string },
  severity: Severity,
  message: string,
  extra?: Partial<Pick<Finding, "file" | "fixable" | "detail">>,
): Finding {
  return {
    ruleId: rule.id,
    severity,
    message,
    fixable: extra?.fixable ?? false,
    ...(extra?.file !== undefined ? { file: extra.file } : {}),
    ...(extra?.detail !== undefined ? { detail: extra.detail } : {}),
  };
}

/** Option reader: duration option like { min: "24h" }, with a safe default. */
export function durationOption(
  options: Record<string, unknown>,
  key: string,
  defaultMinutes: number,
): number {
  const raw = options[key];
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return raw;
  if (typeof raw === "string") {
    const parsed = parseDurationToMinutes(raw);
    if (parsed !== undefined) return parsed;
  }
  return defaultMinutes;
}

export function stringArrayOption(options: Record<string, unknown>, key: string): string[] {
  const raw = options[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

/** Bounded example list for aggregate messages (T5: length caps on output). */
export function exampleList(items: readonly string[], max = 3): string {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown}, … (${items.length} total)` : shown;
}
