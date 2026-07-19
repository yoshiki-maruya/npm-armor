import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeProject } from "../src/detect/index.js";
import { runRules } from "../src/engine/index.js";
import type { RuleSettings } from "../src/engine/index.js";
import { formatMinutes, minutesToNpmDays, parseDurationToMinutes } from "../src/engine/duration.js";
import { isRootFileIgnored } from "../src/engine/gitignore.js";
import { classifyInstallCommand } from "../src/rules/ar005-ci-clean-install.js";
import { allRules } from "../src/rules/index.js";
import type { Finding, Rule } from "../src/model.js";
import { makeTempDir, removePath, writeTree } from "./helpers/fixture-io.js";

test("duration: parse and format round out", () => {
  assert.equal(parseDurationToMinutes("1440"), 1440);
  assert.equal(parseDurationToMinutes("24h"), 1440);
  assert.equal(parseDurationToMinutes("7d"), 10080);
  assert.equal(parseDurationToMinutes("30m"), 30);
  assert.equal(parseDurationToMinutes("soon"), undefined);
  assert.equal(parseDurationToMinutes("-1"), undefined);
  assert.equal(formatMinutes(10080), "7d");
  assert.equal(formatMinutes(90), "90m");
  assert.equal(minutesToNpmDays(1441), 2);
  assert.equal(minutesToNpmDays(1440), 1);
});

test("gitignore matcher: anchors, globs, negation, dir-only", () => {
  assert.equal(isRootFileIgnored("package-lock.json\n", "package-lock.json"), true);
  assert.equal(isRootFileIgnored("/package-lock.json\n", "package-lock.json"), true);
  assert.equal(isRootFileIgnored("*.json\n", "package-lock.json"), true);
  assert.equal(isRootFileIgnored("**/package-lock.json\n", "package-lock.json"), true);
  assert.equal(isRootFileIgnored("package-lock.json/\n", "package-lock.json"), false);
  assert.equal(isRootFileIgnored("# package-lock.json\n", "package-lock.json"), false);
  assert.equal(isRootFileIgnored("*.json\n!package-lock.json\n", "package-lock.json"), false);
  assert.equal(isRootFileIgnored("sub/package-lock.json\n", "package-lock.json"), false);
  assert.equal(isRootFileIgnored("pnpm-lock.yaml\n", "package-lock.json"), false);
  assert.equal(isRootFileIgnored("package-?ock.json\n", "package-lock.json"), true);
});

test("AR005 command classification", () => {
  assert.equal(classifyInstallCommand("npm ci"), "clean");
  assert.equal(classifyInstallCommand("npm ci --ignore-scripts"), "clean");
  assert.equal(classifyInstallCommand("CI=true npm install"), "unclean");
  assert.equal(classifyInstallCommand("npm i"), "unclean");
  assert.equal(classifyInstallCommand("npm install-ci-test"), "clean");
  assert.equal(classifyInstallCommand("npm init -y"), undefined);
  assert.equal(classifyInstallCommand("pnpm install --frozen-lockfile"), "clean");
  assert.equal(classifyInstallCommand("pnpm install"), "unclean");
  assert.equal(classifyInstallCommand("pnpm install --no-frozen-lockfile"), "unclean");
  assert.equal(classifyInstallCommand("pnpm test"), undefined);
  assert.equal(classifyInstallCommand("echo done"), undefined);
});

const baseProject = (extra: Record<string, string>): Record<string, string> => ({
  "package.json": JSON.stringify({ name: "t", version: "1.0.0" }),
  "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
  ...extra,
});

function runOn(files: Record<string, string>, settings?: RuleSettings): Finding[] {
  const tmp = makeTempDir();
  try {
    writeTree(tmp, files);
    return runRules(allRules, analyzeProject(tmp), settings);
  } finally {
    removePath(tmp);
  }
}

test("AR007: many bad sources aggregate into one finding per host/problem", () => {
  const packages: Record<string, unknown> = { "": { name: "t" } };
  for (let i = 0; i < 10; i++) {
    packages[`node_modules/pkg${i}`] = { resolved: `https://mirror.evil.example/pkg${i}.tgz`, integrity: "sha512-x" };
  }
  packages["node_modules/cred"] = { resolved: "https://user:pass@registry.npmjs.org/cred.tgz", integrity: "sha512-x" };
  packages["node_modules/noint"] = { resolved: "https://registry.npmjs.org/noint/-/noint-1.0.0.tgz" };
  const findings = runOn(
    baseProject({ "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages }) }),
  ).filter((f) => f.ruleId === "AR007");
  assert.equal(findings.length, 3);
  const messages = findings.map((f) => f.message).join("\n");
  assert.match(messages, /10 package\(s\) resolve from unallowed host mirror\.evil\.example/);
  assert.match(messages, /… \(10 total\)/);
  assert.match(messages, /embed credentials/);
  assert.match(messages, /lack an integrity hash/);
});

test("AR007: allowedHosts option admits private mirrors", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: { "node_modules/a": { resolved: "https://mirror.corp.example/a.tgz", integrity: "sha512-x" } },
  });
  const settings: RuleSettings = new Map([
    ["AR007", { enabled: true, options: { allowedHosts: ["mirror.corp.example"] } }],
  ]);
  const findings = runOn(baseProject({ "package-lock.json": lock }), settings).filter((f) => f.ruleId === "AR007");
  assert.deepEqual(findings, []);
});

test("AR001: min option changes the threshold", () => {
  const files = baseProject({ ".npmrc": "min-release-age=1\nignore-scripts=true\nallow-git=none\n", ".git/HEAD": "ref: x" });
  const strict: RuleSettings = new Map([["AR001", { enabled: true, options: { min: "7d" } }]]);
  assert.equal(runOn(files).filter((f) => f.ruleId === "AR001").length, 0);
  const findings = runOn(files, strict).filter((f) => f.ruleId === "AR001");
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /below the recommended minimum 7d/);
});

test("engine: a crashing rule becomes a warn finding, tool survives", () => {
  const bomb: Rule = {
    id: "AR999",
    meta: { name: "bomb", defaultSeverity: "error", docsSlug: "bomb", attackRefs: [], summary: "", explain: "" },
    check() {
      throw new Error("boom");
    },
  };
  const tmp = makeTempDir();
  try {
    writeTree(tmp, baseProject({}));
    const findings = runRules([bomb], analyzeProject(tmp));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warn");
    assert.match(findings[0]?.message ?? "", /internal error/);
    assert.equal(findings[0]?.detail?.["internalError"], true);
  } finally {
    removePath(tmp);
  }
});

test("engine: severity override and off", () => {
  const files = baseProject({ ".git/HEAD": "ref: x" }); // no cooldown configured -> AR001 error
  const asWarn: RuleSettings = new Map([["AR001", { enabled: true, severity: "warn", options: {} }]]);
  const off: RuleSettings = new Map([["AR001", { enabled: false, options: {} }]]);
  assert.equal(runOn(files).find((f) => f.ruleId === "AR001")?.severity, "error");
  assert.equal(runOn(files, asWarn).find((f) => f.ruleId === "AR001")?.severity, "warn");
  assert.equal(runOn(files, off).find((f) => f.ruleId === "AR001"), undefined);
});
