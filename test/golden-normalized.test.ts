import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeProject } from "../src/detect/index.js";
import { expectSnapshot, fixtureProjectDir, listFixtures } from "./helpers/golden.js";

// NormalizedConfig / ProjectModel / LockfileModel snapshots over every golden
// fixture combination (design §5.6). Regenerate with UPDATE_GOLDEN=1 npm test.
test("golden fixtures: normalized model snapshots", () => {
  const fixtures = listFixtures();
  assert.equal(fixtures.length, 16, "expected 16 golden fixtures");
  const failures: string[] = [];
  for (const name of fixtures) {
    const analysis = analyzeProject(fixtureProjectDir(name));
    const snapshot = JSON.parse(
      JSON.stringify({
        project: { ...analysis.project, root: "<root>" },
        config: analysis.config,
        lockfile: analysis.lockfile,
      }),
    ) as unknown;
    const r = expectSnapshot(name, "expected-normalized.json", snapshot);
    if (!r.ok) failures.push(`${name}:\n${r.diff ?? ""}`);
  }
  assert.deepEqual(failures, []);
});
