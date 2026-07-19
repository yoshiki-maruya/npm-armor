// Dependency-free argument parser: long flags only, "--flag value" and
// "--flag=value", strict about unknown flags (typos must not silently change
// security-relevant behavior).

export interface FlagSpec {
  name: string; // without the leading "--"
  hasValue: boolean;
}

export interface ParsedArgs {
  values: Map<string, string | true>;
  positionals: string[];
  errors: string[];
}

export function parseArgs(argv: readonly string[], flags: readonly FlagSpec[]): ParsedArgs {
  const byName = new Map(flags.map((f) => [f.name, f]));
  const out: ParsedArgs = { values: new Map(), positionals: [], errors: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      out.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const spec = byName.get(name);
    if (spec === undefined) {
      out.errors.push(`unknown option --${name}`);
      continue;
    }
    if (!spec.hasValue) {
      if (eq !== -1) out.errors.push(`option --${name} does not take a value`);
      else out.values.set(name, true);
      continue;
    }
    if (eq !== -1) {
      out.values.set(name, arg.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out.errors.push(`option --${name} requires a value`);
      continue;
    }
    out.values.set(name, next);
    i += 1;
  }
  return out;
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.values.get(name);
  return typeof v === "string" ? v : undefined;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.values.get(name) === true;
}
