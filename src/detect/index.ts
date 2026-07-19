// Entry point of the analysis pipeline: root -> {project, config, lockfile}.
// Parses each input file exactly once; rules never re-read what is modeled here.
import { createProjectReader, isIoError, realpathSafe } from "../io/index.js";
import type { ReadOnlyFileAccess } from "../io/index.js";
import { parseYamlSubset } from "../adapters/yaml-subset.js";
import type { YamlSubsetResult } from "../adapters/yaml-subset.js";
import { buildProjectModel } from "./project.js";
import { buildNormalizedConfig } from "./normalize.js";
import { loadLockfileModel } from "./lockfile.js";
import type { FileStatus, LockfileModel, NormalizedConfig, ProjectModel } from "../model.js";

export interface Analysis {
  project: ProjectModel;
  config: NormalizedConfig;
  lockfile: LockfileModel;
  io: ReadOnlyFileAccess;
}

export const PNPM_WORKSPACE_KEYS = [
  "packages",
  "minimumReleaseAge",
  "minimumReleaseAgeExclude",
  "onlyBuiltDependencies",
  "dangerouslyAllowAllBuilds",
] as const;

interface WorkspaceYamlRead {
  status: FileStatus;
  issue?: string;
  result?: YamlSubsetResult;
}

function readWorkspaceYaml(io: ReadOnlyFileAccess): WorkspaceYamlRead {
  let text: string;
  try {
    text = io.readTextFile("pnpm-workspace.yaml");
  } catch (e) {
    if (isIoError(e)) {
      if (e.kind === "not-found") return { status: "missing" };
      return { status: "unreadable", issue: `${e.kind}: ${e.message}` };
    }
    throw e;
  }
  const result = parseYamlSubset(text, PNPM_WORKSPACE_KEYS);
  if (result.kind === "unparseable") {
    return { status: "unparseable", issue: result.reason, result };
  }
  return { status: "ok", result };
}

export function analyzeProject(rootDir: string, opts?: { maxBytes?: number }): Analysis {
  const root = realpathSafe(rootDir);
  const io = createProjectReader(root, opts);
  const workspaceYaml = readWorkspaceYaml(io);
  const project = buildProjectModel(root, io, workspaceYaml.result);
  const config = buildNormalizedConfig(project, io, workspaceYaml);
  const lockfile = loadLockfileModel(project, io);
  return { project, config, lockfile, io };
}
