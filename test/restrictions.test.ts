import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource, scanFiles, collectSourceFiles } from "../scripts/check-restrictions.mjs";
import { findRepoRoot, makeTempDir, writeTree, removePath } from "./helpers/fixture-io.js";

const rules = (fileName: string, source: string): string[] =>
  scanSource(fileName, source).map((v) => v.rule);

test("forbidden builtin imports are detected", () => {
  assert.deepEqual(rules("/r/src/a.ts", 'import { exec } from "node:child_process";'), ["forbidden-builtin"]);
  assert.deepEqual(rules("/r/src/a.ts", 'import http from "http";'), ["forbidden-builtin"]);
  assert.deepEqual(rules("/r/src/a.ts", 'import vm from "node:vm";'), ["forbidden-builtin"]);
  assert.deepEqual(rules("/r/src/a.ts", 'import { lookup } from "node:dns";'), ["forbidden-builtin"]);
  assert.deepEqual(rules("/r/src/a.ts", 'import { createRequire } from "node:module";'), ["forbidden-builtin"]);
  assert.deepEqual(rules("/r/src/a.ts", 'import w from "node:worker_threads";'), ["forbidden-builtin"]);
  assert.deepEqual(rules("/r/src/a.ts", 'import c from "node:crypto";'), ["forbidden-builtin"]);
});

test("bare dependencies are forbidden in src, typescript allowed in scripts only", () => {
  assert.deepEqual(rules("/r/src/a.ts", 'import _ from "lodash";'), ["forbidden-dependency"]);
  assert.deepEqual(rules("/r/src/a.ts", 'import ts from "typescript";'), ["forbidden-dependency"]);
  assert.deepEqual(rules("/r/scripts/x.mts", 'import ts from "typescript";'), []);
  assert.deepEqual(rules("/r/scripts/x.mts", 'import fc from "fast-check";'), ["forbidden-dependency"]);
});

test("fs imports are only allowed under src/io", () => {
  assert.deepEqual(rules("/r/src/rules/a.ts", 'import * as fs from "node:fs";'), ["fs-outside-io"]);
  assert.deepEqual(rules("/r/src/rules/a.ts", 'import { readFile } from "node:fs/promises";'), ["fs-outside-io"]);
  assert.deepEqual(rules("/r/scripts/x.mts", 'import * as fs from "node:fs";'), ["fs-outside-io"]);
  assert.deepEqual(rules("/r/src/io/fs.ts", 'import * as fs from "node:fs";'), []);
});

test("eval, new Function, require and import= are detected", () => {
  assert.deepEqual(rules("/r/src/a.ts", 'eval("1");'), ["eval"]);
  assert.deepEqual(rules("/r/src/a.ts", "const f = new Function('return 1');"), ["new-function"]);
  assert.deepEqual(rules("/r/src/a.ts", "const f = Function('return 1');"), ["new-function"]);
  assert.deepEqual(rules("/r/src/a.ts", 'globalThis.eval("1");'), ["eval"]);
  assert.deepEqual(rules("/r/src/a.ts", 'const m = require("x");'), ["require"]);
  assert.deepEqual(rules("/r/src/a.ts", 'import x = require("x");'), ["forbidden-syntax"]);
});

test("network globals are detected", () => {
  assert.deepEqual(rules("/r/src/a.ts", 'await fetch("https://example.com");'), ["network-global"]);
  assert.deepEqual(rules("/r/src/a.ts", "new WebSocket('wss://x');"), ["network-global"]);
  assert.deepEqual(rules("/r/src/a.ts", "new XMLHttpRequest();"), ["network-global"]);
});

test("dynamic import: literal specifiers are checked, non-literal are rejected", () => {
  assert.deepEqual(rules("/r/src/a.ts", 'await import("./ok.js");'), []);
  assert.deepEqual(rules("/r/src/a.ts", 'await import("node:child_process");'), ["forbidden-builtin"]);
  assert.deepEqual(rules("/r/src/a.ts", 'await import("./" + name);'), ["dynamic-import"]);
});

test("process.env access is restricted to NO_COLOR / FORCE_COLOR / CI", () => {
  assert.deepEqual(rules("/r/src/a.ts", "const c = process.env.NO_COLOR;"), []);
  assert.deepEqual(rules("/r/src/a.ts", "const c = process.env.FORCE_COLOR;"), []);
  assert.deepEqual(rules("/r/src/a.ts", "const c = process.env.CI;"), []);
  assert.deepEqual(rules("/r/src/a.ts", "const c = process.env.PATH;"), ["env-access"]);
  assert.deepEqual(rules("/r/src/a.ts", 'const c = process.env["HOME"];'), ["env-access"]);
  assert.deepEqual(rules("/r/src/a.ts", 'const c = process.env["CI"];'), []);
  assert.deepEqual(rules("/r/src/a.ts", "const k = 'X'; const c = process.env[k];"), ["env-access"]);
  assert.deepEqual(rules("/r/src/a.ts", "const e = process.env;"), ["env-access"]);
  assert.deepEqual(rules("/r/src/a.ts", "const e = globalThis.process.env;"), ["env-access"]);
});

test("atomicWrite is only referenceable from src/io and src/fix", () => {
  const importLine = 'import { atomicWrite } from "../io/write.js";';
  assert.ok(rules("/r/src/rules/a.ts", importLine).includes("atomic-write"));
  assert.deepEqual(rules("/r/src/fix/apply.ts", importLine), []);
  assert.deepEqual(rules("/r/src/io/index.ts", 'export { atomicWrite } from "./write.js";'), []);
  assert.ok(rules("/r/src/report/tty.ts", "io.atomicWrite('x', 'y');").includes("atomic-write"));
});

test("clean files produce no violations", () => {
  const clean = [
    'import * as path from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "export const x = path.sep + fileURLToPath(import.meta.url);",
  ].join("\n");
  assert.deepEqual(rules("/r/src/a.ts", clean), []);
});

test("a planted violating file fails the scan and its removal restores green", () => {
  const tmp = makeTempDir();
  try {
    writeTree(tmp, { "src/bad.ts": 'import { exec } from "node:child_process";\nexport const e = exec;\n' });
    const files = collectSourceFiles(tmp);
    assert.equal(files.length, 1);
    const violations = scanFiles(files);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, "forbidden-builtin");

    removePath(path.join(tmp, "src", "bad.ts"));
    const after = collectSourceFiles(tmp);
    assert.deepEqual(after, []);
    assert.deepEqual(scanFiles(after), []);
  } finally {
    removePath(tmp);
  }
});

test("self-scan: the real repository has zero violations", () => {
  const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const files = collectSourceFiles(repoRoot);
  assert.ok(files.length > 0, "expected to find source files in the repo");
  assert.deepEqual(scanFiles(files), []);
});
