# npm-armor

Diagnose and fix the supply-chain defense settings of JavaScript projects.

Package managers already ship real defenses against supply-chain attacks —
release cooldowns, lifecycle-script blocking, lockfile pinning, clean CI
installs. Almost nobody turns them all on, and nothing warns you when one
quietly gets turned off. `npm-armor` checks that configuration layer and can
repair it. It does not scan for malware (Socket, Snyk and npm audit do that);
it makes sure the defenses you already have are actually enabled.

> **Guarantees: zero dependencies, zero network, zero execution, no telemetry.**
> The runtime dependency count is 0 (enforced in CI). The tool never opens a
> network connection and collects no usage data — permanently. It never
> executes code or package-manager binaries from the repository it checks:
> everything works by parsing files directly, because on a compromised
> repository even `npm config get` may be a trap.

## Install / Run

```console
$ npx npm-armor check
$ npx npm-armor fix          # preview
$ npx npm-armor fix --write  # apply
```

Requires Node.js >= 20. Supported package managers in v0.1: npm >= 9 and
pnpm >= 9 (Yarn Berry and Bun are planned — M2).

## Commands

```
armor check   [--dir <path>] [--format tty|json] [--config <path>]
armor fix     [--write] [--rule <id>...] [--preset recommended|strict] [--dir <path>]
armor rules   [--json]
armor explain <ruleId>
```

`check` is read-only. `fix` previews a minimal text patch by default —
comments and ordering in your config files are preserved — and only writes
with `--write` (atomic write with change detection; symlink targets refused).
Fixes only ever *strengthen* settings: an existing value stricter than the
recommendation is never touched. `--preset strict` targets a 7-day cooldown
instead of 24 hours.

Exit codes (stable contract): `0` no violations · `1` error-level violations ·
`2` execution error · `3` invalid configuration. JSON output carries
`schemaVersion: 1`.

## Rules (ruleset `recommended@1`)

| ID | Name | Checks | Fix |
|---|---|---|---|
| AR001 | cooldown-enabled | Release cooldown (npm `min-release-age` / pnpm `minimumReleaseAge`) ≥ 24h | yes |
| AR002 | lifecycle-scripts-restricted | Install scripts blocked (`ignore-scripts`) or allowlisted (pnpm `onlyBuiltDependencies`) | M2 |
| AR003 | git-deps-restricted | No git dependencies; npm additionally `allow-git=none` | yes |
| AR004 | lockfile-committed | Lockfile exists, under git, not gitignored | manual |
| AR005 | ci-clean-install | CI uses `npm ci` / `pnpm install --frozen-lockfile` | manual |
| AR007 | lockfile-trusted-sources | All lockfile URLs https + allowed registry hosts | manual |
| AR009 | npmrc-integrity | No registry overrides, `strict-ssl=false`, `script-shell`, plaintext tokens in `.npmrc` | partial |
| AR010 | single-lockfile | Only one package manager's lockfile present | manual |

`armor explain AR001` (or any ID) prints why the rule exists and which real
attacks it addresses. The same texts live in [docs/rules/](docs/rules/).

## Configuration

`armor.config.json` at the project root (JSON only — JS configs are ignored
by design, so a compromised repository cannot run code through our config):

```json
{
  "ruleset": "recommended@1",
  "rules": {
    "cooldown-enabled": ["error", { "min": "7d" }],
    "lockfile-trusted-sources": ["error", { "allowedHosts": ["registry.corp.example"] }],
    "single-lockfile": "off"
  }
}
```

A rule value is `"off"`, a severity (`"error" | "warn" | "info"`), or
`[severity, options]`.

## Security model

npm-armor assumes the repository it runs on may already be compromised: every
input (lockfiles, `.npmrc`, workflow YAML) is treated as hostile. Reads are
size-capped and confined to the project root, symlinks are never followed,
YAML anchors/aliases make a file "undeterminable" rather than trusted,
terminal output is stripped of control characters, and anything unparseable
is reported as a warning — never silently treated as OK. The forbidden-API
surface (`child_process`, `eval`, network modules, `fs` outside the io layer,
`process.env` beyond `NO_COLOR`/`FORCE_COLOR`/`CI`) is machine-checked in CI
by `scripts/check-restrictions.mts`.

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Development

```console
$ npm ci --ignore-scripts
$ npm test                    # build + golden/hostile/property/E2E suites
$ npm run check:restrictions  # forbidden-API scan (TS Compiler API)
$ npm run check:package       # publishable-content allowlist + size budget
$ npm run bench               # 5MB-lockfile check under 300ms
```

Dev scripts (`scripts/*.mts`) run directly on Node >= 23.6 (or 22.6+ with
`--experimental-strip-types`). This repository dogfoods every rule it ships:
see [.npmrc](.npmrc) and `armor check` running against itself in CI.

## License

[MIT](LICENSE)
