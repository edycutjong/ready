/** src/gate/checksum-gate.ts — checksum-oracle tasks 7.2, 8.4, 9.4 (claude-direct, P1a). Authored 2026 lines only. */
import { describe, expect, it } from "vitest";
import { applyPatch, confusableReadings, editRatio, type PatchOp } from "../../src/gate/checksum-gate.ts";
import { computeChecksum } from "../../src/basic/checksum.ts";
import type { CanonicalLine, CanonicalListing } from "../../src/basic/types.ts";

const line = (n: number, body: string, printed: number | null = computeChecksum(n, body), status: CanonicalLine["status"] = "verified"): CanonicalLine => ({ n, body, printed, status, source: "ocr" });
const base = (): CanonicalListing => [line(10, 'PRINT"GHOST"'), line(20, "GOTO10"), line(30, "X=X+1:IFX<9THEN20")];
const exp = [10, 20, 30, 40];

describe("task 7 — hard refusals", () => {
  it("refuses 0 and 5 operations", () => {
    expect(applyPatch(base(), [], exp).verdict).toBe("refused");
    const five = Array.from({ length: 5 }, () => ({ type: "replace", lineno: 10, new_body: 'PRINT"GHOST"' }) as PatchOp);
    expect(applyPatch(base(), five, exp).reason).toMatch(/R4\.2/);
  });
  it("refuses an empty body even with a passing renumber and force_unverified", () => {
    const l = [...base(), line(48, "END", computeChecksum(40, "END"), "unverified")];
    const v = applyPatch(l, [{ type: "renumber", lineno: 48, new_lineno: 40 }, { type: "replace", lineno: 10, new_body: "" }], exp, { force_unverified: true, refusalCounts: { 10: 9 } });
    expect(v.verdict).toBe("refused");
    expect(v.reason).toMatch(/R4\.4.*empty body/);
  });
  it("refuses a body that types nothing at all, including one made only of untypeable characters", () => {
    expect(applyPatch(base(), [{ type: "replace", lineno: 10, new_body: "   " }], exp).verdict).toBe("refused");
    expect(applyPatch(base(), [{ type: "replace", lineno: 10, new_body: "| " }], exp).reason).toMatch(/R4\.4/);
  });
  it("refuses an op on an unknown line and any insert", () => {
    expect(applyPatch(base(), [{ type: "replace", lineno: 99, new_body: "END" }], exp).reason).toMatch(/R4\.5/);
    const ins = { type: "insert", lineno: 10, new_body: "END" } as unknown as PatchOp;
    expect(applyPatch(base(), [ins], exp).reason).toMatch(/insert is recovery-only/);
  });
});

describe("task 8 — edit distance, renumber, composition", () => {
  it("measures the edit ratio with spaces removed", () => {
    expect(editRatio("AB CDE", "ABCDE")).toBe(0);
    expect(editRatio("ABCDEFGHIJ", "ABCDEFXXXX")).toBeCloseTo(0.4);
  });
  it("refuses 41% and accepts exactly 40% when the checksum validates", () => {
    const target = "ABCDEFXXXX"; // 4 of 10 changed = 40%
    const l = [line(10, "ABCDEFGHIJ", computeChecksum(10, target), "unverified")];
    expect(applyPatch(l, [{ type: "replace", lineno: 10, new_body: target }], [10]).verdict).toBe("accepted");
    const t41 = "ABCDEXXXXXXX"; // 7 edits over 12 = 58%
    const l2 = [line(10, "ABCDEFGHIJ", computeChecksum(10, t41), "unverified")];
    expect(applyPatch(l2, [{ type: "replace", lineno: 10, new_body: t41 }], [10]).reason).toMatch(/R4\.7/);
  });
  it("refuses a renumber outside the inventory, or one that does not produce a checksum-valid line", () => {
    const l = [...base(), line(48, "END", computeChecksum(40, "END"), "unverified")];
    expect(applyPatch(l, [{ type: "renumber", lineno: 48, new_lineno: 45 }], exp).reason).toMatch(/R4\.8/);
    const bad = [...base(), line(48, "END", 7, "unverified")];
    expect(applyPatch(bad, [{ type: "renumber", lineno: 48, new_lineno: 40 }], exp).reason).toMatch(/R4\.9/);
    const ok = applyPatch(l, [{ type: "renumber", lineno: 48, new_lineno: 40 }], exp);
    expect(ok.verdict).toBe("accepted");
  });
  it("accepts a two-line number swap evaluated against one coherent final state", () => {
    // OCR swapped the numbers of two lines: line printed as 20 carries line 30's text and vice versa
    const l = [line(10, 'PRINT"GHOST"'), line(20, "X=X+1:IFX<9THEN20", computeChecksum(30, "X=X+1:IFX<9THEN20"), "unverified"), line(30, "GOTO10", computeChecksum(20, "GOTO10"), "unverified")];
    const v = applyPatch(l, [{ type: "renumber", lineno: 20, new_lineno: 30 }, { type: "renumber", lineno: 30, new_lineno: 20 }], exp);
    expect(v.verdict).toBe("accepted");
    if (v.verdict !== "refused") expect(v.listing.find((x) => x.n === 20)!.body).toBe("GOTO10");
  });
  it("composes a replace and a renumber of the same original line into one final line", () => {
    const l = [...base(), line(48, "EMD", computeChecksum(40, "END"), "unverified")];
    const v = applyPatch(l, [{ type: "replace", lineno: 48, new_body: "END" }, { type: "renumber", lineno: 48, new_lineno: 40 }], exp);
    expect(v.verdict).toBe("accepted");
    if (v.verdict !== "refused") {
      expect(v.listing.filter((x) => x.n === 40)).toEqual([{ n: 40, body: "END", printed: computeChecksum(40, "END"), status: "verified", source: "gate" }]);
      expect(v.listing.some((x) => x.n === 48)).toBe(false);
    }
  });
  it("refuses a renumber that collides with an untouched line", () => {
    const l = [...base(), line(48, "GOTO10", computeChecksum(20, "GOTO10"), "unverified")];
    expect(applyPatch(l, [{ type: "renumber", lineno: 48, new_lineno: 20 }], exp).reason).toMatch(/R4\.10/);
  });
});

