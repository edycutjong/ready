/**
 * The three runtime hook commands, driven exactly as kiro-cli drives them: a child process with the hook event JSON on
 * STDIN and RUN_DIR in the environment (stdin shape measured in spike K1: session_id, hook_event_name, tool_name
 * "mcp_c64_apply_patch", tool_input {ops:[{op,lineno,new_body}], reason}). Fixture = an original 2026 listing.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeChecksum } from "../../src/basic/checksum.ts";

const L = (n: number, body: string, printed: number | null, status = "verified", source = "ocr") => ({ n, body, printed, status, source, provisional: false });
const good20 = 'PRINT"IT LIVES"';
const p10 = computeChecksum(10, 'A$="READY"'), p20 = computeChecksum(20, good20), p30 = computeChecksum(30, "GOTO 30");
const spec = { expectedLines: [10, 20, 30], titlePredicate: { screenContains: "IT LIVES" }, postTitle: { keys: [13], screenContains: "READY." } };

function runDir(lines = [L(10, 'A$="READY"', p10), L(20, 'PR1NT"IT LIVES"', p20, "unverified"), L(30, "GOTO 30", p30)], contract: object = { state: "NOT-RESURRECTED", heading: "" }, extra: object = {}) {
  const d = mkdtempSync(join(tmpdir(), "ready-hooks-"));
  writeFileSync(join(d, "input.json"), JSON.stringify({ listingId: "t", scope: "title-path", spec, lines, provisional: [] }));
  writeFileSync(join(d, "listing.json"), JSON.stringify({ listingId: "t", scope: "title-path", expectedLines: spec.expectedLines, lines, untypeable: [], iteration: 0, postTitle: "not-reached", contract, ...extra }));
  return d;
}
const hook = (name: string, dir: string, stdin: object | null, args: string[] = []) =>
  spawnSync(process.execPath, [`scripts/hooks/${name}.mjs`, ...args], { input: stdin ? JSON.stringify(stdin) : "", env: { ...process.env, RUN_DIR: dir }, encoding: "utf8" });
const patch = (ops: object[], force = false) => ({ session_id: "sess_test", hook_event_name: "PreToolUse", tool_name: "mcp_c64_apply_patch", tool_input: { ops, reason: "test", force_unverified: force } });
const events = (dir: string) => readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const ev = (dir: string, e: object) => writeFileSync(join(dir, "events.jsonl"), (existsSync(join(dir, "events.jsonl")) ? readFileSync(join(dir, "events.jsonl"), "utf8") : "") + JSON.stringify(e) + "\n");

describe("checksum-gate.mjs (Pre Tool Use, matcher @c64/apply_patch)", () => {
  it("refuses an emptying patch with exit 2, the gate's reason on STDERR, and counts the refusal", () => {
    const d = runDir();
    const r = hook("checksum-gate", d, patch([{ op: "replace", lineno: 20, new_body: "" }]));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/REFUSED \(R4\.4\)/);
    expect(events(d).at(-1)).toMatchObject({ k: "hook", hook: "checksum-gate", exit: 2, decision: "refused" });
  });
  it("refuses a checksum-breaking fix with printed vs computed, and allows the true fix (exit 0)", () => {
    const d = runDir();
    const bad = hook("checksum-gate", d, patch([{ op: "replace", lineno: 20, new_body: 'PRINT"IT LIVED"' }]));
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(new RegExp(`printed :rem ${p20}, computed \\d+`));
    const ok = hook("checksum-gate", d, patch([{ op: "replace", lineno: 20, new_body: good20 }]));
    expect(ok.status).toBe(0);
    expect(events(d).at(-1)).toMatchObject({ exit: 0, decision: "accepted" });
  });
  it("force_unverified: refused at 0 and 1 prior refusals, applied (FORCED) at 2 — the hook owns the count", () => {
    const d = runDir();
    const wrong = [{ op: "replace", lineno: 20, new_body: 'PRINT"IT LIVED"' }];
    expect(hook("checksum-gate", d, patch(wrong, true)).status).toBe(2); // 0 prior → refused (R4.17), count 1
    expect(hook("checksum-gate", d, patch(wrong, true)).status).toBe(2); // 1 prior → refused, count 2
    const third = hook("checksum-gate", d, patch(wrong, true));
    expect(third.status).toBe(0);
    expect(events(d).at(-1)).toMatchObject({ decision: "forced" });
  });
  it("never blocks another tool", () => {
    const d = runDir();
    expect(hook("checksum-gate", d, { ...patch([]), tool_name: "mcp_c64_c64_run" }).status).toBe(0);
  });
});

describe("until-title.mjs (Agent Stop hook + runner --check)", () => {
  const run = { k: "emu", op: "run" };
  it("blocks before the first RUN and after an accepted patch that was not RUN", () => {
    const d = runDir();
    expect(JSON.parse(hook("until-title", d, null, ["--check"]).stdout)).toMatchObject({ stop: false });
    ev(d, run); ev(d, { k: "gate", verdict: "accepted" });
    expect(JSON.parse(hook("until-title", d, null, ["--check"]).stdout).reason).toMatch(/not been RUN/);
  });
  it("blocks on a fixable checksum-mismatch line even when the title appeared (title alone = BOOTED)", () => {
    const d = runDir(undefined, { state: "BOOTED-PARTIAL", heading: "TITLE-PATH BOOTED — PARTIAL" });
    writeFileSync(join(d, "state.json"), JSON.stringify({ titleSeen: true, error: null }));
    ev(d, run);
    const r = hook("until-title", d, { session_id: "s", hook_event_name: "Stop" });
    expect(JSON.parse(r.stdout)).toMatchObject({ decision: "block" });
    expect(JSON.parse(r.stdout).reason).toMatch(/20 \(checksum mismatch/);
    expect(events(d).at(-1)).toMatchObject({ hook: "until-title", decision: "block" });
  });
  it("allows stop on RESURRECTED (no output in hook mode)", () => {
    const d = runDir([L(10, 'A$="READY"', p10), L(20, good20, p20), L(30, "GOTO 30", p30)], { state: "RESURRECTED", heading: "TITLE-PATH RESURRECTED · 3/3 checksum-consistent" });
    ev(d, run);
    const r = hook("until-title", d, { hook_event_name: "Stop" });
    expect(r.stdout.trim()).toBe("");
    expect(JSON.parse(hook("until-title", d, null, ["--check"]).stdout)).toMatchObject({ stop: true, result: "resurrected" });
  });
  it("allows stop when only unfixable lines remain (lost line, unparseable printed checksum)", () => {
    const d = runDir([L(10, 'A$="READY"', p10), L(20, good20, null, "unverified")], { state: "BOOTED-PARTIAL" });
    ev(d, run);
    const c = JSON.parse(hook("until-title", d, null, ["--check"]).stdout);
    expect(c).toMatchObject({ stop: true, result: "booted-partial" });
    expect(c.reason).toMatch(/missing .*30/);
  });
  it("allows stop at the iteration cap, counting hook refusals the server never saw", () => {
    const d = runDir(undefined, { state: "NOT-RESURRECTED" }, { iteration: 10 });
    ev(d, run);
    for (let i = 0; i < 5; i++) ev(d, { k: "hook", hook: "checksum-gate", via: "kiro-pre-tool-use", exit: 2 }); // 5 refused CALLS
    const c = JSON.parse(hook("until-title", d, null, ["--check"]).stdout);
    expect(c).toMatchObject({ stop: true, cap: "iteration cap (15/15)" });
  });
  it("allows stop at the 8-credit cap when metered, never when unmetered (QA P1b r3)", () => {
    const d = runDir(undefined, { state: "NOT-RESURRECTED" });
    ev(d, run);
    writeFileSync(join(d, "credits.json"), JSON.stringify({ metered: true, credits: 8.02, iterations: 3, startedAt: Date.now() }));
    expect(JSON.parse(hook("until-title", d, null, ["--check"]).stdout)).toMatchObject({ stop: true, cap: "credit cap (8.02/8)" });
    writeFileSync(join(d, "credits.json"), JSON.stringify({ metered: false, credits: 99, iterations: 3, startedAt: Date.now() }));
    expect(JSON.parse(hook("until-title", d, null, ["--check"]).stdout).cap).toBeUndefined();
  });
  it("allows stop at the 600 s wall cap (QA P1b r3)", () => {
    const d = runDir(undefined, { state: "NOT-RESURRECTED" });
    ev(d, run);
    writeFileSync(join(d, "credits.json"), JSON.stringify({ metered: true, credits: 1, iterations: 3, startedAt: Date.now() - 601_000 }));
    const c = JSON.parse(hook("until-title", d, null, ["--check"]).stdout);
    expect(c.stop).toBe(true);
    expect(c.cap).toMatch(/^wall cap \(60\d s\/600 s\)$/);
  });
});

describe("until-title.mjs — consistent is not runs (QA P1b r1)", () => {
  it("blocks when every line is checksum-consistent and present but the C64 shows no title", () => {
    const d = runDir([L(10, 'A$="READY"', p10), L(20, good20, p20), L(30, "GOTO 30", p30)], { state: "NOT-RESURRECTED", failed: [{ clause: 1, lines: [] }, { clause: 2, lines: [] }] });
    ev(d, { k: "emu", op: "run" });
    const c = JSON.parse(hook("until-title", d, null, ["--check"]).stdout);
    expect(c.stop).toBe(false);
    expect(c.reason).toMatch(/necessary, not sufficient/);
  });
  it("a refused deletion charges no refusal count (it can never unlock force_unverified)", () => {
    const d = runDir();
    hook("checksum-gate", d, patch([{ op: "replace", lineno: 20, new_body: "" }]));
    expect(JSON.parse(readFileSync(join(d, "refusals.json"), "utf8"))).toEqual({});
  });
});

describe("listing-context.mjs (Session Start)", () => {
  it("prints the inventory, the title rule and the listing with printed checksums; never a reference", () => {
    const d = runDir([L(10, 'A$="READY"', p10), L(20, 'PR1NT"IT LIVES"', p20, "unverified")]);
    const r = hook("listing-context", d, { hook_event_name: "SessionStart" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Expected line numbers: 10, 20, 30\./);
    expect(r.stdout).toMatch(/Lost by OCR and not recovered .*: 30\./);
    expect(r.stdout).toContain(`20 PR1NT"IT LIVES" :rem ${p20}   ✗checksum mismatch`);
    expect(r.stdout).toMatch(/SERVER presses RETURN/);
  });
});
