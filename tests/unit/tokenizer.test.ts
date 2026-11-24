/**
 * Tasks 2.3 and 3.2: tokenizer unit tests. Every listing text here is authored in 2026; none is from a magazine.
 * Typed text uses String.fromCharCode for bytes >= 0x80 (shifted keys), because a source file cannot show them.
 * Where an expectation differs from the wording of R3.7/R3.8 it is because the real C64 was measured
 * (see keywords.ts header and tokenizer-rom.test.ts, which re-checks these against the emulator).
 */
import { describe, expect, it } from "vitest";
import { BASIC_START, KEYWORDS as KEYWORDS_FROM_TOKENIZER, crunchLine, tokenizeProgram } from "../../src/basic/tokenizer.ts";
import { KEYWORDS, crunch, matchKeywordAt } from "../../src/basic/keywords.ts";

const T = (name: string): number => 0x80 + KEYWORDS.indexOf(name);
const codes = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const sh = (letter: string): string => String.fromCharCode(letter.charCodeAt(0) | 0x80);
/** Crunched token bytes of a typed body. */
const tok = (body: string): number[] => crunch(body).bytes;

describe("KEYWORDS (R3.1)", () => {
  it("has the 76 ROM entries from $80 to $CB, once, re-exported by tokenizer.ts", () => {
    expect(KEYWORDS).toHaveLength(76);
    expect(KEYWORDS_FROM_TOKENIZER).toBe(KEYWORDS);
    expect(new Set(KEYWORDS).size).toBe(76);
    expect(T("END")).toBe(0x80);
    expect(T("GO")).toBe(0xcb);
  });

  it("puts well-known tokens at their ROM bytes", () => {
    const known: Record<string, number> = {
      DATA: 0x83, "INPUT#": 0x84, INPUT: 0x85, GOTO: 0x89, GOSUB: 0x8d, REM: 0x8f, "PRINT#": 0x98,
      PRINT: 0x99, THEN: 0xa7, "+": 0xaa, ">": 0xb1, "=": 0xb2, "<": 0xb3, ATN: 0xc1, "CHR$": 0xc7, "MID$": 0xca,
    };
    for (const [name, byte] of Object.entries(known)) expect(T(name), name).toBe(byte);
  });
});

describe("crunchLine: line record (R3.10)", () => {
  it("emits link, little-endian number, tokens, terminator, with the link pointing past the line", () => {
    const line = crunchLine(10, 'PRINT"HI"', 0x0801);
    // 4 header + 5 token bytes (99 22 48 49 22) + 1 terminator = 10 bytes -> next line at $080B
    expect([...line.bytes]).toEqual([0x0b, 0x08, 10, 0, 0x99, 0x22, 0x48, 0x49, 0x22, 0]);
    expect(line.startAddr).toBe(0x0801);
  });

  it("splits a line number above 255 into two bytes (63999 = $F9FF)", () => {
    const line = crunchLine(63999, "END", 0x0801);
    expect([...line.bytes].slice(2, 4)).toEqual([0xff, 0xf9]);
  });

  it("uses startAddr for the link", () => {
    const line = crunchLine(5, "END", 0x1000);
    expect([...line.bytes]).toEqual([0x06, 0x10, 5, 0, 0x80, 0]);
  });
});

describe("crunch: keywords, ? and quotes (R3.2-R3.4)", () => {
  it("crunches a plain keyword line", () => {
    expect(tok("GOTO100")).toEqual([T("GOTO"), 0x31, 0x30, 0x30]);
    expect(tok("IFA=1THENEND")).toEqual([T("IF"), 0x41, T("="), 0x31, T("THEN"), T("END")]);
  });

  it("crunches ? as PRINT (R3.3)", () => {
    expect(tok("?A")).toEqual([T("PRINT"), 0x41]);
    expect(tok("?")).toEqual([0x99]);
  });

  it("copies a quoted string unchanged, keyword-looking text and ? included (R3.4)", () => {
    expect(tok('PRINT"GOTO?END"')).toEqual([T("PRINT"), ...codes('"GOTO?END"')]);
  });

  it("treats an unterminated quote as running to end of line (R3.4)", () => {
    expect(tok('PRINT"GOTO')).toEqual([T("PRINT"), ...codes('"GOTO')]);
  });

  it("resumes crunching after the closing quote", () => {
    expect(tok('"A"GOTO1')).toEqual([...codes('"A"'), T("GOTO"), 0x31]);
  });
});

