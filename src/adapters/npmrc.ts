// Line-oriented INI parser for .npmrc — no full ini features, no dot-splitting,
// no type coercion. Keys are normalized the way npm does (case-insensitive,
// "_" and "-" interchangeable) for lookups, while raw lines are preserved so
// fix can patch minimally.

export interface NpmrcEntry {
  key: string; // raw key as written
  normKey: string; // normalized: lowercased, "_" -> "-"
  value: string;
  line: number; // 1-based
}

export interface NpmrcData {
  entries: NpmrcEntry[];
  lines: string[]; // raw lines (without EOL), for fix anchoring
}

export function normalizeNpmrcKey(key: string): string {
  return key.trim().toLowerCase().replaceAll("_", "-");
}

function stripQuotes(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseNpmrc(text: string): NpmrcData {
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const entries: NpmrcEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue; // not key=value — npm ignores such lines too
    const key = trimmed.slice(0, eq).trim();
    const value = stripQuotes(trimmed.slice(eq + 1).trim());
    entries.push({ key, normKey: normalizeNpmrcKey(key), value, line: i + 1 });
  }
  return { entries, lines };
}

/** Last-one-wins lookup by normalized key (npm semantics). */
export function npmrcGet(data: NpmrcData, key: string): NpmrcEntry | undefined {
  const norm = normalizeNpmrcKey(key);
  for (let i = data.entries.length - 1; i >= 0; i--) {
    const e = data.entries[i];
    if (e !== undefined && e.normKey === norm) return e;
  }
  return undefined;
}

export function npmrcGetBool(data: NpmrcData, key: string): boolean | undefined {
  const e = npmrcGet(data, key);
  if (e === undefined) return undefined;
  const v = e.value.toLowerCase();
  if (v === "true" || v === "") return true; // bare "key=" and "key=true" are truthy for npm flags
  if (v === "false") return false;
  return undefined; // unparseable boolean — caller decides (safe side)
}

/** Is the value an environment-variable reference like ${NPM_TOKEN}? */
export function isEnvReference(value: string): boolean {
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value.trim());
}
