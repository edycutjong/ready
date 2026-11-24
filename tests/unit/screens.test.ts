import { describe, expect, it } from "vitest";
import { screenOf } from "../../src/replay/screens.ts";
import { readFileSync, readdirSync } from "node:fs";

describe("screenOf (recorded playback C64 pane)", () => {
  it("shows the furthest screen the recorded run reached, not the tool report", () => {
    const r = "RESURRECTED · 12/12\nerror: none\n--- AFTER RUN ---\n\n  AFTER\n--- TITLE ---\n\n  THE TITLE\n--- POST-TITLE ---\n THE SPIRITS ANSWER\n\nREADY.\n";
    expect(screenOf(r)).toBe(" THE SPIRITS ANSWER\n\nREADY.");
    expect(screenOf("x\n--- TITLE ---\nT\n")).toBe("T");
    expect(screenOf("no sections")).toBe("no sections");
  });
  it("works on the shipped recorded run", () => {
    const f = readdirSync("public/runs").find((n) => /^line20-.*\.jsonl$/.test(n))!;
    const ev = readFileSync(`public/runs/${f}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const shown = ev.filter((e) => e.k === "kiro" && e.op === "tool_result" && /c64_run/.test(String(e.title ?? ""))).map((e) => screenOf(String(e.text)));
    expect(shown.length).toBeGreaterThan(0);
    for (const s of shown) expect(s).not.toMatch(/titleSeen|untypeable|postTitle:/);
  });
});