describe("crunch: REM and DATA (R3.5, R3.6)", () => {
  it("REM swallows the rest of the line including : ? quotes and keywords", () => {
    expect(tok('REMX:PRINT?"A')).toEqual([T("REM"), ...codes('X:PRINT?"A')]);
  });

  it("DATA copies until the next unquoted colon, then crunching resumes from it", () => {
    expect(tok("DATAA,PRINT:PRINT")).toEqual([T("DATA"), ...codes("A,PRINT"), 0x3a, T("PRINT")]);
  });

  it("DATA does not end at a colon inside quotes", () => {
    expect(tok('DATA"A:B":END')).toEqual([T("DATA"), ...codes('"A:B"'), 0x3a, T("END")]);
  });

  it("DATA keeps ? as a literal question mark", () => {
    expect(tok("DATA?:?")).toEqual([T("DATA"), 0x3f, 0x3a, T("PRINT")]);
  });
});

describe("crunch: abbreviation (R3.7), as measured on the real C64", () => {
  it("P + shifted R is PRINT#, not PRINT: table order puts PRINT# first", () => {
    expect(tok("P" + sh("R"))).toEqual([T("PRINT#")]);
    expect(tok("PR" + sh("I"))).toEqual([T("PRINT#")]);
  });

  it("crunches the classic prefix-plus-shifted-letter forms", () => {
    expect(tok("E" + sh("N"))).toEqual([T("END")]);
    expect(tok("TH" + sh("E"))).toEqual([T("THEN")]);
    expect(tok("GO" + sh("S"))).toEqual([T("GOSUB")]);
    expect(tok("G" + sh("O"))).toEqual([T("GOTO")]);
    expect(tok("R" + sh("E"))).toEqual([T("READ")]);
  });

  it("consumes exactly the prefix and the one shifted byte", () => {
    expect(tok("E" + sh("N") + "5")).toEqual([T("END"), 0x35]);
  });

  it("does not abbreviate inside quotes or after REM", () => {
    expect(tok('"E' + sh("N") + '"')).toEqual([0x22, 0x45, 0xce, 0x22]);
    expect(tok("REMP" + sh("R"))).toEqual([T("REM"), 0x50, 0xd2]);
  });

  it("does not accept the shifted LAST letter (I+shift-F is not IF)", () => {
    expect(tok("I" + sh("F"))).toEqual([0x49]);
    expect(tok("T" + sh("O"))).toEqual([0x54]);
  });

  it("does not accept a shifted letter that is not the keyword's next letter", () => {
    expect(tok("P" + sh("A"))).toEqual([0x50]);
  });

  it("matches the keyword text case-insensitively (design.md); other bytes pass through as given", () => {
    expect(tok("print")).toEqual([T("PRINT")]);
    expect(tok("x")).toEqual([0x78]);
  });
});

describe("crunch: bytes >= 0x80 not consumed by an abbreviation (R3.8), as measured", () => {
  it("drops a stray shifted byte outside quotes and REM (the real ROM does; R3.8 says copy)", () => {
    expect(tok("A" + sh("A") + "B")).toEqual([0x41, 0x42]);
    expect(tok(sh("A"))).toEqual([]);
    expect(tok("DATAA" + sh("A") + "B:PRINT")).toEqual([T("DATA"), 0x41, 0x42, 0x3a, T("PRINT")]);
  });

  it("copies it unchanged inside a quoted string and after REM", () => {
    expect(tok('"A' + sh("A") + 'B"')).toEqual([0x22, 0x41, 0xc1, 0x42, 0x22]);
    expect(tok("REMA" + sh("A"))).toEqual([T("REM"), 0x41, 0xc1]);
  });

  it("keeps pi ($FF), the one token-range byte the ROM stores", () => {
    expect(tok("A" + String.fromCharCode(0xff))).toEqual([0x41, 0xff]);
  });

  it("drops a character that is not a byte at all (> 0xFF)", () => {
    expect(tok("A\u20acB")).toEqual([0x41, 0x42]);
  });
});

