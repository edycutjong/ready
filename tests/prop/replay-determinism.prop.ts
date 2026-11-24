/** P7 full sequence (R4.23, R6.2): replaying the same accepted patch sequence from the same start yields the identical listing hash. */
import fc from "fast-check";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { applyPatch, type PatchOp } from "../../src/gate/checksum-gate.ts";
import type { CanonicalListing } from "../../src/basic/types.ts";
import { patchFor, scenario } from "./arbs.ts";

const hash = (l: CanonicalListing) => createHash("sha1").update(JSON.stringify(l.map((x) => [x.n, x.body, x.status]))).digest("hex");
function replay(start: CanonicalListing, seq: PatchOp[][], expected: number[]): CanonicalListing | null {
  let cur = structuredClone(start);
  for (const p of seq) { const v = applyPatch(cur, p, expected); if (v.verdict !== "accepted") return null; cur = v.listing; }
  return cur;
}
it("P7b: an accepted patch sequence replays to the same listing hash", () => {
  let kept = 0;
  fc.assert(fc.property(scenario.chain((s) => fc.tuple(fc.constant(s), fc.array(patchFor(s), { minLength: 1, maxLength: 5 }))), ([s, seq]) => {
    const a = replay(s.listing, seq, s.expected);
    if (!a) return true;
    kept++;
    const b = replay(s.listing, seq, s.expected)!;
    expect(b).toEqual(a);
    expect(hash(b)).toBe(hash(a));
  }), { numRuns: 100 });
  expect(kept).toBeGreaterThan(0);
});
