/**
 * ASSISTED part 1 core (browser and tests, pure): OCR'd logical lines → per-line checksum flags, plus the
 * ASSISTED certificate. The Gazette `:rem NNN` is the magazine's own checksum; a line is only ever "ok" when the
 * checksum recomputed from the line as it stands equals the printed one. No Kiro call, no emulator.
 */
import { computeChecksum } from "../basic/checksum.ts";
import { checkLine } from "../gate/checksum-gate.ts";
import type { Logical } from "./recover.ts";

export type FlagState = "ok" | "digit-misread" | "mismatch" | "no-checksum";
export type FlaggedLine = { n: number; body: string; printed: number | null; computed: number | null; state: FlagState; edited: boolean };

export function flagLine(n: number, body: string, printed: number | null, edited = false): FlaggedLine {
  if (printed === null) return { n, body, printed, computed: null, state: "no-checksum", edited };
  const r = checkLine(n, body, printed);
  const computed = computeChecksum(n, body);
  return { n, body, printed, computed, state: r.status === "verified" ? "ok" : r.status === "digit-misread" ? "digit-misread" : "mismatch", edited };
}

export const flagAll = (logical: readonly Logical[]): FlaggedLine[] => logical.map((l) => flagLine(l.n, l.body, l.printed));

export type AssistedSummary = { total: number; ok: number; digitMisread: number; mismatch: number; noChecksum: number; edited: number };
export function summarize(lines: readonly FlaggedLine[]): AssistedSummary {
  const c = (s: FlagState) => lines.filter((l) => l.state === s).length;
  return { total: lines.length, ok: c("ok"), digitMisread: c("digit-misread"), mismatch: c("mismatch"), noChecksum: c("no-checksum"), edited: lines.filter((l) => l.edited).length };
}

/** The ASSISTED certificate is never "resurrected": nothing was run, and the page's full line inventory is unknown. */
export function assistedHeading(s: AssistedSummary): string {
  return `ASSISTED — not automatically resurrected · ${s.ok} of ${s.total} lines match the printed checksum${s.digitMisread ? ` (+${s.digitMisread} digit-misread)` : ""} · ${s.mismatch} mismatch · ${s.noChecksum} without a checksum · missing lines: unknown`;
}

/** `.bas`-style export: only lines whose checksum matches are emitted as verified; the rest are listed as comments. */
export function basExport(lines: readonly FlaggedLine[]): string {
  const out: string[] = ["REM ASSISTED export — lines below verified against the magazine checksum; others are NOT verified"];
  for (const l of lines) out.push(l.state === "ok" || l.state === "digit-misread" ? `${l.n} ${l.body}` : `REM UNVERIFIED (${l.state}) ${l.n} ${l.body}`);
  return out.join("\n") + "\n";
}

export function errataSheet(lines: readonly FlaggedLine[]): string {
  const bad = lines.filter((l) => l.state === "mismatch");
  if (!bad.length) return "No checksum mismatches.\n";
  return bad.map((l) => `line ${l.n}: printed :rem ${l.printed}, computed ${l.computed} — check this line against the page character by character`).join("\n") + "\n";
}
