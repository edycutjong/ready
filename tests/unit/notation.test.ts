/**
 * Tasks 4.3 and 5.3 (typedLine/render/abbreviation tests are appended in task 5): notation unit tests.
 * Every body here is authored in 2026; none is magazine text.
 */
import { describe, expect, it } from "vitest";
import { MAX_REPEAT, TOKENS, parseBody, scanBody } from "../../src/basic/notation.ts";

const codesOf = (body: string): number[] => parseBody(body).codes;
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const R1_1: readonly [string, number][] = [
  ["CLR", 147], ["HOME", 19], ["DOWN", 17], ["UP", 145], ["RIGHT", 29], ["LEFT", 157], ["RVS", 18],
  ["OFF", 146], ["F1", 133], ["F3", 134], ["F5", 135], ["F7", 136], ["BLK", 144], ["WHT", 5],
  ["RED", 28], ["CYN", 159], ["PUR", 156], ["GRN", 30], ["BLU", 31], ["YEL", 158], ["SPACE", 32],
];

describe("TOKENS (R1.1)", () => {
  it("has exactly the 21 names with the R1.1 codes", () => {
    expect(Object.keys(TOKENS)).toHaveLength(21);
    expect(Object.entries(TOKENS).sort()).toEqual([...R1_1].sort());
  });

  it("is frozen", () => {
    expect(Object.isFrozen(TOKENS)).toBe(true);
  });
});

describe("parseBody: fixed tokens (R1.1)", () => {
  it.each(R1_1)("{%s} types code %i exactly once", (name, code) => {
    expect(parseBody(`{${name}}`)).toEqual({ codes: [code], dropped: [] });
  });

  it("accepts names that contain digits in the counted form too", () => {
    expect(codesOf("{2 F7}{1 F1S}")).toEqual([136, 136, 133]);
  });

  it("is case-insensitive", () => {
    expect(codesOf("{clr}{Down}{rVs}")).toEqual([147, 17, 18]);
  });

  it("types a token in place among other characters, left to right (R1.8)", () => {
    expect(codesOf('PRINT"{CLR}HI"')).toEqual([80, 82, 73, 78, 84, 34, 147, 72, 73, 34]);
  });
});

describe("parseBody: repeats (R1.2)", () => {
  it("{3 DOWN} and {1 DOWNS} repeat n times; the plural form is not validated against n", () => {
    expect(codesOf("{3 DOWN}")).toEqual([17, 17, 17]);
    expect(codesOf("{1 DOWNS}")).toEqual([17]);
    expect(codesOf("{3 DOWNS}")).toEqual([17, 17, 17]);
    expect(codesOf("{2 down}")).toEqual([17, 17]);
  });

  it("{0 DOWN} types nothing and drops nothing", () => {
    expect(parseBody("{0 DOWN}")).toEqual({ codes: [], dropped: [] });
  });

  it("allows leading zeros", () => {
    expect(codesOf("{007 UP}")).toEqual(Array(7).fill(145));
  });

  it("does not accept the bare plural: {DOWNS} is an unknown token", () => {
    expect(parseBody("{DOWNS}").dropped.map((d) => d.char)).toEqual(["{", "}"]);
  });

  it("requires exactly one space between n and the name", () => {
    expect(parseBody("{3DOWN}").dropped).toHaveLength(2);
    expect(parseBody("{3  DOWN}").dropped).toHaveLength(2);
    expect(parseBody("{ 3 DOWN}").dropped).toHaveLength(2);
  });

  it("treats a repeat above MAX_REPEAT as an unknown token instead of allocating it", () => {
    const r = parseBody(`{${MAX_REPEAT + 1} DOWN}`);
    expect(r.codes).toContain(68); // the letters of DOWN typed literally
    expect(r.dropped.map((d) => d.char)).toEqual(["{", "}"]);
    expect(codesOf(`{${MAX_REPEAT} DOWN}`)).toHaveLength(MAX_REPEAT);
  });
});

describe("parseBody: spaces and case (R1.3-R1.5)", () => {
  it("types no code for a space outside quotes (R1.3)", () => {
    expect(codesOf("A B")).toEqual([65, 66]);
    expect(codesOf("   ")).toEqual([]);
  });

  it("types code 32 for a space inside quotes (R1.4), including an unterminated quote", () => {
    expect(codesOf('"A B"')).toEqual([34, 65, 32, 66, 34]);
    expect(codesOf('"A B')).toEqual([34, 65, 32, 66]);
    expect(codesOf('"A" B')).toEqual([34, 65, 34, 66]);
  });

  it("types {SPACE} as 32 even outside quotes", () => {
    expect(codesOf("A{SPACE}B")).toEqual([65, 32, 66]);
    expect(codesOf("A{3 SPACES}B")).toEqual([65, 32, 32, 32, 66]);
  });

  it("folds a lower-case letter to upper case (R1.5)", () => {
    expect(parseBody("abz")).toEqual({ codes: [65, 66, 90], dropped: [] });
  });
});

