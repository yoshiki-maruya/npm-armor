// Rule catalog. Order here is presentation order everywhere.
import type { Rule } from "../model.js";
import { ar001 } from "./ar001-cooldown.js";
import { ar002 } from "./ar002-lifecycle.js";
import { ar003 } from "./ar003-git-deps.js";
import { ar004 } from "./ar004-lockfile-committed.js";
import { ar005 } from "./ar005-ci-clean-install.js";
import { ar007 } from "./ar007-trusted-sources.js";
import { ar009 } from "./ar009-npmrc-integrity.js";
import { ar010 } from "./ar010-single-lockfile.js";

export const RULESET_TAG = "recommended@1";

export const allRules: readonly Rule[] = [ar001, ar002, ar003, ar004, ar005, ar007, ar009, ar010];

export function ruleById(idOrName: string): Rule | undefined {
  const q = idOrName.trim().toLowerCase();
  return allRules.find((r) => r.id.toLowerCase() === q || r.meta.name === q);
}
