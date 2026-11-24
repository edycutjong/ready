/** afterLastRun / parseError anchor on the echoed RUN row, not on "RUN" inside program output (QA P1a r2). */
import { describe, expect, it } from "vitest";
import { afterLastRun, parseError } from "../../src/emu/core.ts";

describe("RUN anchor", () => {
  it("ignores RUN inside program output", () => {
    const screen = "READY.\nRUN\nVIC OR 64?\nRUNNING THE SEEDS";
    expect(afterLastRun(screen)).toBe("VIC OR 64?\nRUNNING THE SEEDS");
  });
  it("an error printed before RUNNING text is still the run's error", () => {
    expect(parseError("RUN\n?SYNTAX  ERROR IN 20\nRUNNING\nREADY.")).toEqual({ kind: "SYNTAX", line: 20 });
  });
  it("whole screen when the program cleared the echo", () => {
    expect(afterLastRun("PRESS SPACE\nVIC OR 64?")).toBe("PRESS SPACE\nVIC OR 64?");
  });
});
