import type { Finding, LockfileSource, Rule, RuleContext } from "../model.js";
import { exampleList, finding, stringArrayOption } from "./util.js";

export const DEFAULT_ALLOWED_HOSTS = ["registry.npmjs.org"];

interface Group {
  severity: "error" | "warn";
  message: (names: string[], count: number) => string;
  names: string[];
}

export const ar007: Rule = {
  id: "AR007",
  meta: {
    name: "lockfile-trusted-sources",
    defaultSeverity: "error",
    docsSlug: "lockfile-trusted-sources",
    attackRefs: ["lockfile-poisoning"],
    summary: "Every lockfile source URL is https and from an allowed registry",
    explain: [
      "Lockfiles are reviewed as opaque blobs, which makes them a perfect",
      "hiding place: one edited `resolved` URL redirects a single package to",
      "an attacker-controlled server while everything else keeps installing",
      "normally (lockfile poisoning). Http URLs additionally allow on-path",
      "tampering at install time.",
      "",
      "This rule verifies every source URL in package-lock.json /",
      "pnpm-lock.yaml: https only, host within the allowlist (default:",
      "registry.npmjs.org — extend with the allowedHosts option for private",
      "mirrors), no embedded credentials, and integrity hashes present.",
      "Git-sourced packages are judged by AR003, not here.",
      "",
      "No auto-fix on purpose: a poisoned lockfile means the dependency tree",
      "itself is suspect. Delete the lockfile and regenerate it from a",
      "trusted registry, then diff the result.",
    ].join("\n"),
  },

  check(ctx: RuleContext): Finding[] {
    const { lockfile } = ctx;
    if (lockfile.status === "missing") return []; // AR004 reports this
    const allowedHosts = new Set(
      [...DEFAULT_ALLOWED_HOSTS, ...stringArrayOption(ctx.options, "allowedHosts")].map((h) => h.toLowerCase()),
    );

    const findings: Finding[] = [];
    if (lockfile.status === "unparseable") {
      findings.push(
        finding(this, "warn", `lockfile cannot be fully interpreted (${lockfile.reason ?? "unknown reason"}); source URLs are undeterminable`),
      );
    }

    const groups = new Map<string, Group>();
    const add = (key: string, group: Omit<Group, "names">, source: LockfileSource): void => {
      const existing = groups.get(key);
      const name = source.name ?? source.url;
      if (existing === undefined) groups.set(key, { ...group, names: [name] });
      else existing.names.push(name);
    };

    for (const s of lockfile.sources) {
      if (s.kind === "git") continue; // AR003's domain
      if (s.kind === "file") {
        add("file", { severity: "warn", message: (n, c) => `${c} package(s) resolve to local file/link sources (${exampleList(n)}) — these bypass the registry entirely` }, s);
        continue;
      }
      if (s.kind === "other") {
        add("other", { severity: "warn", message: (n, c) => `${c} package(s) have unrecognized source URLs (${exampleList(n)})` }, s);
        continue;
      }
      let url: URL;
      try {
        url = new URL(s.url);
      } catch {
        add("invalid", { severity: "warn", message: (n, c) => `${c} package(s) have invalid source URLs (${exampleList(n)})` }, s);
        continue;
      }
      if (url.username !== "" || url.password !== "") {
        add("credentials", { severity: "error", message: (n, c) => `${c} package(s) embed credentials in their source URL (${exampleList(n)})` }, s);
        continue;
      }
      if (url.protocol === "http:") {
        add(`http|${url.hostname}`, { severity: "error", message: (n, c) => `${c} package(s) resolve over insecure http from ${url.hostname} (${exampleList(n)})` }, s);
        continue;
      }
      if (!allowedHosts.has(url.hostname.toLowerCase())) {
        add(`host|${url.hostname}`, { severity: "error", message: (n, c) => `${c} package(s) resolve from unallowed host ${url.hostname} (${exampleList(n)})` }, s);
        continue;
      }
      if (s.integrity === undefined || s.integrity === "") {
        add("integrity", { severity: "warn", message: (n, c) => `${c} package(s) lack an integrity hash (${exampleList(n)})` }, s);
      }
    }

    for (const [, g] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      findings.push(
        finding(this, g.severity, g.message(g.names, g.names.length), {
          ...(lockfile.file !== undefined ? { file: lockfile.file } : {}),
          detail: { count: g.names.length },
        }),
      );
    }
    return findings;
  },
};
