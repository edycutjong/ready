/** P5 (R4.12–R4.15): after an accepted patch, every line the patch touched that has a printed sum is verified or digit-misread. */
import fc from "fast-check";
import { expect, it } from "vitest";
import { applyPatch } from "../../src/gate/checksum-gate.ts";
import { computeChecksum } from "../../src/basic/checksum.ts";
import { patchFor, scenario } from "./arbs.ts";

it("P5: accepted patches leave every touched printed-checksum line checksum-consistent", () => {
  let accepted = 0;
  fc.assert(fc.property(scenario.chain((s) => fc.tuple(fc.constant(s), patchFor(s))), ([s, patch]) => {
    const v = applyPatch(s.listing, patch, s.expected);
    if (v.verdict !== "accepted") return true;
    accepted++;
    const touched = new Set(v.listing.filter((l) => l.source === "gate").map((l) => l.n));
    return v.listing.filter((l) => touched.has(l.n) && l.printed !== null).every((l) =>
      (l.status === "verified" && computeChecksum(l.n, l.body) === l.printed) || l.status === "digit-misread");
  }), { numRuns: 100 });
  expect(accepted).toBeGreaterThan(10); // the generator is biased so acceptances are not vanishingly rare
});
