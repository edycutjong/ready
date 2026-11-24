/**
 * Certificate heading (agents.md §4): built from the contract the code computed, named by its SCOPE, with the
 * evaluation-only source-exact count and the listing's own note (e.g. "DATA not executed" on randnum's title path).
 * Example: `TITLE-PATH RESURRECTED · 28/28 checksum-consistent · 19/28 source-exact · DATA not executed`.
 */
import type { ContractResult } from "../gate/contract.ts";
import type { CanonicalLine, CanonicalListing } from "../basic/types.ts";
import { BASIC_START, tokenizeProgram } from "../basic/tokenizer.ts";

export function certificateHeading(c: Pick<ContractResult, "verdict" | "counts">, scope: string, total: number, extra: { sourceExact?: number; sourceTotal?: number; note?: string } = {}): string {
  const state = c.verdict === "RESURRECTED" ? "RESURRECTED" : c.verdict === "BOOTED-PARTIAL" ? "BOOTED — PARTIAL" : "NOT RESURRECTED";
  const k = c.counts.verified + c.counts.digitMisread + c.counts.eyeVerified;
  const parts = [`${scope === "title-path" ? "TITLE-PATH " : ""}${state}`, `${k}/${total} checksum-consistent`];
  if (extra.sourceExact !== undefined) parts.push(`${extra.sourceExact}/${extra.sourceTotal ?? total} source-exact`);
  if (extra.note) parts.push(extra.note);
  return parts.join(" · ");
}


export type RecoveryEvent = { k?: string; op: string; line?: number; ocrNumber?: number; outcome: string };
export type Provenance = {
  /** final lines by where their text came from: page OCR, a re-OCR of a gap, TYPED by a person, or a gate-accepted Kiro patch */
  counts: { ocr: number; reOcr: number; typed: number; patched: number; forced: number };
  perLine: Map<number, "OCR" | "re-OCR" | "TYPED" | "patched" | "FORCED">;
  recovery: RecoveryEvent[];
  orphansExcluded: number;
  /** final lines that did not exist in the run's input: the gate refuses inserts, so this is computed, not assumed */
  addedDuringRun: number[];
  origin: string | null;
};

/** One accepted or forced patch's ops, in run order (the shape REPLAY records). */
export type AppliedOps = readonly { op?: unknown; type?: unknown; lineno?: unknown; new_lineno?: unknown; new_body?: unknown }[];

/**
 * Final line number → the input line it started as, carried through every applied renumber (a2a arch-01). A batch
 * renumbers atomically and the gate keeps numbers unique (R4.10), so identity is exact; a number never renumbered
 * maps to itself. Without this a renumbered line read as "added during the run" and dropped out of the errata.
 */
export function lineOrigins(batches: readonly AppliedOps[]): Map<number, number> {
  let cur = new Map<number, number>();
  for (const ops of batches) {
    // the gate keeps the LAST renumber of a line within one batch (finalNumber), so keep the last op per source line
    const moves = [...new Map(ops.filter((o) => (o.op ?? o.type) === "renumber").map((o) => [Number(o.lineno), Number(o.new_lineno)] as const)).entries()];
    if (!moves.length) continue;
    const next = new Map<number, number>();
    const moved = new Set(moves.map(([from]) => from));
    for (const [from, to] of moves) next.set(to, cur.get(from) ?? from);
    for (const [n, o] of cur) if (!moved.has(n) && !next.has(n)) next.set(n, o);
    cur = next;
  }
  return cur;
}

