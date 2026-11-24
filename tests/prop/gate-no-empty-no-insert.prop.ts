/** P4 (R4.4, R4.6, R4.22): any patch with an empty-body replace or a non-replace/renumber op is refused, whatever else it holds. */
import fc from "fast-check";
import { it } from "vitest";
import { applyPatch, type PatchOp } from "../../src/gate/checksum-gate.ts";
import { patchFor, scenario } from "./arbs.ts";

it("P4: the gate never accepts a deletion or an insert", () => {
  fc.assert(fc.property(scenario.chain((s) => fc.tuple(fc.constant(s), patchFor(s), fc.constantFrom("", "   ", "insert", "delete"), fc.nat(), fc.boolean(), fc.nat({ max: 9 }))),
    ([s, patch, poison, at, force, count]) => {
      const target = s.listing[at % s.listing.length].n;
      const bad = (poison === "insert" || poison === "delete" ? { type: poison, lineno: target, new_body: "END" } : { type: "replace", lineno: target, new_body: poison }) as unknown as PatchOp;
      const p = [...patch.slice(0, 3)]; p.splice(at % (p.length + 1), 0, bad);
      const v = applyPatch(s.listing, p, s.expected, { force_unverified: force, refusalCounts: Object.fromEntries(s.expected.map((n) => [n, count])) });
      return v.verdict === "refused";
    }), { numRuns: 100 });
});
