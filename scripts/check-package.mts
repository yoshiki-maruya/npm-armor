#!/usr/bin/env node
// Package-content allowlist check (design §5.2): what npm pack would publish
// must be exactly dist/**/*.js + dist/**/*.d.ts, package.json, README.md and
// LICENSE — nothing else — with no lifecycle scripts, no dependencies, and
// within the size budget. Implemented without running npm (zero-exec applies
// to this repo's own tooling too); reads go through the built io layer.
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { listDir, lstatSafe, readTextFile } from "../build/src/io/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures: string[] = [];

// --- package.json invariants ---------------------------------------------
const pkg = JSON.parse(readTextFile(path.join(repoRoot, "package.json"))) as {
  name?: string;
  files?: string[];
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
};

if (pkg.dependencies !== undefined && Object.keys(pkg.dependencies).length > 0) {
  failures.push(`dependencies must be empty, found: ${Object.keys(pkg.dependencies).join(", ")}`);
}
const LIFECYCLE = [
  "preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare",
  "prepack", "postpack", "prepublishOnly", "publish", "postpublish",
];
for (const s of Object.keys(pkg.scripts ?? {})) {
  if (LIFECYCLE.includes(s)) failures.push(`lifecycle script must not exist: ${s}`);
}
if (JSON.stringify(pkg.files) !== JSON.stringify(["dist"])) {
  failures.push(`files must be exactly ["dist"], found ${JSON.stringify(pkg.files)}`);
}
if (pkg.bin === undefined || Object.keys(pkg.bin).length !== 1) {
  failures.push("exactly one bin entry is required");
}
const binTarget = Object.values(pkg.bin ?? {})[0];
if (binTarget !== "dist/bin/armor.js") {
  failures.push(`bin must point into dist, found ${String(binTarget)}`);
}

// --- dist content allowlist ----------------------------------------------
const SIZE_BUDGET = 300 * 1024;
// Design §5.4 sketched "< 40 files", but §3.1 mandates one module per rule /
// adapter / reporter, which alone exceeds that. The hard M1 gate (DoD #9) is
// the 300KB unpacked budget; the count guard below still catches accidental
// bloat. Flagged for human review in the M1 report.
const FILE_COUNT_BUDGET = 60;
const ALLOWED_DIST = /\.js$/; // declarations are not published (CLI, not a library)

let totalBytes = 0;
let fileCount = 0;

function walk(rel: string): void {
  for (const entry of listDir(path.join(repoRoot, rel))) {
    const relPath = `${rel}/${entry.name}`;
    if (entry.kind === "dir") {
      walk(relPath);
      continue;
    }
    if (entry.kind !== "file") {
      failures.push(`unexpected non-file in package: ${relPath} (${entry.kind})`);
      continue;
    }
    if (!ALLOWED_DIST.test(entry.name)) {
      failures.push(`unexpected file in dist (allowlist: *.js, *.d.ts): ${relPath}`);
    }
    totalBytes += lstatSafe(path.join(repoRoot, relPath))?.size ?? 0;
    fileCount += 1;
  }
}

if (lstatSafe(path.join(repoRoot, "dist"))?.kind !== "dir") {
  failures.push("dist/ not found — run npm run build first");
} else {
  walk("dist");
}

for (const req of ["README.md", "LICENSE"]) {
  if (lstatSafe(path.join(repoRoot, req))?.kind !== "file") {
    failures.push(`${req} is required in the package`);
  } else {
    totalBytes += lstatSafe(path.join(repoRoot, req))?.size ?? 0;
    fileCount += 1;
  }
}
totalBytes += lstatSafe(path.join(repoRoot, "package.json"))?.size ?? 0;
fileCount += 1;

if (totalBytes > SIZE_BUDGET) {
  failures.push(`unpacked size ${totalBytes} exceeds budget ${SIZE_BUDGET}`);
}
if (fileCount > FILE_COUNT_BUDGET) {
  failures.push(`file count ${fileCount} exceeds budget ${FILE_COUNT_BUDGET}`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`check-package: ${f}`);
  process.exit(1);
}
console.log(
  `check-package: OK (${fileCount} files, ${(totalBytes / 1024).toFixed(1)}KB unpacked, budget ${SIZE_BUDGET / 1024}KB)`,
);
