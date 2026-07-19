// PM-specific settings → NormalizedConfig. Rules only ever see this model;
// dialect differences (key names, units, file locations) end here (design §3.2).
import type { ReadOnlyFileAccess } from "../io/index.js";
import { isIoError } from "../io/index.js";
import { isEnvReference, npmrcGet, npmrcGetBool, parseNpmrc } from "../adapters/npmrc.js";
import type { NpmrcData } from "../adapters/npmrc.js";
import type { YamlSubsetResult } from "../adapters/yaml-subset.js";
import type {
  FileStatus,
  NormalizedConfig,
  NpmrcDanger,
  ProjectModel,
} from "../model.js";

export const DEFAULT_REGISTRY_HOSTS = ["registry.npmjs.org"];

const MINUTES_PER_DAY = 1440;

function isDefaultRegistry(value: string): boolean {
  const v = value.trim().toLowerCase().replace(/\/+$/, "");
  return v === "https://registry.npmjs.org";
}

const AUTH_KEY_TAILS = new Set(["-auth", "-authtoken", "-password"]);

export function scanNpmrcDangers(data: NpmrcData): NpmrcDanger[] {
  const dangers: NpmrcDanger[] = [];
  for (const e of data.entries) {
    if (e.normKey === "registry" || e.normKey.endsWith(":registry")) {
      if (!isDefaultRegistry(e.value)) {
        dangers.push({ key: e.key, kind: "registry-override", line: e.line });
      }
      continue;
    }
    if (e.normKey === "strict-ssl" && e.value.toLowerCase() === "false") {
      dangers.push({ key: e.key, kind: "ssl-off", line: e.line });
      continue;
    }
    if (e.normKey === "script-shell") {
      dangers.push({ key: e.key, kind: "script-shell", line: e.line });
      continue;
    }
    const tail = e.normKey.includes(":") ? e.normKey.slice(e.normKey.lastIndexOf(":") + 1) : e.normKey;
    if (AUTH_KEY_TAILS.has(tail) && !isEnvReference(e.value)) {
      dangers.push({ key: e.key, kind: "inline-token", line: e.line });
    }
  }
  return dangers;
}

interface NpmrcRead {
  status: FileStatus;
  issue?: string;
  data?: NpmrcData;
}

function readNpmrc(io: ReadOnlyFileAccess): NpmrcRead {
  let text: string;
  try {
    text = io.readTextFile(".npmrc");
  } catch (e) {
    if (isIoError(e)) {
      if (e.kind === "not-found") return { status: "missing" };
      return { status: "unreadable", issue: `${e.kind}: ${e.message}` };
    }
    throw e;
  }
  return { status: "ok", data: parseNpmrc(text) };
}

function parseCooldownScalar(raw: string): { minutes?: number; unparseable?: boolean } {
  const v = raw.trim();
  if (/^\d+$/.test(v)) return { minutes: Number(v) };
  return { unparseable: true };
}

function pnpmMajor(project: ProjectModel): number | undefined {
  if (project.pm !== "pnpm" || project.pmVersion === undefined) return undefined;
  const m = /^(\d+)/.exec(project.pmVersion);
  return m === null ? undefined : Number(m[1]);
}

