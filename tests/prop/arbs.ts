/** Shared fast-check generators for the gate/contract properties (claude-direct, P1a). Authored text only. */
import fc from "fast-check";
import { computeChecksum } from "../../src/basic/checksum.ts";
import type { CanonicalListing, LineStatus } from "../../src/basic/types.ts";
import type { PatchOp } from "../../src/gate/checksum-gate.ts";

export const ATOMS = ["PRINT", "GOTO", "IF", "THEN", "FOR", "TO", "NEXT", "POKE", "PEEK(", "GET", "A$", "X", "I", "1", "2", "10", "53280", "+", "-", "*", "=", "<", ">", "(", ")", ":", ",", ";"];
export const body = fc.array(fc.constantFrom(...ATOMS), { minLength: 1, maxLength: 8 }).map((a) => a.join(""));
/** one OCR-style single-character mutation */
export const mutate = (b: string, i: number, c: string) => (b.length ? b.slice(0, i % b.length) + c + b.slice((i % b.length) + 1) : c);
export const ocrChar = fc.constantFrom("0", "O", "8", "9", "@", "S", "$", "l", "1", "I", "(", "{", "[");

/** A listing whose printed sums were computed from a TRUE body, while the current body may be an OCR mutation of it. */
export const scenario = fc.uniqueArray(fc.integer({ min: 1, max: 9999 }), { minLength: 1, maxLength: 6 }).chain((nums) =>
  fc.tuple(...nums.map((n) => fc.record({ n: fc.constant(n), truth: body, i: fc.nat(), c: ocrChar, broken: fc.boolean(), unreadable: fc.boolean() }))).map((rows) => {
    const listing: CanonicalListing = rows.map((r) => {
      const cur = r.broken ? mutate(r.truth, r.i, r.c) : r.truth;
      const printed = r.unreadable ? null : computeChecksum(r.n, r.truth);
      const status: LineStatus = printed !== null && computeChecksum(r.n, cur) === printed ? "verified" : "unverified";
      return { n: r.n, body: cur, printed, status, source: "ocr" };
    });
    return { listing, truths: rows.map((r) => ({ n: r.n, body: r.truth })), expected: rows.map((r) => r.n) };
  }),
);

/** Patches biased toward the true fix (so acceptances are common) mixed with arbitrary replaces and renumbers. */
export const patchFor = (s: { listing: CanonicalListing; truths: { n: number; body: string }[]; expected: number[] }) =>
  fc.array(
    fc.oneof(
      fc.constantFrom(...s.truths).map((t): PatchOp => ({ type: "replace", lineno: t.n, new_body: t.body })),
      fc.tuple(fc.constantFrom(...s.listing), fc.nat(), ocrChar).map(([l, i, c]): PatchOp => ({ type: "replace", lineno: l.n, new_body: mutate(l.body, i, c) })),
      fc.tuple(fc.constantFrom(...s.listing), fc.constantFrom(...s.expected)).map(([l, n]): PatchOp => ({ type: "renumber", lineno: l.n, new_lineno: n })),
    ),
    { minLength: 1, maxLength: 4 },
  );
