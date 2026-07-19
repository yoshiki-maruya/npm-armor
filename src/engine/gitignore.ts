// Minimal .gitignore matcher for AR004 — answers one narrow question: is a
// given root-level file name ignored? Implemented from scratch (running git is
// banned by principle 1). Supports comments, negation, anchoring, `*`/`?`/`**`.
// Patterns are attacker-controlled (T3): globs compile to linear-ish regexes
// and only ever run against short fixed file names.

interface CompiledPattern {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

function globToRegex(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (glob[i + 1] === "/") i += 1; // "**/" collapses
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c !== undefined && /[A-Za-z0-9_\-./@]/.test(c)) {
      out += c === "." ? "\\." : c;
    } else if (c !== undefined) {
      out += `\\u{${c.codePointAt(0)?.toString(16) ?? "0"}}`;
    }
  }
  return new RegExp(`${out}$`, "u");
}

export function compileGitignore(text: string): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  for (const rawLine of text.split("\n")) {
    let line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trimStart().startsWith("#")) continue;
    // Trailing spaces are ignored unless escaped; we simply trim (subset).
    line = line.trim();
    if (line === "") continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    // Leading "/" anchors to the root — for root-level files both forms
    // behave identically once stripped.
    if (line.startsWith("/")) line = line.slice(1);
    if (line === "") continue;
    compiled.push({ regex: globToRegex(line), negated, dirOnly });
  }
  return compiled;
}

/** Is a root-level *file* (e.g. "package-lock.json") ignored? */
export function isRootFileIgnored(gitignoreText: string, fileName: string): boolean {
  let ignored = false;
  for (const p of compileGitignore(gitignoreText)) {
    if (p.dirOnly) continue; // a directory pattern cannot match a file
    if (p.regex.test(fileName)) ignored = !p.negated;
  }
  return ignored;
}
