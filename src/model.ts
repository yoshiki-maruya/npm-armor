// Shared contracts (work order §3). Exit codes, JSON schema and rule IDs are
// stability contracts (design §5.5); the additive fields beyond the work-order
// skeleton are marked below and never weaken that contract.
import type { ReadOnlyFileAccess } from "./io/index.js";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string; // raw text — reporters MUST sanitize before display
  file?: string; // project-root-relative path
  fixable: boolean;
  detail?: Record<string, string | number | boolean>;
}

export type PackageManager = "npm" | "pnpm" | "unknown";

export interface ProjectModel {
  root: string; // realpath'ed
  pm: PackageManager;
  lockfiles: string[]; // every lockfile found (for AR010)
  workspaces: string[]; // workspace-relative paths for monorepos
  packageManagerField?: string;
  // -- additive detail --
  pmVersion?: string; // parsed from packageManager field
  packageJsonStatus: "ok" | "missing" | "unparseable";
}

export type LifecyclePolicy = "blocked" | "allowlisted" | "allowed" | "unknown";
export type GitDepsPolicy = "none-allowed" | "unrestricted" | "unknown";
export type NpmrcDangerKind = "registry-override" | "ssl-off" | "script-shell" | "inline-token";

export interface NpmrcDanger {
  key: string;
  kind: NpmrcDangerKind;
  line: number; // 1-based line in .npmrc, for fix anchoring
  value?: string; // recorded for non-secret kinds only (registry URL, shell path)
}

export type FileStatus = "ok" | "missing" | "unreadable" | "unparseable" | "not-applicable";

export interface NormalizedConfig {
  cooldownMinutes?: number; // undefined = not set
  cooldownUnparseable?: boolean;
  cooldownExclude?: string[];
  lifecycleScripts: LifecyclePolicy;
  scriptAllowlist?: string[];
  gitDepsPolicy: GitDepsPolicy;
  saveExact?: boolean;
  npmrcDangers: NpmrcDanger[];
  // -- additive detail so rules can distinguish "not set" from "undeterminable" --
  npmrcStatus: FileStatus;
  npmrcIssue?: string;
  workspaceYamlStatus: FileStatus;
  workspaceYamlIssue?: string;
}

export type LockfileSourceKind = "registry-tarball" | "git" | "file" | "other";

export interface LockfileSource {
  file: string; // which lockfile this came from (root-relative)
  name?: string; // best-effort package name (hostile input — sanitize on output)
  url: string;
  kind: LockfileSourceKind;
  integrity?: string;
}

export interface LockfileModel {
  status: "ok" | "missing" | "unparseable";
  file?: string;
  reason?: string;
  sources: LockfileSource[];
}

export interface RuleContext {
  readonly project: ProjectModel;
  readonly config: NormalizedConfig;
  readonly lockfile: LockfileModel; // additive: parsed once, shared by AR003/AR007
  readonly io: ReadOnlyFileAccess;
  readonly options: Record<string, unknown>; // per-rule options from armor.config.json
}

export interface PatchEdit {
  op: "insert-line" | "replace-line";
  anchor?: string; // exact current line for replace-line / insertion point
  newLine: string;
}

export interface PatchPlan {
  file: string;
  edits: PatchEdit[];
  constraints: string[]; // user-facing caveats, e.g. "npm has no exclude-list equivalent"
  createIfMissing?: boolean;
}

export interface RuleMeta {
  name: string; // "cooldown-enabled" style
  defaultSeverity: Severity;
  docsSlug: string;
  attackRefs: string[];
  summary: string; // one-line description for `armor rules`
  explain: string; // long-form text for `armor explain` (docs/rules mirrors this)
}

export interface Rule {
  id: string; // "AR001" style — stable contract
  meta: RuleMeta;
  check(ctx: RuleContext): Finding[];
  fix?(ctx: RuleContext): PatchPlan | null;
}

export function classifySourceUrl(url: string): LockfileSourceKind {
  const u = url.trim().toLowerCase();
  if (
    u.startsWith("git+") ||
    u.startsWith("git://") ||
    u.startsWith("git@") ||
    u.startsWith("github:") ||
    u.startsWith("gitlab:") ||
    u.startsWith("bitbucket:") ||
    u.startsWith("ssh://")
  ) {
    return "git";
  }
  if (u.startsWith("file:") || u.startsWith("link:") || u.startsWith("portal:")) return "file";
  if (u.startsWith("http://") || u.startsWith("https://")) return "registry-tarball";
  return "other";
}
