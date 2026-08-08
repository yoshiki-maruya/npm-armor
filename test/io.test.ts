import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_MAX_BYTES,
  IoError,
  createProjectReader,
  listDir,
  lstatSafe,
  readTextFile,
  resolveWithinRoot,
  sanitizeForTerminal,
} from "../src/io/index.js";
import { atomicWrite } from "../src/io/write.js";
import {
  makeTempDir,
  makeSymlink,
  readFileRaw,
  removePath,
  symlinksSupported,
  writeFilled,
  writeTree,
} from "./helpers/fixture-io.js";

const ioKind = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof IoError) return e.kind;
    throw e;
  }
  return "no-error";
};

test("readTextFile reads plain files and strips a UTF-8 BOM", () => {
  const tmp = makeTempDir();
  try {
    writeTree(tmp, { "a.txt": "hello\n", "bom.txt": "﻿key=value\n" });
    assert.equal(readTextFile(path.join(tmp, "a.txt")), "hello\n");
    assert.equal(readTextFile(path.join(tmp, "bom.txt")), "key=value\n");
  } finally {
    removePath(tmp);
  }
});

test("readTextFile decodes UTF-16 LE and refuses UTF-16 BE (undeterminable, not a crash)", () => {
  const tmp = makeTempDir();
  try {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("registry=x\n", "utf16le")]);
    writeTree(tmp, { "le.ini": le, "be.ini": Buffer.from([0xfe, 0xff, 0x00, 0x41]) });
    assert.equal(readTextFile(path.join(tmp, "le.ini")), "registry=x\n");
    assert.equal(ioKind(() => readTextFile(path.join(tmp, "be.ini"))), "unreadable");
  } finally {
    removePath(tmp);
  }
});

test("readTextFile does not crash on invalid UTF-8 bytes", () => {
  const tmp = makeTempDir();
  try {
    writeTree(tmp, { "bad.ini": Buffer.from([0x6b, 0x65, 0x79, 0x3d, 0xff, 0xfd, 0x0a]) });
    const text = readTextFile(path.join(tmp, "bad.ini"));
    assert.ok(text.startsWith("key="));
  } finally {
    removePath(tmp);
  }
});

test("T1: oversized files are a dedicated too-large error, default cap is 64MB", () => {
  assert.equal(DEFAULT_MAX_BYTES, 64 * 1024 * 1024);
  const tmp = makeTempDir();
  try {
    writeFilled(path.join(tmp, "big.json"), 2 * 1024 * 1024);
    assert.equal(
      ioKind(() => readTextFile(path.join(tmp, "big.json"), { maxBytes: 1024 * 1024 })),
      "too-large",
    );
    // At the cap is still fine
    writeFilled(path.join(tmp, "ok.json"), 1024);
    assert.equal(readTextFile(path.join(tmp, "ok.json"), { maxBytes: 1024 }).length, 1024);
  } finally {
    removePath(tmp);
  }
});

test("readTextFile refuses symlinks and non-files", { skip: !symlinksSupported() }, () => {
  const tmp = makeTempDir();
  try {
    writeTree(tmp, { "real.txt": "x" });
    makeSymlink(path.join(tmp, "real.txt"), path.join(tmp, "link.txt"));
    assert.equal(ioKind(() => readTextFile(path.join(tmp, "link.txt"))), "symlink");
    assert.equal(ioKind(() => readTextFile(tmp)), "not-a-file");
    assert.equal(ioKind(() => readTextFile(path.join(tmp, "missing.txt"))), "not-found");
  } finally {
    removePath(tmp);
  }
});

test("T4: sanitizeForTerminal strips C0, ESC, ANSI sequences, DEL and C1", () => {
  assert.equal(sanitizeForTerminal("\u001b[31mevil\u001b[0m"), "[31mevil[0m");
  assert.equal(sanitizeForTerminal("a\nb\tc\rd"), "abcd");
  assert.equal(sanitizeForTerminal("x\u0000y\u0007z"), "xyz");
  assert.equal(sanitizeForTerminal("p\u007fq\u009br"), "pqr");
  assert.equal(sanitizeForTerminal("日本語テキスト ok"), "日本語テキスト ok");
});

