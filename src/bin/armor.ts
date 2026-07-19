#!/usr/bin/env node
// CLI entry: argument routing and lazy imports only (startup budget, §5.4).

const USAGE = `usage: armor <command> [options]

commands:
  check    [--dir <path>] [--format tty|json] [--config <path>]  diagnose supply-chain defenses
  fix      [--write] [--rule <id>...] [--preset recommended|strict]  preview (default) or apply fixes
  rules    [--json]                                              list rules
  explain  <ruleId>                                              explain a rule

options:
  --version   print version
  --help      show this help
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    const { loadToolMeta } = await import("../cli/meta.js");
    const meta = loadToolMeta();
    process.stdout.write(`${meta.name} ${meta.version}\n`);
    return 0;
  }

  switch (command) {
    case "check": {
      const { runCheck } = await import("../cli/check.js");
      return runCheck(argv.slice(1));
    }
    case "fix": {
      const { runFix } = await import("../cli/fix.js");
      return runFix(argv.slice(1));
    }
    case "rules": {
      const { runRulesCommand } = await import("../cli/rules.js");
      return runRulesCommand(argv.slice(1));
    }
    case "explain": {
      const { runExplain } = await import("../cli/explain.js");
      return runExplain(argv.slice(1));
    }
    default:
      console.error(`armor: unknown command ${JSON.stringify(command)}\n`);
      process.stdout.write(USAGE);
      return 2;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    // A crash is always a bug (principle 6) — report as execution error.
    console.error(`armor: unexpected error: ${String(e)}`);
    process.exitCode = 2;
  },
);
