/**
 * Task 6.4: checksum oracle unit tests. All lines are authored in 2026; no magazine text.
 * Expected sums are worked out by hand in the comments, so a failure points at the rule, not the code.
 */
import { describe, expect, it } from "vitest";
import { computeChecksum, parsePrinted, splitLine } from "../../src/basic/checksum.ts";
import { parseBody } from "../../src/basic/notation.ts";

describe("computeChecksum (R2.1-R2.5)", () => {
  it("sums line-number digits and body codes mod 256 (worked example)", () => {
    // line 10: '1'(49) + '0'(48)                       =  97
    // body PRINT"HI": P80 R82 I73 N78 T84              = 397
    //                 '"'34 H72 I73 '"'34              = 213   -> 707 mod 256 = 195
    expect(computeChecksum(10, 'PRINT"HI"')).toBe(195);
  });

  it("uses the line number's digits with no leading zeros (R2.1), including n = 0", () => {
    expect(computeChecksum(0, "")).toBe(48); // '0'
    expect(computeChecksum(0, "A")).toBe((48 + 65) % 256);
    expect(computeChecksum(63999, "")).toBe((54 + 51 + 57 + 57 + 57) % 256);
  });

  it("wraps modulo 256", () => {
    // 'Z'(90) x 3 + '1'(49) = 319 -> 63
    expect(computeChecksum(1, "ZZZ")).toBe(63);
  });

  it("counts a literal space as 0 outside AND inside quotes (R2.2), unlike the typist", () => {
    expect(computeChecksum(10, 'PRINT"A B"')).toBe(computeChecksum(10, 'PRINT"AB"'));
    expect(computeChecksum(10, "P R I N T")).toBe(computeChecksum(10, "PRINT"));
    // The typed codes of the same input DO differ: a quoted space is typed (R1.4).
    expect(parseBody('PRINT"A B"').codes).toHaveLength(parseBody('PRINT"AB"').codes.length + 1);
  });

  it("counts {SPACE} and {n SPACES} as 0 whatever n is (R2.3)", () => {
    const plain = computeChecksum(10, "AB");
    expect(computeChecksum(10, "A{SPACE}B")).toBe(plain);
    expect(computeChecksum(10, "A{3 SPACES}B")).toBe(plain);
    expect(computeChecksum(10, "A{0 SPACE}B")).toBe(plain);
    expect(computeChecksum(10, "A{12 SPACES}B")).toBe(plain);
    expect(computeChecksum(10, "A{space}B")).toBe(plain);
  });

  it("counts every other token by its PETSCII code, n times (R2.4)", () => {
    expect(computeChecksum(0, "{CLR}")).toBe((48 + 147) % 256);
    expect(computeChecksum(0, "{3 DOWN}")).toBe((48 + 17 * 3) % 256);
    expect(computeChecksum(0, "{1 DOWNS}")).toBe((48 + 17) % 256);
    expect(computeChecksum(0, "{0 DOWN}")).toBe(48);
    expect(computeChecksum(0, "{rvs}{F7}")).toBe((48 + 18 + 136) % 256);
  });

  it("counts a lower-case letter by its lower-case code, not the folded upper-case one (R2.5)", () => {
    expect(computeChecksum(0, "a")).toBe(48 + 97);
    expect(computeChecksum(0, "A")).toBe(48 + 65);
    expect(computeChecksum(0, "a")).not.toBe(computeChecksum(0, "A"));
  });

  it("counts characters outside the typeable range by their raw code (R2.5)", () => {
    expect(computeChecksum(0, "~")).toBe((48 + 126) % 256);
    expect(computeChecksum(0, "\t")).toBe(48 + 9); // only U+0020 is ignored
  });

  it("counts an unknown token's literal characters, braces included (R2.5, R1.7)", () => {
    // { 123, F 70, O 79, O 79, } 125
    expect(computeChecksum(0, "{FOO}")).toBe((48 + 123 + 70 + 79 + 79 + 125) % 256);
  });

  it("counts an unterminated {DOWN literally from the brace to the end (R2.5, R1.7)", () => {
    expect(computeChecksum(0, "{DOWN")).toBe((48 + 123 + 68 + 79 + 87 + 78) % 256);
    // a `{` nested in an unknown group is literal too: {A{DOWN} is one unknown group, not a DOWN token
    expect(computeChecksum(0, "{A{DOWN}")).toBe((48 + 123 + 65 + 123 + 68 + 79 + 87 + 78 + 125) % 256);
  });

  it("agrees with notation.ts on what a token is: an over-limit repeat is literal in both", () => {
    expect(computeChecksum(0, "{5000 DOWN}")).not.toBe((48 + 17 * 5000) % 256);
  });

  it("is deterministic (R2.10)", () => {
    expect(computeChecksum(20, 'GOTO{3 UP}"X"')).toBe(computeChecksum(20, 'GOTO{3 UP}"X"'));
  });
});

