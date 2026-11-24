/** The recorded c64_run result is a report: header lines, then `--- AFTER RUN ---`, `--- TITLE ---`, `--- POST-TITLE ---` screens. Show the furthest screen the run reached. */
export function screenOf(report: string): string {
  const parts = report.split(/^--- ([A-Z -]+) ---$/m); // [header, name1, body1, name2, body2, …]
  const bodies = new Map<string, string>();
  for (let i = 1; i + 1 < parts.length; i += 2) bodies.set(parts[i], parts[i + 1].replace(/^\n+|\s+$/g, ""));
  return bodies.get("POST-TITLE") ?? bodies.get("TITLE") ?? bodies.get("AFTER RUN") ?? report;
}
