/**
 * Judge review 01: a visitor's own fix on the desk ("fix it yourself"). Kept out of replay.ts, whose bytes are pinned by
 * the sha256 freezes in evidence/freeze/, so the gate code the recorded runs were judged with stays byte-identical.
 */
import { applyPatch, type GateVerdict } from "../gate/checksum-gate.ts";
import type { CanonicalListing } from "../basic/types.ts";
/**
 * A visitor's own fix, typed the way a C64 owner types a line ("20 PRINT…"), judged by the same applyPatch as the
 * agent's apply_patch and the Pre Tool Use hook. No C64 runs it: only the gate's clauses (typeable, checksum = printed,
 * edit cap, no delete/insert) decide. The leading spaces after the number are dropped, as the C64's line editor does.
 */
export function judgePatch(listing: CanonicalListing, expectedLines: readonly number[], typed: string): { line: number; verdict: GateVerdict } | { line: null; error: string } {
  const m = /^\s*(\d+)\s*([\s\S]*)$/.exec(typed.replace(/[\r\n]+/g, " "));
  if (!m) return { line: null, error: "Type the line as you would on a C64: its number first, then the program text (e.g. 20 PRINT\"HELLO\")." };
  const line = Number(m[1]);
  return { line, verdict: applyPatch(listing, [{ type: "replace", lineno: line, new_body: m[2].trimEnd() }], expectedLines) };
}
