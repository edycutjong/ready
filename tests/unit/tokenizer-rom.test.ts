/**
 * The tokenizer against the real C64 (c64-ready@3.4.0, Commodore KERNAL ROM). One core is booted once and
 * every case is typed with `loadProgram`; the bytes `dumpBasic` reads back must equal the model's.
 * These cases are the measured evidence for the places where R3.7/R3.8's wording was corrected
 * (abbreviation shape, stray bytes >= 0x80, P+shift-R = PRINT#). Cases are authored 2026 text.
 * Line bodies never start with a digit: the ROM's line-number parser skips spaces, so "10 3" is line 103.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { bootNodeCore } from "../../src/emu/node.ts";
import { dumpBasic, loadProgram, typeAndSettle, type C64Core } from "../../src/emu/core.ts";
import { crunchLine, tokenizeProgram } from "../../src/basic/tokenizer.ts";
import { typedLine } from "../../src/basic/notation.ts";

const sh = (letter: string): string => String.fromCharCode(letter.charCodeAt(0) | 0x80);
const q = String.fromCharCode(0x22);

const RETURN = 13;

/**
 * NEW, then type one line and press RETURN, giving the ROM 30 frames to crunch it. `loadProgram` settles for
 * only 2 frames, which is too short for a long unquoted line (measured: a 32-code line was still being
 * crunched when `dumpBasic` read memory), so this test settles longer.
 */
function enter(core: C64Core, codes: readonly number[]): void {
  loadProgram(core, []);
  typeAndSettle(core, [...codes, RETURN], 30);
}

const CASES: readonly [name: string, body: string][] = [
  ["plain keywords", "FORI=1TO9:NEXT"],
  ["? is PRINT", "?A"],
  ["keyword text in quotes", `PRINT${q}GOTO?END${q}`],
  ["unterminated quote", `PRINT${q}GOTO`],
  ["REM swallows everything", `REMX:PRINT?${q}A`],
  ["DATA until colon", "DATAA,PRINT:PRINT"],
  ["DATA quoted colon", `DATA${q}A:B${q}:END`],
  ["DATA question mark", "DATA?:?"],
  ["GO alone", "GOX"],
  ["GOTO", "GOTO100"],
  ["GOSUB", "GOSUB100"],
  ["PRINT#", "PRINT#1"],
  ["PRINT then letter", "PRINTX"],
  ["INPUT#", "INPUT#1"],
  ["keyword inside identifier", "TOTAL=1"],
  ["space breaks GO TO", "GO TO"],
  ["P+shift-R is PRINT#", "P" + sh("R")],
  ["PR+shift-I", "PR" + sh("I")],
  ["PRIN+shift-T", "PRIN" + sh("T")],
  ["E+shift-N is END", "E" + sh("N")],
  ["TH+shift-E is THEN", "TH" + sh("E")],
  ["GO+shift-S is GOSUB", "GO" + sh("S")],
  ["G+shift-O is GOTO", "G" + sh("O")],
  ["R+shift-E is READ", "R" + sh("E")],
  ["I+shift-N is INPUT#", "I" + sh("N")],
  ["A+shift-T is ATN", "A" + sh("T") + "X"],
  ["M+shift-I is MID$", "M" + sh("I") + "$"],
  ["L+shift-E is LET? (table order)", "L" + sh("E")],
  ["shifted last letter: I+shift-F", "I" + sh("F")],
  ["shifted last letter: T+shift-O", "T" + sh("O")],
  ["shifted last letter: FO+shift-R", "FO" + sh("R")],
  ["shifted wrong letter", "P" + sh("A")],
  ["stray shifted byte", "X" + sh("A") + "Y"],
  ["stray shifted byte in DATA", "DATAA" + sh("A") + "B:PRINT"],
  ["shifted byte in quotes", `${q}A${sh("A")}B${q}`],
  ["shifted byte after REM", "REMA" + sh("A")],
  ["pi", "A" + String.fromCharCode(0xff)],
  ["operators", "A<>B"],
  ["TAB( and STR$", "PRINTTAB(5)STR$(1)"],
  ["control codes in quotes", `PRINT${q}${String.fromCharCode(147, 17, 18, 5, 133, 32)}${q}`],
];

describe("tokenizer == the real KERNAL (R3 user story: byte for byte)", () => {
  let core: C64Core;
  beforeAll(async () => {
    core = await bootNodeCore();
  });

  it.each(CASES)("%s", (_name, body) => {
    enter(core, [0x31, 0x30, ...[...body].map((c) => c.charCodeAt(0))]); // "10" + body
    const line = crunchLine(10, body, 0x0801).bytes;
    expect([...dumpBasic(core)]).toEqual([...line, 0, 0]);
  });

  // R1.11: an abbreviated long line must store exactly what the unabbreviated one would (typedLine -> KERNAL).
  it("a line over 80 codes, abbreviated by typedLine, stores the same bytes as tokenizeProgram predicts", () => {
    // 2 + 79 = 81 typed codes before abbreviation; the rightmost keyword (GOTO) saves 2 -> 79, a length the
    // machine accepts (see the 79/80 test below: exactly 80 would not be stored).
    const body = "END:STOP:THEN:GOTO9:".repeat(4).slice(0, -1);
    const typed = typedLine(10, body);
    expect(typed.tooLong).toBe(false);
    expect(typed.codes.length).toBeLessThanOrEqual(80);
    expect(typed.codes.some((c) => c >= 0x80)).toBe(true);
    enter(core, typed.codes);
    expect([...dumpBasic(core)]).toEqual([...tokenizeProgram([{ n: 10, body }])]);
  });

  // MEASURED: R1.10's limit of 80 typed codes is one too many for the keyboard path. A line of 79 codes
  // is stored; 80 and above is not (the 80th character wraps the cursor to a third row, so RETURN reads an empty
  // line). `MAX_TYPED` in notation.ts stays 80 as R1.10/tasks 5.3 specify; contract clause 6 would flag the
  // missing line, never hide it.
  it("a 79-code line is stored by typing, an 80-code line is not", () => {
    const at = (total: number): number[] => [0x31, 0x30, 0x22, ...Array(total - 3).fill(0x41)];
    enter(core, at(79));
    expect(dumpBasic(core).length).toBe(84); // link 2 + number 2 + 77 body bytes (quote + 76 A) + terminator 1 + end link 2
    enter(core, at(80));
    expect([...dumpBasic(core)]).toEqual([0, 0]);
  });

  it("Gazette notation round-trips through the machine: spaces, case, tokens in quotes", () => {
    const body = 'print "{CLR}{3 DOWN}Hi there":goto 10';
    const typed = typedLine(20, body);
    enter(core, typed.codes);
    expect([...dumpBasic(core)]).toEqual([...tokenizeProgram([{ n: 20, body }])]);
  });
});
