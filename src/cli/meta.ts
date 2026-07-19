// Tool identity comes from our own package.json — the name is never
// hardcoded (work order §0).
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readTextFile } from "../io/index.js";
import { asString, parseJsonSafe, safeGet } from "../adapters/json-safe.js";

export interface ToolMeta {
  name: string;
  version: string;
}

let cached: ToolMeta | undefined;

export function loadToolMeta(): ToolMeta {
  if (cached !== undefined) return cached;
  // dist/cli/meta.js -> ../../package.json (package root)
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  let name = "npm-armor";
  let version = "0.0.0";
  try {
    const parsed = parseJsonSafe(readTextFile(pkgPath));
    if (parsed.kind === "ok") {
      name = asString(safeGet(parsed.value, "name")) ?? name;
      version = asString(safeGet(parsed.value, "version")) ?? version;
    }
  } catch {
    // fall back to defaults — identity display must never crash the tool
  }
  cached = { name, version };
  return cached;
}
