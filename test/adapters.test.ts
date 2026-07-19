import { test } from "node:test";
import assert from "node:assert/strict";
import { isEnvReference, npmrcGet, npmrcGetBool, parseNpmrc } from "../src/adapters/npmrc.js";
import { parseYamlSubset } from "../src/adapters/yaml-subset.js";
import { parseNpmLockfile } from "../src/adapters/lockfile-npm.js";
import { parsePnpmLockfile } from "../src/adapters/lockfile-pnpm.js";
import { extractRunCommands } from "../src/adapters/workflows.js";
import { parseJsonSafe, scanMaxDepth } from "../src/adapters/json-safe.js";

test("npmrc: line-oriented parse with comments, CRLF, quotes and last-wins", () => {
  const data = parseNpmrc("; comment\r\n# other\nfoo=1\nfoo = 2\nbar=\"quoted\"\nnot a pair\n");
  assert.equal(npmrcGet(data, "foo")?.value, "2");
  assert.equal(npmrcGet(data, "bar")?.value, "quoted");
  assert.equal(npmrcGet(data, "missing"), undefined);
});

test("npmrc: key normalization matches npm (_ and -, case-insensitive)", () => {
  const data = parseNpmrc("Min_Release_Age=7\n");
  assert.equal(npmrcGet(data, "min-release-age")?.value, "7");
});

test("npmrc: boolean parsing is safe-side", () => {
  const data = parseNpmrc("a=true\nb=false\nc=\nd=banana\n");
  assert.equal(npmrcGetBool(data, "a"), true);
  assert.equal(npmrcGetBool(data, "b"), false);
  assert.equal(npmrcGetBool(data, "c"), true);
  assert.equal(npmrcGetBool(data, "d"), undefined);
});

test("npmrc: env references are recognized", () => {
  assert.equal(isEnvReference("${NPM_TOKEN}"), true);
  assert.equal(isEnvReference("deadbeef"), false);
  assert.equal(isEnvReference("${NPM_TOKEN}x"), false);
});

test("yaml-subset: scalars, block lists, comments, quotes", () => {
  const r = parseYamlSubset(
    "# header\nminimumReleaseAge: 1440  # inline comment\npackages:\n  - 'packages/*'\n  - \"apps/web\"\nunknownKey: whatever\n",
    ["minimumReleaseAge", "packages"],
  );
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") {
    assert.equal(r.data.get("minimumReleaseAge"), "1440");
    assert.deepEqual(r.data.get("packages"), ["packages/*", "apps/web"]);
    assert.equal(r.data.has("unknownKey"), false);
  }
});

test("yaml-subset: unknown nested blocks are skipped safely", () => {
  const r = parseYamlSubset(
    "catalog:\n  react: ^18.0.0\n  redux: ^5.0.0\nminimumReleaseAge: 60\n",
    ["minimumReleaseAge"],
  );
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") assert.equal(r.data.get("minimumReleaseAge"), "60");
});

test("yaml-subset: anchors, aliases, tags, merge keys, flow style are unparseable", () => {
  const cases = [
    "minimumReleaseAge: &age 1440\n",
    "minimumReleaseAge: *age\n",
    "minimumReleaseAge: !!int 1440\n",
    "base: &b\n  x: 1\nderived:\n  <<: *b\n",
    "packages: [a, b]\n",
    "packages: |\n  text\n",
  ];
  for (const text of cases) {
    const r = parseYamlSubset(text, ["minimumReleaseAge", "packages"]);
    assert.equal(r.kind, "unparseable", `expected unparseable for: ${JSON.stringify(text)}`);
  }
});

test("yaml-subset: glob asterisks in quoted and path positions are not aliases", () => {
  const r = parseYamlSubset("packages:\n  - 'packages/*'\n  - apps/web/*\n", ["packages"]);
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") assert.deepEqual(r.data.get("packages"), ["packages/*", "apps/web/*"]);
});

test("json-safe: depth scan ignores brackets inside strings and bounds real nesting", () => {
  assert.equal(scanMaxDepth('{"a": "]]]}}}"}', 3), "ok");
  assert.equal(scanMaxDepth("[".repeat(50) + "]".repeat(50), 10), "too-deep");
  const deep = "[".repeat(10_000) + "]".repeat(10_000);
  assert.equal(parseJsonSafe(deep).kind, "unparseable");
});

test("npm lockfile: v3 packages extraction with git/http classification", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "x" },
      "node_modules/ok": { resolved: "https://registry.npmjs.org/ok/-/ok-1.0.0.tgz", integrity: "sha512-x" },
      "node_modules/@scope/pkg": { resolved: "http://evil.example/p.tgz" },
      "node_modules/gd": { resolved: "git+https://github.com/a/b.git#c" },
    },
  });
  const r = parseNpmLockfile("package-lock.json", lock);
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") {
    assert.deepEqual(
      r.sources.map((s) => [s.name, s.kind]),
      [
        ["ok", "registry-tarball"],
        ["@scope/pkg", "registry-tarball"],
        ["gd", "git"],
      ],
    );
  }
});

test("npm lockfile: v1 dependencies tree is walked", () => {
  const lock = JSON.stringify({
    lockfileVersion: 1,
    dependencies: {
      a: { resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz", dependencies: { b: { resolved: "https://registry.npmjs.org/b/-/b-1.0.0.tgz" } } },
    },
  });
  const r = parseNpmLockfile("package-lock.json", lock);
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") assert.deepEqual(r.sources.map((s) => s.name), ["a", "b"]);
});

test("npm lockfile: garbage is unparseable, not a crash", () => {
  assert.equal(parseNpmLockfile("package-lock.json", "not json").kind, "unparseable");
  assert.equal(parseNpmLockfile("package-lock.json", '{"unrelated": true}').kind, "unparseable");
});

test("pnpm lockfile: tarball/repo extraction from flow-style resolution", () => {
  const text = [
    "lockfileVersion: '9.0'",
    "packages:",
    "",
    "  left-pad@1.3.0:",
    "    resolution: {integrity: sha512-abc}",
    "",
    "  evil@1.0.0:",
    "    resolution: {integrity: sha512-x, tarball: http://evil.example/e.tgz}",
    "",
    "  gd@git+https://github.com/a/b#c:",
    "    resolution: {commit: c, repo: https://github.com/a/b, type: git}",
    "",
  ].join("\n");
  const r = parsePnpmLockfile("pnpm-lock.yaml", text);
  assert.deepEqual(
    r.sources.map((s) => [s.name, s.kind, s.url]),
    [
      ["evil", "registry-tarball", "http://evil.example/e.tgz"],
      ["gd", "git", "https://github.com/a/b"],
    ],
  );
});

test("workflows: run commands are extracted from plain and block scalars", () => {
  const yml = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - run: npm ci",
    "      - name: build",
    "        run: |",
    "          npm install",
    "          npm test",
    "      - run: >",
    "          pnpm install --frozen-lockfile",
    "",
  ].join("\n");
  assert.deepEqual(
    extractRunCommands(yml).map((c) => c.command),
    ["npm ci", "npm install", "npm test", "pnpm install --frozen-lockfile"],
  );
});
