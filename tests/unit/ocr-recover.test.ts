/** src/ocr/recover.ts — lost-line recovery by code (agent contract §4). Authored 2026 text only. */
import { describe, expect, it } from "vitest";
import { computeChecksum } from "../../src/basic/checksum.ts";
import { chooseRecovered, logicalFromRows, logicalFromText, planRecovery, resolveOrphan, type Row } from "../../src/ocr/recover.ts";

const row = (text: string, y: number): Row => ({ text, bbox: { x0: 0, y0: y, x1: 500, y1: y + 10 } });
const sum = (n: number, b: string) => computeChecksum(n, b);

describe("OCR rows → logical lines", () => {
  it("joins continuation rows until :rem, reads ¢/@ in the line number as 0, unparseable :rem → null", () => {
    const rows = [row(`1¢ PRINT"A";`, 0), row(`"B" :rem ${sum(10, 'PRINT"A"; "B"')}`, 12), row("2@ GOTO 10 :rem 9X", 24)];
    const l = logicalFromRows(rows);
    expect(l.map((x) => [x.n, x.printed, x.rows])).toEqual([[10, sum(10, 'PRINT"A"; "B"'), [0, 1]], [20, null, [2]]]);
  });
});

describe("recovery plan + choices", () => {
  const exp = [10, 20, 30, 40];
  const rows = [row("10 A=1 :rem 1", 0), row("30 C=3 :rem 3", 30), row("77 D=4 :rem 4", 60)];
  const plan = planRecovery(logicalFromRows(rows), rows, exp, [[0, 100]]);
  it("finds the absent lines with the pixel gap between their neighbours, and the orphan", () => {
    expect(plan.absent).toEqual([{ n: 20, gap: [10, 30] }, { n: 40, gap: [40, 70] }]);
    expect(plan.orphans.map((o) => o.n)).toEqual([77]);
  });
  it("one distinct checksum-valid re-OCR reading → recovered; two → ambiguous (a person types it); none → still lost", () => {
    const ok = `20 B=2 :rem ${sum(20, "B=2")}`;
    expect(chooseRecovered(20, logicalFromText(`${ok}\n${ok}`)).outcome).toBe("recovered");
    expect(chooseRecovered(20, logicalFromText(`${ok}\n20 B= 2 :rem ${sum(20, "B=2")}`)).outcome).toBe("recovered"); // spaces do not make a second reading
    // arch review 01: a space inside quotes IS typed, so two readings that differ only there are two lines, not one
    const q1 = 'PRINT"A B"', q2 = 'PRINT"AB"';
    expect(sum(20, q1)).toBe(sum(20, q2));
    expect(chooseRecovered(20, logicalFromText(`20 ${q1} :rem ${sum(20, q1)}\n20 ${q2} :rem ${sum(20, q2)}`)).outcome).toBe("ambiguous");
    expect(chooseRecovered(20, logicalFromText(`${ok}\n20 =B2 :rem ${sum(20, "=B2")}`)).outcome).toBe("ambiguous");
    expect(chooseRecovered(20, logicalFromText("20 B=7 :rem 1")).outcome).toBe("still-lost");
  });
  it("an orphan is renumbered only to an absent inventory number with the same printed sum, else excluded", () => {
    const o = plan.orphans[0];
    expect(resolveOrphan(o, logicalFromText("40 D=4 :rem 4"), exp, new Set([10, 30]))?.n).toBe(40);
    expect(resolveOrphan(o, logicalFromText("40 D=4 :rem 5"), exp, new Set([10, 30]))).toBeNull();
    expect(resolveOrphan(o, logicalFromText("30 D=4 :rem 4"), exp, new Set([10, 30]))).toBeNull();
  });
});
