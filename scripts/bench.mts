#!/usr/bin/env node
// Performance smoke (design §5.4): a full check over a 5MB lockfile project
// must finish within BUDGET_MS. Run after `npm run build && npm run build:test`.
// File setup goes through the compiled test helper (test code may use fs;
// scripts and src may not — see scripts/check-restrictions.mts).
import { analyzeProject } from "../build/src/detect/index.js";
import { runRules } from "../build/src/engine/index.js";
import { allRules } from "../build/src/rules/index.js";
import { makeBenchProject } from "../build/test/helpers/gen-lockfile.js";
import { removePath } from "../build/test/helpers/fixture-io.js";

const TARGET_BYTES = 5 * 1024 * 1024;
const BUDGET_MS = 300;
// Regression guard: warn when the median creeps past 80% of budget so drift
// is visible before it becomes a failure (±20% band, design §5.4).
const WARN_MS = BUDGET_MS * 0.8;
const RUNS = 5;

const { dir, lockBytes } = makeBenchProject(TARGET_BYTES);
try {
  // Warm-up (JIT, fs cache)
  runRules(allRules, analyzeProject(dir));

  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const findings = runRules(allRules, analyzeProject(dir));
    samples.push(performance.now() - t0);
    if (findings.some((f) => f.severity === "error")) {
      console.error("bench: fixture unexpectedly has error findings");
      process.exit(1);
    }
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;

  console.log(
    `bench: lockfile ${(lockBytes / 1024 / 1024).toFixed(1)}MB, median check ${median.toFixed(1)}ms ` +
      `(min ${samples[0]?.toFixed(1)}ms, max ${samples[samples.length - 1]?.toFixed(1)}ms, budget ${BUDGET_MS}ms)`,
  );
  if (median > BUDGET_MS) {
    console.error(`bench: FAIL — median ${median.toFixed(1)}ms exceeds budget ${BUDGET_MS}ms`);
    process.exit(1);
  }
  if (median > WARN_MS) {
    console.warn(`bench: WARNING — median ${median.toFixed(1)}ms is within 20% of the budget`);
  }
} finally {
  removePath(dir);
}
