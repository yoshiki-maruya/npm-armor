// Deterministic synthetic package-lock.json generator (bench + size fixtures).
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTempDir } from "./fixture-io.js";

const INTEGRITY_FILLER = "sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8yDtgTWSzvpGw==";

/** Generate a realistic v3 lockfile of at least `targetBytes` bytes. */
export function generateNpmLockText(targetBytes: number): string {
  const packages: Record<string, unknown> = {
    "": { name: "bench-fixture", version: "1.0.0" },
  };
  const parts: string[] = [];
  let approx = 0;
  for (let i = 0; approx < targetBytes; i++) {
    const name = `pkg-${i}`;
    const entry = {
      version: `1.${i % 100}.${i % 10}`,
      resolved: `https://registry.npmjs.org/${name}/-/${name}-1.${i % 100}.${i % 10}.tgz`,
      integrity: INTEGRITY_FILLER,
      engines: { node: ">=14" },
      dependencies: {
        [`dep-a-${i}`]: "^1.0.0",
        [`dep-b-${i}`]: "^2.3.4",
        [`dep-c-${i}`]: "~0.9.1",
      },
      funding: { type: "opencollective", url: `https://opencollective.com/${name}` },
    };
    packages[`node_modules/${name}`] = entry;
    const chunk = JSON.stringify(entry);
    parts.push(chunk);
    approx += chunk.length + name.length + 20;
  }
  return JSON.stringify(
    { name: "bench-fixture", version: "1.0.0", lockfileVersion: 3, requires: true, packages },
    null,
    2,
  );
}

/** Materialize a temp npm project whose lockfile is >= targetBytes. */
export function makeBenchProject(targetBytes: number): { dir: string; lockBytes: number } {
  const dir = makeTempDir("npm-armor-bench-");
  const lock = generateNpmLockText(targetBytes);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "bench-fixture", version: "1.0.0" }));
  fs.writeFileSync(path.join(dir, "package-lock.json"), lock);
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".npmrc"),
    "min-release-age=7\nignore-scripts=true\nallow-git=none\nsave-exact=true\n",
  );
  return { dir, lockBytes: Buffer.byteLength(lock) };
}
