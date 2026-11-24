/** P7 single-patch slice (R4.23): deep-equal arguments → deep-equal verdict. */
import fc from "fast-check";
import { expect, it } from "vitest";
import { applyPatch } from "../../src/gate/checksum-gate.ts";
import { patchFor, scenario } from "./arbs.ts";

it("P7a: the gate is deterministic", () => {
  fc.assert(fc.property(scenario.chain((s) => fc.tuple(fc.constant(s), patchFor(s), fc.boolean(), fc.nat({ max: 3 }))), ([s, p, force, c]) => {
    const opts = { force_unverified: force, refusalCounts: Object.fromEntries(s.expected.map((n) => [n, c])) };
    expect(applyPatch(structuredClone(s.listing), structuredClone(p), [...s.expected], opts)).toEqual(applyPatch(structuredClone(s.listing), structuredClone(p), [...s.expected], opts));
  }), { numRuns: 100 });
});