test("T6: resolveWithinRoot rejects escapes and symlinks", { skip: !symlinksSupported() }, () => {
  const tmp = makeTempDir();
  const outside = makeTempDir("npm-armor-outside-");
  try {
    writeTree(tmp, { "proj/.npmrc": "registry=https://registry.npmjs.org/\n" });
    writeTree(outside, { "secret.txt": "secret" });
    const root = path.join(tmp, "proj");

    // Normal resolution works
    const abs = resolveWithinRoot(root, ".npmrc");
    assert.equal(readTextFile(abs).includes("registry.npmjs.org"), true);

    // Lexical escape
    assert.equal(ioKind(() => resolveWithinRoot(root, "../../etc/passwd")), "outside-root");

    // Symlink as final component pointing outside the root
    makeSymlink(path.join(outside, "secret.txt"), path.join(root, "evil.npmrc"));
    assert.equal(ioKind(() => resolveWithinRoot(root, "evil.npmrc")), "symlink");

    // Symlinked directory component escaping the root
    makeSymlink(outside, path.join(root, "subdir"));
    assert.equal(ioKind(() => resolveWithinRoot(root, "subdir/secret.txt")), "outside-root");
  } finally {
    removePath(tmp);
    removePath(outside);
  }
});

test("createProjectReader confines all operations to the root", () => {
  const tmp = makeTempDir();
  const outside = makeTempDir("npm-armor-outside-");
  try {
    writeTree(tmp, { "proj/package.json": "{}", "proj/sub/file.txt": "inner" });
    writeTree(outside, { "x.txt": "outer" });
    const reader = createProjectReader(path.join(tmp, "proj"));
    assert.equal(reader.readTextFile("package.json"), "{}");
    assert.equal(reader.exists("sub/file.txt"), true);
    assert.equal(reader.exists("nope.txt"), false);
    assert.deepEqual(
      reader.listDir(".").map((e) => e.name),
      ["package.json", "sub"],
    );
    assert.equal(ioKind(() => reader.readTextFile("../../x.txt")), "outside-root");
  } finally {
    removePath(tmp);
    removePath(outside);
  }
});

test("listDir returns [] for a missing directory", () => {
  const tmp = makeTempDir();
  try {
    assert.deepEqual(listDir(path.join(tmp, "no-such-dir")), []);
  } finally {
    removePath(tmp);
  }
});

test("atomicWrite creates, replaces, preserves permissions and refuses symlinks", { skip: !symlinksSupported() }, () => {
  const tmp = makeTempDir();
  const outside = makeTempDir("npm-armor-outside-");
  try {
    const target = path.join(tmp, "conf.ini");

    // Create
    atomicWrite(target, "a=1\n");
    assert.equal(readFileRaw(target), "a=1\n");

    // Replace, preserving a restrictive mode. Windows has no POSIX
    // owner/group/other bits (chmod only toggles the read-only attribute,
    // so 0o600 round-trips as 0o666) — verify the byte-for-byte mode
    // preservation only where the OS actually supports it.
    fs.chmodSync(target, 0o600);
    atomicWrite(target, "a=2\n");
    assert.equal(readFileRaw(target), "a=2\n");
    if (process.platform !== "win32") {
      assert.equal((lstatSafe(target)?.mode ?? 0) & 0o777, 0o600);
    }

    // No temp litter left behind
    assert.deepEqual(
      listDir(tmp).map((e) => e.name),
      ["conf.ini"],
    );

    // Symlink target refused, link and its destination untouched
    writeTree(outside, { "victim.txt": "untouched" });
    makeSymlink(path.join(outside, "victim.txt"), path.join(tmp, "sneaky.ini"));
    assert.equal(ioKind(() => atomicWrite(path.join(tmp, "sneaky.ini"), "pwned")), "symlink");
    assert.equal(readFileRaw(path.join(outside, "victim.txt")), "untouched");

    // Directory target refused
    assert.equal(ioKind(() => atomicWrite(tmp, "x")), "not-a-file");
  } finally {
    removePath(tmp);
    removePath(outside);
  }
});
