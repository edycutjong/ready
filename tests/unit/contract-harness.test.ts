/**
 * Contract harness, part 1 (agents.md §4, build Day 1): the gate + contract on the REAL headless core, 0 credits.
 * Fixture: tests/fixtures/crypt.bas — an authored 2026 listing (not magazine text); :rem sums hand-checked on
 * lines 30, 70, 80. Title predicate "THE CRYPT KEEPER"; post-title key RETURN → "THE DOOR CREAKS OPEN.".
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { bootNodeCore } from "../../src/emu/node.ts";
import { type C64Core, loadProgram, runProgram, pressKeys, dumpBasic, afterLastRun, readScreenText } from "../../src/emu/core.ts";
import { typedLine } from "../../src/basic/notation.ts";
import { computeChecksum, splitLine } from "../../src/basic/checksum.ts";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";
import { applyPatch } from "../../src/gate/checksum-gate.ts";
import { evaluate } from "../../src/gate/contract.ts";
import type { CanonicalListing } from "../../src/basic/types.ts";

const TITLE = /THE CRYPT KEEPER/;
const POST = /THE DOOR CREAKS OPEN\./;
const raw = readFileSync(new URL("../fixtures/crypt.bas", import.meta.url), "utf8").split("\n").filter((l) => /^\d/.test(l));
const truth: CanonicalListing = raw.map((l) => {
  const s = splitLine(l);
  return { n: s.n!, body: s.body, printed: s.printed, status: "verified", source: "ocr" };
});
const expected = truth.map((l) => l.n);
const clone = (l: CanonicalListing): CanonicalListing => l.map((x) => ({ ...x }));
const sha1 = (l: CanonicalListing) => createHash("sha1").update(JSON.stringify(l.map((x) => [x.n, x.body]))).digest("hex");

/** Type the listing into the real C64, RUN, press the title key, report the facts the contract needs. */
function machineFacts(core: C64Core, listing: CanonicalListing) {
  loadProgram(core, [...listing].sort((a, b) => a.n - b.n).map((l) => typedLine(l.n, l.body).codes));
  const resident = dumpBasic(core);
  const run = runProgram(core, { maxFrames: 1500, until: (s) => TITLE.test(s) });
  const titleSeen = TITLE.test(afterLastRun(run.screen));
  const post = titleSeen ? (POST.test(pressKeys(core, [13], 150)) ? "pass" : "fail") : "not-reached";
  return { resident, titleSeen, postTitle: post as "pass" | "fail" | "not-reached", run };
}

let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); });

describe("fixture sanity", () => {
  it("every authored line's printed sum equals the oracle (and three were checked by hand)", () => {
    for (const l of truth) expect(computeChecksum(l.n, l.body)).toBe(l.printed);
    expect(truth.find((l) => l.n === 70)!.printed).toBe(62);
  });
});

