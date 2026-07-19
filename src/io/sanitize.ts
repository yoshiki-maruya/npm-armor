// Terminal-escape defense (threat T4): any string that originated in a target
// repository must pass through here before reaching a reporter. Strips all C0
// controls (incl. ESC, \n, \t), DEL and C1 controls, so a hostile package name
// cannot move the cursor, retitle the window or forge report lines.

// Single character class — linear time, no backtracking (threat T3).
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

export function sanitizeForTerminal(s: string): string {
  return s.replace(CONTROL_CHARS, "");
}
