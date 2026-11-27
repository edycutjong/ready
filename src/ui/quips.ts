/**
 * One human line under the gate's verdict on `/` (Cheat and "fix it yourself"). Copy only: the verdict itself, its
 * rule code and its sums are printed unchanged above this line, and nothing here feeds back into the gate.
 */
export function quip(text: string, ok: boolean): string {
  if (/already matches its printed checksum/.test(text)) return "This line is innocent. Look where the red checksum cross points.";
  if (ok) return "It stirs. The checksum printed in 1984 agrees with you.";
  if (/R4\.4\b/.test(text)) return "The dead don't get deleted. Nice try.";
  if (/R4\.7\b/.test(text)) return "That's not a repair, that's a rewrite. The gate lets you change 40% of a line, no more.";
  if (/no C64 key types/.test(text)) return "No key on a C64 types that. The gate noticed.";
  if (/checksum mismatch/.test(text)) return "The magazine's sum says no. It has been saying no since 1984.";
  return "Refused. The gate does not negotiate.";
}