describe("contract harness part 1 (real core)", () => {
  it("full contract → RESURRECTED, and the resident program equals the tokenizer's image", () => {
    const f = machineFacts(core, truth);
    expect(f.titleSeen).toBe(true);
    expect(f.postTitle).toBe("pass");
    expect(Buffer.from(f.resident).equals(Buffer.from(tokenizeProgram(truth)))).toBe(true);
    const r = evaluate({ listing: truth, expectedLines: expected, titleSeen: f.titleSeen, postTitle: f.postTitle, residentBytes: f.resident, provisional: new Set() });
    expect(r.verdict).toBe("RESURRECTED");
    expect(r.failed).toEqual([]);
  });

  it("an OCR typo shows a real ?SYNTAX ERROR, the gate accepts the checksum-valid fix, and the retype is visible to the next read", () => {
    const ocr = clone(truth);
    const l10 = ocr.find((l) => l.n === 10)!;
    l10.body = l10.body.replace("PRINT", "PR1NT"); l10.status = "unverified";
    const before = machineFacts(core, ocr);
    expect(before.run.error).toEqual({ kind: "SYNTAX", line: 10 });
    const v = applyPatch(ocr, [{ type: "replace", lineno: 10, new_body: truth[0].body }], expected);
    expect(v.verdict).toBe("accepted");
    if (v.verdict === "refused") throw new Error(v.reason);
    const after = machineFacts(core, v.listing);
    expect(Buffer.from(dumpBasic(core)).equals(Buffer.from(tokenizeProgram(v.listing)))).toBe(true);
    expect(after.titleSeen).toBe(true);
  });

  it("a checksum-invalid 'fix' is refused with printed vs computed in the reason; Cheat (empty body) is always refused", () => {
    const v = applyPatch(clone(truth), [{ type: "replace", lineno: 10, new_body: 'PRINT"{CLR} THE CRYPT KEEPER"' }], expected);
    expect(v.verdict).toBe("refused");
    expect(v.reason).toMatch(/5/);
    const cheat = applyPatch(clone(truth), [{ type: "replace", lineno: 10, new_body: "" }], expected);
    expect(cheat.verdict).toBe("refused");
  });

  it("compound renumber + replace in one atomic group fixes a line whose number AND body were misread", () => {
    const ocr = clone(truth).filter((l) => l.n !== 40);
    ocr.push({ n: 48, body: "IFAS<>CHR$(13)THEN30", printed: 26, status: "unverified", source: "ocr" });
    const v = applyPatch(ocr, [{ type: "renumber", lineno: 48, new_lineno: 40 }, { type: "replace", lineno: 48, new_body: "IFA$<>CHR$(13)THEN30" }], expected);
    expect(v.verdict).toBe("accepted");
    if (v.verdict === "refused") return;
    expect(v.listing.map((l) => l.n).sort((a, b) => a - b)).toEqual(expected);
  });

  it("one atomic multi-op patch replays to an identical listing hash", () => {
    const ocr = clone(truth);
    ocr.find((l) => l.n === 10)!.body = 'PR1NT"{CLR}{DOWN} THE CRYPT KEEPER"';
    ocr.find((l) => l.n === 30)!.body = "GETA$:IFA$=\"\"THEN3O";
    const patch = [{ type: "replace" as const, lineno: 10, new_body: truth[0].body }, { type: "replace" as const, lineno: 30, new_body: truth[2].body }];
    const a = applyPatch(clone(ocr), patch, expected);
    const b = applyPatch(clone(ocr), patch, expected);
    expect(a.verdict).toBe("accepted");
    if (a.verdict === "refused" || b.verdict === "refused") return;
    expect(sha1(a.listing)).toBe(sha1(b.listing));
  });

  it("a number collision is refused (renumber onto an existing line)", () => {
    const v = applyPatch(clone(truth), [{ type: "renumber", lineno: 30, new_lineno: 40 }], expected);
    expect(v.verdict).toBe("refused");
  });

  it("a spurious extra OCR line typed into the machine breaks clause 6 until code excludes it", () => {
    const withOrphan = [...clone(truth), { n: 75, body: "REM", printed: null, status: "unverified" as const, source: "ocr" }];
    const f = machineFacts(core, withOrphan);
    const r = evaluate({ listing: truth, expectedLines: expected, titleSeen: f.titleSeen, postTitle: f.postTitle, residentBytes: f.resident, provisional: new Set() });
    expect(r.verdict).toBe("BOOTED-PARTIAL");
    expect(r.failed.map((x) => x.clause)).toContain(6);
  });

  it("an unparseable-checksum line that still prints the title leaves the run BOOTED-PARTIAL (clause 4)", () => {
    const l = clone(truth);
    const l20 = l.find((x) => x.n === 20)!; l20.printed = null; l20.status = "unverified";
    const f = machineFacts(core, l);
    const r = evaluate({ listing: l, expectedLines: expected, titleSeen: f.titleSeen, postTitle: f.postTitle, residentBytes: f.resident, provisional: new Set() });
    expect(f.titleSeen).toBe(true);
    expect(r.verdict).toBe("BOOTED-PARTIAL");
    expect(r.failed.find((x) => x.clause === 4)?.lines).toContain(20);
  });

  it("title with a fixable unverified line is not met; a forced line is never RESURRECTED (clause 5)", () => {
    const l = clone(truth);
    l.find((x) => x.n === 60)!.status = "forced";
    const f = machineFacts(core, l);
    const r = evaluate({ listing: l, expectedLines: expected, titleSeen: f.titleSeen, postTitle: f.postTitle, residentBytes: f.resident, provisional: new Set() });
    expect(r.verdict).toBe("BOOTED-PARTIAL");
    expect(r.failed.map((x) => x.clause)).toContain(5);
  });

  it("a recovered line stays provisional until a re-RUN passes it; a missing line fails clause 3", () => {
    const f = machineFacts(core, truth);
    const prov = evaluate({ listing: truth, expectedLines: expected, titleSeen: f.titleSeen, postTitle: f.postTitle, residentBytes: f.resident, provisional: new Set([80]) });
    expect(prov.verdict).toBe("BOOTED-PARTIAL");
    const missing = truth.filter((l) => l.n !== 70);
    const g = machineFacts(core, missing);
    const r = evaluate({ listing: missing, expectedLines: expected, titleSeen: g.titleSeen, postTitle: g.postTitle, residentBytes: g.resident, provisional: new Set() });
    expect(r.failed.find((x) => x.clause === 3)?.lines).toContain(70);
  });

  it("the post-title press records fail when the program never reaches the post-title text", () => {
    const l = clone(truth);
    l.find((x) => x.n === 50)!.body = 'PRINT"{CLR} THE DOOR IS SHUT."';
    const f = machineFacts(core, l);
    expect(f.titleSeen).toBe(true);
    expect(f.postTitle).toBe("fail");
    const r = evaluate({ listing: truth, expectedLines: expected, titleSeen: false, postTitle: "not-reached", residentBytes: f.resident, provisional: new Set() });
    expect(r.verdict).toBe("NOT-RESURRECTED");
    expect(readScreenText(core).length).toBeGreaterThan(0);
  });
});
