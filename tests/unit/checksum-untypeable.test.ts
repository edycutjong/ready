/**
 * arch review 01 (P1d): a character no C64 key types can never make a line "verified". U+2122 is one UTF-16 unit,
 * 8482 mod 256 = 34 = the code of a quote, so the raw sum matched while the loader dropped the glyph.
 */
import { describe, expect, it } from "vitest";
import { computeChecksum } from "../../src/basic/checksum.ts";
import { applyPatch, checkLine } from "../../src/gate/checksum-gate.ts";
import { evaluate } from "../../src/gate/contract.ts";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";
import type { CanonicalListing } from "../../src/basic/types.ts";

const good = 'PRINT "HI"';
const glyph = 'PRINT ™HI"'; // the OCR read the opening quote as ™
const printed = computeChecksum(10, good);

describe("untypeable characters are never checksum-consistent (arch review 01)", () => {
  it("the raw sum collides (the hole) but checkLine refuses the line and names the glyph", () => {
    expect(computeChecksum(10, glyph)).toBe(printed);
    expect(checkLine(10, glyph, printed)).toMatchObject({ status: "mismatch", untypeable: "™" });
    expect(checkLine(10, good, printed).status).toBe("verified");
  });
  it("the gate refuses a patch that writes it, with an honest reason (not 'printed X, computed X')", () => {
    const listing: CanonicalListing = [{ n: 10, body: 'PRINT "HX"', printed, status: "unverified", source: "ocr" }];
    const v = applyPatch(listing, [{ type: "replace", lineno: 10, new_body: glyph }], [10]);
    expect(v.verdict).toBe("refused");
    expect(v.reason).toMatch(/no C64 key types/);
  });
  it("clause 4 recomputes: a stored 'verified' label on such a line is not trusted", () => {
    const listing: CanonicalListing = [{ n: 10, body: glyph, printed, status: "verified", source: "ocr" }];
    const image = tokenizeProgram([{ n: 10, body: glyph }]);
    const r = evaluate({ listing, expectedLines: [10], titleSeen: true, postTitle: "pass", residentBytes: image, provisional: new Set() });
    expect(r.verdict).toBe("BOOTED-PARTIAL");
    expect(r.failed).toContainEqual({ clause: 4, lines: [10] });
    expect(r.heading).toContain("0/1 checksum-consistent");
  });
});
