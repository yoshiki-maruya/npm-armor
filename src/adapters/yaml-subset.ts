// Restricted line-oriented YAML reader for pnpm-workspace.yaml (design §3.1).
// Supports exactly: top-level scalar keys, top-level keys with a block list of
// scalar items, comments and blank lines. Anchors, aliases, tags, merge keys,
// flow style and block scalars on extracted keys make the file "unparseable" —
// principle 6: an input we cannot be sure the real PM reads the same way is
// reported as undeterminable, never as OK. Unknown nested blocks are skipped
// (they cannot change the meaning of a top-level scalar once anchors/aliases
// are excluded globally).

export type YamlValue = string | string[];

export type YamlSubsetResult =
  | { kind: "ok"; data: Map<string, YamlValue> }
  | { kind: "unparseable"; reason: string };

/** Remove quoted spans so danger-token scanning ignores quoted content. */
function stripQuotedSpans(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
}

function stripComment(line: string): string {
  const stripped = stripQuotedSpans(line);
  // A '#' starting the line or preceded by whitespace begins a comment.
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === "#" && (i === 0 || stripped[i - 1] === " " || stripped[i - 1] === "\t")) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Danger tokens that could make our reading diverge from a real YAML parser. */
function findDangerToken(rawLine: string): string | undefined {
  const line = stripQuotedSpans(rawLine);
  if (/(^|[\s,])[&*][^\s]/.test(line)) return "anchor or alias";
  if (/(^|[\s,])!{1,2}[^\s]/.test(line)) return "tag";
  if (/<</.test(line)) return "merge key";
  return undefined;
}

function isDangerScalar(value: string): string | undefined {
  const v = value.trim();
  if (v.startsWith("&") || v.startsWith("*")) return "anchor or alias";
  if (v.startsWith("!")) return "tag";
  if (v.startsWith("{") || v.startsWith("[")) return "flow style";
  if (v === "|" || v === ">" || v.startsWith("|") || v.startsWith(">")) return "block scalar";
  return undefined;
}

export function parseYamlSubset(text: string, extractKeys: readonly string[]): YamlSubsetResult {
  const wanted = new Set(extractKeys);
  const data = new Map<string, YamlValue>();
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));

  let sawDocMarker = false;
  let currentKey: string | undefined; // top-level key awaiting/collecting a block list
  let currentIsWanted = false;

  for (let i = 0; i < lines.length; i++) {
    const withComment = lines[i] ?? "";
    const line = stripComment(withComment);
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const danger = findDangerToken(line);
    if (danger !== undefined) {
      return { kind: "unparseable", reason: `${danger} at line ${i + 1}` };
    }

    if (trimmed === "---") {
      if (sawDocMarker || data.size > 0 || currentKey !== undefined) {
        return { kind: "unparseable", reason: `multiple documents at line ${i + 1}` };
      }
      sawDocMarker = true;
      continue;
    }

    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      if (trimmed.startsWith("- ")) {
        return { kind: "unparseable", reason: `top-level sequence at line ${i + 1}` };
      }
      const m = /^([^\s:]+):\s*(.*)$/.exec(trimmed);
      if (m === null) {
        return { kind: "unparseable", reason: `unrecognized top-level line ${i + 1}` };
      }
      const key = unquote(m[1] ?? "");
      const rest = (m[2] ?? "").trim();
      currentKey = key;
      currentIsWanted = wanted.has(key);
      if (rest === "") {
        // Block (list or nested map) follows; initialize wanted keys as list.
        if (currentIsWanted) data.set(key, []);
        continue;
      }
      if (currentIsWanted) {
        const dangerScalar = isDangerScalar(rest);
        if (dangerScalar !== undefined) {
          return { kind: "unparseable", reason: `${dangerScalar} in "${key}" at line ${i + 1}` };
        }
        data.set(key, unquote(rest));
      }
      currentKey = undefined; // scalar consumed; nothing block-level follows for it
      currentIsWanted = false;
      continue;
    }

    // Indented content
    if (currentKey === undefined) {
      return { kind: "unparseable", reason: `unexpected indentation at line ${i + 1}` };
    }
    if (!currentIsWanted) continue; // skip unknown nested blocks (safe: no anchors/aliases anywhere)

    const itemMatch = /^-\s+(.*)$/.exec(trimmed);
    if (itemMatch === null) {
      // Nested map or block scalar under a key we must interpret — bail out.
      return { kind: "unparseable", reason: `unsupported structure under "${currentKey}" at line ${i + 1}` };
    }
    const item = (itemMatch[1] ?? "").trim();
    const dangerScalar = isDangerScalar(item);
    if (dangerScalar !== undefined) {
      return { kind: "unparseable", reason: `${dangerScalar} under "${currentKey}" at line ${i + 1}` };
    }
    const list = data.get(currentKey);
    if (Array.isArray(list)) list.push(unquote(item));
  }

  return { kind: "ok", data };
}
