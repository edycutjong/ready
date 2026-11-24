/**
 * Three real-C64 typing edges found by the P3 KERNAL-equality property (P1a), pinned on the real core.
 * Each is a case where a damaged OCR line cannot be typed faithfully; the contract's clause 6 (resident image ==
 * tokenizer image) is what catches them on a real run, and the loader must refuse lines flagged by
 * controlOutsideQuotes() rather than type them.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { bootNodeCore } from "../../src/emu/node.ts";
import { type C64Core, dumpBasic, loadProgram } from "../../src/emu/core.ts";
import { controlOutsideQuotes, typedLine } from "../../src/basic/notation.ts";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";

let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); });
const lineNumbersIn = (img: Uint8Array) => { const ns: number[] = []; let i = 0; while (i + 3 < img.length && (img[i] | img[i + 1])) { ns.push(img[i + 2] | (img[i + 3] << 8)); i += 4; while (img[i] !== 0) i++; i++; } return ns; };

describe("real C64 typing edges", () => {
  it("a body that starts with a digit merges into the line number (10 + '0RINT' is stored as line 100)", () => {
    loadProgram(core, [typedLine(10, '0RINT"A"').codes]);
    expect(lineNumbersIn(dumpBasic(core))).toEqual([100]);
  });
  it("{CLR} outside quotes is executed by the screen editor, so the line is never stored", () => {
    const t = typedLine(1, 'PRINT0{CLR}"HI"');
    expect(controlOutsideQuotes(t.codes).length).toBeGreaterThan(0);
    loadProgram(core, [t.codes, typedLine(2, "END").codes]);
    expect(lineNumbersIn(dumpBasic(core))).toEqual([2]);
    expect(controlOutsideQuotes(typedLine(1, 'PRINT"{CLR}HI"').codes)).toEqual([]);
  });
  it("a line number with nothing typeable after it deletes the line instead of storing it", () => {
    loadProgram(core, [typedLine(10, "END").codes, typedLine(20, "|").codes]);
    expect(lineNumbersIn(dumpBasic(core))).toEqual([10]);
  });
  it("trailing blanks inside an unclosed quote are dropped by the editor, and the tokenizer agrees", () => {
    loadProgram(core, [typedLine(50, 'PRINT"OPEN.0   ').codes]);
    expect([...dumpBasic(core)]).toEqual([...tokenizeProgram([{ n: 50, body: 'PRINT"OPEN.0   ' }])]);
  });
});