describe("crunch: table-order precedence (R3.2)", () => {
  it("GO, GOTO and GOSUB each resolve to their own token", () => {
    expect(tok("GO")).toEqual([T("GO")]);
    expect(tok("GOTO")).toEqual([T("GOTO")]);
    expect(tok("GOSUB")).toEqual([T("GOSUB")]);
    expect(tok("GOX")).toEqual([T("GO"), 0x58]);
  });

  it("PRINT# and INPUT# win over PRINT and INPUT only when the # is there", () => {
    expect(tok("PRINT#")).toEqual([T("PRINT#")]);
    expect(tok("PRINTX")).toEqual([T("PRINT"), 0x58]);
    expect(tok("INPUT#")).toEqual([T("INPUT#")]);
    expect(tok("INPUT")).toEqual([T("INPUT")]);
  });

  it("crunches keywords found inside identifiers, like the ROM (TOTAL = TO + TAL)", () => {
    expect(tok("TOTAL")).toEqual([T("TO"), 0x54, 0x41, 0x4c]);
  });

  it("a space breaks a keyword (GO TO is GO, space, TO)", () => {
    expect(tok("GO TO")).toEqual([T("GO"), 0x20, T("TO")]);
  });

  it("matchKeywordAt reports index and consumed length, or null", () => {
    expect(matchKeywordAt("GOSUB10", 0)).toEqual({ index: KEYWORDS.indexOf("GOSUB"), length: 5 });
    expect(matchKeywordAt("XPRINT", 1)).toEqual({ index: KEYWORDS.indexOf("PRINT"), length: 5 });
    expect(matchKeywordAt("QQ", 0)).toBeNull();
    expect(matchKeywordAt("", 0)).toBeNull();
  });
});

describe("crunch: reported keywords", () => {
  it("lists each crunched keyword with its start, in order, none inside quotes/REM/DATA", () => {
    const r = crunch('FORI=1TO9:PRINT"TO":REMTO');
    expect(r.keywords.map((k) => [KEYWORDS[k.index], k.start])).toEqual([
      ["FOR", 0], ["=", 4], ["TO", 6], ["PRINT", 10], ["REM", 20],
    ]);
  });

  it("never throws and yields empty output for empty text", () => {
    expect(crunch("")).toEqual({ bytes: [], keywords: [] });
  });
});

describe("tokenizeProgram (R3.9-R3.12)", () => {
  const END = T("END");

  it("sorts lines ascending by number whatever the input order (R3.9)", () => {
    const image = tokenizeProgram([{ n: 20, body: "END" }, { n: 10, body: "END" }]);
    expect([...image]).toEqual([0x07, 0x08, 10, 0, END, 0, 0x0d, 0x08, 20, 0, END, 0, 0, 0]);
  });

  it("keeps only the later input occurrence of a duplicate line number (R3.9)", () => {
    const image = tokenizeProgram([
      { n: 10, body: "END" },
      { n: 5, body: "STOP" },
      { n: 10, body: "RUN" },
    ]);
    const expected = tokenizeProgram([{ n: 5, body: "STOP" }, { n: 10, body: "RUN" }]);
    expect([...image]).toEqual([...expected]);
    expect([...image]).not.toContain(END);
  });

  it("threads link addresses from $0801 by hand-computed lengths (R3.10, R3.11)", () => {
    // 10 PRINT"A"   : 4 + (99 22 41 22) + 1 = 9 bytes -> next at $080A
    // 20 GOTO10     : 4 + (89 31 30)     + 1 = 8 bytes -> next at $0812
    const image = tokenizeProgram([{ n: 10, body: 'PRINT"A"' }, { n: 20, body: "GOTO10" }]);
    expect(BASIC_START).toBe(0x0801);
    expect([...image]).toEqual([
      0x0a, 0x08, 10, 0, 0x99, 0x22, 0x41, 0x22, 0,
      0x12, 0x08, 20, 0, 0x89, 0x31, 0x30, 0,
      0, 0,
    ]);
  });

  it("yields exactly [0, 0] for an empty program (R3.12)", () => {
    expect([...tokenizeProgram([])]).toEqual([0, 0]);
  });

  it("types each body from Gazette notation first: spaces dropped, case folded, tokens resolved", () => {
    const image = tokenizeProgram([{ n: 10, body: 'print "{CLR}a b"' }]);
    expect([...image].slice(4, -3)).toEqual([T("PRINT"), 0x22, 147, 0x41, 0x20, 0x42, 0x22]);
  });

  it("an untypeable character in a body is simply not there (parseBody reports it, the tokenizer never throws)", () => {
    expect([...tokenizeProgram([{ n: 1, body: "EN~D" }])].slice(4, -3)).toEqual([T("END")]);
  });

  it("returns a fresh Uint8Array each call and does not mutate its input", () => {
    const lines = [{ n: 2, body: "END" }, { n: 1, body: "END" }];
    const copy = structuredClone(lines);
    const a = tokenizeProgram(lines);
    const b = tokenizeProgram(lines);
    expect(a).not.toBe(b);
    expect([...a]).toEqual([...b]);
    expect(lines).toEqual(copy);
  });
});
