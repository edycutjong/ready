/**
 * scripts/record-run.mjs against a stub child (tests/fixtures/kiro-stub.mjs) — the kill path and cap propagation
 * (QA P1a r2): the 15th fix attempt's RESULT must be on the record before the iteration kill, the end event must
 * carry the cap, and metered credits must reach credits.json (read by until-title.mjs) and the ledger.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function record(env: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "ready-rec-"));
  writeFileSync(join(d, "prompt.md"), "stub prompt");
  const out = join(d, "run.jsonl"), rd = join(d, "run");
  const r = spawnSync(process.execPath, ["scripts/record-run.mjs", "--listing", "stub", "--prompt-file", join(d, "prompt.md"), "--out", out, "--run-dir", rd,
    "--ledger", join(d, "ledger"), "--kiro-bin", resolve("tests/fixtures/kiro-stub.mjs"), "--stop-check", "node scripts/hooks/until-title.mjs --check"],
    { env: { ...process.env, ...env }, encoding: "utf8", timeout: 60_000 });
  const ev = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { r, ev, rd };
}

describe("record-run.mjs with a stub kiro-cli", () => {
  it("kills at the iteration cap only after the 15th apply_patch result is recorded", () => {
    const { ev } = record({ STUB_CALLS: "20", STUB_DELAY: "15" });
    const results = ev.filter((e) => e.k === "kiro" && e.op === "tool_result");
    expect(results.length).toBe(15);
    expect(results.at(-1).text).toBe("ACCEPTED 15");
    expect(ev.at(-1)).toMatchObject({ k: "end", cap: "iterations", iterations: 15 });
    // a killed cycle never reports its credits: the total is a lower bound, never a fake 0
    expect(ev.find((e) => e.k === "credits" && e.lowerBound !== undefined)).toMatchObject({ lowerBound: true });
  }, 60_000);
  it("propagates metered credits to credits.json and ends on the stop check, one cycle", () => {
    const { r, ev, rd } = record({ STUB_CALLS: "2", STUB_CREDITS: "0.75" });
    expect(r.status).toBe(0);
    expect(ev.filter((e) => e.k === "cycle")).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(rd, "credits.json"), "utf8"))).toMatchObject({ metered: true, credits: 0.75, iterations: 2 });
    expect(ev.at(-1)).toMatchObject({ k: "end", cap: null });
    expect(JSON.parse(r.stdout.trim().split("\n").at(-1)!)).toMatchObject({ credits: 0.75 });
  }, 60_000);
  it("merges the server's events.jsonl into the run after a cycle (spike G attempt 1 crashed here)", () => {
    const { r, ev } = record({ STUB_CALLS: "1", STUB_EVENT: "1" });
    expect(r.status).toBe(0);
    expect(ev.some((e) => e.k === "emu" && e.op === "run")).toBe(true);
    expect(ev.at(-1).k).toBe("end");
  }, 60_000);
});