/** Where every final line came from (spec F10, agents.md §4 "certificate"): computed from the run input and the final listing. */
export function provenance(input: { lines: readonly CanonicalLine[]; recovery?: readonly RecoveryEvent[]; origin?: { recovered?: string; note?: string } | null }, final: CanonicalListing, origins: ReadonlyMap<number, number> = new Map()): Provenance {
  const start = new Map(input.lines.map((l) => [l.n, l]));
  const perLine = new Map<number, "OCR" | "re-OCR" | "TYPED" | "patched" | "FORCED">();
  // a FORCED line was changed by the agent after repeated refusals and never verified: never counted as gate-accepted
  const counts = { ocr: 0, reOcr: 0, typed: 0, patched: 0, forced: 0 };
  const addedDuringRun: number[] = [];
  for (const l of final) {
    const from = origins.get(l.n) ?? l.n;
    const s = start.get(from);
    if (!s) { addedDuringRun.push(l.n); continue; }
    const changed = s.body !== l.body || from !== l.n;
    const tag = changed ? (l.status === "forced" ? "FORCED" : "patched") : s.source === "re-ocr" ? "re-OCR" : s.source === "typed" ? "TYPED" : "OCR";
    perLine.set(l.n, tag);
    counts[tag === "FORCED" ? "forced" : tag === "patched" ? "patched" : tag === "re-OCR" ? "reOcr" : tag === "TYPED" ? "typed" : "ocr"]++;
  }
  const recovery = [...(input.recovery ?? [])];
  const origin = input.origin ? [input.origin.note, input.origin.recovered ? `(recovered listing ${input.origin.recovered})` : ""].filter(Boolean).join(" ") || null : null;
  return { counts, perLine, recovery, orphansExcluded: recovery.filter((r) => r.outcome === "orphan-excluded").length, addedDuringRun, origin };
}

export type Erratum = { n: number; printed: number | null; ocr: string; final: string; reason: string; renumberedFrom: number | null; forced: boolean; status: CanonicalLine["status"] };

/** The errata sheet: every line whose final text or number differs from what OCR read, with the reason the agent gave. */
export function errata(inputLines: readonly CanonicalLine[], final: CanonicalListing, reasons: ReadonlyMap<number, string> = new Map(), origins: ReadonlyMap<number, number> = new Map()): Erratum[] {
  const start = new Map(inputLines.map((l) => [l.n, l]));
  const from = (n: number) => origins.get(n) ?? n;
  return final.filter((l) => start.has(from(l.n)) && (start.get(from(l.n))!.body !== l.body || from(l.n) !== l.n)).sort((a, b) => a.n - b.n)
    .map((l) => ({
      n: l.n, printed: l.printed, ocr: start.get(from(l.n))!.body, final: l.body, reason: reasons.get(l.n) ?? reasons.get(from(l.n)) ?? "",
      renumberedFrom: from(l.n) !== l.n ? from(l.n) : null, forced: l.status === "forced", status: l.status,
    }));
}

export function errataText(title: string, heading: string, rows: readonly Erratum[]): string {
  // Say what each change rests on (a2a arch-01 QA): only a "verified" row matched the :rem printed on the page.
  const by = (s: Erratum["status"]) => rows.filter((r) => r.status === s).length;
  const parts: [number, string][] = [
    [by("verified"), "matched the checksum printed on the page"],
    [by("digit-misread"), "matched a misread of the printed checksum digits (digit-misread)"],
    [by("eye-verified"), "were verified by a person's reading of the page"],
    [by("unverified"), "were accepted with no readable printed checksum (unverified)"],
    [by("forced"), "were FORCED after repeated refusals and never checksum-verified"],
  ];
  const summary = rows.length > 0 && by("verified") === rows.length
    ? "Every change passed the checksum gate (:rem printed on the page)."
    : parts.filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`).join("; ") + ".";
  const out = [`ERRATA — ${title}`, heading, `${rows.length} line(s) changed from the OCR read. ${rows.length ? summary : ""}`.trim(), ""];
  const mark = (r: Erratum) => (r.forced ? "   FORCED — never verified" : r.status === "verified" ? "" : `   ${r.status.toUpperCase()}`);
  for (const r of rows) out.push(`${r.n}  :rem ${r.printed ?? "??"}${r.renumberedFrom !== null ? `   (was line ${r.renumberedFrom})` : ""}${mark(r)}`, `   OCR read : ${r.ocr}`, `   resurrected: ${r.final}`, ...(r.reason ? [`   why      : ${r.reason}`] : []), "");
  return out.join("\n");
}

/** A loadable .PRG: the 2-byte load address $0801 + the same tokenized image contract clause 6 compares with C64 memory. */
export function prgBytes(final: CanonicalListing): Uint8Array {
  const image = tokenizeProgram([...final].sort((a, b) => a.n - b.n).map((l) => ({ n: l.n, body: l.body })));
  const out = new Uint8Array(image.length + 2);
  out[0] = BASIC_START & 0xff; out[1] = BASIC_START >> 8; out.set(image, 2);
  return out;
}
