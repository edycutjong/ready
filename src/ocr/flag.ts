/**
 * ASSISTED part 1 core (browser and tests, pure): OCR'd logical lines → per-line checksum flags, plus the
 * ASSISTED certificate. The Gazette `:rem NNN` is the magazine's own checksum; a line is only ever "ok" when the
 * checksum recomputed from the line as it stands equals the printed one. No Kiro call, no emulator.
 */
import { computeChecksum } from "../basic/checksum.ts";
import { checkLine } from "../gate/checksum-gate.ts";
import type { Logical } from "./recover.ts";

export type FlagState = "ok" | "digit-misread" | "mismatch" | "no-checksum";
export type FlaggedLine = { n: number; body: string; printed: number | null; computed: number | null; state: FlagState; edited: boolean; untypeable?: string };

export function flagLine(n: number, body: string, printed: number | null, edited = false): FlaggedLine {
  if (printed === null) return { n, body, printed, computed: null, state: "no-checksum", edited };
  const r = checkLine(n, body, printed);
  const computed = computeChecksum(n, body);
  const untypeable = r.status === "mismatch" ? r.untypeable : undefined;
  return { n, body, printed, computed, state: r.status === "verified" ? "ok" : r.status === "digit-misread" ? "digit-misread" : "mismatch", edited, ...(untypeable ? { untypeable } : {}) };
}

export const flagAll = (logical: readonly Logical[]): FlaggedLine[] => logical.map((l) => flagLine(l.n, l.body, l.printed));

export type AssistedSummary = { total: number; ok: number; digitMisread: number; mismatch: number; noChecksum: number; edited: number };
export function summarize(lines: readonly FlaggedLine[]): AssistedSummary {
  const c = (s: FlagState) => lines.filter((l) => l.state === s).length;
  return { total: lines.length, ok: c("ok"), digitMisread: c("digit-misread"), mismatch: c("mismatch"), noChecksum: c("no-checksum"), edited: lines.filter((l) => l.edited).length };
}

/** The ASSISTED certificate is never "resurrected": nothing was run, and the page's full line inventory is unknown. */
export function assistedHeading(s: AssistedSummary): string {
  const withSum = s.total - s.noChecksum;
  return `ASSISTED — not automatically resurrected · ${s.ok} of ${withSum} lines with a printed checksum match${s.digitMisread ? ` (+${s.digitMisread} digit-misread)` : ""} · ${s.mismatch} mismatch · ${s.noChecksum} numbered row${s.noChecksum === 1 ? "" : "s"} without a checksum · missing lines: unknown`;
}

/** `.bas`-style export: only lines whose checksum matches are emitted as verified; the rest are listed as comments. */
export function basExport(lines: readonly FlaggedLine[]): string {
  // arch review 01: a digit-misread line stays a program line (clause 4 counts it, and commenting it out would break the
  // program), but the header no longer calls it verified: it matches a confusable reading of the printed digits only.
  const misread = lines.filter((l) => l.state === "digit-misread").map((l) => l.n);
  const out: string[] = [`REM ASSISTED export — numbered lines match the magazine checksum as printed${misread.length ? ", except the DIGIT-MISREAD lines named below" : ""}; REM UNVERIFIED lines do NOT`];
  if (misread.length) out.push(`REM DIGIT-MISREAD (sum matches a misread of the printed checksum digits, not the digits as read): ${misread.join(", ")}`);
  for (const l of lines) out.push(l.state === "ok" || l.state === "digit-misread" ? `${l.n} ${l.body}` : `REM UNVERIFIED (${l.state}) ${l.n} ${l.body}`);
  return out.join("\n") + "\n";
}

export function errataSheet(lines: readonly FlaggedLine[]): string {
  const bad = lines.filter((l) => l.state === "mismatch");
  if (!bad.length) return "No checksum mismatches.\n";
  return bad.map((l) => (l.untypeable
    ? `line ${l.n}: contains ${JSON.stringify(l.untypeable)}, which no C64 key types — the OCR misread a character; check this line against the page`
    : `line ${l.n}: printed :rem ${l.printed}, computed ${l.computed} — check this line against the page character by character`)).join("\n") + "\n";
}

/**
 * OCR quality gate (eval case 7): an unreadable scan stops BEFORE any further step, with 0 credits. Readable = at least
 * 3 logical lines, of which at least one carries a printed `:rem` checksum (otherwise there is nothing to verify against).
 */
export function scanQuality(logical: readonly { n: number; printed: number | null }[]): { readable: boolean; reason: string } {
  if (logical.length < 3) return { readable: false, reason: `only ${logical.length} numbered line${logical.length === 1 ? "" : "s"} found — the scan is too blurred, too small or not a listing page` };
  if (!logical.some((l) => l.printed !== null)) return { readable: false, reason: "no printed :rem checksum could be read — nothing to verify against" };
  return { readable: true, reason: `${logical.length} lines, ${logical.filter((l) => l.printed !== null).length} with a printed checksum` };
}
