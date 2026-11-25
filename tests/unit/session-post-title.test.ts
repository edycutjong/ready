/**
 * arch review 01 (P1d): clause 2 must come from the post-title press itself. The typed listing stays on screen above
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

describe("post-title clause needs fresh evidence (arch review 01)", () => {
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

describe("orphan lines are never typed (arch review 01)", () => {
  it("a typeable line outside the inventory stays out of memory, so clause 6 can pass and the orphan is counted", async () => {
    const { judge } = await import("../../src/emu/session.ts");
    const inScope = listing([[10, 'PRINT "HELLO"'], [20, 'GET A$:IF A$="" THEN 20'], [30, 'PRINT "SEEDS"']]);
    const orphan = listing([[25, 'PRINT "ORPHAN"']]);
    const all = [...inScope, ...orphan];
    const s = spec(inScope, "SEEDS"); // expectedLines = 10, 20, 30
    const f = runListing(core, all, s, 1500);
    expect(f.postTitle).toBe("pass");
    expect(f.screens.postTitle).not.toContain("ORPHAN"); // line 25 never ran
    const c = judge(all, s, f, new Set(), "title-path");
    expect(c.counts.orphansExcluded).toBe(1);
    expect(c.failed).toEqual([]);
    expect(c.verdict).toBe("RESURRECTED");
  });
});

describe("a load never types into a running program (arch review 01)", () => {
  it("after a run leaves a GET loop waiting, the next load stores exactly the new program", async () => {
    const { loadProgram, runProgram, dumpBasic, programRunning } = await import("../../src/emu/core.ts");
    const { typedLine } = await import("../../src/basic/notation.ts");
    const { tokenizeProgram } = await import("../../src/basic/tokenizer.ts");
    const waiting: [number, string][] = [[10, 'PRINT "PRESS F1"'], [20, 'GET A$:IF A$="" THEN 20'], [30, "GOTO 20"]];
    loadProgram(core, waiting.map(([n, b]) => typedLine(n, b).codes));
    runProgram(core, { maxFrames: 300 });
    expect(programRunning(core)).toBe(true); // the GET loop would eat every typed key
    const next: [number, string][] = [[10, 'PRINT "NEW PROGRAM"'], [20, "END"]];
    loadProgram(core, next.map(([n, b]) => typedLine(n, b).codes));
    expect(Array.from(dumpBasic(core))).toEqual(Array.from(tokenizeProgram(next.map(([n, body]) => ({ n, body })))));
    expect(programRunning(core)).toBe(false);
  });
  it("after an error BASIC is at READY. again: no reset is needed", async () => {
    const { loadProgram, runProgram, programRunning } = await import("../../src/emu/core.ts");
    const { typedLine } = await import("../../src/basic/notation.ts");
    loadProgram(core, [typedLine(10, "PRINT 1/0").codes]);
    runProgram(core, { maxFrames: 300 });
    expect(programRunning(core)).toBe(false);
  });
});
