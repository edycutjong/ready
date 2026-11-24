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
  counts: { ocr: number; reOcr: number; typed: number; patched: number };
  perLine: Map<number, "OCR" | "re-OCR" | "TYPED" | "patched">;
  recovery: RecoveryEvent[];
  orphansExcluded: number;
  /** final lines that did not exist in the run's input: the gate refuses inserts, so this is computed, not assumed */
  addedDuringRun: number[];
  origin: string | null;
};

/** Where every final line came from (spec F10, agents.md §4 "certificate"): computed from the run input and the final listing. */
export function provenance(input: { lines: readonly CanonicalLine[]; recovery?: readonly RecoveryEvent[]; origin?: { recovered?: string; note?: string } | null }, final: CanonicalListing): Provenance {
  const start = new Map(input.lines.map((l) => [l.n, l]));
  const perLine = new Map<number, "OCR" | "re-OCR" | "TYPED" | "patched">();
  const counts = { ocr: 0, reOcr: 0, typed: 0, patched: 0 };
  const addedDuringRun: number[] = [];
  for (const l of final) {
    const s = start.get(l.n);
    if (!s) { addedDuringRun.push(l.n); continue; }
    const tag = s.body !== l.body ? "patched" : s.source === "re-ocr" ? "re-OCR" : s.source === "typed" ? "TYPED" : "OCR";
    perLine.set(l.n, tag);
    counts[tag === "patched" ? "patched" : tag === "re-OCR" ? "reOcr" : tag === "TYPED" ? "typed" : "ocr"]++;
  }
  const recovery = [...(input.recovery ?? [])];
  const origin = input.origin ? [input.origin.note, input.origin.recovered ? `(recovered listing ${input.origin.recovered})` : ""].filter(Boolean).join(" ") || null : null;
  return { counts, perLine, recovery, orphansExcluded: recovery.filter((r) => r.outcome === "orphan-excluded").length, addedDuringRun, origin };
}

export type Erratum = { n: number; printed: number | null; ocr: string; final: string; reason: string };

/** The errata sheet: every line whose final text differs from what OCR read, with the reason the agent gave and the gate accepted. */
export function errata(inputLines: readonly CanonicalLine[], final: CanonicalListing, reasons: ReadonlyMap<number, string> = new Map()): Erratum[] {
  const start = new Map(inputLines.map((l) => [l.n, l]));
  return final.filter((l) => start.has(l.n) && start.get(l.n)!.body !== l.body).sort((a, b) => a.n - b.n)
    .map((l) => ({ n: l.n, printed: l.printed, ocr: start.get(l.n)!.body, final: l.body, reason: reasons.get(l.n) ?? "" }));
}

export function errataText(title: string, heading: string, rows: readonly Erratum[]): string {
  const out = [`ERRATA — ${title}`, heading, `${rows.length} line(s) changed from the OCR read; every change passed the checksum gate (:rem printed on the page).`, ""];
  for (const r of rows) out.push(`${r.n}  :rem ${r.printed ?? "??"}`, `   OCR read : ${r.ocr}`, `   resurrected: ${r.final}`, ...(r.reason ? [`   why      : ${r.reason}`] : []), "");
  return out.join("\n");
}

/** A loadable .PRG: the 2-byte load address $0801 + the same tokenized image contract clause 6 compares with C64 memory. */
export function prgBytes(final: CanonicalListing): Uint8Array {
  const image = tokenizeProgram([...final].sort((a, b) => a.n - b.n).map((l) => ({ n: l.n, body: l.body })));
  const out = new Uint8Array(image.length + 2);
  out[0] = BASIC_START & 0xff; out[1] = BASIC_START >> 8; out.set(image, 2);
  return out;
}
