// Load every npm/pnpm lockfile present into one LockfileModel. A file that
// cannot be read or parsed marks the model "unparseable" (undeterminable, warn)
// while keeping whatever was extracted from the others.
import type { ReadOnlyFileAccess } from "../io/index.js";
import { isIoError } from "../io/index.js";
import { parseNpmLockfile } from "../adapters/lockfile-npm.js";
import { parsePnpmLockfile } from "../adapters/lockfile-pnpm.js";
import { NPM_LOCKFILES, PNPM_LOCKFILES } from "./project.js";
import type { LockfileModel, ProjectModel } from "../model.js";

export function loadLockfileModel(project: ProjectModel, io: ReadOnlyFileAccess): LockfileModel {
  const model: LockfileModel = { status: "missing", sources: [] };
  let sawAny = false;
  let firstIssue: string | undefined;

  const readOr = (file: string): string | undefined => {
    try {
      return io.readTextFile(file);
    } catch (e) {
      if (isIoError(e)) {
        firstIssue ??= `${file}: ${e.kind === "too-large" ? "exceeds size limit" : e.message}`;
        return undefined;
      }
      throw e;
    }
  };

  for (const file of NPM_LOCKFILES) {
    if (!project.lockfiles.includes(file)) continue;
    sawAny = true;
    model.file ??= file;
    const text = readOr(file);
    if (text === undefined) continue;
    const result = parseNpmLockfile(file, text);
    if (result.kind === "unparseable") {
      firstIssue ??= `${file}: ${result.reason}`;
      continue;
    }
    model.sources.push(...result.sources);
  }

  for (const file of PNPM_LOCKFILES) {
    if (!project.lockfiles.includes(file)) continue;
    sawAny = true;
    model.file ??= file;
    const text = readOr(file);
    if (text === undefined) continue;
    model.sources.push(...parsePnpmLockfile(file, text).sources);
  }

  if (!sawAny) return model; // status "missing"
  if (firstIssue !== undefined) {
    model.status = "unparseable";
    model.reason = firstIssue;
  } else {
    model.status = "ok";
  }
  return model;
}
