/**
 * REPLAY re-executes a recorded run: every attempt re-judged by the same gate, every run re-executed on a real
 * headless C64, the contract recomputed — and any disagreement with the record reported. Authored 2026 listing.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { computeChecksum } from "../../src/basic/checksum.ts";
import type { C64Core } from "../../src/emu/core.ts";
import type { CanonicalListing } from "../../src/basic/types.ts";
import { bootNodeCore } from "../../src/emu/node.ts";
import { cheat, emulatorRefusal, replay, type RunEvent } from "../../src/replay/replay.ts";
import { errata, errataText, prgBytes, provenance } from "../../src/replay/certificate.ts";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";

const truth: [number, string][] = [[10, 'PRINT"{CLR}IT LIVES"'], [20, 'GETA$:IFA$=""THEN20'], [30, 'PRINT"RISEN."'], [40, "END"]];
const spec = { expectedLines: [10, 20, 30, 40], titlePredicate: { screenContains: "IT LIVES" }, postTitle: { keys: [13], screenContains: "RISEN." } };
const lines: CanonicalListing = truth.map(([n, body]) => ({ n, body: n === 10 ? 'PR1NT"{CLR}IT LIVES"' : body, printed: computeChecksum(n, body), status: n === 10 ? "unverified" : "verified", source: "ocr" }));
const ops = [{ op: "replace", lineno: 10, new_body: 'PRINT"{CLR}IT LIVES"' }];
function recorded(gateVerdict = "accepted"): RunEvent[] {
  return [
    { k: "start", input: { listingId: "t", scope: "title-path", spec, lines, provisional: [] } },
    { k: "emu", op: "run", error: { kind: "SYNTAX", line: 10 }, titleSeen: false, postTitle: "not-reached" },
    { k: "hook", hook: "checksum-gate", via: "kiro-pre-tool-use", exit: 2, ops: [{ op: "replace", lineno: 10, new_body: "" }], stderr: "REFUSED (R4.4)" },
    { k: "proposal", ops, reason: "1 misread as I", force_unverified: false },
    { k: "gate", verdict: gateVerdict },
    { k: "emu", op: "run", error: null, titleSeen: true, postTitle: "pass" },
    { k: "end", result: "resurrected" },
  ];
}

let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); }, 60_000);

describe("replay", () => {
  it("re-judges the refusal and the fix, re-runs the C64, recomputes RESURRECTED, zero mismatches", () => {
    const r = replay(recorded(), core);
    expect(r.mismatches).toEqual([]);
    expect(r.steps.filter((s) => s.kind === "attempt").map((s) => s.kind === "attempt" && s.recomputed.verdict)).toEqual(["refused", "accepted"]);
    const runs = r.steps.filter((s) => s.kind === "run");
    expect(runs.every((s) => s.kind === "run" && s.match)).toBe(true);
    expect(r.contract?.verdict).toBe("RESURRECTED");
  });
  it("reports a record the gate does not reproduce (tampered verdict), never smooths it over", () => {
    const ev = recorded();
    (ev[3] as unknown as { ops: unknown }).ops = [{ op: "replace", lineno: 10, new_body: 'PRINT"{CLR}IT LIVED"' }]; // checksum-breaking
    const r = replay(ev, core);
    expect(r.mismatches.some((m) => /gate .*recorded accepted, re-judged refused/.test(m))).toBe(true);
    expect(r.contract?.verdict).not.toBe("RESURRECTED");
  });
  it("without a core (recorded playback) still re-judges every gate verdict, and computes no contract", () => {
    const r = replay(recorded(), null);
    expect(r.contract).toBeNull();
    expect(r.steps.filter((s) => s.kind === "run").every((s) => s.kind === "run" && s.match === null)).toBe(true);
    expect(r.final.find((l) => l.n === 10)?.status).toBe("verified");
  });
  it("refuses re-execution on a different emulator: another c64-ready version or other WASM bytes (spec F9, QA P1b r3)", () => {
    const ev = recorded();
    (ev[0] as RunEvent).emulator = { id: "c64-ready@9.9.9", wasmSha256: "a".repeat(64) };
    const r = replay(ev, core);
    expect(r.refused).toMatch(/REPLAY refused: recorded on c64-ready@9\.9\.9/);
    expect(r.contract).toBeNull(); // nothing re-ran on the C64
    expect(r.steps.filter((s) => s.kind === "run").every((s) => s.kind === "run" && s.facts === null)).toBe(true);
    expect(r.mismatches[0]).toBe(r.refused);
    (ev[0] as RunEvent).emulator = { id: core.id, wasmSha256: "a".repeat(64) };
    expect(emulatorRefusal(ev[0], core, "b".repeat(64))).toMatch(/WASM sha256 aaaaaaaaaaaa…, this browser has bbbbbbbbbbbb…/);
    expect(emulatorRefusal(ev[0], core, "a".repeat(64))).toBeNull();
    expect(emulatorRefusal(ev[0], core)).toBeNull(); // the hash is compared only when both sides know it
    expect(replay(recorded(), core).refused).toBeNull(); // no emulator recorded: replays (older recordings)
  });
  it("certificate provenance, errata and .PRG are computed from the run input and the final listing (spec F10)", () => {
    const r = replay(recorded(), core);
    const p = provenance({ ...r.input, recovery: [{ op: "orphan", ocrNumber: 89, outcome: "orphan-excluded" }], origin: { recovered: "x.json", note: "inventory from the page" } }, r.final);
    expect(p.counts).toEqual({ ocr: 3, reOcr: 0, typed: 0, patched: 1, forced: 0 });
    expect(p.perLine.get(10)).toBe("patched");
    expect(p.addedDuringRun).toEqual([]);
    expect(p.orphansExcluded).toBe(1);
    expect(p.origin).toBe("inventory from the page (recovered listing x.json)");
    const e = errata(r.input.lines, r.final, new Map([[10, "1 misread as I"]]));
    expect(e).toEqual([{ n: 10, printed: computeChecksum(10, 'PRINT"{CLR}IT LIVES"'), ocr: 'PR1NT"{CLR}IT LIVES"', final: 'PRINT"{CLR}IT LIVES"', reason: "1 misread as I", renumberedFrom: null, forced: false, status: "verified" }]);
    expect(errataText("t", "h", e)).toMatch(/OCR read : PR1NT/);
    expect(errataText("t", "h", e)).toMatch(/Every change passed the checksum gate/);
    const prg = prgBytes(r.final, r.input.spec.expectedLines);
    expect([prg[0], prg[1]]).toEqual([0x01, 0x08]);
    expect(Array.from(prg.slice(2))).toEqual(Array.from(tokenizeProgram(r.final)));
    // arch review 02: an orphan kept in the listing (not in the page inventory, never typed) never enters the .PRG
    const withOrphan = [...r.final, { n: 99, body: 'PRINT"ORPHAN"', printed: null, status: "unverified" as const, source: "ocr" }];
    expect(Array.from(prgBytes(withOrphan, r.input.spec.expectedLines))).toEqual(Array.from(prg));
  });
  it("Cheat empties the error line and is refused by the same gate", () => {
    const c = cheat(lines, spec.expectedLines, 10);
    expect(c.line).toBe(10);
    expect(c.verdict.verdict).toBe("refused");
    expect(cheat(lines, spec.expectedLines, null).line).toBe(10); // no line number → first ✗ line
  });
});

describe("renumber identity and forced lines on the certificate (arch review 01)", () => {
  it("a renumbered line is a patched line, never 'added during the run', and stays on the errata", async () => {
    const { lineOrigins } = await import("../../src/replay/certificate.ts");
    const input = { lines: [
      { n: 10, body: "PRINT 1", printed: 1, status: "verified" as const, source: "ocr" as const },
      { n: 20, body: "PRINT 2", printed: 2, status: "verified" as const, source: "ocr" as const },
    ] };
    // batch 1: 20 → 25 with a repair of its body; batch 2: 25 → 30
    const origins = lineOrigins([[{ op: "renumber", lineno: 20, new_lineno: 25 }, { op: "replace", lineno: 20, new_body: "PRINT 3" }], [{ op: "renumber", lineno: 25, new_lineno: 30 }]]);
    expect([...origins]).toEqual([[30, 20]]);
    const final = [input.lines[0]!, { n: 30, body: "PRINT 3", printed: 2, status: "verified" as const, source: "ocr" as const }];
    const p = provenance(input, final, origins);
    expect(p.addedDuringRun).toEqual([]);
    expect(p.perLine.get(30)).toBe("patched");
    const e = errata(input.lines, final, new Map(), origins);
    expect(e).toEqual([{ n: 30, printed: 2, ocr: "PRINT 2", final: "PRINT 3", reason: "", renumberedFrom: 20, forced: false, status: "verified" }]);
    expect(errataText("t", "h", e)).toMatch(/30  :rem 2   \(was line 20\)/);
    expect(provenance(input, final).addedDuringRun).toEqual([30]); // the old inference, without origins
  });
  it("the errata never says a FORCED change passed the checksum gate", () => {
    const input = [{ n: 10, body: "PRINT 1", printed: 1, status: "unverified" as const, source: "ocr" as const }];
    const final = [{ n: 10, body: "PRINT 9", printed: 1, status: "forced" as const, source: "ocr" as const }];
    const e = errata(input, final);
    expect(e[0]!.forced).toBe(true);
    const t = errataText("t", "h", e);
    expect(t).not.toMatch(/Every change passed/);
    expect(t).toMatch(/1 were FORCED after repeated refusals and never checksum-verified/);
    expect(t).toMatch(/FORCED — never verified/);
    const p = provenance({ lines: input }, final);
    expect(p.counts).toMatchObject({ patched: 0, forced: 1 }); // never counted as "changed by a gate-accepted patch"
    expect(p.perLine.get(10)).toBe("FORCED");
  });
  it("an accepted change with no readable printed checksum is not said to match the page (arch review 01 QA)", () => {
    const input = [{ n: 10, body: "PRINT 1", printed: null, status: "unverified" as const, source: "ocr" as const }];
    const final = [{ n: 10, body: "PRINT 2", printed: null, status: "unverified" as const, source: "ocr" as const }];
    const t = errataText("t", "h", errata(input, final));
    expect(t).not.toMatch(/passed the checksum gate/);
    expect(t).toMatch(/1 were accepted with no readable printed checksum \(unverified\)/);
    expect(t).toMatch(/10  :rem \?\?   UNVERIFIED/);
  });
});
