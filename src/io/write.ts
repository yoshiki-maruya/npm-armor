// The write side of the io layer. atomicWrite may only be referenced from
// src/fix/ (and here) — enforced by scripts/check-restrictions.mts. Every
// other code path in the tool is structurally read-only (design principle 4).
import * as fs from "node:fs";
import * as path from "node:path";
import { IoError } from "./errors.js";
import { lstatSafe } from "./fs.js";

let tmpCounter = 0;

/**
 * Atomically replace (or create) `filePath` with `content`:
 * write to a sibling temp file, fsync, then rename over the target.
 * Refuses symlink targets; preserves the permissions of an existing target.
 */
export function atomicWrite(filePath: string, content: string): void {
  const existing = lstatSafe(filePath);
  if (existing?.kind === "symlink") {
    throw new IoError("symlink", filePath, "refusing to write through a symlink");
  }
  if (existing !== undefined && existing.kind !== "file") {
    throw new IoError("not-a-file", filePath, `refusing to replace a ${existing.kind}`);
  }

  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  tmpCounter += 1;
  const tmp = path.join(dir, `.${base}.armor-tmp-${process.pid}-${tmpCounter}`);

  let fd: number;
  try {
    fd = fs.openSync(tmp, "wx");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new IoError("unreadable", tmp, `could not create temp file: ${code ?? "unknown error"}`);
  }
  try {
    if (existing !== undefined) fs.fchmodSync(fd, existing.mode);
    fs.writeSync(fd, Buffer.from(content, "utf8"));
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw new IoError("unreadable", filePath, `write failed: ${String(e)}`);
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code;
    throw new IoError("unreadable", filePath, `rename failed: ${code ?? "unknown error"}`);
  }
  // Best-effort directory fsync so the rename itself is durable (not available
  // on all platforms; failure changes durability, not correctness).
  try {
    const dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // ignore
  }
}
