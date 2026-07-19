// Shared harness for golden-fixture snapshot tests.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "./fixture-io.js";

export const UPDATE_GOLDEN = process.env["UPDATE_GOLDEN"] === "1";

export function goldenRoot(): string {
  const repo = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  return path.join(repo, "test", "fixtures", "golden");
}

export function listFixtures(): string[] {
  return fs
    .readdirSync(goldenRoot(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function fixtureProjectDir(name: string): string {
  const dir = path.join(goldenRoot(), name, "project");
  // Rules judge "under git control" by the presence of .git — fixtures cannot
  // commit a real .git directory, so materialize a marker one at test time.
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

/** Compare against (or update) the stored snapshot for a fixture. */
export function expectSnapshot(name: string, fileName: string, actual: unknown): { ok: boolean; diff?: string } {
  const file = path.join(goldenRoot(), name, fileName);
  const actualJson = `${JSON.stringify(actual, null, 2)}\n`;
  if (UPDATE_GOLDEN || !fs.existsSync(file)) {
    fs.writeFileSync(file, actualJson);
    return { ok: true };
  }
  const expected = fs.readFileSync(file, "utf8");
  if (expected === actualJson) return { ok: true };
  return { ok: false, diff: `expected (${file}):\n${expected}\nactual:\n${actualJson}` };
}
