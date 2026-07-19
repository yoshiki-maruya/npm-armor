// E2E for `armor fix`: preview is read-only, --write patches minimally,
// constraints are surfaced, TOCTOU aborts, fixes converge.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { runCli } from "./helpers/cli.js";
import { fixtureProjectDir } from "./helpers/golden.js";
import { copyToTemp, fileExists, readFileRaw, removePath, writeTree } from "./helpers/fixture-io.js";
import { analyzeProject } from "../src/detect/index.js";
import { allRules } from "../src/rules/index.js";
import { computeFixPlans, mergePlans, writeChange } from "../src/fix/index.js";
import { IoError } from "../src/io/index.js";

test("preview shows a diff and constraints without touching files", () => {
  const dir = copyToTemp(fixtureProjectDir("npm-broken-single"));
  try {
    const before = readFileRaw(path.join(dir, ".npmrc"));
    const r = runCli(["fix", "--dir", dir]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /preview \(use --write to apply\)/);
    assert.match(r.stdout, /- min-release-age=soon/);
    assert.match(r.stdout, /\+ min-release-age=1/);
    assert.match(r.stdout, /- strict-ssl=false/);
    assert.match(r.stdout, /\+ strict-ssl=true/);
    assert.match(r.stdout, /constraints:/);
    assert.match(r.stdout, /npm >= 11\.10/);
    assert.equal(readFileRaw(path.join(dir, ".npmrc")), before, "preview must not modify files");
  } finally {
    removePath(dir);
  }
});

test("--write patches minimally, preserving comments and unrelated lines", () => {
  const dir = copyToTemp(fixtureProjectDir("npm-broken-single"));
  try {
    const r = runCli(["fix", "--dir", dir, "--write"]);
    assert.equal(r.status, 0);
    const npmrc = readFileRaw(path.join(dir, ".npmrc"));
    assert.match(npmrc, /^min-release-age=1$/m);
    assert.match(npmrc, /^strict-ssl=true$/m);
    // untouched lines survive verbatim
    assert.match(npmrc, /^script-shell=\/bin\/bash$/m);
    assert.match(npmrc, /^registry=http:\/\/registry\.evil\.example\/$/m);
    // git deps present -> allow-git must NOT be added (it would break install)
    assert.doesNotMatch(npmrc, /allow-git/);
  } finally {
    removePath(dir);
  }
});

test("--write on an unset npm project creates .npmrc with cooldown and allow-git", () => {
  const dir = copyToTemp(fixtureProjectDir("npm-unset-single"));
  try {
    assert.equal(fileExists(path.join(dir, ".npmrc")), false);
    const r = runCli(["fix", "--dir", dir, "--write"]);
    assert.equal(r.status, 0);
    const npmrc = readFileRaw(path.join(dir, ".npmrc"));
    assert.match(npmrc, /^min-release-age=1$/m);
    assert.match(npmrc, /^allow-git=none$/m);
    // and the fixable findings are gone
    const check = runCli(["check", "--dir", dir, "--format", "json"]);
    const doc = JSON.parse(check.stdout) as { findings: Array<{ ruleId: string }> };
    assert.equal(doc.findings.some((f) => f.ruleId === "AR001"), false);
    assert.equal(doc.findings.some((f) => f.ruleId === "AR003"), false);
  } finally {
    removePath(dir);
  }
});

test("--preset strict raises the cooldown target to 7d", () => {
  const npmDir = copyToTemp(fixtureProjectDir("npm-recommended-single"));
  const pnpmDir = copyToTemp(fixtureProjectDir("pnpm-recommended-single"));
  try {
    assert.match(runCli(["fix", "--dir", npmDir]).stdout, /nothing to fix/);
    const rNpm = runCli(["fix", "--dir", npmDir, "--preset", "strict", "--write"]);
    assert.equal(rNpm.status, 0);
    assert.match(readFileRaw(path.join(npmDir, ".npmrc")), /^min-release-age=7$/m);

    const rPnpm = runCli(["fix", "--dir", pnpmDir, "--preset", "strict", "--write"]);
    assert.equal(rPnpm.status, 0);
    assert.match(readFileRaw(path.join(pnpmDir, "pnpm-workspace.yaml")), /^minimumReleaseAge: 10080$/m);
  } finally {
    removePath(npmDir);
    removePath(pnpmDir);
  }
});

