// Defensive JSON handling for attacker-controlled files (threats T1/T2).

export type JsonResult = { kind: "ok"; value: unknown } | { kind: "unparseable"; reason: string };

export const DEFAULT_MAX_JSON_DEPTH = 512;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Single linear pass counting bracket nesting outside string literals, so a
 * hostile deeply-nested document is rejected deterministically instead of
 * relying on engine stack limits (threat T1).
 */
export function scanMaxDepth(text: string, limit: number): "ok" | "too-deep" {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (c === 0x5c) escaped = true; // backslash
      else if (c === 0x22) inString = false; // quote
      continue;
    }
    if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      depth += 1;
      if (depth > limit) return "too-deep";
    } else if (c === 0x7d || c === 0x5d) depth -= 1;
  }
  return "ok";
}

export function parseJsonSafe(text: string, opts?: { maxDepth?: number }): JsonResult {
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  if (scanMaxDepth(text, maxDepth) === "too-deep") {
    return { kind: "unparseable", reason: `nesting depth exceeds ${maxDepth}` };
  }
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch (e) {
    return { kind: "unparseable", reason: `invalid JSON: ${(e as Error).message}` };
  }
}

/** Own-key iteration that drops __proto__ / constructor / prototype (threat T2). */
export function safeEntries(value: unknown): Array<[string, unknown]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const out: Array<[string, unknown]> = [];
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out.push([key, (value as Record<string, unknown>)[key]]);
  }
  return out;
}

export function safeGet(value: unknown, key: string): unknown {
  if (DANGEROUS_KEYS.has(key)) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  return (value as Record<string, unknown>)[key];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) if (typeof v === "string") out.push(v);
  return out;
}
