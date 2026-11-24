/** runner/stream.ts replayed over a real kiro-cli 3.5.0 stream (spike K1/K2, evidence/spikes/k1-k2-stream.jsonl). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLine, sessionIdOf } from "../../runner/stream.ts";

const lines = readFileSync(new URL("../../evidence/spikes/k1-k2-stream.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);
const events = lines.flatMap(parseLine);

describe("kiro-cli stream-json parser", () => {
  it("sees the on-demand tool load before the MCP call", () => {
    const i = events.findIndex((e) => e.k === "tool_load" && e.id === "tool::c64::apply_patch");
    const j = events.findIndex((e) => e.k === "tool_call" && e.title === "@c64/apply_patch");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThan(i);
  });
  it("classifies the Pre Tool Use refusal and the permission denial", () => {
    const results = events.filter((e) => e.k === "tool_result");
    expect(results.filter((r) => r.k === "tool_result" && r.hookRefusal)).toHaveLength(1);
    expect(results.filter((r) => r.k === "tool_result" && r.permissionDenied)).toHaveLength(1);
  });
  it("reads the metered credits once and the final text", () => {
    const credits = events.filter((e) => e.k === "credits");
    expect(credits).toHaveLength(1);
    expect(credits[0].k === "credits" && credits[0].usage).toBeCloseTo(0.7336, 3);
    expect(events.at(-1)?.k).toBe("finished");
  });
  it("finds the session id used to resume", () => {
    expect(lines.map(sessionIdOf).find(Boolean)).toMatch(/^sess_/);
  });
  it("ignores garbage lines", () => {
    expect(parseLine("not json")).toEqual([]);
  });
});
