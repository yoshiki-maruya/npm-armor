// Adversarial-input behavior locked to the threat model (design §5.6, work
// order §6). Each case asserts the safe-side outcome, never a crash.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { analyzeProject } from "../src/detect/index.js";
import { makeSymlink, makeTempDir, removePath, writeTree } from "./helpers/fixture-io.js";

const basePackageJson = JSON.stringify({ name: "hostile", version: "1.0.0" });

test("T2: __proto__ / constructor keys in a lockfile do not pollute and still parse", () => {
  const tmp = makeTempDir();
  try {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "hostile" },
        "node_modules/ok": { resolved: "https://registry.npmjs.org/ok/-/ok-1.0.0.tgz" },
        "__proto__": { polluted: true, resolved: "https://registry.npmjs.org/p/-/p-1.0.0.tgz" },
        "node_modules/bad": { "__proto__": { polluted: true }, constructor: { prototype: { polluted: true } }, resolved: "https://registry.npmjs.org/bad/-/bad-1.0.0.tgz" },
      },
    });
    writeTree(tmp, { "package.json": basePackageJson, "package-lock.json": lock });
    const a = analyzeProject(tmp);
    assert.equal(({} as Record<string, unknown>)["polluted"], undefined, "prototype must not be polluted");
    assert.equal(a.lockfile.status, "ok");
    assert.deepEqual(a.lockfile.sources.map((s) => s.name).sort(), ["bad", "ok"]);
  } finally {
    removePath(tmp);
  }
});

test("T1: 10,000-deep nested lockfile JSON is undeterminable, not a crash", () => {
  const tmp = makeTempDir();
  try {
    const deep = `{"lockfileVersion": 3, "packages": ${"[".repeat(10_000)}${"]".repeat(10_000)}}`;
    writeTree(tmp, { "package.json": basePackageJson, "package-lock.json": deep });
    const a = analyzeProject(tmp);
    assert.equal(a.lockfile.status, "unparseable");
    assert.match(a.lockfile.reason ?? "", /depth/);
  } finally {
    removePath(tmp);
  }
});

test("YAML anchors in pnpm-workspace.yaml are unparseable (undeterminable), not OK", () => {
  const tmp = makeTempDir();
  try {
    writeTree(tmp, {
      "package.json": JSON.stringify({ name: "hostile", version: "1.0.0", packageManager: "pnpm@10.15.0" }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "pnpm-workspace.yaml": "minimumReleaseAge: &age 99999\n",
    });
    const a = analyzeProject(tmp);
    assert.equal(a.config.workspaceYamlStatus, "unparseable");
    assert.equal(a.config.cooldownUnparseable, true);
    assert.equal(a.config.cooldownMinutes, undefined);
  } finally {
    removePath(tmp);
  }
});

test("T6: .npmrc symlinked outside the repository is undeterminable, target never read", () => {
  const tmp = makeTempDir();
  const outside = makeTempDir("npm-armor-outside-");
  try {
    writeTree(outside, { "evil-npmrc": "min-release-age=9999\nignore-scripts=true\n" });
    writeTree(tmp, { "package.json": basePackageJson, "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }) });
    makeSymlink(path.join(outside, "evil-npmrc"), path.join(tmp, ".npmrc"));
    const a = analyzeProject(tmp);
    assert.equal(a.config.npmrcStatus, "unreadable");
    assert.match(a.config.npmrcIssue ?? "", /symlink/);
    assert.equal(a.config.cooldownMinutes, undefined, "symlinked config must not be trusted");
    assert.equal(a.config.lifecycleScripts, "unknown");
  } finally {
    removePath(tmp);
    removePath(outside);
  }
});

test("BOM + CRLF .npmrc parses; stray non-UTF-8 bytes do not crash", () => {
  const tmp = makeTempDir();
  try {
    const bomCrlf = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("min-release-age=2\r\nignore-scripts=true\r\n"),
    ]);
    writeTree(tmp, {
      "package.json": basePackageJson,
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
      ".npmrc": bomCrlf,
    });
    const a = analyzeProject(tmp);
    assert.equal(a.config.cooldownMinutes, 2 * 1440);
    assert.equal(a.config.lifecycleScripts, "blocked");
  } finally {
    removePath(tmp);
  }
});
