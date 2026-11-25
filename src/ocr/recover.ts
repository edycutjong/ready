/**
 * OCR → logical listing lines → lost-line recovery BY CODE (agent contract §4 "Lost lines"; spike G0, now in the product).
 * Pure and isomorphic: the OCR engine (tesseract.js, browser worker or Node) hands in physical rows with their boxes;
 * this module joins rows into logical lines, diffs them against the page's line inventory (`expectedLines`), plans
 * the re-OCR of every gap and orphan, chooses between re-OCR candidates by the printed checksum, and returns the
 * canonical starting listing plus one `recovery` event per decision. The model never writes a lost line: a gap is
 * re-OCR'd, else a PERSON types it (scripts/type-lost-lines.mjs), labelled TYPED.
 */
import { computeChecksum } from "../basic/checksum.ts";
import { parseBody } from "../basic/notation.ts";

/**
 * Two readings are one line when the C64 would store the same bytes (arch review 01). The checksum ignores every space
 * (R2.2), but a space inside quotes is typed (R1.4); stripping all whitespace let two readings that differ only in a
 * quoted space count as one and "recover" the first.
 */
const typedKey = (body: string): string => {
  const p = parseBody(body);
  return `${p.codes.join(",")}|${p.dropped.map((d) => d.char).join("")}`;
};

export type Row = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type Logical = { n: number; body: string; printed: number | null; rows: number[] };
export type RecoveryEvent =
  | { k: "recovery"; op: "re-ocr"; line: number; outcome: "recovered" | "ambiguous" | "still-lost"; candidates: number; validDistinct: number; gap: [number, number] }
  | { k: "recovery"; op: "orphan"; ocrNumber: number; outcome: "renumbered-by-re-ocr" | "orphan-excluded"; to?: number }
  | { k: "recovery"; op: "collision"; line: number; kept: string; dropped: number };

/** Frozen number-token rule (spike O): slashed-zero glyphs ¢ and @ in a LINE NUMBER read as 0. */
export const normalizeNumberToken = (tok: string): string => tok.replace(/[¢@]/g, "0");

const REM = /^(.*?)\s*[:;]?\s*[rR][eEoO][mMnN]\s*(\S{1,4})\s*$/;
const parsePrinted = (raw: string): number | null => (/^\d{1,3}$/.test(raw) && Number(raw) < 256 ? Number(raw) : null);

/** Physical rows → logical lines: a line starts with a 1–4 digit number and ends at its `:rem NNN`; rows between join. */
export function logicalFromRows(rows: readonly Row[]): Logical[] {
  const out: (Logical & { done: boolean })[] = [];
  let cur: (Logical & { done: boolean }) | null = null;
  rows.forEach((row, i) => {
    const l = row.text.trim();
    if (!l) return;
    const s0 = l.match(/^(\S{1,4})\s+(.*)$/);
    const tok = s0 ? normalizeNumberToken(s0[1]) : null;
    if (s0 && tok && /^\d{1,4}$/.test(tok) && (!cur || cur.done)) {
      if (cur) out.push(cur);
      cur = { n: Number(tok), body: s0[2], printed: null, rows: [i], done: false };
    } else if (cur && !cur.done) { cur.body += " " + l; cur.rows.push(i); } else return;
    const r = cur.body.match(REM);
    if (r) { cur.body = r[1].trim(); cur.printed = parsePrinted(r[2]); cur.done = true; }
  });
  if (cur) out.push(cur);
  return out.map(({ done: _d, ...l }) => l);
}

/** Plain OCR text (a re-OCR of one crop) → logical lines, same rules. */
export const logicalFromText = (text: string): Logical[] => logicalFromRows(text.split("\n").map((t) => ({ text: t, bbox: { x0: 0, y0: 0, x1: 0, y1: 0 } })));

export type Plan = { inScope: Logical[]; absent: { n: number; gap: [number, number] }[]; orphans: Logical[] };

/** Diff OCR vs the inventory. `inScope` keeps lines within the scope's number ranges; gaps are pixel spans between neighbours. */
export function planRecovery(logical: readonly Logical[], rows: readonly Row[], expected: readonly number[], ranges: readonly [number, number][]): Plan {
  const inRange = (n: number) => ranges.some(([a, b]) => n >= a && n <= b);
  const inScope = logical.filter((l) => inRange(l.n));
  const seen = new Set(inScope.map((l) => l.n));
  const orphans = inScope.filter((l) => !expected.includes(l.n));
  const absent = expected.filter((n) => !seen.has(n)).map((n) => {
    const i = expected.indexOf(n);
    const prevN = [...expected.slice(0, i)].reverse().find((x) => seen.has(x));
    const nextN = expected.slice(i + 1).find((x) => seen.has(x));
    const prev = inScope.find((l) => l.n === prevN), next = inScope.find((l) => l.n === nextN);
    const y0 = prev ? rows[prev.rows.at(-1)!].bbox.y1 : 0;
    const y1 = next ? rows[next.rows[0]].bbox.y0 : rows.at(-1)?.bbox.y1 ?? 0;
    return { n, gap: [y0, y1] as [number, number] };
  });
  return { inScope, absent, orphans };
}

/** One lost line from its re-OCR candidates: exactly one distinct checksum-valid body → recovered; else TYPED by a person. */
export function chooseRecovered(n: number, candidates: readonly Logical[]): { outcome: "recovered" | "ambiguous" | "still-lost"; line?: Logical; validDistinct: number } {
  const good = candidates.filter((c) => c.n === n && c.printed !== null && computeChecksum(c.n, c.body) === c.printed);
  const distinct = [...new Set(good.map((c) => typedKey(c.body)))];
  if (distinct.length === 1) return { outcome: "recovered", line: good[0], validDistinct: 1 };
  return { outcome: distinct.length > 1 ? "ambiguous" : "still-lost", validDistinct: distinct.length };
}

/** An orphan's re-OCR: a re-read number that is in the inventory, still absent, and keeps the row's printed sum. */
export function resolveOrphan(orphan: Logical, reread: readonly Logical[], expected: readonly number[], present: ReadonlySet<number>): Logical | null {
  return reread.find((l) => expected.includes(l.n) && !present.has(l.n) && (orphan.printed === null || l.printed === orphan.printed)) ?? null;
}
