/** src/gate/contract.ts — checksum-oracle task 10.2 (claude-direct, P1a). */
import { describe, expect, it } from "vitest";
import { evaluate, type ContractInput } from "../../src/gate/contract.ts";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";
import { computeChecksum } from "../../src/basic/checksum.ts";
import type { CanonicalListing } from "../../src/basic/types.ts";

const listing = (): CanonicalListing => [
  { n: 10, body: 'PRINT"BOO"', printed: computeChecksum(10, 'PRINT"BOO"'), status: "verified", source: "ocr" },
  { n: 20, body: "GOTO10", printed: computeChecksum(20, "GOTO10"), status: "digit-misread", source: "gate" },
  { n: 30, body: "END", printed: null, status: "eye-verified", source: "typed" },
];
const good = (over: Partial<ContractInput> = {}): ContractInput => {
  const l = over.listing ?? listing();
  return { listing: l, expectedLines: [10, 20, 30], titleSeen: true, postTitle: "pass", residentBytes: tokenizeProgram(l), provisional: new Set(), ...over };
};

describe("contract", () => {
  it("no title is always NOT-RESURRECTED, with a clause-1 entry", () => {
    const r = evaluate(good({ titleSeen: false }));
    expect(r.verdict).toBe("NOT-RESURRECTED");
    expect(r.failed[0]).toEqual({ clause: 1, lines: [] });
    expect(r.heading).toBe("NO-TITLE NOT RESURRECTED · 3/3 checksum-consistent");
  });
  it("all six clauses → RESURRECTED with empty failed and the exact heading", () => {
    const r = evaluate(good());
    expect(r.verdict).toBe("RESURRECTED");
    expect(r.failed).toEqual([]);
    expect(r.heading).toBe("TITLE-PATH RESURRECTED · 3/3 checksum-consistent");
    expect(r.counts).toEqual({ verified: 1, digitMisread: 1, eyeVerified: 1, forced: 0, unverified: 0, present: 3, typed: 1, missing: 0, orphansExcluded: 0 });
  });
  it("one forced line flips to BOOTED — PARTIAL with clause 5 naming it", () => {
    const l = listing(); l[1].status = "forced";
    const r = evaluate(good({ listing: l }));
    expect(r.verdict).toBe("BOOTED-PARTIAL");
    expect(r.failed.find((f) => f.clause === 5)).toEqual({ clause: 5, lines: [20] });
    expect(r.heading).toBe("TITLE-PATH BOOTED — PARTIAL · 2/3 checksum-consistent");
  });
  it("an unverified title line fails clause 4 even though the title showed", () => {
    const l = listing(); l[0].status = "unverified"; l[0].printed = null;
    expect(evaluate(good({ listing: l })).failed.find((f) => f.clause === 4)?.lines).toEqual([10]);
  });
  it("a provisional (recovered, not yet executed past) line fails clause 4", () => {
    expect(evaluate(good({ provisional: new Set([30]) })).failed.find((f) => f.clause === 4)?.lines).toEqual([30]);
  });
  it("one differing resident byte fails clause 6 with empty lines", () => {
    const b = tokenizeProgram(listing()); b[5] ^= 1;
    const r = evaluate(good({ residentBytes: b }));
    expect(r.failed).toContainEqual({ clause: 6, lines: [] });
  });
  it("missing and duplicated numbers fail clause 3", () => {
    const l = listing(); l.push({ ...l[0] });
    const r = evaluate(good({ listing: l.filter((x) => x.n !== 30) }));
    expect(r.failed.find((f) => f.clause === 3)?.lines).toEqual([10, 30]);
  });
  it("postTitle fail or not-reached fails clause 2", () => {
    expect(evaluate(good({ postTitle: "fail" })).failed).toContainEqual({ clause: 2, lines: [] });
    expect(evaluate(good({ postTitle: "not-reached" })).verdict).toBe("BOOTED-PARTIAL");
  });
  it("an orphan is excluded from every clause and counted, never blocking RESURRECTED by itself", () => {
    const l = [...listing(), { n: 99, body: "REM", printed: null, status: "unverified" as const, source: "ocr" }];
    const r = evaluate(good({ listing: l, residentBytes: tokenizeProgram(listing()) }));
    expect(r.verdict).toBe("RESURRECTED");
    expect(r.counts.orphansExcluded).toBe(1);
  });
  it("is deterministic", () => {
    expect(evaluate(good())).toEqual(evaluate(good()));
  });
});
