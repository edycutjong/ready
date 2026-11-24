/** src/emu/core.ts on the real c64-ready core (REPORT 1a protocol) + its pure helpers. */
import { beforeAll, describe, expect, it } from "vitest";
import { bootNodeCore, c64ReadyWasmSha256 } from "../../src/emu/node.ts";
import { type C64Core, asciiToPetscii, dumpBasic, loadProgram, parseError, readScreenText, runProgram, screenCodeToChar } from "../../src/emu/core.ts";

let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); });

describe("pure helpers", () => {
  it("parses the real C64 double-space error format, only after the last RUN", () => {
    expect(parseError("RUN\n\n?SYNTAX  ERROR IN 20\nREADY.")).toEqual({ kind: "SYNTAX", line: 20 });
    expect(parseError("?SYNTAX  ERROR\nREADY.\nRUN\nHELLO")).toBeNull();
    expect(parseError("RUN\n?UNDEF'D STATEMENT  ERROR IN 40")).toEqual({ kind: "UNDEF'D STATEMENT", line: 40 });
    expect(parseError("RUN\n?OUT OF DATA  ERROR IN 19")).toEqual({ kind: "OUT OF DATA", line: 19 });
  });
  it("maps screen codes, ignoring reverse video", () => {
    expect(screenCodeToChar(1)).toBe("A");
    expect(screenCodeToChar(1 | 0x80)).toBe("A");
    expect(screenCodeToChar(0x20)).toBe(" ");
    expect(screenCodeToChar(0x30)).toBe("0");
  });
  it("folds lower case and drops untypeable characters", () => {
    expect(asciiToPetscii("run\n")).toEqual([82, 85, 78, 13]);
  });
});

describe("real core round trip (pinned WASM)", () => {
  it("is the pinned c64-ready build", () => {
    expect(c64ReadyWasmSha256()).toBe("dad5965346c0e72e82611e87ecf8358d11fa068977958ef854f74289f87e0f46");
  });
  it("boots to READY.", () => {
    expect(readScreenText(core)).toMatch(/READY\./);
  });
  it.each([20, 30, 40, 60, 70])("a syntax error planted in line %i is reported as ?SYNTAX ERROR IN %i", (n) => {
    const lines = [10, 20, 30, 40, 50, 60, 70, 80].map((ln) => asciiToPetscii(ln === n ? `${ln} PRINT )(` : `${ln} PRINT "LINE ${ln}"`));
    loadProgram(core, lines);
    const r = runProgram(core, { maxFrames: 1500 });
    expect(r.error).toEqual({ kind: "SYNTAX", line: n });
    expect(r.screen).toMatch(new RegExp(`\\?SYNTAX  ERROR IN ${n}`));
  });
  it("NEW + retype replaces the resident program (dump reflects the latest load)", () => {
    loadProgram(core, [asciiToPetscii('10 PRINT"A"')]);
    const a = dumpBasic(core);
    loadProgram(core, [asciiToPetscii('10 PRINT"AB"')]);
    const b = dumpBasic(core);
    expect(b.length).toBe(a.length + 1);
    // link(2) + line number 10 (2) + PRINT token $99 + quote
    expect([...b.slice(2, 6)]).toEqual([10, 0, 0x99, 0x22]);
  });
});
