import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeProject } from "../src/detect/index.js";
import { runRules } from "../src/engine/index.js";
import { allRules } from "../src/rules/index.js";
import { expectSnapshot, fixtureProjectDir, listFixtures } from "./helpers/golden.js";

// Expected Finding sets for every golden combination (design §5.6).
// Regenerate with UPDATE_GOLDEN=1 npm test — then review the diff.
test("golden fixtures: findings snapshots", () => {
  const failures: string[] = [];
  for (const name of listFixtures()) {
    const analysis = analyzeProject(fixtureProjectDir(name));
    const findings = runRules(allRules, analysis);
    const r = expectSnapshot(name, "expected-findings.json", findings);
    if (!r.ok) failures.push(`${name}:\n${r.diff ?? ""}`);
  }
  assert.deepEqual(failures, []);
});

test("recommended fixtures have no error/warn findings (the recommended state passes)", () => {
  for (const name of listFixtures().filter((n) => n.includes("-recommended-") || n.includes("-stricter-"))) {
    const analysis = analyzeProject(fixtureProjectDir(name));
    const findings = runRules(allRules, analysis).filter((f) => f.severity !== "info");
    assert.deepEqual(findings, [], `expected no findings for ${name}`);
  }
});

test("broken fixtures always produce at least one error", () => {
  for (const name of listFixtures().filter((n) => n.includes("-broken-"))) {
    const analysis = analyzeProject(fixtureProjectDir(name));
    const findings = runRules(allRules, analysis);
    assert.ok(findings.some((f) => f.severity === "error"), `expected errors for ${name}`);
  }
});
