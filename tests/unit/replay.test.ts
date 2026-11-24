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
    expect(p.counts).toEqual({ ocr: 3, reOcr: 0, typed: 0, patched: 1 });
    expect(p.perLine.get(10)).toBe("patched");
    expect(p.addedDuringRun).toEqual([]);
    expect(p.orphansExcluded).toBe(1);
    expect(p.origin).toBe("inventory from the page (recovered listing x.json)");
    const e = errata(r.input.lines, r.final, new Map([[10, "1 misread as I"]]));
    expect(e).toEqual([{ n: 10, printed: computeChecksum(10, 'PRINT"{CLR}IT LIVES"'), ocr: 'PR1NT"{CLR}IT LIVES"', final: 'PRINT"{CLR}IT LIVES"', reason: "1 misread as I" }]);
    expect(errataText("t", "h", e)).toMatch(/OCR read : PR1NT/);
    const prg = prgBytes(r.final);
    expect([prg[0], prg[1]]).toEqual([0x01, 0x08]);
    expect(Array.from(prg.slice(2))).toEqual(Array.from(tokenizeProgram(r.final)));
  });
  it("Cheat empties the error line and is refused by the same gate", () => {
    const c = cheat(lines, spec.expectedLines, 10);
    expect(c.line).toBe(10);
    expect(c.verdict.verdict).toBe("refused");
    expect(cheat(lines, spec.expectedLines, null).line).toBe(10); // no line number → first ✗ line
  });
});