describe("parsePrinted (R2.7, R2.8)", () => {
  it("accepts :rem with 1-3 digits in 0-255", () => {
    expect(parsePrinted(":rem 7")).toBe(7);
    expect(parsePrinted(":rem 007")).toBe(7);
    expect(parsePrinted(":rem 0")).toBe(0);
    expect(parsePrinted(":rem 255")).toBe(255);
    expect(parsePrinted(":REM 42")).toBe(42);
    expect(parsePrinted(":rem 42   ")).toBe(42);
    expect(parsePrinted("PRINT:rem 9")).toBe(9);
  });

  it("rejects four digits, even with leading zeros", () => {
    expect(parsePrinted(":rem 1234")).toBeNull();
    expect(parsePrinted(":rem 0007")).toBeNull();
  });

  it("rejects a number above 255", () => {
    expect(parsePrinted(":rem 256")).toBeNull();
    expect(parsePrinted(":rem 999")).toBeNull();
  });

  it("rejects text with no :rem, or cut off before a digit", () => {
    expect(parsePrinted("")).toBeNull();
    expect(parsePrinted("rem 7")).toBeNull();
    expect(parsePrinted("7")).toBeNull();
    expect(parsePrinted(":rem")).toBeNull();
    expect(parsePrinted(":rem ")).toBeNull();
  });

  it("rejects non-numeric text and trailing content", () => {
    expect(parsePrinted(":rem x")).toBeNull();
    expect(parsePrinted(":rem 12x")).toBeNull();
    expect(parsePrinted(":rem 1 2")).toBeNull();
    expect(parsePrinted(":rem 12 ;")).toBeNull();
    expect(parsePrinted(":rem -3")).toBeNull();
  });

  it("does not guess when the space after rem is missing (design.md's pattern)", () => {
    expect(parsePrinted(":rem143")).toBeNull();
  });

  it("uses the last :rem when there are several", () => {
    expect(parsePrinted("X:rem 5:rem 6")).toBe(6);
  });
});

describe("splitLine (R2.9)", () => {
  it("splits number, body and printed checksum", () => {
    expect(splitLine('10 PRINT"HI":rem 195')).toEqual({ n: 10, body: 'PRINT"HI"', printed: 195 });
  });

  it("returns the whole remainder as body, with printed null, when there is no trailing :rem", () => {
    expect(splitLine('10 PRINT"HI"')).toEqual({ n: 10, body: 'PRINT"HI"', printed: null });
  });

  it("keeps a garbled checksum out of the body and reports printed null", () => {
    expect(splitLine("20 X=1:rem 1x3")).toEqual({ n: 20, body: "X=1", printed: null });
    expect(splitLine("20 X=1:rem")).toEqual({ n: 20, body: "X=1", printed: null });
    expect(splitLine("20 X=1:rem 999")).toEqual({ n: 20, body: "X=1", printed: null });
  });

  it("splits at the LAST :rem, so an earlier REM statement stays in the body", () => {
    expect(splitLine("30 X=1:REM HI:rem 77")).toEqual({ n: 30, body: "X=1:REM HI", printed: 77 });
  });

  it("preserves the body's internal spacing", () => {
    expect(splitLine('  40   PRINT "A  B" :REM 5')).toEqual({ n: 40, body: 'PRINT "A  B" ', printed: 5 });
  });

  it("round-trips with computeChecksum", () => {
    const { n, body, printed } = splitLine('10 PRINT"HI":rem 195');
    expect(computeChecksum(n!, body)).toBe(printed);
  });

  it("returns n null when there is no usable leading number, leaving the text intact", () => {
    expect(splitLine("PRINT:rem 5")).toEqual({ n: null, body: "PRINT", printed: 5 });
    expect(splitLine("")).toEqual({ n: null, body: "", printed: null });
    expect(splitLine("99999999 END").n).toBeNull();
  });

  it("accepts line 0 and line 63999, and ignores leading zeros of the number", () => {
    expect(splitLine("0 END").n).toBe(0);
    expect(splitLine("63999 END").n).toBe(63999);
    expect(splitLine("64000 END").n).toBeNull();
    expect(splitLine("0020 END").n).toBe(20);
  });

  it("does not treat :remark as a checksum marker", () => {
    expect(splitLine("10 X:remark")).toEqual({ n: 10, body: "X:remark", printed: null });
  });

  it("is deterministic (R2.10)", () => {
    expect(splitLine("10 A:rem 3")).toEqual(splitLine("10 A:rem 3"));
  });
});
