// Minimal text patching (design §4.4): only the targeted lines change;
// comments, ordering and the file's EOL style are preserved. An anchor that
// no longer matches aborts the whole plan — we never guess.
import type { PatchPlan } from "../model.js";

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

export function applyPlanToText(original: string | undefined, plan: PatchPlan): string {
  const text = original ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rawLines = text === "" ? [] : text.split("\n");
  // Drop the phantom empty element produced by a trailing newline.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();
  const lines = rawLines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));

  for (const edit of plan.edits) {
    if (edit.op === "replace-line") {
      if (edit.anchor === undefined) throw new PatchError("replace-line requires an anchor");
      // Last occurrence: for duplicated keys npm/pnpm honor the last one, so
      // that is the line whose replacement changes the effective value.
      const idx = lines.lastIndexOf(edit.anchor);
      if (idx === -1) {
        throw new PatchError(`anchor line not found in ${plan.file}: ${JSON.stringify(edit.anchor)}`);
      }
      lines[idx] = edit.newLine;
      continue;
    }
    // insert-line
    if (edit.anchor === undefined) {
      lines.push(edit.newLine);
      continue;
    }
    const idx = lines.lastIndexOf(edit.anchor);
    if (idx === -1) {
      throw new PatchError(`anchor line not found in ${plan.file}: ${JSON.stringify(edit.anchor)}`);
    }
    lines.splice(idx + 1, 0, edit.newLine);
  }

  return lines.length === 0 ? "" : `${lines.join(eol)}${eol}`;
}
