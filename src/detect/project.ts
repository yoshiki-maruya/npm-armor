// Project structure detection: which PM, which lockfiles, which workspaces.
// Everything here reads through the confined io layer and degrades to
// "unknown" rather than guessing (principle 6).
import type { ReadOnlyFileAccess } from "../io/index.js";
import { isIoError } from "../io/index.js";
import { asString, asStringArray, parseJsonSafe, safeGet } from "../adapters/json-safe.js";
import type { YamlSubsetResult } from "../adapters/yaml-subset.js";
import type { PackageManager, ProjectModel } from "../model.js";

export const NPM_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"] as const;
export const PNPM_LOCKFILES = ["pnpm-lock.yaml"] as const;
export const OTHER_LOCKFILES = ["yarn.lock", "bun.lock", "bun.lockb"] as const;
export const ALL_LOCKFILES = [...NPM_LOCKFILES, ...PNPM_LOCKFILES, ...OTHER_LOCKFILES];

interface PackageJsonInfo {
  status: "ok" | "missing" | "unparseable";
  name?: string;
  packageManagerField?: string;
  workspacePatterns: string[];
}

function readPackageJson(io: ReadOnlyFileAccess): PackageJsonInfo {
  let text: string;
  try {
    text = io.readTextFile("package.json");
  } catch (e) {
    if (isIoError(e) && e.kind === "not-found") {
      return { status: "missing", workspacePatterns: [] };
    }
    return { status: "unparseable", workspacePatterns: [] };
  }
  const parsed = parseJsonSafe(text);
  if (parsed.kind === "unparseable") return { status: "unparseable", workspacePatterns: [] };

  const workspacesRaw = safeGet(parsed.value, "workspaces");
  const workspacePatterns =
    asStringArray(workspacesRaw) ?? asStringArray(safeGet(workspacesRaw, "packages")) ?? [];
  return {
    status: "ok",
    name: asString(safeGet(parsed.value, "name")),
    packageManagerField: asString(safeGet(parsed.value, "packageManager")),
    workspacePatterns,
  };
}

/**
 * Expand workspace patterns. Supported: literal paths and a single trailing
 * "*" segment ("packages/*"). Anything fancier is kept out of the model —
 * M1 rules only need to know workspaces exist, not resolve them perfectly.
 */
function expandWorkspaces(io: ReadOnlyFileAccess, patterns: string[]): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    const p = pattern.trim().replaceAll("\\", "/");
    if (p === "" || p.startsWith("!")) continue;
    if (p.endsWith("/*")) {
      const base = p.slice(0, -2);
      if (base.includes("*")) continue;
      let entries;
      try {
        entries = io.listDir(base);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.kind === "dir" && !e.name.startsWith(".")) found.add(`${base}/${e.name}`);
      }
      continue;
    }
    if (p.includes("*")) continue;
    try {
      if (io.lstat(p)?.kind === "dir") found.add(p);
    } catch {
      // outside root or otherwise invalid — not a workspace we accept
    }
  }
  return [...found].sort();
}

function parsePmField(field: string | undefined): { pm: PackageManager; version?: string } {
  if (field === undefined) return { pm: "unknown" };
  const m = /^([a-z]+)@([^+]+)/.exec(field.trim());
  if (m === null) return { pm: "unknown" };
  const name = m[1];
  const version = m[2];
  if (name === "npm" || name === "pnpm") return { pm: name, version };
  return { pm: "unknown" };
}

export function buildProjectModel(
  root: string,
  io: ReadOnlyFileAccess,
  workspaceYaml: YamlSubsetResult | undefined,
): ProjectModel {
  const pkg = readPackageJson(io);

  const lockfiles: string[] = [];
  for (const name of ALL_LOCKFILES) {
    try {
      if (io.exists(name)) lockfiles.push(name);
    } catch {
      // unreadable entry — treat as absent; AR-level checks surface io issues
    }
  }

  const fromField = parsePmField(pkg.packageManagerField);
  let pm: PackageManager = fromField.pm;
  if (pm === "unknown" && pkg.packageManagerField === undefined) {
    const hasNpm = lockfiles.some((f) => (NPM_LOCKFILES as readonly string[]).includes(f));
    const hasPnpm = lockfiles.some((f) => (PNPM_LOCKFILES as readonly string[]).includes(f));
    const hasOther = lockfiles.some((f) => (OTHER_LOCKFILES as readonly string[]).includes(f));
    if (hasNpm && !hasPnpm && !hasOther) pm = "npm";
    else if (hasPnpm && !hasNpm && !hasOther) pm = "pnpm";
  }

  // Workspaces: npm reads package.json "workspaces"; pnpm reads pnpm-workspace.yaml "packages".
  let patterns = pkg.workspacePatterns;
  if (workspaceYaml !== undefined && workspaceYaml.kind === "ok") {
    const pkgs = workspaceYaml.data.get("packages");
    if (Array.isArray(pkgs)) patterns = pm === "npm" ? patterns : pkgs;
  }

  const model: ProjectModel = {
    root,
    pm,
    lockfiles,
    workspaces: expandWorkspaces(io, patterns),
    packageJsonStatus: pkg.status,
  };
  if (pkg.packageManagerField !== undefined) model.packageManagerField = pkg.packageManagerField;
  if (fromField.version !== undefined) model.pmVersion = fromField.version;
  return model;
}
