// The desk's "fix it yourself" box (a2a judge round 01) and the three public recordings it sits on.
// judgePatch must be the SAME gate as the agent's apply_patch: the agent's accepted bodies pass, edits that break the
// printed checksum, deletions and inserts are refused, and no C64 is needed (the public URL has none).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { judgePatch, replay, type RunEvent } from "../../src/replay/replay.ts";

const runs = JSON.parse(readFileSync("public/runs/index.json", "utf8")).runs as { id: string; file: string }[];
const load = (id: string) => {
  const ref = runs.find((r) => r.id === id);
  if (!ref) throw new Error(`no public run ${id}`);
  const events = readFileSync(`public${ref.file}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunEvent);
  return replay(events, null);
};

describe("public recordings on / (recorded mode, no C64)", () => {
  it("lists the hero first, then the two harder authored cases", () => {
    expect(runs.map((r) => r.id)).toEqual(["line20-hero", "knock-case5", "ossuary-case6"]);
  });
  for (const id of ["line20-hero", "knock-case5", "ossuary-case6"]) {
    it(`${id}: every recorded gate decision re-judges the same, recorded end RESURRECTED`, () => {
      const r = load(id);
      expect(r.refused).toBeNull();
      expect(r.mismatches).toEqual([]);
      expect(r.recordedEnd?.result).toBe("RESURRECTED");
      expect(r.steps.filter((s) => s.kind === "attempt").every((s) => s.kind === "attempt" && s.recomputed.verdict === "accepted")).toBe(true);
    });
  }
});

describe("judgePatch — a visitor's line through the agent's gate", () => {
  it("accepts the hero fix the agent made, typed as a C64 owner types it", () => {
    const r = load("line20-hero");
    const v = judgePatch(r.input.lines, r.input.spec.expectedLines, '20 PRINT"   ** THE LAST SEANCE **"');
    expect(v.line).toBe(20);
    expect("verdict" in v && v.verdict.verdict).toBe("accepted");
  });
  it("refuses a line that runs but does not match the printed checksum", () => {
    const r = load("line20-hero");
    const v = judgePatch(r.input.lines, r.input.spec.expectedLines, '20 PRINT"   ** THE LOST SEANCE **"');
    expect("verdict" in v && v.verdict.verdict).toBe("refused");
    expect("verdict" in v && v.verdict.reason).toMatch(/checksum/i);
    const rewrite = judgePatch(r.input.lines, r.input.spec.expectedLines, '20 PRINT"IT LIVES"');
    expect("verdict" in rewrite && rewrite.verdict.reason).toMatch(/R4\.7/); // the 40% edit cap: fix typos, do not rewrite
  });
  it("ossuary: patching the line the C64 blames (19) is refused; the DATA line the agent fixed (890) is accepted", () => {
    const r = load("ossuary-case6");
    const blamed = judgePatch(r.input.lines, r.input.spec.expectedLines, "19 FORI=1TOC-1:READA:S=S+A:NEXT");
    expect("verdict" in blamed && blamed.verdict.verdict).toBe("refused");
    const asRead = judgePatch(r.input.lines, r.input.spec.expectedLines, "19 FORI=1TOC:READA:S=S+A:NEXT");
    expect("verdict" in asRead && asRead.verdict.verdict).toBe("accepted"); // line 19 already matches its printed sum
    const fault = judgePatch(r.input.lines, r.input.spec.expectedLines, "890 DATA 5,3,5,8,9,7,9,3");
    expect("verdict" in fault && fault.verdict.verdict).toBe("accepted");
  });
  it("knock: the silent DATA misprint is caught by its checksum, the intended value passes", () => {
    const r = load("knock-case5");
    const asPrinted = judgePatch(r.input.lines, r.input.spec.expectedLines, "80 DATA 73,84,32,78");
    expect("verdict" in asPrinted && asPrinted.verdict.verdict).toBe("refused");
    const intended = judgePatch(r.input.lines, r.input.spec.expectedLines, "80 DATA 73,84,32,76");
    expect("verdict" in intended && intended.verdict.verdict).toBe("accepted");
  });
  it("refuses deleting a line and inventing a new one; asks for a line number when none is typed", () => {
    const r = load("line20-hero");
    const del = judgePatch(r.input.lines, r.input.spec.expectedLines, "20");
    expect("verdict" in del && del.verdict.verdict).toBe("refused");
    const ins = judgePatch(r.input.lines, r.input.spec.expectedLines, '25 PRINT"BOO"');
    expect("verdict" in ins && ins.verdict.verdict).toBe("refused");
    const none = judgePatch(r.input.lines, r.input.spec.expectedLines, 'PRINT"BOO"');
    expect(none.line).toBeNull();
  });
});
