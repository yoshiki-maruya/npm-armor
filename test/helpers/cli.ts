// E2E driver: runs the *built* CLI (dist/bin/armor.js) in a child process to
// verify the real exit-code and output contracts. Tests are exempt from the
// zero-exec restriction scan — this only ever executes our own build output.
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "./fixture-io.js";

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runCli(args: readonly string[], opts?: { cwd?: string; env?: Record<string, string> }): CliResult {
  const repo = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const cli = path.join(repo, "dist", "bin", "armor.js");
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: opts?.cwd ?? repo,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...opts?.env },
  });
  if (r.error !== undefined) throw r.error;
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}
