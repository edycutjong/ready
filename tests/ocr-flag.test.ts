import { describe, expect, it } from "vitest";
import { assistedHeading, basExport, errataSheet, flagAll, flagLine, summarize } from "../src/ocr/flag.ts";
import { computeChecksum } from "../src/basic/checksum.ts";

const body = 'PRINT"HELLO"';
const good = computeChecksum(20, body);

describe("ASSISTED flags (browser OCR → checksum)", () => {
  it("flags a line ok only when the recomputed checksum equals the printed one", () => {
    expect(flagLine(20, body, good).state).toBe("ok");
    expect(flagLine(20, "PRIMT\"HELLO\"", good).state).toBe("mismatch");
    expect(flagLine(20, body, null).state).toBe("no-checksum");
  });
  it("summary + heading say ASSISTED and never claim a resurrection or a complete inventory", () => {
    const lines = flagAll([{ n: 20, body, printed: good, rows: [0] }, { n: 30, body: "X", printed: 1, rows: [1] }, { n: 40, body: "Y", printed: null, rows: [2] }]);
    const s = summarize(lines);
    expect(s).toMatchObject({ total: 3, ok: 1, mismatch: 1, noChecksum: 1 });
    const h = assistedHeading(s);
    expect(h).toMatch(/^ASSISTED — not automatically resurrected/);
    expect(h).toMatch(/missing lines: unknown/);
    expect(h).not.toMatch(/RESURRECTED/);
  });
  it("export marks every unverified line as a REM, never as verified", () => {
    const lines = flagAll([{ n: 20, body, printed: good, rows: [0] }, { n: 30, body: "X", printed: 1, rows: [1] }]);
    const bas = basExport(lines);
    expect(bas).toContain(`20 ${body}`);
    expect(bas).toContain("REM UNVERIFIED (mismatch) 30 X");
    expect(errataSheet(lines)).toMatch(/line 30: printed :rem 1/);
    expect(bas).not.toMatch(/DIGIT-MISREAD/);
  });
  it("a digit-misread line is never called verified: the header names it (arch review 01)", () => {
    const l = flagLine(20, body, 0, false);
    const misread = { ...l, state: "digit-misread" as const };
    const bas = basExport([misread]);
    expect(bas).toMatch(/^REM ASSISTED export — numbered lines match the magazine checksum as printed/);
    expect(bas).toContain("REM DIGIT-MISREAD (sum matches a misread of the printed checksum digits, not the digits as read): 20");
    expect(bas).not.toMatch(/verified against the magazine checksum/);
    expect(bas).toMatch(/as printed, except the DIGIT-MISREAD lines named below/);
  });
  it("/scan names an untypeable character instead of 'printed X, computed X' (arch review 01 QA)", () => {
    const good = 'PRINT "HI"';
    const l = flagLine(10, 'PRINT \u2122HI"', flagLine(10, good, 0).computed);
    expect(l).toMatchObject({ state: "mismatch", untypeable: "\u2122" });
    expect(errataSheet([l])).toMatch(/contains "\u2122", which no C64 key types/);
  });
  it("an edit that fixes the line flips it to ok (per-keystroke recheck)", () => {
    expect(flagLine(20, "PRIMT\"HELLO\"", good).state).toBe("mismatch");
    expect(flagLine(20, body, good, true)).toMatchObject({ state: "ok", edited: true });
  });
});
