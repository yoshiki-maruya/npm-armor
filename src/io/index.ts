// Public read-only surface of the io layer. atomicWrite is deliberately NOT
// re-exported here: the write path exists only as src/io/write.js, importable
// only from src/fix/ (enforced by scripts/check-restrictions.mts).
export { IoError, isIoError } from "./errors.js";
export type { IoErrorKind } from "./errors.js";
export {
  DEFAULT_MAX_BYTES,
  createProjectReader,
  listDir,
  lstatSafe,
  readTextFile,
  realpathSafe,
  resolveWithinRoot,
} from "./fs.js";
export type { DirEntry, FileKind, ReadOnlyFileAccess, StatInfo } from "./fs.js";
export { sanitizeForTerminal } from "./sanitize.js";
