/**
 * REPLAY re-executes a recorded run: every attempt re-judged by the same gate, every run re-executed on a real
 * headless C64, the contract recomputed — and any disagreement with the record reported. Authored 2026 listing.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { computeChecksum } from "../../src/basic/checksum.ts";
import type { C64Core } from "../../src/emu/core.ts";
import type { CanonicalListing } from "../../src/basic/types.ts";
import { bootNodeCore } from "../../src/emu/node.ts";
import { cheat, replay, type RunEvent } from "../../src/replay/replay.ts";

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
  it("Cheat empties the error line and is refused by the same gate", () => {
    const c = cheat(lines, spec.expectedLines, 10);
    expect(c.line).toBe(10);
    expect(c.verdict.verdict).toBe("refused");
    expect(cheat(lines, spec.expectedLines, null).line).toBe(10); // no line number → first ✗ line
  });
});
