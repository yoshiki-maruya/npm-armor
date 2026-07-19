// GitHub Actions workflow scan for AR005: extract the shell commands from
// `run:` entries with a tolerant line-oriented pass (plain values, `|`/`>`
// block scalars). We only ever *read* command strings to look for install
// invocations — a wrong guess degrades to a warn, never to code execution.

export interface WorkflowCommand {
  command: string;
  line: number; // 1-based
}

export function extractRunCommands(text: string): WorkflowCommand[] {
  const out: WorkflowCommand[] = [];
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (m === null) continue;
    const keyIndent = (m[1] ?? "").length;
    const rest = (m[2] ?? "").trim();

    if (rest !== "" && !rest.startsWith("|") && !rest.startsWith(">")) {
      out.push({ command: rest, line: i + 1 });
      continue;
    }
    // Block scalar: collect following lines that are more indented than `run:`
    for (let j = i + 1; j < lines.length; j++) {
      const blockLine = lines[j] ?? "";
      if (blockLine.trim() === "") continue;
      const indent = blockLine.length - blockLine.trimStart().length;
      if (indent <= keyIndent) break;
      out.push({ command: blockLine.trim(), line: j + 1 });
    }
  }
  return out;
}