test("pnpm unset project gets a fresh pnpm-workspace.yaml", () => {
  const dir = copyToTemp(fixtureProjectDir("pnpm-unset-single"));
  try {
    const r = runCli(["fix", "--dir", dir, "--write"]);
    assert.equal(r.status, 0);
    assert.equal(readFileRaw(path.join(dir, "pnpm-workspace.yaml")), "minimumReleaseAge: 1440\n");
  } finally {
    removePath(dir);
  }
});

test("fix is idempotent: second run has nothing to do", () => {
  const dir = copyToTemp(fixtureProjectDir("npm-unset-single"));
  try {
    assert.equal(runCli(["fix", "--dir", dir, "--write"]).status, 0);
    const contents = readFileRaw(path.join(dir, ".npmrc"));
    const second = runCli(["fix", "--dir", dir, "--write"]);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /nothing to fix/);
    assert.equal(readFileRaw(path.join(dir, ".npmrc")), contents);
  } finally {
    removePath(dir);
  }
});

test("strengthen-only: stricter-than-recommended settings are never weakened", () => {
  const dir = copyToTemp(fixtureProjectDir("npm-stricter-single"));
  try {
    const before = readFileRaw(path.join(dir, ".npmrc"));
    const r = runCli(["fix", "--dir", dir, "--write"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /nothing to fix/);
    assert.equal(readFileRaw(path.join(dir, ".npmrc")), before);
  } finally {
    removePath(dir);
  }
});

test("--rule filters which fixes run", () => {
  const dir = copyToTemp(fixtureProjectDir("npm-broken-single"));
  try {
    const r = runCli(["fix", "--dir", dir, "--rule", "AR009", "--write"]);
    assert.equal(r.status, 0);
    const npmrc = readFileRaw(path.join(dir, ".npmrc"));
    assert.match(npmrc, /^strict-ssl=true$/m);
    assert.match(npmrc, /^min-release-age=soon$/m, "AR001 must not run when filtered out");
    assert.equal(runCli(["fix", "--dir", dir, "--rule", "nope"]).status, 2);
  } finally {
    removePath(dir);
  }
});

test("T7 TOCTOU: writeChange aborts when the file changed after analysis", () => {
  const dir = copyToTemp(fixtureProjectDir("npm-broken-single"));
  try {
    const analysis = analyzeProject(dir);
    const plans = computeFixPlans(allRules, analysis, undefined, "recommended");
    const changes = mergePlans(plans);
    assert.ok(changes.length > 0);
    // Someone edits .npmrc between analysis and write
    writeTree(dir, { ".npmrc": "min-release-age=soon\n# raced\n" });
    const target = changes.find((c) => c.file === ".npmrc");
    assert.ok(target !== undefined);
    let kind = "no-error";
    try {
      writeChange(analysis.project.root, target);
    } catch (e) {
      if (e instanceof IoError) kind = e.kind;
      else throw e;
    }
    assert.equal(kind, "changed");
    assert.equal(readFileRaw(path.join(dir, ".npmrc")), "min-release-age=soon\n# raced\n", "raced file must stay untouched");
  } finally {
    removePath(dir);
  }
});

test("fix never runs for rules disabled in config", () => {
  const dir = copyToTemp(fixtureProjectDir("npm-unset-single"));
  try {
    writeTree(dir, {
      "armor.config.json": JSON.stringify({ rules: { "cooldown-enabled": "off" } }),
    });
    const r = runCli(["fix", "--dir", dir, "--write"]);
    assert.equal(r.status, 0);
    const npmrc = readFileRaw(path.join(dir, ".npmrc"));
    assert.doesNotMatch(npmrc, /min-release-age/);
    assert.match(npmrc, /^allow-git=none$/m);
  } finally {
    removePath(dir);
  }
});
