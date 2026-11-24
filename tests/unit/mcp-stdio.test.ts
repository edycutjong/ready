/**
 * c64-mcp-server task 7.2 (claude-direct, Kiro credit line capped): the real stdio server spawned the way kiro-cli
 * spawns it, driven by the SDK client. RUN_DIR must be passed explicitly (not in the SDK's inherited env list).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { computeChecksum } from "../../src/basic/checksum.ts";
import { makeRun, type Run } from "../fixtures/mcp-fixture.ts";

let run: Run | null = null;
afterEach(() => { run?.cleanup(); run = null; });

describe("c64 MCP server over stdio", () => {
  it("lists the 6 tools in order, answers checksum_line, returns isError on a malformed call, exits 0 on close", async () => {
    run = makeRun();
    const t = new StdioClientTransport({ command: process.execPath, args: ["mcp/c64-server/server.ts"], env: { ...process.env, RUN_DIR: run.dir } as Record<string, string>, stderr: "pipe" });
    const c = new Client({ name: "test", version: "0" });
    await c.connect(t);
    const listed = (await c.listTools()).tools;
    expect(listed.map((x) => x.name)).toEqual(["c64_reload", "c64_run", "c64_read_screen", "c64_press", "checksum_line", "apply_patch"]);
    expect(listed.every((x) => x.inputSchema.type === "object")).toBe(true);
    const r = await c.callTool({ name: "checksum_line", arguments: { lineno: 10, body: 'PRINT"HI"' } });
    expect(JSON.stringify(r.content)).toContain(String(computeChecksum(10, 'PRINT"HI"')));
    const bad = await c.callTool({ name: "c64_run", arguments: { frames: "many" } });
    expect(bad.isError).toBe(true);
    const pid = (t as unknown as { pid: number | null }).pid;
    await c.close();
    expect(pid).toBeTypeOf("number");
    expect(run.has("listing.json")).toBe(true);
  }, 60_000);
  it("refuses to start without RUN_DIR, writing nothing", () => {
    const r = spawnSync(process.execPath, ["mcp/c64-server/server.ts"], { env: { ...process.env, RUN_DIR: "" }, encoding: "utf8", input: "" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/RUN_DIR/);
  }, 30_000);
  it("exits non-zero on a bad input.json without writing a file", () => {
    run = makeRun({ raw: "{ not json" });
    const r = spawnSync(process.execPath, ["mcp/c64-server/server.ts"], { env: { ...process.env, RUN_DIR: run.dir }, encoding: "utf8", input: "", timeout: 30_000 });
    expect(r.status).not.toBe(0);
    expect(readdirSync(run.dir)).toEqual(["input.json"]);
  }, 30_000);
});
