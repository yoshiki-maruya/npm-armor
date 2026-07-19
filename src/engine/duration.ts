// Cooldown durations: internal unit is minutes (design §4.3).

/** Parse "30m" / "24h" / "7d" / bare minutes ("1440") into minutes. */
export function parseDurationToMinutes(raw: string): number | undefined {
  const m = /^(\d+)([mhd])?$/.exec(raw.trim());
  if (m === null) return undefined;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n)) return undefined;
  switch (m[2]) {
    case "h":
      return n * 60;
    case "d":
      return n * 1440;
    default:
      return n;
  }
}

/** Human-readable rendering: exact days/hours when clean, else minutes. */
export function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0 && minutes > 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0 && minutes > 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** npm's min-release-age is in days; strengthening only, so round up. */
export function minutesToNpmDays(minutes: number): number {
  return Math.ceil(minutes / 1440);
}
