// package-lock.json extraction: only `resolved`/`integrity` per package are
// pulled out (AR003/AR007). Everything else is dropped at the parse boundary;
// dangerous keys never cross it (threat T2).
import { asString, parseJsonSafe, safeEntries, safeGet } from "./json-safe.js";
import type { LockfileSource } from "../model.js";
import { classifySourceUrl } from "../model.js";

export type NpmLockResult =
  | { kind: "ok"; lockfileVersion: number | undefined; sources: LockfileSource[] }
  | { kind: "unparseable"; reason: string };

function nameFromPackagePath(pkgPath: string): string | undefined {
  // "node_modules/@scope/name" or "node_modules/a/node_modules/b"
  const idx = pkgPath.lastIndexOf("node_modules/");
  if (idx === -1) return pkgPath === "" ? undefined : pkgPath;
  return pkgPath.slice(idx + "node_modules/".length) || undefined;
}

export function parseNpmLockfile(file: string, text: string): NpmLockResult {
  const parsed = parseJsonSafe(text);
  if (parsed.kind === "unparseable") return { kind: "unparseable", reason: parsed.reason };

  const root = parsed.value;
  const versionRaw = safeGet(root, "lockfileVersion");
  const lockfileVersion = typeof versionRaw === "number" ? versionRaw : undefined;
  const sources: LockfileSource[] = [];

  const packages = safeGet(root, "packages");
  if (packages !== undefined) {
    // lockfileVersion 2/3
    for (const [pkgPath, entry] of safeEntries(packages)) {
      const resolved = asString(safeGet(entry, "resolved"));
      if (resolved === undefined || pkgPath === "") continue;
      sources.push({
        file,
        name: nameFromPackagePath(pkgPath),
        url: resolved,
        kind: classifySourceUrl(resolved),
        integrity: asString(safeGet(entry, "integrity")),
      });
    }
    return { kind: "ok", lockfileVersion, sources };
  }

  const dependencies = safeGet(root, "dependencies");
  if (dependencies !== undefined) {
    // lockfileVersion 1 (read-only best effort; npm >= 9 writes v2/v3)
    const walk = (deps: unknown, depth: number): void => {
      if (depth > 64) return; // parseJsonSafe already bounds depth; belt and suspenders
      for (const [name, entry] of safeEntries(deps)) {
        const resolved = asString(safeGet(entry, "resolved"));
        if (resolved !== undefined) {
          sources.push({
            file,
            name,
            url: resolved,
            kind: classifySourceUrl(resolved),
            integrity: asString(safeGet(entry, "integrity")),
          });
        }
        const nested = safeGet(entry, "dependencies");
        if (nested !== undefined) walk(nested, depth + 1);
      }
    };
    walk(dependencies, 0);
    return { kind: "ok", lockfileVersion, sources };
  }

  if (lockfileVersion !== undefined || safeGet(root, "name") !== undefined) {
    // Valid JSON that looks like a lockfile but has no package data (empty project)
    return { kind: "ok", lockfileVersion, sources };
  }
  return { kind: "unparseable", reason: "does not look like a package-lock.json" };
}
