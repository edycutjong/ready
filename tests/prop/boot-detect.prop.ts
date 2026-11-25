/**
 * bugfix-boot-detect P1 (design.md): a title that the program shows and then clears is seen whatever its duration.
 * For a delay loop of N iterations (0..400) between PRINT"{CLR}THE CRYPT" and the next {CLR}, runListing reports
 * titleSeen and the post-title press produces OPENED. On the pre-fix code (50-frame sampling) short N failed:
 * evidence/boot-detect/baseline.md records the failing delays. Real C64 core, authored listings only.
 */
import fc from "fast-check";
import { beforeAll, expect, it } from "vitest";
import { bootNodeCore } from "../../src/emu/node.ts";
import type { C64Core } from "../../src/emu/core.ts";
import { runListing, type ListingSpec } from "../../src/emu/session.ts";
import type { CanonicalListing } from "../../src/basic/types.ts";

let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); });

export const flashListing = (delay: number): CanonicalListing =>
  ['PRINT"{CLR}THE CRYPT"', `FORI=1TO${delay}:NEXT`, 'PRINT"{CLR}PRESS RETURN"', 'GETK$:IFK$=""THEN40', 'PRINT"OPENED"']
    .map((body, i) => ({ n: (i + 1) * 10, body, printed: null, status: "forced" as const, source: "test" }));
const spec: ListingSpec = { expectedLines: [10, 20, 30, 40, 50], titlePredicate: { screenContains: "THE CRYPT" }, postTitle: { keys: [13], screenContains: "OPENED" } };

it("P1: a flashed title is seen for every delay 0..400, and the post-title press still produces its text", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 400 }), (delay) => {
    const f = runListing(core, flashListing(delay), spec);
    expect(f.run.error).toBeNull();
    expect(f.titleSeen).toBe(true);
    expect(f.postTitle).toBe("pass");
  }), { numRuns: 12, examples: [[0], [1], [25], [400]] });
});
