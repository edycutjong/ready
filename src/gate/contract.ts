/**
 * The three terminal states (.kiro/specs/checksum-oracle R5; agents.md §4 "What resurrected means").
 * Computed from the final listing and emulator facts, never from a model's claim. Pure and isomorphic.
 *
 * claude-direct (P1a, Kiro credit cap for this spec line reached — see docs/DX-REPORT.md).
 * Two deliberate deviations from design.md, both resolved in favour of requirements.md / agents.md:
 *  - NOT-RESURRECTED returns a clause-1 `failed` entry (R5.6 requires a non-empty `failed`; design.md said []).
 *  - `counts.typed` counts lines a PERSON typed (source "typed"), as the certificate and video captions use it
 *    ("1 line typed"); the number of in-scope lines present is `counts.present` (R5.5 amended).
 */
import { tokenizeProgram } from "../basic/tokenizer.ts";
import { parseBody } from "../basic/notation.ts";
import { checkLine } from "./checksum-gate.ts";
import type { CanonicalListing } from "../basic/types.ts";

export interface ContractInput {
  listing: CanonicalListing;
  expectedLines: readonly number[];
  titleSeen: boolean;
  postTitle: "pass" | "fail" | "not-reached";
  residentBytes: Uint8Array;
  provisional: ReadonlySet<number>;
  /** the listing's certificate scope ("title-path" | "whole listing"); omitted = title-path (QA P1b r3: the heading names the scope) */
  scope?: string;
}

export type Verdict = "RESURRECTED" | "BOOTED-PARTIAL" | "NOT-RESURRECTED";
export type Clause = 1 | 2 | 3 | 4 | 5 | 6;

export interface ContractResult {
  verdict: Verdict;
  counts: {
    verified: number; digitMisread: number; eyeVerified: number; forced: number; unverified: number;
    present: number; typed: number; missing: number; orphansExcluded: number;
  };
  failed: { clause: Clause; lines: number[] }[];
  heading: string;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const GOOD = new Set(["verified", "digit-misread", "eye-verified"]);

/**
 * Clause 4 recomputes each line's checksum from its body and printed sum instead of trusting the stored label
 * (a2a arch-01): a "verified" written by an earlier stage can never outlive its evidence. An eye-verified line is a
 * person's reading of the page; it still needs a body the C64 can type.
 */
function isGood(l: CanonicalListing[number]): boolean {
  if (!GOOD.has(l.status)) return false;
  if (l.status === "eye-verified") return parseBody(l.body).dropped.length === 0;
  const c = checkLine(l.n, l.body, l.printed);
  return c.status === "verified" || c.status === "digit-misread";
}

export function evaluate(input: ContractInput): ContractResult {
  const expected = new Set(input.expectedLines);
  const inScope = input.listing.filter((l) => expected.has(l.n));
  const orphans = input.listing.filter((l) => !expected.has(l.n));
  const occurrences = new Map<number, number>();
  for (const l of inScope) occurrences.set(l.n, (occurrences.get(l.n) ?? 0) + 1);
  const missing = input.expectedLines.filter((n) => !occurrences.has(n));
  const duplicated = [...occurrences].filter(([, c]) => c > 1).map(([n]) => n);

  const by = (s: string) => inScope.filter((l) => l.status === s).length;
  const counts = {
    verified: by("verified"), digitMisread: by("digit-misread"), eyeVerified: by("eye-verified"), forced: by("forced"), unverified: by("unverified"),
    present: inScope.length,
    typed: inScope.filter((l) => l.source === "typed").length,
    missing: missing.length,
    orphansExcluded: orphans.length,
  };

  const failed: ContractResult["failed"] = [];
  if (!input.titleSeen) failed.push({ clause: 1, lines: [] });
  if (input.postTitle !== "pass") failed.push({ clause: 2, lines: [] });
  if (missing.length || duplicated.length) failed.push({ clause: 3, lines: [...missing, ...duplicated].sort((a, b) => a - b) });
  const notGood = inScope.filter((l) => !isGood(l) || input.provisional.has(l.n)).map((l) => l.n);
  if (notGood.length) failed.push({ clause: 4, lines: [...new Set(notGood)].sort((a, b) => a - b) });
  const forced = inScope.filter((l) => l.status === "forced").map((l) => l.n);
  if (forced.length) failed.push({ clause: 5, lines: forced.sort((a, b) => a - b) });
  const image = tokenizeProgram([...inScope].sort((a, b) => a.n - b.n).map((l) => ({ n: l.n, body: l.body })));
  if (!bytesEqual(input.residentBytes, image)) failed.push({ clause: 6, lines: [] });

  const verdict: Verdict = !input.titleSeen ? "NOT-RESURRECTED" : failed.length === 0 ? "RESURRECTED" : "BOOTED-PARTIAL";
  const k = inScope.filter(isGood).length;
  const state = verdict === "RESURRECTED" ? "RESURRECTED" : verdict === "BOOTED-PARTIAL" ? "BOOTED — PARTIAL" : "NOT RESURRECTED";
  const prefix = !input.titleSeen ? "NO-TITLE " : (input.scope ?? "title-path") === "title-path" ? "TITLE-PATH " : "";
  const heading = `${prefix}${state} · ${k}/${input.expectedLines.length} checksum-consistent`;
  return { verdict, counts, failed: verdict === "RESURRECTED" ? [] : failed, heading };
}
