/** c64-mcp-server task 6.2, core cases (claude-direct, Kiro credit line capped): crash recovery R12 + crash budget R2.6. */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { C64Core } from "../../src/emu/core.ts";
import { bootNodeCore } from "../../src/emu/node.ts";
import { createTools } from "../../mcp/c64-server/tools.ts";
import { makeRun, ThrowingCore, type Run } from "../fixtures/mcp-fixture.ts";

let real: C64Core;
let run: Run | null = null;
beforeAll(async () => { real = await bootNodeCore(); }, 60_000);
afterEach(() => { run?.cleanup(); run = null; });

describe("crash recovery", () => {
  it("one crash during c64_run: reboot, re-type, retry once, run continues; listing unchanged", async () => {
    run = makeRun();
    const core = new ThrowingCore(real);
    const tools = await createTools(core, run.dir);
    const before = run.json("listing.json");
    core.failOn.add(core.stepCalls + 1);
    const r = await tools.call("c64_run", {});
    expect(r.isError).toBe(false);
    const ev = run.events();
    expect(ev.filter((e) => e.k === "emu" && e.op === "restart")).toHaveLength(1);
    const after = run.json("listing.json");
    expect(after.lines).toEqual(before.lines);
    expect(after.hash).toBe(before.hash);
  }, 60_000);
  it("a second crash in the same run — even in a new process — ends it with the exact tool error", async () => {
    run = makeRun();
    const core = new ThrowingCore(real);
    let tools = await createTools(core, run.dir);
    core.failOn.add(core.stepCalls + 1);
    await tools.call("c64_run", {});
    tools = await createTools(core, run.dir); // restart: crash count seeded from events.jsonl
    core.failOn.add(core.stepCalls + 1);
    const r = await tools.call("c64_run", {});
    expect(r.isError).toBe(true);
    expect(r.text).toBe("emulator crashed twice; the run ends");
    expect(run.events().at(-1)).toMatchObject({ k: "error", why: "emulator crashed twice" });
    expect((await tools.call("checksum_line", { lineno: 10, body: "END" })).text).toMatch(/run is over/);
  }, 60_000);
});
