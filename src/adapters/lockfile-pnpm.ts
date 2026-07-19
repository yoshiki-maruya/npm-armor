// pnpm-lock.yaml targeted extraction. This is deliberately NOT a YAML parser:
// a single linear pass collects the fields AR003/AR007 need — tarball URLs,
// git repos and integrity hashes inside `resolution:` — keyed to the nearest
// enclosing package entry. Packages from the default registry carry only an
// integrity hash (no URL) and are exactly the entries AR007 lets pass.
import type { LockfileSource } from "../model.js";
import { classifySourceUrl } from "../model.js";

export interface PnpmLockExtract {
  sources: LockfileSource[];
}

function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function nameFromPackageKey(key: string): string | undefined {
  // "foo@1.0.0", "@scope/foo@1.0.0", "/foo@1.0.0", "foo@git+https://..."
  const k = key.startsWith("/") ? key.slice(1) : key;
  const at = k.startsWith("@") ? k.indexOf("@", 1) : k.indexOf("@");
  if (at > 0) return k.slice(0, at);
  return k === "" ? undefined : k;
}

/** Parse a single-line flow map body like `integrity: sha512-..., tarball: https://...` */
function parseFlowMap(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = unquote(part.slice(idx + 1).trim());
    if (key !== "") out.set(key, value);
  }
  return out;
}

export function parsePnpmLockfile(file: string, text: string): PnpmLockExtract {
  const sources: LockfileSource[] = [];
  const lines = text.split("\n");
  let currentName: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trim();

    // Package entry key, e.g. "  foo@1.0.0:" (indent 2, ends with ":")
    const keyMatch = /^ {2}(\S.*):$/.exec(line);
    if (keyMatch !== null) {
      currentName = nameFromPackageKey(unquote(keyMatch[1] ?? ""));
      continue;
    }

    const resIdx = trimmed.indexOf("resolution: {");
    if (resIdx !== -1 && trimmed.endsWith("}")) {
      const body = trimmed.slice(resIdx + "resolution: {".length, -1);
      const flow = parseFlowMap(body);
      const integrity = flow.get("integrity");
      const tarball = flow.get("tarball");
      const repo = flow.get("repo");
      if (tarball !== undefined && tarball !== "") {
        sources.push({ file, name: currentName, url: tarball, kind: classifySourceUrl(tarball), integrity });
      }
      if (repo !== undefined && repo !== "") {
        sources.push({ file, name: currentName, url: repo, kind: "git", integrity });
      }
      continue;
    }

    // Defensive: multi-line resolution blocks (older formats)
    const tarballMatch = /^tarball:\s+(.+)$/.exec(trimmed);
    if (tarballMatch !== null) {
      const url = unquote((tarballMatch[1] ?? "").trim());
      if (url !== "") sources.push({ file, name: currentName, url, kind: classifySourceUrl(url) });
      continue;
    }
    const repoMatch = /^repo:\s+(.+)$/.exec(trimmed);
    if (repoMatch !== null) {
      const url = unquote((repoMatch[1] ?? "").trim());
      if (url !== "") sources.push({ file, name: currentName, url, kind: "git" });
    }
  }
  return { sources };
}
