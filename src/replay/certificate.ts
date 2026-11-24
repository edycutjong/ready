/**
 * Certificate heading (agents.md §4): built from the contract the code computed, named by its SCOPE, with the
 * evaluation-only source-exact count and the listing's own note (e.g. "DATA not executed" on randnum's title path).
 * Example: `TITLE-PATH RESURRECTED · 28/28 checksum-consistent · 19/28 source-exact · DATA not executed`.
 */
import type { ContractResult } from "../gate/contract.ts";

export function certificateHeading(c: Pick<ContractResult, "verdict" | "counts">, scope: string, total: number, extra: { sourceExact?: number; sourceTotal?: number; note?: string } = {}): string {
  const state = c.verdict === "RESURRECTED" ? "RESURRECTED" : c.verdict === "BOOTED-PARTIAL" ? "BOOTED — PARTIAL" : "NOT RESURRECTED";
  const k = c.counts.verified + c.counts.digitMisread + c.counts.eyeVerified;
  const parts = [`${scope === "title-path" ? "TITLE-PATH " : ""}${state}`, `${k}/${total} checksum-consistent`];
  if (extra.sourceExact !== undefined) parts.push(`${extra.sourceExact}/${extra.sourceTotal ?? total} source-exact`);
  if (extra.note) parts.push(extra.note);
  return parts.join(" · ");
}
