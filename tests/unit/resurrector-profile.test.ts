/** Pins the agent's least privilege (agent contract §2, tightened in P1b QA r1): MCP c64 only; no read, shell, write or web. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("resurrector profile: tools @c64 only, fs_read/shell/fs_write/web denied, inline hooks on the three triggers, no CLI 2.x fields", () => {
  const p = JSON.parse(readFileSync(".kiro/agents/resurrector.json", "utf8"));
  expect(p.tools).toEqual(["@c64"]);
  const eff = (c: string) => p.permissions.rules.filter((r: { capability: string }) => r.capability === c).map((r: { effect: string }) => r.effect);
  for (const c of ["fs_read", "shell", "fs_write", "web"]) expect(eff(c)).toEqual(["deny"]);
  expect(p.permissions.rules.find((r: { capability: string }) => r.capability === "mcp")).toMatchObject({ match: ["c64/*"], effect: "allow" });
  expect(p.hooks.map((h: { trigger: string; matcher?: string }) => `${h.trigger}${h.matcher ? ` ${h.matcher}` : ""}`)).toEqual(["SessionStart", "PreToolUse @c64/apply_patch", "Stop"]);
  expect(p.allowedTools).toBeUndefined();
  expect(p.toolsSettings).toBeUndefined();
});