describe("parseBody: untypeable characters (R1.6)", () => {
  it("reports a character outside 32-95 with its original, un-folded form and index", () => {
    expect(parseBody("A~B")).toEqual({ codes: [65, 66], dropped: [{ index: 1, char: "~" }] });
    expect(parseBody("1£2")).toEqual({ codes: [49, 50], dropped: [{ index: 1, char: "£" }] });
  });

  it("does not drop the edges of the typeable range: space..underscore, and lower-case folds into it", () => {
    expect(parseBody("@[\\]^_").dropped).toEqual([]);
    expect(parseBody("`").dropped).toEqual([{ index: 0, char: "`" }]); // 96
    expect(parseBody("{").dropped).toEqual([{ index: 0, char: "{" }]); // unterminated; 123
  });

  it("reports control characters such as a tab, and astral characters as one entry", () => {
    expect(parseBody("A\tB").dropped).toEqual([{ index: 1, char: "\t" }]);
    expect(parseBody("A\u{1F600}B")).toEqual({ codes: [65, 66], dropped: [{ index: 1, char: "\u{1F600}" }] });
  });

  it("returns dropped sorted by ascending index (R1.8)", () => {
    const { dropped } = parseBody("~A~{3 DOWN}~");
    expect(dropped.map((d) => d.index)).toEqual([0, 2, 11]);
  });
});

describe("parseBody: unknown and unterminated groups (R1.7)", () => {
  it("types an unknown token's letters and reports its braces", () => {
    expect(parseBody("{FOOBAR}")).toEqual({
      codes: ascii("FOOBAR"),
      dropped: [{ index: 0, char: "{" }, { index: 7, char: "}" }],
    });
  });

  it("types an unterminated {DOWN from the brace to the end of the body", () => {
    expect(parseBody("{DOWN")).toEqual({ codes: ascii("DOWN"), dropped: [{ index: 0, char: "{" }] });
    expect(parseBody("A{DOWN B")).toEqual({ codes: ascii("ADOWNB"), dropped: [{ index: 1, char: "{" }] });
  });

  it("does not re-read a token nested in an unknown group", () => {
    // {A{DOWN} is one unknown group: its inner {DOWN} is not a token.
    expect(parseBody("{A{DOWN}")).toEqual({
      codes: ascii("ADOWN"),
      dropped: [{ index: 0, char: "{" }, { index: 2, char: "{" }, { index: 7, char: "}" }],
    });
  });

  it("applies the quote and space rules to the literal text", () => {
    expect(codesOf('"{A B}"')).toEqual([34, 65, 32, 66, 34]);
    expect(codesOf("{A B}")).toEqual([65, 66]);
  });

  it("recognises a known group after an unknown one", () => {
    expect(codesOf("{X}{DOWN}")).toEqual([88, 17]);
  });
});

