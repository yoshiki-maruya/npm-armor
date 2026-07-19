// The four fix invariants (design §5.6, work order Phase 5), driven by
// fast-check over generated project states:
//   1. fix -> check passes for the fixed rules
//   2. fix is idempotent (second pass finds nothing, bytes unchanged)
//   3. unit conversion round-trips
//   4. fix only strengthens (already-stricter configs are byte-identical)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import fc from "fast-check";
import { analyzeProject } from "../src/detect/index.js";
import { runRules } from "../src/engine/index.js";
import { allRules } from "../src/rules/index.js";
import { computeFixPlans, mergePlans, writeChange } from "../src/fix/index.js";
import { formatMinutes, minutesToNpmDays, parseDurationToMinutes } from "../src/engine/duration.js";
import { makeTempDir, readFileRaw, removePath, writeTree } from "./helpers/fixture-io.js";

const FIXED_RULES = new Set(["AR001", "AR003", "AR009"]);
const RUNS = 40;

// --- generators -----------------------------------------------------------

const npmrcArb = fc
  .record({
    cooldown: fc.option(
      fc.oneof(
        fc.integer({ min: 0, max: 30 }).map((d) => `min-release-age=${d}`),
        fc.constant("min-release-age=soon"),
      ),
      { nil: undefined },
    ),
    ignoreScripts: fc.option(fc.constantFrom("ignore-scripts=true", "ignore-scripts=false"), { nil: undefined }),
    allowGit: fc.option(fc.constantFrom("allow-git=none", "allow-git=all"), { nil: undefined }),
    strictSsl: fc.option(fc.constantFrom("strict-ssl=false", "strict-ssl=true"), { nil: undefined }),
    comments: fc.array(fc.constantFrom("# comment", "; note", "fund=false", "loglevel=warn"), { maxLength: 3 }),
  })
  .map(({ cooldown, ignoreScripts, allowGit, strictSsl, comments }) => {
    const lines: string[] = [...comments];
    if (cooldown !== undefined) lines.push(cooldown);
    if (ignoreScripts !== undefined) lines.push(ignoreScripts);
    if (allowGit !== undefined) lines.push(allowGit);
    if (strictSsl !== undefined) lines.push(strictSsl);
    return lines.length === 0 ? undefined : `${lines.join("\n")}\n`;
  });

const pnpmYamlArb = fc.option(
  fc
    .oneof(
      fc.integer({ min: 0, max: 40000 }).map((m) => `minimumReleaseAge: ${m}`),
      fc.constant("minimumReleaseAge: whenever"),
      fc.constant("onlyBuiltDependencies:\n  - esbuild"),
    )
    .map((body) => `${body}\n`),
  { nil: undefined },
);

function makeNpmProject(npmrc: string | undefined): string {
  const dir = makeTempDir("npm-armor-prop-");
  writeTree(dir, {
    "package.json": JSON.stringify({ name: "p", version: "1.0.0" }),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
    ".git/HEAD": "ref: refs/heads/main\n",
    ...(npmrc !== undefined ? { ".npmrc": npmrc } : {}),
  });
  return dir;
}

