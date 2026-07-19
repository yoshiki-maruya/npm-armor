import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { allRules } from "../src/rules/index.js";
import { renderRuleDoc } from "../src/report/docs.js";
import { findRepoRoot } from "./helpers/fixture-io.js";

const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

// docs/rules/<slug>.md must equal the embedded rule documentation that
// `armor explain` prints (docs are not shipped; dist embeds the text).
test("docs/rules markdown files are in sync with embedded rule docs", () => {
  const repo = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const docsDir = path.join(repo, "docs", "rules");
  fs.mkdirSync(docsDir, { recursive: true });
  const expectedFiles = new Set<string>();
  for (const rule of allRules) {
    const file = path.join(docsDir, `${rule.meta.docsSlug}.md`);
    expectedFiles.add(`${rule.meta.docsSlug}.md`);
    const rendered = renderRuleDoc(rule);
    if (UPDATE || !fs.existsSync(file)) {
      fs.writeFileSync(file, rendered);
      continue;
    }
    assert.equal(fs.readFileSync(file, "utf8"), rendered, `out of sync: ${file} (UPDATE_GOLDEN=1 to regenerate)`);
  }
  const actualFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
  assert.deepEqual(actualFiles.sort(), [...expectedFiles].sort(), "stray or missing files in docs/rules");
});
