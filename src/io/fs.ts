// The only module (besides write.ts) allowed to import node:fs — enforced by
// scripts/check-restrictions.mts. All reads are lstat-first (symlinks are never
// followed), size-capped and decoded defensively.
import * as fs from "node:fs";
import * as path from "node:path";
import { IoError } from "./errors.js";

export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export type FileKind = "file" | "dir" | "symlink" | "other";

export interface StatInfo {
  kind: FileKind;
  size: number;
  mode: number;
}

export interface DirEntry {
  name: string;
  kind: FileKind;
}

function kindOf(st: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileKind {
  if (st.isSymbolicLink()) return "symlink";
  if (st.isFile()) return "file";
  if (st.isDirectory()) return "dir";
  return "other";
}

/** lstat that returns undefined for a missing path and never follows symlinks. */
export function lstatSafe(p: string): StatInfo | undefined {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw new IoError("unreadable", p, `lstat failed: ${code ?? "unknown error"}`);
  }
  return { kind: kindOf(st), size: st.size, mode: st.mode & 0o7777 };
}

function decode(p: string, buf: Buffer): string {
  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString("utf8");
  }
  // UTF-16 LE BOM (seen in the wild for .npmrc edited on Windows)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  // UTF-16 BE is not decodable with node's built-in encodings — undeterminable
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    throw new IoError("unreadable", p, "UTF-16 BE encoding is not supported");
  }
  // Invalid UTF-8 sequences become U+FFFD; never throws
  return buf.toString("utf8");
}

/**
 * Read a text file with a hard size cap. Refuses symlinks and non-files.
 * Throws IoError only — callers translate to "undeterminable" findings.
 */
export function readTextFile(p: string, opts?: { maxBytes?: number }): string {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const st = lstatSafe(p);
  if (st === undefined) throw new IoError("not-found", p, "file not found");
  if (st.kind === "symlink") throw new IoError("symlink", p, "refusing to follow symlink");
  if (st.kind !== "file") throw new IoError("not-a-file", p, `not a regular file (${st.kind})`);
  if (st.size > maxBytes) {
    throw new IoError("too-large", p, `file size ${st.size} exceeds limit ${maxBytes}`);
  }
  let buf: Buffer;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new IoError("unreadable", p, `read failed: ${code ?? "unknown error"}`);
  }
  // The file may have grown between lstat and read — enforce the cap on actual bytes.
  if (buf.length > maxBytes) {
    throw new IoError("too-large", p, `file size ${buf.length} exceeds limit ${maxBytes}`);
  }
  return decode(p, buf);
}

/** List a directory; a missing directory yields []. Never follows symlinks. */
export function listDir(p: string): DirEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(p, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw new IoError("unreadable", p, `readdir failed: ${code ?? "unknown error"}`);
  }
  return entries
    .map((d) => ({ name: d.name, kind: kindOf(d) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function realpathSafe(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new IoError("not-found", p, "path not found");
    }
    throw new IoError("unreadable", p, `realpath failed: ${code ?? "unknown error"}`);
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve `relative` against `root` and guarantee the result stays inside the
 * realpathed root: lexical containment, refusal of a symlink as the final
 * component, and realpath verification of the existing ancestor chain (so a
 * symlinked directory cannot smuggle the path outside). Returns the absolute
 * path to use for the actual fs operation.
 *
 * `allowSymlinkFinal` permits a symlink as the *final* component — used only
 * by lstat/exists so a symlinked config file is detectable as such (its
 * content still cannot be read: readTextFile refuses symlinks separately).
 */
export function resolveWithinRoot(
  root: string,
  relative: string,
  opts?: { allowSymlinkFinal?: boolean },
): string {
  const rootReal = realpathSafe(root);
  const abs = path.resolve(rootReal, relative);
  if (!isInside(abs, rootReal)) {
    throw new IoError("outside-root", abs, `path escapes project root ${rootReal}`);
  }
  const st = lstatSafe(abs);
  if (st?.kind === "symlink") {
    if (opts?.allowSymlinkFinal !== true) {
      throw new IoError("symlink", abs, "refusing to follow symlink");
    }
    // Containment check applies to the parent chain, not the link target.
    if (!isInside(realpathSafe(path.dirname(abs)), rootReal)) {
      throw new IoError("outside-root", abs, `path resolves outside project root ${rootReal}`);
    }
    return abs;
  }
  if (st !== undefined) {
    // Exists and is not itself a symlink: realpath resolves any symlinked
    // directory components, which must not lead outside the root.
    if (!isInside(realpathSafe(abs), rootReal)) {
      throw new IoError("outside-root", abs, `path resolves outside project root ${rootReal}`);
    }
    return abs;
  }
  // Missing path: verify the deepest existing ancestor realpaths inside the root.
  let ancestor = path.dirname(abs);
  while (lstatSafe(ancestor) === undefined) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (!isInside(realpathSafe(ancestor), rootReal)) {
    throw new IoError("outside-root", abs, `path resolves outside project root ${rootReal}`);
  }
  return abs;
}

/** Read-only view of a project directory handed to rules (RuleContext.io). */
export interface ReadOnlyFileAccess {
  readTextFile(relativePath: string, opts?: { maxBytes?: number }): string;
  lstat(relativePath: string): StatInfo | undefined;
  listDir(relativePath: string): DirEntry[];
  exists(relativePath: string): boolean;
}

export function createProjectReader(root: string, defaults?: { maxBytes?: number }): ReadOnlyFileAccess {
  const rootReal = realpathSafe(root);
  return {
    readTextFile(relativePath, opts) {
      const abs = resolveWithinRoot(rootReal, relativePath);
      return readTextFile(abs, { maxBytes: opts?.maxBytes ?? defaults?.maxBytes ?? DEFAULT_MAX_BYTES });
    },
    lstat(relativePath) {
      return lstatSafe(resolveWithinRoot(rootReal, relativePath, { allowSymlinkFinal: true }));
    },
    listDir(relativePath) {
      return listDir(resolveWithinRoot(rootReal, relativePath));
    },
    exists(relativePath) {
      return lstatSafe(resolveWithinRoot(rootReal, relativePath, { allowSymlinkFinal: true })) !== undefined;
    },
  };
}
