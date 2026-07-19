// armor.config.json loader (design §4.6). JSON only — a JS config in the
// target repo is a potential code-execution vector (T11): it is ignored with
// a notice and defaults are used. Config problems the user must resolve throw
// ConfigError (exit code 3).
import * as path from "node:path";
import { isIoError, readTextFile } from "../io/index.js";
import { parseJsonSafe, safeEntries, safeGet } from "../adapters/json-safe.js";
import type { RuleSetting, RuleSettings } from "../engine/index.js";
import { RULESET_TAG, ruleById } from "../rules/index.js";
import type { ReadOnlyFileAccess } from "../io/index.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface LoadedConfig {
  settings: RuleSettings;
  notices: string[];
  ruleset: string;
}

const JS_CONFIG_NAMES = ["armor.config.js", "armor.config.cjs", "armor.config.mjs", "armor.config.ts"];
const SEVERITIES = new Set(["error", "warn", "info"]);

export function loadConfig(io: ReadOnlyFileAccess, explicitPath?: string): LoadedConfig {
  const notices: string[] = [];

  for (const jsName of JS_CONFIG_NAMES) {
    try {
      if (io.exists(jsName)) {
        notices.push(`${jsName} is ignored: only JSON configuration (armor.config.json) is supported`);
      }
    } catch {
      // ignore — detection is best-effort
    }
  }

  let text: string | undefined;
  if (explicitPath !== undefined) {
    try {
      text = readTextFile(path.resolve(explicitPath));
    } catch (e) {
      throw new ConfigError(`cannot read config file ${explicitPath}: ${isIoError(e) ? e.kind : "error"}`);
    }
  } else {
    try {
      text = io.readTextFile("armor.config.json");
    } catch (e) {
      if (isIoError(e) && e.kind === "not-found") text = undefined;
      else throw new ConfigError(`cannot read armor.config.json: ${isIoError(e) ? e.kind : "error"}`);
    }
  }

  if (text === undefined) {
    return { settings: new Map(), notices, ruleset: RULESET_TAG };
  }

  const parsed = parseJsonSafe(text);
  if (parsed.kind === "unparseable") {
    throw new ConfigError(`invalid armor config: ${parsed.reason}`);
  }
  if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
    throw new ConfigError("invalid armor config: top level must be an object");
  }

  const ruleset = safeGet(parsed.value, "ruleset");
  if (ruleset !== undefined && ruleset !== RULESET_TAG) {
    throw new ConfigError(`unknown ruleset ${JSON.stringify(ruleset)} (supported: ${RULESET_TAG})`);
  }

  const settings: RuleSettings = new Map();
  const rulesRaw = safeGet(parsed.value, "rules");
  if (rulesRaw !== undefined) {
    if (typeof rulesRaw !== "object" || rulesRaw === null || Array.isArray(rulesRaw)) {
      throw new ConfigError('invalid armor config: "rules" must be an object');
    }
    for (const [key, value] of safeEntries(rulesRaw)) {
      const rule = ruleById(key);
      if (rule === undefined) throw new ConfigError(`unknown rule in config: ${key}`);
      settings.set(rule.id, parseRuleSetting(key, value));
    }
  }
  return { settings, notices, ruleset: RULESET_TAG };
}

function parseRuleSetting(key: string, value: unknown): RuleSetting {
  if (value === "off") return { enabled: false, options: {} };
  if (typeof value === "string") {
    if (!SEVERITIES.has(value)) {
      throw new ConfigError(`invalid severity for rule ${key}: ${JSON.stringify(value)}`);
    }
    return { enabled: true, severity: value as RuleSetting["severity"], options: {} };
  }
  if (Array.isArray(value)) {
    const [sev, opts] = value;
    if (typeof sev !== "string" || !SEVERITIES.has(sev)) {
      throw new ConfigError(`invalid severity for rule ${key}`);
    }
    let options: Record<string, unknown> = {};
    if (opts !== undefined) {
      if (typeof opts !== "object" || opts === null || Array.isArray(opts)) {
        throw new ConfigError(`invalid options for rule ${key}: must be an object`);
      }
      options = Object.fromEntries(safeEntries(opts));
    }
    if (value.length > 2) throw new ConfigError(`invalid setting for rule ${key}: too many elements`);
    return { enabled: true, severity: sev as RuleSetting["severity"], options };
  }
  throw new ConfigError(`invalid setting for rule ${key}`);
}