function makePnpmProject(yaml: string | undefined): string {
  const dir = makeTempDir("npm-armor-prop-");
  writeTree(dir, {
    "package.json": JSON.stringify({ name: "p", version: "1.0.0", packageManager: "pnpm@10.15.0" }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    ".git/HEAD": "ref: refs/heads/main\n",
    ...(yaml !== undefined ? { "pnpm-workspace.yaml": yaml } : {}),
  });
  return dir;
}

function applyAllFixes(dir: string): number {
  const analysis = analyzeProject(dir);
  const plans = computeFixPlans(allRules, analysis, undefined, "recommended");
  for (const change of mergePlans(plans)) {
    writeChange(analysis.project.root, change);
  }
  return plans.length;
}

function readMaybe(p: string): string | undefined {
  try {
    return readFileRaw(p);
  } catch {
    return undefined;
  }
}

// --- 1: fix -> check passes ----------------------------------------------

test("property: after fix, the fixed rules produce no error/fixable findings (npm)", () => {
  fc.assert(
    fc.property(npmrcArb, (npmrc) => {
      const dir = makeNpmProject(npmrc);
      try {
        applyAllFixes(dir);
        const findings = runRules(allRules, analyzeProject(dir)).filter((f) => FIXED_RULES.has(f.ruleId));
        const bad = findings.filter((f) => f.severity === "error" || f.fixable);
        assert.deepEqual(bad, [], `remaining: ${JSON.stringify(findings)} for input ${JSON.stringify(npmrc)}`);
      } finally {
        removePath(dir);
      }
    }),
    { numRuns: RUNS },
  );
});

test("property: after fix, AR001 passes (pnpm)", () => {
  fc.assert(
    fc.property(pnpmYamlArb, (yaml) => {
      const dir = makePnpmProject(yaml);
      try {
        applyAllFixes(dir);
        const findings = runRules(allRules, analyzeProject(dir)).filter((f) => f.ruleId === "AR001");
        assert.deepEqual(findings, [], `remaining: ${JSON.stringify(findings)} for input ${JSON.stringify(yaml)}`);
      } finally {
        removePath(dir);
      }
    }),
    { numRuns: RUNS },
  );
});

// --- 2: idempotence -------------------------------------------------------

test("property: fix is idempotent (second pass empty, bytes unchanged)", () => {
  fc.assert(
    fc.property(npmrcArb, (npmrc) => {
      const dir = makeNpmProject(npmrc);
      try {
        applyAllFixes(dir);
        const afterFirst = readMaybe(path.join(dir, ".npmrc"));
        const secondCount = applyAllFixes(dir);
        assert.equal(secondCount, 0, `second pass had plans for input ${JSON.stringify(npmrc)}`);
        assert.equal(readMaybe(path.join(dir, ".npmrc")), afterFirst);
      } finally {
        removePath(dir);
      }
    }),
    { numRuns: RUNS },
  );
});

// --- 3: unit conversion round-trip ---------------------------------------

test("property: duration format/parse round-trips exactly", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 1_000_000 }), (m) => {
      assert.equal(parseDurationToMinutes(formatMinutes(m)), m);
    }),
    { numRuns: 200 },
  );
});

test("property: npm day conversion is the minimal strengthening", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1_000_000 }), (m) => {
      const days = minutesToNpmDays(m);
      assert.ok(days * 1440 >= m, "must not weaken");
      assert.ok((days - 1) * 1440 < m, "must be minimal");
    }),
    { numRuns: 200 },
  );
});

// --- 4: strengthen-only ---------------------------------------------------

test("property: already-stricter npm configs are byte-identical after fix", () => {
  const stricterArb = fc.record({
    days: fc.integer({ min: 1, max: 60 }),
    extra: fc.array(fc.constantFrom("# keep", "save-exact=true", "fund=false"), { maxLength: 2 }),
  });
  fc.assert(
    fc.property(stricterArb, ({ days, extra }) => {
      const npmrc = `${[...extra, `min-release-age=${days}`, "allow-git=none", "strict-ssl=true", "ignore-scripts=true"].join("\n")}\n`;
      const dir = makeNpmProject(npmrc);
      try {
        fc.pre(days * 1440 >= 1440); // always true (days >= 1) — explicit for the invariant's shape
        applyAllFixes(dir);
        assert.equal(readMaybe(path.join(dir, ".npmrc")), npmrc, "stricter config must not be touched");
      } finally {
        removePath(dir);
      }
    }),
    { numRuns: RUNS },
  );
});

test("property: already-stricter pnpm configs are byte-identical after fix", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1440, max: 100_000 }), (minutes) => {
      const yaml = `minimumReleaseAge: ${minutes}\nonlyBuiltDependencies:\n  - esbuild\n`;
      const dir = makePnpmProject(yaml);
      try {
        applyAllFixes(dir);
        assert.equal(readMaybe(path.join(dir, "pnpm-workspace.yaml")), yaml);
      } finally {
        removePath(dir);
      }
    }),
    { numRuns: RUNS },
  );
});
