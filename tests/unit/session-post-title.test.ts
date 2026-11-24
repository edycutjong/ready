/**
 * a2a arch-01 (P1d): clause 2 must come from the post-title press itself. The typed listing stays on screen above
 * RUN and usually contains the PRINT of the post-title text, so a whole-screen search passed without the press
 * producing anything. Real C64 core (c64-ready), no mocks.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { bootNodeCore } from "../../src/emu/node.ts";
import type { C64Core } from "../../src/emu/core.ts";
import { runListing, type ListingSpec } from "../../src/emu/session.ts";
import { computeChecksum } from "../../src/basic/checksum.ts";
import type { CanonicalListing } from "../../src/basic/types.ts";

const listing = (rows: [number, string][]): CanonicalListing =>
  rows.map(([n, body]) => ({ n, body, printed: computeChecksum(n, body), status: "verified", source: "ocr" }));
const spec = (l: CanonicalListing, post: string): ListingSpec => ({
  expectedLines: l.map((x) => x.n), titlePredicate: { screenContains: "HELLO" }, postTitle: { keys: [13], screenContains: post },
});

let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); });

describe("post-title clause needs fresh evidence (a2a arch-01)", () => {
  it("fails when the text is only in the typed listing above RUN, never printed by the press", () => {
    // line 40 is never reached: RETURN ends the program at line 30, yet "SEEDS" sits on screen inside the typed listing
    const l = listing([[10, 'PRINT "HELLO"'], [20, 'GET A$:IF A$="" THEN 20'], [30, "END"], [40, 'PRINT "SEEDS"']]);
    const f = runListing(core, l, spec(l, "SEEDS"), 1500);
    expect(f.titleSeen).toBe(true);
    expect(f.screens.postTitle).toContain("SEEDS"); // the old whole-screen check passed here
    expect(f.postTitle).toBe("fail");
  });
  it("fails closed when the text was already on screen before the press", () => {
    const l = listing([[10, 'PRINT "HELLO SEEDS"'], [20, 'GET A$:IF A$="" THEN 20'], [30, 'PRINT "SEEDS"']]);
    expect(runListing(core, l, spec(l, "SEEDS"), 1500).postTitle).toBe("fail");
  });
  it("passes when the press produces the text (positive control)", () => {
    const l = listing([[10, 'PRINT "HELLO"'], [20, 'GET A$:IF A$="" THEN 20'], [30, 'PRINT "SEEDS"']]);
    const f = runListing(core, l, spec(l, "SEEDS"), 1500);
    expect(f.titleSeen).toBe(true);
    expect(f.postTitle).toBe("pass");
  });
});
