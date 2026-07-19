export type IoErrorKind =
  | "too-large"
  | "not-found"
  | "symlink"
  | "outside-root"
  | "not-a-file"
  | "unreadable"
  | "changed";

/**
 * Every failure of the io layer is an IoError with a machine-readable kind.
 * Callers map these to "undeterminable (warn)" findings — never a crash
 * (design principle 6: fail safe, fail loud).
 */
export class IoError extends Error {
  readonly kind: IoErrorKind;
  readonly path: string;

  constructor(kind: IoErrorKind, filePath: string, message: string) {
    super(message);
    this.name = "IoError";
    this.kind = kind;
    this.path = filePath;
  }
}

export function isIoError(e: unknown): e is IoError {
  return e instanceof IoError;
}
