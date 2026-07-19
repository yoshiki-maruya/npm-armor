// E2E: exit codes and output are stability contracts (design §4.1/§5.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { runCli } from "./helpers/cli.js";
import { fixtureProjectDir } from "./helpers/golden.js";
import { makeTempDir, removePath, writeTree } from "./helpers/fixture-io.js";

test("exit 0 + clean report for a recommended project", () => {
  const r = runCli(["check", "--dir", fixtureProjectDir("npm-recommended-single")]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /all checks passed \(8 rules\)/);
});

test("exit 1 + findings for a broken project (tty)", () => {
  const r = runCli(["check", "--dir", fixtureProjectDir("npm-broken-single")]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /AR001 cooldown-enabled/);
  assert.match(r.stdout, /AR009 npmrc-integrity/);
  assert.match(r.stdout, /error\(s\)/);
});

test("json format: schemaVersion 1 and stable shape", () => {
  const r = runCli(["check", "--dir", fixtureProjectDir("npm-broken-single"), "--format", "json"]);
  assert.equal(r.status, 1);
  const doc = JSON.parse(r.stdout) as {
    schemaVersion: number;
    tool: { name: string; version: string };
    packageManager: string;
    findings: Array<{ ruleId: string; severity: string; fixable: boolean }>;
    summary: Record<string, number>;
    notices: string[];
  };
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.tool.name, "npm-armor");
  assert.equal(doc.packageManager, "npm");
  assert.ok(doc.findings.length > 0);
  assert.ok(doc.summary["error"] !== undefined && doc.summary["error"] > 0);
});

test("exit 2 for a missing directory and for unknown flags/commands", () => {
  assert.equal(runCli(["check", "--dir", "/nonexistent/nowhere"]).status, 2);
  assert.equal(runCli(["check", "--bogus"]).status, 2);
  assert.equal(runCli(["frobnicate"]).status, 2);
});

test("exit 3 for invalid configuration", () => {
  const tmp = makeTempDir();
  try {
    writeTree(tmp, {
      "package.json": JSON.stringify({ name: "t", version: "1.0.0" }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
      "armor.config.json": JSON.stringify({ rules: { "no-such-rule": "error" } }),
    });
    const r = runCli(["check", "--dir", tmp]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /unknown rule/);

    writeTree(tmp, { "armor.config.json": JSON.stringify({ ruleset: "recommended@99" }) });
    assert.equal(runCli(["check", "--dir", tmp]).status, 3);

    writeTree(tmp, { "armor.config.json": "{not json" });
    assert.equal(runCli(["check", "--dir", tmp]).status, 3);
  } finally {
    removePath(tmp);
  }
});

test("config can silence and reconfigure rules", () => {
  const tmp = makeTempDir();
  try {
    writeTree(tmp, {
      "package.json": JSON.stringify({ name: "t", version: "1.0.0" }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
      ".git/HEAD": "ref: refs/heads/main\n",
      "armor.config.json": JSON.stringify({
        ruleset: "recommended@1",
        rules: {
          "cooldown-enabled": "off",
          "lifecycle-scripts-restricted": "warn",
          "git-deps-restricted": "off",
        },
      }),
    });
    const r = runCli(["check", "--dir", tmp, "--format", "json"]);
    const doc = JSON.parse(r.stdout) as { findings: Array<{ ruleId: string; severity: string }> };
    assert.equal(doc.findings.some((f) => f.ruleId === "AR001"), false);
    assert.equal(doc.findings.find((f) => f.ruleId === "AR002")?.severity, "warn");
    assert.equal(r.status, 0, "with AR002 downgraded to warn there are no errors left");
  } finally {
    removePath(tmp);
  }
});

test("T11: armor.config.js is ignored with a notice, JSON defaults still apply", () => {
  const tmp = makeTempDir();
  try {
    writeTree(tmp, {
      "package.json": JSON.stringify({ name: "t", version: "1.0.0" }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
      "armor.config.js": "module.exports = { rules: {} };",
    });
    const r = runCli(["check", "--dir", tmp, "--format", "json"]);
    const doc = JSON.parse(r.stdout) as { notices: string[] };
    assert.equal(doc.notices.length, 1);
    assert.match(doc.notices[0] ?? "", /armor\.config\.js is ignored/);
    const tty = runCli(["check", "--dir", tmp]);
    assert.match(tty.stdout, /note: armor\.config\.js is ignored/);
  } finally {
    removePath(tmp);
  }
});

test("T4/T5: hostile package names cannot inject control bytes into any output", () => {
  const tmp = makeTempDir();
  try {
    const evilName = "node_modules/evil\u001b[2J\u0007\r\npkg";
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        [evilName]: { resolved: "https://bad\u001b.example/x.tgz", integrity: "sha512-x" },
      },
    });
    writeTree(tmp, {
      "package.json": JSON.stringify({ name: "t", version: "1.0.0" }),
      "package-lock.json": lock,
    });
    for (const format of ["tty", "json"]) {
      const r = runCli(["check", "--dir", tmp, "--format", format]);
      assert.doesNotMatch(r.stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/, `${format} output must contain no control bytes`);
    }
  } finally {
    removePath(tmp);
  }
});

test("rules / rules --json / explain", () => {
  const rules = runCli(["rules"]);
  assert.equal(rules.status, 0);
  assert.match(rules.stdout, /AR001 {2}cooldown-enabled/);
  assert.match(rules.stdout, /ruleset: recommended@1/);

  const json = runCli(["rules", "--json"]);
  const doc = JSON.parse(json.stdout) as { schemaVersion: number; rules: Array<{ id: string }> };
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.rules.length, 8);

  const explain = runCli(["explain", "AR001"]);
  assert.equal(explain.status, 0);
  assert.match(explain.stdout, /min-release-age/);
  assert.equal(runCli(["explain", "cooldown-enabled"]).status, 0);
  assert.equal(runCli(["explain", "AR404"]).status, 2);
});

test("--version prints name and version; --help exits 0; bare invocation exits 2", () => {
  const v = runCli(["--version"]);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /^npm-armor \d+\.\d+\.\d+/);
  assert.equal(runCli(["--help"]).status, 0);
  assert.equal(runCli([]).status, 2);
});

test("check --dir works from any cwd and reports pnpm fixtures too", () => {
  const r = runCli(["check", "--dir", fixtureProjectDir("pnpm-broken-single"), "--format", "json"], {
    cwd: path.parse(process.cwd()).root,
  });
  assert.equal(r.status, 1);
  const doc = JSON.parse(r.stdout) as { packageManager: string };
  assert.equal(doc.packageManager, "pnpm");
});
