// Test-only fs helpers. test/** is exempt from the fs-outside-io restriction
// (see scripts/check-restrictions.mts): fixture setup needs symlinks, oversized
// files and temp trees that the production io layer must refuse to create.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "tsconfig.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`repo root not found from ${startDir}`);
    dir = parent;
  }
}

export function makeTempDir(prefix = "npm-armor-test-"): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

/** Write a tree of files. Keys are relative paths, values are file contents. */
export function writeTree(root: string, files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

export function makeSymlink(target: string, linkPath: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath);
}

export function makeDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function removePath(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

export function readFileRaw(p: string): string {
  return fs.readFileSync(p, "utf8");
}

export function fileExists(p: string): boolean {
  return fs.existsSync(p);
}

/** Create a file of exactly `bytes` bytes (used for size-limit fixtures). */
export function writeFilled(p: string, bytes: number, fill = "a"): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const fd = fs.openSync(p, "w");
  try {
    const chunk = Buffer.alloc(1024 * 1024, fill);
    let remaining = bytes;
    while (remaining > 0) {
      const n = Math.min(remaining, chunk.length);
      fs.writeSync(fd, chunk, 0, n);
      remaining -= n;
    }
  } finally {
    fs.closeSync(fd);
  }
}
