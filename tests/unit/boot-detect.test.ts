/**
 * Boot detection on the real C64 core (c64-ready@3.4.0): the probes of .kiro/specs/bugfix-boot-detect/bugfix.md.
 * Fixtures are authored 2026 listings. Title `THE CRYPT`, post-title `OPENED` after RETURN.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { bootNodeCore } from "../../src/emu/node.ts";
import { type C64Core, runProgram } from "../../src/emu/core.ts";
import { type ListingSpec, loadCanonical, runListing } from "../../src/emu/session.ts";
import type { CanonicalListing } from "../../src/basic/types.ts";

let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); });

const listing = (...bodies: string[]): CanonicalListing =>
  bodies.map((body, i) => ({ n: (i + 1) * 10, body, printed: null, status: "forced" as const, source: "test" }));
const specFor = (n: number, keys?: readonly number[]): ListingSpec => ({
  expectedLines: Array.from({ length: n }, (_, i) => (i + 1) * 10),
  titlePredicate: { screenContains: "THE CRYPT", ...(keys ? { keys } : {}) },
  postTitle: { keys: [13], screenContains: "OPENED" },
});
const GET = (n: number) => `GETK$:IFK$=""THEN${n}`;
const fresh = async () => bootNodeCore();

const probeA = listing('PRINT"{CLR}THE CRYPT"', "FORI=1TO300:NEXT", 'PRINT"{CLR}PRESS RETURN"', GET(40), 'PRINT"OPENED"');
const probeB = listing('PRINT"{CLR}THE CRYPT"', 'PRINT"RUN"', GET(30), 'PRINT"OPENED"');
const probeC = listing('PRINT"{CLR}?SYNTAX  ERROR IN 99"', 'PRINT"THE CRYPT"', GET(30), 'PRINT"OPENED"');
const probeD = listing('PRIMT"X"', 'PRINT"THE CRYPT"');
const probeE = listing('PRINT"{CLR}THE CRYPT"', "END");
// f2: error-shaped text printed after the title-key press, while the program keeps running
const f2 = listing('PRINT"{CLR}PRESS A KEY"', GET(20), 'PRINT"?SYNTAX  ERROR IN 99"', 'PRINT"THE CRYPT"', GET(50), 'PRINT"OPENED"');
// g: the title needs a key first
const fixtureG = listing('PRINT"{CLR}PRESS A KEY"', GET(20), 'PRINT"{CLR}THE CRYPT"', GET(40), 'PRINT"OPENED"');

describe("E1 / E4 (probe a)", () => {
  it("E1: a title shown for under 50 frames is seen", () => {
    const f = runListing(core, probeA, specFor(5));
    expect(f.titleSeen).toBe(true);
    expect(f.run.stoppedOn).toBe("predicate");
    expect(f.run.error).toBeNull();
    expect(f.screens.title).toContain("THE CRYPT");
    expect(f.postTitle).toBe("pass");
  });
  it("E4: the same listing on a fresh core gives the same titleSeen, frames and screens", async () => {
    const a = runListing(await fresh(), probeA, specFor(5));
    const b = runListing(await fresh(), probeA, specFor(5));
    expect(b.titleSeen).toBe(a.titleSeen);
    expect(b.run.frames).toBe(a.run.frames);
    expect(b.screens).toEqual(a.screens);
  });
});

describe("E2 (probe c)", () => {
  it("E2: error-shaped program output is not a BASIC error while the program runs", () => {
    const f = runListing(core, probeC, specFor(4));
    expect(f.run.error).toBeNull();
    expect(f.titleSeen).toBe(true);
    expect(f.postTitle).toBe("pass");
  });
});

describe("E3 (other call sites)", () => {
  it("E3 f2: error-shaped text after the title-key press is not an error", () => {
    const f = runListing(core, f2, specFor(6, [32]));
    expect(f.run.error).toBeNull();
    expect(f.titleSeen).toBe(true);
  });
  it("E3 f1: a budget spent before RUN is even typed reports no error, though the typed listing holds error-shaped text", () => {
    // measured 2026-11-26 after CLR/HOME joined the RUN keys: 1 frame in, 4 keys pending, direct mode, and parseError matched
    // `10PRINT" ?SYNTAX  ERROR IN 99"` in the typed listing — the budget-end site reproduced, so C3 f1 is fixed, not Unchanged
    loadCanonical(core, probeC);
    const r = runProgram(core, { maxFrames: 1, checkEvery: 1 });
    expect(core.pendingKeys()).toBeGreaterThan(0);
    expect(r.error).toBeNull();
    expect(r.stoppedOn).toBe("frames");
  });
});

describe("Unchanged", () => {
  it("U1: a real error still stops the run", () => {
    const f = runListing(core, probeD, specFor(2));
    expect(f.run.error).toEqual({ kind: "SYNTAX", line: 10 });
    expect(f.run.stoppedOn).toBe("error");
    expect(f.titleSeen).toBe(false);
  });
  it("U2: a title followed by END is seen, but the press produced nothing", () => {
    const f = runListing(core, probeE, specFor(2));
    expect(f.titleSeen).toBe(true);
    expect(f.postTitle).toBe("fail");
  });
  it("U3: post-title text already on screen before the press fails closed", () => {
    const f = runListing(core, listing('PRINT"{CLR}THE CRYPT"', 'PRINT"OPENED"', GET(30)), specFor(3));
    expect(f.titleSeen).toBe(true);
    expect(f.postTitle).toBe("fail");
  });
  it("U4: title text in the typed source never counts, and no latch call happens while keys are pending", () => {
    const rem = runListing(core, listing("REM THE CRYPT", GET(20)), specFor(2), 300);
    expect(rem.titleSeen).toBe(false);
    expect(runListing(core, probeD, specFor(2)).titleSeen).toBe(false);
    loadCanonical(core, listing("REM THE CRYPT", GET(20)));
    const pendingAtCall: number[] = [];
    runProgram(core, { maxFrames: 200, until: () => false, latch: () => { pendingAtCall.push(core.pendingKeys()); return false; } } as Parameters<typeof runProgram>[1]);
    expect(pendingAtCall.every((p) => p === 0)).toBe(true);
  });
  it("U5: budgets stay 3000 (runListing) and 6000 (runProgram)", () => {
    const never = listing(GET(10));
    expect(runListing(core, never, specFor(1)).run).toMatchObject({ stoppedOn: "frames", frames: 3000 });
    loadCanonical(core, never);
    expect(runProgram(core)).toMatchObject({ stoppedOn: "frames", frames: 6000 });
  });
  it("U7: a title that needs a key is reached by waiting(); until is called once per check", () => {
    const f = runListing(core, fixtureG, specFor(5, [32]));
    expect(f.titleSeen).toBe(true);
    expect(f.screens.title).toContain("THE CRYPT");
    expect(f.postTitle).toBe("pass");
    loadCanonical(core, fixtureG);
    let calls = 0;
    const r = runProgram(core, { maxFrames: 500, until: () => { calls++; return false; } });
    expect(calls).toBe(r.frames / 50);
  });
});

describe("K1 (known limitation, probe b)", () => {
  // The program prints a row that is exactly RUN, so afterLastRun cuts the title away. Turns red when someone fixes it.
  it.fails("K1: titleSeen should be true for probe b", () => {
    expect(runListing(core, probeB, specFor(4)).titleSeen).toBe(true);
  });
});