describe("task 9 — checksum rule, force path, output shapes", () => {
  it("marks an exact match verified", () => {
    const l = [line(10, 'PRlNT"GHOST"', computeChecksum(10, 'PRINT"GHOST"'), "unverified")];
    const v = applyPatch(l, [{ type: "replace", lineno: 10, new_body: 'PRINT"GHOST"' }], [10]);
    expect(v.verdict).toBe("accepted");
    if (v.verdict !== "refused") expect(v.listing[0].status).toBe("verified");
  });
  it("lists only the frozen confusable readings", () => {
    expect(confusableReadings(28)).toEqual([20]);
    expect(confusableReadings(23)).toEqual([]);
    expect(confusableReadings(100)).toEqual(expect.arrayContaining([108, 109, 106, 180, 190, 160]));
    expect(confusableReadings(100).every((v) => v <= 255)).toBe(true);
  });
  it("marks digit-misread when the printed digits read through a confusable pair (28 read for 20)", () => {
    // one-character OCR fix whose computed sum is 20 while the page's printed digits were read as "28"
    let cur = "", tb = "";
    for (let L = 65; L <= 90 && !tb; L++) for (let c = 48; c <= 90 && !tb; c++) {
      const cand = String.fromCharCode(L).repeat(4) + String.fromCharCode(c);
      if (c !== 123 && computeChecksum(10, cand) === 20) { tb = cand; cur = String.fromCharCode(L).repeat(4) + "#"; }
    }
    expect(computeChecksum(10, tb)).toBe(20);
    const v = applyPatch([line(10, cur, 28, "unverified")], [{ type: "replace", lineno: 10, new_body: tb }], [10]);
    expect(v.verdict).toBe("accepted");
    if (v.verdict !== "refused") { expect(v.listing[0].status).toBe("digit-misread"); expect(v.perOp[0].why).toMatch(/misread.*28.*20/); }
  });
  it("refuses a mismatch with printed and computed in the reason", () => {
    const v = applyPatch([line(10, 'PRINT"GHOST"', 23, "unverified")], [{ type: "replace", lineno: 10, new_body: 'PRINT"GHOTS"' }], [10]);
    expect(v.verdict).toBe("refused");
    expect(v.reason).toContain("printed :rem 23");
    expect(v.reason).toContain(`computed ${computeChecksum(10, 'PRINT"GHOTS"')}`);
  });
  it("an unreadable printed checksum marks the line unverified without refusing", () => {
    const v = applyPatch([line(10, 'PRINT"GH0ST"', null, "unverified")], [{ type: "replace", lineno: 10, new_body: 'PRINT"GHOST"' }], [10]);
    expect(v.verdict).toBe("accepted");
    if (v.verdict !== "refused") expect(v.listing[0].status).toBe("unverified");
  });
  it("force_unverified needs 2 earlier refusals; then the line is forced, never verified", () => {
    const l = [line(20, "GOTO1O", 99, "unverified")];
    const p: PatchOp[] = [{ type: "replace", lineno: 20, new_body: "GOTO10" }];
    expect(applyPatch(l, p, [20], { force_unverified: true, refusalCounts: { 20: 1 } }).reason).toMatch(/R4\.17/);
    const v = applyPatch(l, p, [20], { force_unverified: true, refusalCounts: { 20: 2 } });
    expect(v.verdict).toBe("forced");
    if (v.verdict !== "refused") { expect(v.listing[0].status).toBe("forced"); expect(v.perOp[0].ok).toBe(false); }
  });
  it("leaves the input listing untouched (atomic, no mutation)", () => {
    const l = base(); const snap = JSON.stringify(l);
    applyPatch(l, [{ type: "replace", lineno: 20, new_body: "GOTO1" }], exp);
    applyPatch(l, [{ type: "replace", lineno: 20, new_body: "GOTO10" }], exp);
    expect(JSON.stringify(l)).toBe(snap);
  });
});
