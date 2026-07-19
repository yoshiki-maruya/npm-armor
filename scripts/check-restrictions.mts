#!/usr/bin/env node
// Machine enforcement of npm-armor's non-negotiable constraints (design §2/§5.3, work order §1):
//   (a) module imports outside an explicit allowlist — bans child_process / vm / net /
//       http(s) / dns / worker_threads / crypto / module and every bare dependency
//   (b) eval / new Function / non-literal dynamic import()
//   (c) fs imports anywhere but src/io/
//   (d) process.env access beyond NO_COLOR / FORCE_COLOR / CI
//   (e) the atomicWrite identifier outside src/io/ and src/fix/
//   (f) network globals (fetch / WebSocket / XMLHttpRequest / EventSource) and require()
//
// Scope: src/**/*.ts and scripts/**/*.mts — including this file. test/** is out of
// scope on purpose: fixture setup (symlinks, oversized files, temp trees) needs raw
// fs access, and tests are never shipped (package "files" allowlist).
//
// Erasable-syntax-only TypeScript: runs directly under `node` >= 22.6 via type
// stripping. No enums, no namespaces, no parameter properties.

import ts from "typescript";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface Violation {
  file: string;
  line: number;
  rule: string;
  message: string;
}

// Node builtins that src/ and scripts/ may import. Everything else is a violation,
// so a new builtin need is a conscious, reviewable diff to this list.
const NODE_BUILTIN_ALLOW = new Set(["path", "url", "process", "util"]);
const FS_MODULES = new Set(["fs", "fs/promises"]);
// Bare (non-builtin) specifiers allowed in scripts/ only. src/ allows none: zero deps.
const BARE_ALLOW_SCRIPTS = new Set(["typescript"]);
const ALLOWED_ENV = new Set(["NO_COLOR", "FORCE_COLOR", "CI"]);
const NET_GLOBALS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);

// Used only to classify a bare specifier as "builtin" vs "dependency".
const KNOWN_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain", "events",
  "fs", "http", "http2", "https", "inspector", "module", "net", "os", "path",
  "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "sea",
  "sqlite", "stream", "string_decoder", "test", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isUnder(posixFile: string, segment: string): boolean {
  return posixFile.includes(segment);
}

function isScriptFile(posixFile: string): boolean {
  return posixFile.endsWith(".mts") || isUnder(posixFile, "/scripts/");
}

export function scanSource(fileName: string, sourceText: string): Violation[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const posixFile = toPosix(fileName);
  const out: Violation[] = [];

  const add = (node: ts.Node, rule: string, message: string): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ file: fileName, line: line + 1, rule, message });
  };

  const checkSpecifier = (node: ts.Node, spec: string): void => {
    if (spec.startsWith("./") || spec.startsWith("../")) return;
    const canonical = spec.startsWith("node:") ? spec.slice(5) : spec;
    const head = canonical.split("/")[0] ?? canonical;
    const isBuiltin = spec.startsWith("node:") || KNOWN_BUILTINS.has(head);
    if (isBuiltin) {
      if (FS_MODULES.has(canonical)) {
        if (!isUnder(posixFile, "/src/io/")) {
          add(node, "fs-outside-io", `fs import "${spec}" is only allowed in src/io/`);
        }
        return;
      }
      if (!NODE_BUILTIN_ALLOW.has(canonical)) {
        add(node, "forbidden-builtin", `import of "${spec}" is forbidden`);
      }
      return;
    }
    if (isScriptFile(posixFile) && BARE_ALLOW_SCRIPTS.has(spec)) return;
    add(node, "forbidden-dependency", `bare import "${spec}" violates the zero-dependency rule`);
  };

  const endsWithProcess = (e: ts.Expression): boolean =>
    (ts.isIdentifier(e) && e.text === "process") ||
    (ts.isPropertyAccessExpression(e) && e.name.text === "process");

  const checkEnvAccess = (envNode: ts.PropertyAccessExpression): void => {
    const parent = envNode.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === envNode) {
      if (!ALLOWED_ENV.has(parent.name.text)) {
        add(parent, "env-access", `process.env.${parent.name.text} is not an allowed variable`);
      }
      return;
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === envNode) {
      const arg = parent.argumentExpression;
      if (ts.isStringLiteralLike(arg) && ALLOWED_ENV.has(arg.text)) return;
      add(parent, "env-access", "computed or disallowed process.env access");
      return;
    }
    add(envNode, "env-access", "bare process.env reference is not allowed");
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkSpecifier(node, node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node)) {
      add(node, "forbidden-syntax", "import = require() syntax is not allowed");
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg !== undefined && ts.isStringLiteralLike(arg)) {
          checkSpecifier(node, arg.text);
        } else {
          add(node, "dynamic-import", "dynamic import() with a non-literal specifier");
        }
      }
      if (ts.isIdentifier(node.expression)) {
        const callee = node.expression.text;
        if (callee === "eval") add(node, "eval", "eval() is forbidden");
        if (callee === "require") add(node, "require", "require() is forbidden");
        if (callee === "Function") add(node, "new-function", "Function() is forbidden");
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") {
      add(node, "new-function", "new Function() is forbidden");
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "eval") {
      add(node, "eval", "property access named eval is forbidden");
    }
    if (ts.isIdentifier(node) && NET_GLOBALS.has(node.text)) {
      add(node, "network-global", `"${node.text}" is forbidden (zero-network rule)`);
    }
    if (
      ts.isIdentifier(node) &&
      node.text === "atomicWrite" &&
      !isUnder(posixFile, "/src/io/") &&
      !isUnder(posixFile, "/src/fix/")
    ) {
      add(node, "atomic-write", "atomicWrite may only be referenced from src/io/ and src/fix/");
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      endsWithProcess(node.expression)
    ) {
      checkEnvAccess(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

export function scanFiles(files: readonly string[]): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    const text = ts.sys.readFile(file);
    if (text === undefined) {
      out.push({ file, line: 0, rule: "unreadable", message: "could not read file" });
      continue;
    }
    out.push(...scanSource(file, text));
  }
  return out;
}

export function collectSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];
  for (const dir of ["src", "scripts"]) {
    const abs = path.join(repoRoot, dir);
    if (!ts.sys.directoryExists(abs)) continue;
    files.push(...ts.sys.readDirectory(abs, [".ts", ".mts"]));
  }
  return files.sort();
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = collectSourceFiles(repoRoot);
  if (files.length === 0) {
    console.error("check-restrictions: no source files found — scan misconfigured?");
    process.exit(2);
  }
  const violations = scanFiles(files);
  for (const v of violations) {
    console.error(`${path.relative(repoRoot, v.file)}:${v.line} [${v.rule}] ${v.message}`);
  }
  if (violations.length > 0) {
    console.error(`check-restrictions: ${violations.length} violation(s) in ${files.length} file(s)`);
    process.exit(1);
  }
  console.log(`check-restrictions: OK (${files.length} files scanned, 0 violations)`);
}