describe("parseBody: shape and determinism (R1.14)", () => {
  it("returns empty results for an empty body", () => {
    expect(parseBody("")).toEqual({ codes: [], dropped: [] });
  });

  it("returns deep-equal results on repeated calls and never mutates a shared table", () => {
    const a = parseBody('PRINT"{CLR}{3 DOWN}~"');
    const b = parseBody('PRINT"{CLR}{3 DOWN}~"');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("does not treat Object.prototype names as tokens", () => {
    expect(parseBody("{constructor}").dropped).toHaveLength(2);
    expect(parseBody("{toString}").dropped).toHaveLength(2);
  });
});

describe("scanBody", () => {
  it("returns groups with start/end and literals with their index", () => {
    expect(scanBody("A{2 UP}")).toEqual([
      { kind: "char", index: 0, char: "A" },
      { kind: "group", name: "UP", count: 2, start: 1, end: 7 },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 5: render, typedLine, abbreviation
// ---------------------------------------------------------------------------------------------
import { crunch } from "../../src/basic/keywords.ts";
import { render, typedLine } from "../../src/basic/notation.ts";

const SHIFTED = (c: string): number => c.charCodeAt(0) | 0x80;
const typedText = (codes: readonly number[]): string => codes.map((c) => String.fromCharCode(c)).join("");

describe("render (R1, design P2)", () => {
  it.each(R1_1.filter(([name]) => name !== "SPACE"))("renders code of {%s} back to its token", (name, code) => {
    expect(render([code])).toBe(`{${name}}`);
  });

  it("renders 33-95 as the character, and a quoted 32 as a space", () => {
    expect(render([65, 66, 33, 95])).toBe("AB!_");
    expect(render([34, 65, 32, 66, 34])).toBe('"A B"');
  });

  it("renders an unquoted 32 as {SPACE} so that parseBody types it again", () => {
    expect(render([65, 32, 66])).toBe("A{SPACE}B");
    expect(codesOf(render([65, 32, 66]))).toEqual([65, 32, 66]);
  });

  it("renders a code parseBody can never produce as an untypeable character, never silently", () => {
    expect(parseBody(render([0xff])).dropped).toHaveLength(1);
  });

  it("round-trips a mixed line", () => {
    const codes = codesOf('PRINT"{CLR}{3 DOWN}HI THERE"{SPACE}:GOTO10');
    expect(codesOf(render(codes))).toEqual(codes);
  });

  it("renders no codes as the empty string", () => {
    expect(render([])).toBe("");
  });
});

describe("typedLine: digit prefix and short lines (R1.9, R1.10, R1.13)", () => {
  it("prepends the digits of the line number, no leading zeros", () => {
    expect(typedLine(10, "END")).toEqual({ codes: [49, 48, 69, 78, 68], dropped: [], tooLong: false });
    expect(typedLine(0, "END").codes.slice(0, 1)).toEqual([48]);
    expect(typedLine(63999, "").codes).toEqual(ascii("63999"));
  });

  it("returns parseBody's dropped list unchanged", () => {
    expect(typedLine(10, "A~").dropped).toEqual([{ index: 1, char: "~" }]);
  });

  it("returns a line of exactly 80 codes unchanged, even with abbreviatable keywords", () => {
    const body = "END:" + "A".repeat(74); // 2 digits + 78 = 80
    const r = typedLine(10, body);
    expect(r.codes).toHaveLength(80);
    expect(r).toEqual({ codes: ascii("10" + body), dropped: [], tooLong: false });
  });
});

describe("typedLine: abbreviation (R1.11-R1.13)", () => {
  it("abbreviates exactly the rightmost keyword when one saved code is enough (81 -> 80)", () => {
    const body = "END:END:" + "A".repeat(71); // 2 + 79 = 81
    const r = typedLine(10, body);
    expect(r.tooLong).toBe(false);
    expect(r.codes).toHaveLength(80);
    expect(r.codes).toEqual([...ascii("10END:"), 69, SHIFTED("N"), ...ascii(":" + "A".repeat(71))]);
  });

  it("abbreviates every eligible occurrence, then reports tooLong with the most abbreviated codes", () => {
    const body = "END:".repeat(5) + "A".repeat(80); // 2 + 100 = 102, minus 5 saved = 97
    const r = typedLine(10, body);
    expect(r.tooLong).toBe(true);
    expect(r.codes).toHaveLength(97);
    expect(r.codes.filter((c) => c === SHIFTED("N"))).toHaveLength(5);
    expect(r.codes).not.toContain(68); // no full "END" left (68 = D; the filler has no D)
  });

  it("never touches a keyword inside a quoted string", () => {
    const body = '"END"' + "A".repeat(80);
    const r = typedLine(10, body);
    expect(r.tooLong).toBe(true);
    expect(r.codes).toEqual(ascii("10" + body));
  });

  it("never touches keyword text after REM or inside DATA", () => {
    const rem = typedLine(10, "REMEND" + "A".repeat(80));
    expect(rem.codes).toEqual(ascii("10REMEND" + "A".repeat(80)));
    const data = typedLine(10, "DATAEND" + "A".repeat(80));
    expect(data.codes).toEqual(ascii("10DATAEND" + "A".repeat(80)));
  });

  it("does not abbreviate a keyword glued to a letter (whole-token rule)", () => {
    const body = "FORI=1TO9" + "A".repeat(80);
    expect(typedLine(10, body).codes).toEqual(ascii("10" + body));
  });

  it("does not abbreviate a keyword whose two-code form is another keyword on the real C64", () => {
    // P+shift-R is PRINT#, R+shift-E is READ, GO+... needs three codes: none of these may be shortened.
    for (const kw of ["PRINT", "GOSUB", "INPUT", "RETURN"]) {
      const body = `${kw}:`.repeat(14) + "A".repeat(20);
      const r = typedLine(10, body);
      expect(r.tooLong, kw).toBe(true);
      expect(r.codes.some((c) => c >= 0x80), kw).toBe(false);
    }
  });

  it("does not abbreviate REM either (R+shift-E is READ)", () => {
    const r = typedLine(10, "REM" + "A".repeat(80));
    expect(r.tooLong).toBe(true);
    expect(r.codes.some((c) => c >= 0x80)).toBe(false);
  });

  it("an abbreviated line crunches to exactly the bytes of the unabbreviated one (R1.11)", () => {
    const body = "IFA=1THENEND:STOP:GOTO100:" + 'PRINT"X":'.repeat(3) + "NEXT:" + "A".repeat(30);
    const r = typedLine(10, body);
    expect(r.codes.some((c) => c >= 0x80)).toBe(true); // something was abbreviated
    const full = parseBody(body).codes;
    expect(crunch(typedText(r.codes.slice(2))).bytes).toEqual(crunch(typedText(full)).bytes);
  });

  it("two-character keywords are never abbreviated (no saving)", () => {
    const body = "IFA=1THEN:" + "ON".repeat(5) + "A".repeat(70);
    const r = typedLine(10, body);
    expect(r.codes.some((c) => c >= 0x80)).toBe(true); // THEN is abbreviated...
    expect(typedText(r.codes)).toContain("ONONONONON"); // ...but ON is left alone
  });

  it("is deterministic (R1.14)", () => {
    const body = "END:".repeat(30);
    expect(typedLine(10, body)).toEqual(typedLine(10, body));
  });
});
