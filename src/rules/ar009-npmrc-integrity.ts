import type { Finding, NpmrcDanger, PatchPlan, Rule, RuleContext } from "../model.js";
import { parseNpmrc } from "../adapters/npmrc.js";
import { finding } from "./util.js";

export const ar009: Rule = {
  id: "AR009",
  meta: {
    name: "npmrc-integrity",
    defaultSeverity: "error",
    docsSlug: "npmrc-integrity",
    attackRefs: ["project-npmrc-abuse"],
    summary: "The project .npmrc contains no dangerous settings or plaintext credentials",
    explain: [
      "A project-level .npmrc travels with the repository, so anyone who can",
      "land a commit — or a git dependency, see AR003 — can change how your",
      "package manager behaves on every machine that clones it. Four settings",
      "turn it into an attack vector:",
      "",
      "- registry / @scope:registry overrides redirect installs to an",
      "  attacker-controlled server;",
      "- strict-ssl=false disables TLS verification, enabling on-path",
      "  tampering;",
      "- script-shell swaps the interpreter that runs lifecycle scripts;",
      "- plaintext _authToken/_auth/_password values leak credentials to",
      "  everyone with repo access (use ${ENV_VAR} references instead, and",
      "  revoke any token that was ever committed).",
      "",
      "`armor fix` repairs strict-ssl=false (to true). Registry overrides and",
      "credentials are reported only: a legitimate corporate mirror should be",
      "acknowledged via this rule's options, and a leaked token must be",
      "revoked by a human, not edited away.",
    ].join("\n"),
  },

  check(ctx: RuleContext): Finding[] {
    const { config } = ctx;
    if (config.npmrcStatus === "unreadable") {
      return [
        finding(this, "warn", `.npmrc cannot be read (${config.npmrcIssue ?? "unknown reason"}); its integrity is undeterminable`, { file: ".npmrc" }),
      ];
    }
    if (config.npmrcStatus === "missing") return [];

    const findings: Finding[] = [];
    for (const danger of config.npmrcDangers) {
      findings.push(dangerFinding(this, danger));
    }
    return findings;
  },

  // Partial fix (M1): only strict-ssl=false is repaired. Registry overrides
  // may be legitimate mirrors, and a leaked token must be revoked by a human.
  fix(ctx: RuleContext): PatchPlan | null {
    const { config } = ctx;
    if (config.npmrcStatus !== "ok") return null;
    const sslDangers = config.npmrcDangers.filter((d) => d.kind === "ssl-off");
    if (sslDangers.length === 0) return null;

    let text: string;
    try {
      text = ctx.io.readTextFile(".npmrc");
    } catch {
      return null;
    }
    const lines = parseNpmrc(text).lines;
    const edits: PatchPlan["edits"] = [];
    for (const d of sslDangers) {
      const anchor = lines[d.line - 1];
      if (anchor === undefined) return null; // model out of sync with file — abort, never guess
      edits.push({ op: "replace-line", anchor, newLine: "strict-ssl=true" });
    }
    return {
      file: ".npmrc",
      edits,
      constraints: [
        "registry overrides and plaintext credentials are reported but not auto-fixed — review them manually",
      ],
      baseContent: text,
    };
  },
};

function dangerFinding(rule: Rule, danger: NpmrcDanger): Finding {
  switch (danger.kind) {
    case "registry-override":
      return finding(rule, "error", `registry override in .npmrc: ${danger.key}=${danger.value ?? ""} — installs are redirected away from the default registry`, {
        file: ".npmrc",
        detail: { line: danger.line, key: danger.key },
      });
    case "ssl-off":
      return finding(rule, "error", "strict-ssl=false in .npmrc disables TLS verification for registry traffic", {
        file: ".npmrc",
        fixable: true,
        detail: { line: danger.line, key: danger.key },
      });
    case "script-shell":
      return finding(rule, "error", `script-shell is overridden in .npmrc (${danger.value ?? ""}) — lifecycle scripts run under a non-default interpreter`, {
        file: ".npmrc",
        detail: { line: danger.line, key: danger.key },
      });
    case "inline-token":
      return finding(rule, "error", `plaintext credential in .npmrc (key: ${danger.key}) — revoke it and reference an environment variable like \${NPM_TOKEN} instead`, {
        file: ".npmrc",
        detail: { line: danger.line, key: danger.key },
      });
  }
}