export function buildNormalizedConfig(
  project: ProjectModel,
  io: ReadOnlyFileAccess,
  workspaceYaml: { status: FileStatus; issue?: string; result?: YamlSubsetResult },
): NormalizedConfig {
  const npmrc = readNpmrc(io);
  const config: NormalizedConfig = {
    lifecycleScripts: "unknown",
    gitDepsPolicy: "unknown",
    npmrcDangers: npmrc.data !== undefined ? scanNpmrcDangers(npmrc.data) : [],
    npmrcStatus: npmrc.status,
    workspaceYamlStatus: project.pm === "pnpm" ? workspaceYaml.status : "not-applicable",
  };
  if (npmrc.issue !== undefined) config.npmrcIssue = npmrc.issue;
  if (project.pm === "pnpm" && workspaceYaml.issue !== undefined) {
    config.workspaceYamlIssue = workspaceYaml.issue;
  }

  const npmrcData = npmrc.data;
  const npmrcUsable = npmrc.status === "ok" || npmrc.status === "missing";

  // save-exact: honored by both npm and pnpm via .npmrc
  if (npmrcData !== undefined) {
    const se = npmrcGetBool(npmrcData, "save-exact");
    if (se !== undefined) config.saveExact = se;
  }

  if (project.pm === "npm") {
    // --- cooldown: .npmrc min-release-age, unit days -> minutes ---
    if (npmrcData !== undefined) {
      const entry = npmrcGet(npmrcData, "min-release-age");
      if (entry !== undefined) {
        const c = parseCooldownScalar(entry.value);
        if (c.minutes !== undefined) config.cooldownMinutes = c.minutes * MINUTES_PER_DAY;
        if (c.unparseable === true) config.cooldownUnparseable = true;
      }
    }
    // --- lifecycle scripts: ignore-scripts (npm default: scripts run) ---
    if (npmrcUsable) {
      const ig = npmrcData !== undefined ? npmrcGetBool(npmrcData, "ignore-scripts") : undefined;
      if (ig === true) config.lifecycleScripts = "blocked";
      else if (ig === false || npmrcData === undefined || npmrcGet(npmrcData, "ignore-scripts") === undefined) {
        config.lifecycleScripts = "allowed";
      }
    }
    // --- git deps: allow-git (npm >= 11.10) ---
    if (npmrcUsable) {
      const ag = npmrcData !== undefined ? npmrcGet(npmrcData, "allow-git") : undefined;
      config.gitDepsPolicy = ag !== undefined && ag.value.trim().toLowerCase() === "none"
        ? "none-allowed"
        : "unrestricted";
    }
    return config;
  }

  if (project.pm === "pnpm") {
    // --- cooldown: pnpm-workspace.yaml minimumReleaseAge, unit minutes ---
    const yaml = workspaceYaml.result;
    if (workspaceYaml.status === "unparseable" || workspaceYaml.status === "unreadable") {
      config.cooldownUnparseable = true;
    } else if (yaml !== undefined && yaml.kind === "ok") {
      const age = yaml.data.get("minimumReleaseAge");
      if (typeof age === "string") {
        const c = parseCooldownScalar(age);
        if (c.minutes !== undefined) config.cooldownMinutes = c.minutes;
        if (c.unparseable === true) config.cooldownUnparseable = true;
      }
      const exclude = yaml.data.get("minimumReleaseAgeExclude");
      if (Array.isArray(exclude) && exclude.length > 0) config.cooldownExclude = exclude;
    }

    // --- lifecycle scripts ---
    const yamlOk = yaml !== undefined && yaml.kind === "ok" ? yaml.data : undefined;
    const dangerouslyAll = yamlOk?.get("dangerouslyAllowAllBuilds");
    const allowlist = yamlOk?.get("onlyBuiltDependencies");
    const ig = npmrcData !== undefined ? npmrcGetBool(npmrcData, "ignore-scripts") : undefined;
    const major = pnpmMajor(project);
    if (workspaceYaml.status === "unparseable" || workspaceYaml.status === "unreadable" || !npmrcUsable) {
      config.lifecycleScripts = "unknown";
    } else if (dangerouslyAll === "true") {
      config.lifecycleScripts = "allowed";
    } else if (ig === true) {
      config.lifecycleScripts = "blocked";
    } else if (Array.isArray(allowlist)) {
      config.lifecycleScripts = "allowlisted";
      config.scriptAllowlist = allowlist;
    } else if (major !== undefined && major >= 10) {
      config.lifecycleScripts = "blocked"; // pnpm 10+ blocks dependency scripts by default
    } else {
      config.lifecycleScripts = "unknown"; // pnpm version unknown — cannot assume the default
    }

    // pnpm has no allow-git equivalent; git deps are judged from the lockfile alone
    config.gitDepsPolicy = "unrestricted";
    return config;
  }

  return config; // pm unknown: everything stays "unknown"/defaults
}
