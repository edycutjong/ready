/**
 * Contract harness part 2 (agent contract §4, build Day 2, 0 credits): the bypasses, through the real MCP tools on the
 * real headless core, on the authored 2026 line-20 page (real OCR output, fixtures/authored/).
 *  - an edit outside the gate (listing.json rewritten on disk) + c64_reload → still not RESURRECTED
 *  - an unlisted c64_press key → refused, nothing typed, contract unchanged
 *  - the retype: an accepted patch is what the next c64_run executes (BASIC memory = tokenized canonical listing)
 *  - the server, not the agent, presses the post-title key and records pass/fail
 *  - until-title blocks on a fixable line and allows the stop once the contract holds
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";
import { dumpBasic, type C64Core } from "../../src/emu/core.ts";
import { bootNodeCore } from "../../src/emu/node.ts";
import { bytesEqual } from "../../src/gate/contract.ts";
import { createTools } from "../../mcp/c64-server/tools.ts";

const FIX = { ops: [{ op: "replace", lineno: 20, new_body: 'PRINT"   ** THE LAST SEANCE **"' }], reason: "M misprint; OCR read the quote as ™" };
let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); }, 60_000);
function runDir() {
  const d = mkdtempSync(join(tmpdir(), "ready-h2-"));
  copyFileSync("fixtures/authored/line20-input.json", join(d, "input.json"));
  return d;
}
const listing = (d: string) => JSON.parse(readFileSync(join(d, "listing.json"), "utf8"));
const stopCheck = (d: string) => JSON.parse(spawnSync(process.execPath, ["scripts/hooks/until-title.mjs", "--check"], { env: { ...process.env, RUN_DIR: d }, encoding: "utf8" }).stdout);

describe("contract harness part 2 (MCP tools, real core)", () => {
  it("an edit outside the gate + c64_reload never yields RESURRECTED", async () => {
    const d = runDir();
    const tools = await createTools(core, d);
    const l = listing(d);
    l.lines = l.lines.map((x: { n: number }) => (x.n === 20 ? { ...x, body: FIX.ops[0].new_body, status: "verified" } : x));
    writeFileSync(join(d, "listing.json"), JSON.stringify(l)); // a write the agent's profile denies; simulated here
    await tools.call("c64_reload", {});
    const r = await tools.call("c64_run", {});
    expect(r.text).toMatch(/SYNTAX {2}ERROR IN 20/); // the server types ITS canonical listing, not the file
    expect(listing(d).contract.state).not.toBe("RESURRECTED");
  }, 60_000);
  it("an unlisted key is refused and types nothing; the contract is unchanged", async () => {
    const d = runDir();
    const tools = await createTools(core, d);
    await tools.call("c64_run", {});
    const before = listing(d).contract;
    const p = await tools.call("c64_press", { keys: ["RETURN"] }); // line20 waits for no key before its title
    expect(p.isError).toBe(true);
    expect(listing(d).contract).toEqual(before);
  }, 60_000);
  it("accepted patch → retyped → the next run executes exactly the gated text; server presses the post-title key", async () => {
    const d = runDir();
    const tools = await createTools(core, d);
    await tools.call("c64_run", {});
    expect(stopCheck(d)).toMatchObject({ stop: false });
    const p = await tools.call("apply_patch", FIX);
    expect(p.isError).toBe(false);
    expect(stopCheck(d).reason).toMatch(/not been RUN/);
    const r = await tools.call("c64_run", {});
    expect(r.text).toMatch(/postTitle: pass/);
    const canon = listing(d).lines.map((x: { n: number; body: string }) => ({ n: x.n, body: x.body }));
    // after the run the C64 is past the title; reload and compare memory with the tokenized canonical listing
    await tools.call("c64_reload", {});
    expect(bytesEqual(dumpBasic(core), tokenizeProgram(canon))).toBe(true);
    expect(listing(d).contract.state).toBe("RESURRECTED");
    expect(stopCheck(d)).toMatchObject({ stop: true, result: "resurrected" });
    const press = JSON.parse(readFileSync(join(d, "events.jsonl"), "utf8").trim().split("\n").filter((x) => /"press"/.test(x)).at(-1) ?? "null");
    expect(press === null || press.checkpoint === "postTitle").toBe(true);
  }, 90_000);
});
