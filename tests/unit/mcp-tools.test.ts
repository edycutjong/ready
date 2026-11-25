/**
 * mcp/c64-server/tools.ts driven through `createTools` on the real headless core (booted once), a fresh RUN_DIR per
 * test (R14.1). Measured wall times (R14.5), to be filled from one real run by task 8.2:
 *   bootNodeCore():            (not measured yet)
 *   c64_run, default 3000 f:   (not measured yet)
 *   c64_run, 20000 frames:     (not measured yet)
 */
import { readFileSync, rmSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";
import { computeChecksum } from "../../src/basic/checksum.ts";
import { dumpBasic, type C64Core } from "../../src/emu/core.ts";
import { bootNodeCore } from "../../src/emu/node.ts";
import { createTools, type C64Tools } from "../../mcp/c64-server/tools.ts";
import { canonicalHash } from "../../mcp/c64-server/rundir.ts";
import { applyPatch } from "../../src/gate/checksum-gate.ts";
import { evaluate } from "../../src/gate/contract.ts";
import {
  BAD_PATCH_30, NIGHTJAR_BODIES, PATCH_TO_UNTYPEABLE, StubCore, badChecksumLines, brokenLines, line, makeRun, patchableToUntypeableLines, nightjarLines, spec, untypeableLines,
  type InputOverrides, type Run,
} from "../fixtures/mcp-fixture.ts";

let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); });

const runs: Run[] = [];
afterEach(() => { while (runs.length) runs.pop()!.cleanup(); });

async function setup(over: InputOverrides = {}, c: C64Core = core): Promise<{ r: Run; t: C64Tools }> {
  const r = makeRun(over);
  runs.push(r);
  return { r, t: await createTools(c, r.dir) };
}
const call = (t: C64Tools, name: string, args: unknown = {}) => t.call(name, args);
/** BASIC memory the machine should hold for these lines (typeable ones only). */
const image = (lines: { n: number; body: string }[]) => tokenizeProgram([...lines].sort((a, b) => a.n - b.n));
const bytes = (r: Run, name: string) => readFileSync(r.file(name));

describe("c64_reload and c64_read_screen (R5, R7)", () => {
  it("reload types the canonical listing, reports its hash and 'untypeable: none', and writes no file", async () => {
    const { r, t } = await setup();
    const before = { listing: bytes(r, "listing.json"), files: r.files() };
    const res = await call(t, "c64_reload");
    expect(res.isError).toBe(false);
    const hash = canonicalHash(nightjarLines());
    expect(res.text).toBe(`hash ${hash}\nuntypeable: none`);
    expect(res.data).toEqual({ hash, untypeable: [] });
    expect(Buffer.compare(bytes(r, "listing.json"), before.listing)).toBe(0);
    expect(r.files()).toEqual(before.files);
    expect(r.events().map((e) => `${e.k}:${e.op}`)).toEqual(["emu:load", "emu:load"]);
    expect(Array.from(dumpBasic(core))).toEqual(Array.from(image(nightjarLines())));
  });

  it("read_screen returns the 40x25 screen, writes state.json only, appends no event, steps nothing", async () => {
    const { r, t } = await setup();
    const events = r.text("events.jsonl");
    const listing = bytes(r, "listing.json");
    const res = await call(t, "c64_read_screen");
    expect(res.isError).toBe(false);
    const screen = res.data.screen as string;
    expect(screen.split("\n")).toHaveLength(25);
    expect(screen.split("\n").every((row) => row.length <= 40)).toBe(true);
    expect(res.text).toContain(screen);
    expect(res.data.error).toBeNull();
    const st = r.json("state.json");
    expect(st).toMatchObject({ iteration: 0, screen, error: null, postTitle: "not-reached" });
    // observational only (R4.2): the typed listing text itself contains "NIGHTJAR", which is why state.json never feeds the contract
    expect(st.titleSeen).toBe(true);
    expect(r.json("listing.json").contract.state).toBe("NOT-RESURRECTED");
    expect(new Date(st.at).toISOString()).toBe(st.at);
    expect(r.text("events.jsonl")).toBe(events);
    expect(Buffer.compare(bytes(r, "listing.json"), listing)).toBe(0);
    expect(r.files()).toEqual(["events.jsonl", "input.json", "listing.json", "state.json"]);
  });

  it("an untypeable line is reported by reload, kept in the listing and never typed (R5.3, R5.4, R14.1 m)", async () => {
    const { r, t } = await setup({ lines: untypeableLines() });
    const f = r.json("listing.json");
    expect(f.untypeable).toEqual([{ n: 40, why: "control-outside-quotes" }]);
    expect(f.lines.map((l: any) => l.n)).toEqual([10, 20, 30, 40]);
    const res = await call(t, "c64_reload");
    expect(res.text).toContain("untypeable: line 40: control-outside-quotes");
    expect(res.data.untypeable).toEqual([{ n: 40, why: "control-outside-quotes" }]);
    expect(Array.from(dumpBasic(core))).toEqual(Array.from(image(nightjarLines().filter((l) => l.n !== 40))));
  });

  it("an argument to a no-argument tool is a malformed call and reaches no emulator (R5.1)", async () => {
    const stub = new StubCore();
    const { r, t } = await setup({}, stub);
    const typed = stub.keysLog.length;
    const res = await call(t, "c64_reload", { lines: ["10 END"] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/^c64_reload: malformed call\narguments: /);
    expect(stub.keysLog.length).toBe(typed);
    expect(r.events().at(-1)).toMatchObject({ k: "malformed", tool: "c64_reload" });
  });
});

describe("start-up and the restart rule (R2)", () => {
  it("first start: lines from input.json, iteration 0, not-reached, before-run contract; writes load event + listing.json", async () => {
    const { r } = await setup({ provisional: [30] });
    const f = r.json("listing.json");
    expect(f).toMatchObject({ listingId: "nightjar", scope: "title-path", expectedLines: [10, 20, 30, 40], iteration: 0, postTitle: "not-reached", hash: canonicalHash(nightjarLines()), untypeable: [] });
    expect(f.lines.map((l: any) => [l.n, l.provisional])).toEqual([[10, false], [20, false], [30, true], [40, false]]);
    expect(f.contract.state).toBe("NOT-RESURRECTED");
    expect(f.contract.heading.startsWith("NO-TITLE")).toBe(true);
    expect(f.contract.lines).toHaveLength(4);
    expect(f.contract.lines.find((l: any) => l.n === 30).provisional).toBe(true);
    expect(r.events()).toHaveLength(1);
    expect(r.events()[0]).toMatchObject({ k: "emu", op: "load", hash: f.hash, untypeable: [] });
    expect(r.has("state.json")).toBe(false);
    expect(r.files()).toEqual(["events.jsonl", "input.json", "listing.json"]);
  });

  it("restart: resumes the gated lines, iteration, postTitle and contract; ignores input.json's lines; does not run; leaves state.json alone", async () => {
    const { r } = await setup();
    const carried = r.json("listing.json");
    carried.lines.find((l: any) => l.n === 30).body = 'PRINT"CARRIED"';
    carried.lines.find((l: any) => l.n === 30).provisional = true;
    carried.iteration = 4;
    carried.postTitle = "fail";
    carried.contract.heading = "carried heading";
    carried.contract.state = "BOOTED-PARTIAL";
    r.write("listing.json", JSON.stringify(carried));
    r.write("state.json", '{"sentinel":true}');
    // input.json now holds garbage for the parts a restart must ignore (R2.3): they are neither validated nor used
    const input = r.json("input.json");
    r.write("input.json", JSON.stringify({ ...input, lines: "garbage", provisional: "garbage" }));
    const eventsBefore = r.events().length;
    const t2 = await createTools(core, r.dir);
    const f = r.json("listing.json");
    expect(f.iteration).toBe(4);
    expect(f.postTitle).toBe("fail");
    expect(f.contract.heading).toBe("carried heading");
    expect(f.contract.state).toBe("BOOTED-PARTIAL");
    expect(f.lines.find((l: any) => l.n === 30)).toMatchObject({ body: 'PRINT"CARRIED"', provisional: true });
    expect(f.hash).toBe(canonicalHash(f.lines));
    expect(f.expectedLines).toEqual(spec.expectedLines);
    expect(r.text("state.json")).toBe('{"sentinel":true}');
    expect(r.events().slice(eventsBefore).map((e) => `${e.k}:${e.op}`)).toEqual(["emu:load"]);
    expect(r.events().some((e) => e.op === "run")).toBe(false);
    expect(Array.from(dumpBasic(core))).toEqual(Array.from(image(f.lines)));
    expect((await call(t2, "checksum_line", { lineno: 30, body: 'PRINT"CARRIED"' })).data.exists).toBe(true);
  });

  describe("every start-up failure rejects and writes nothing (R2.4, R1.8)", () => {
    const snapshot = (r: Run) => r.files().map((f) => [f, r.text(f)]);
    async function rejects(prep: (r: Run) => void, why: RegExp, over: InputOverrides = {}): Promise<void> {
      const stub = new StubCore();
      const r = makeRun(over);
      runs.push(r);
      prep(r);
      const before = snapshot(r);
      await expect(createTools(stub, r.dir)).rejects.toThrow(why);
      expect(snapshot(r)).toEqual(before);
      expect(stub.keysLog).toEqual([]);
    }
    /** a valid listing.json for the fixture, as a first start writes it */
    async function withListing(r: Run): Promise<void> {
      const s = makeRun({ dir: undefined });
      runs.push(s);
      await createTools(new StubCore(), s.dir);
      r.write("listing.json", s.text("listing.json"));
    }

    it("input.json missing", () => rejects((r) => rmSync(r.file("input.json")), /input\.json: cannot read/));
    it("input.json is not JSON", () => rejects((r) => r.write("input.json", "{nope"), /input\.json: invalid JSON/));
    it("input.json fails the schema (first start)", () => rejects(() => {}, /input\.json: listingId/, { listingId: "" }));
    it("input.json: a line with an out-of-range number (first start)", () => rejects(() => {}, /input\.json: lines\.0\.n/, { lines: [{ ...nightjarLines()[0]!, n: 64000 }] }));
    it("input.json: two lines with the same n (first start)", () => rejects(() => {}, /two lines are numbered 10/, { lines: [...nightjarLines(), line(10, "END")] }));
    it("input.json: provisional is not a line (first start)", () => rejects(() => {}, /provisional 99 is not the number of a line/, { provisional: [99] }));
    it("listing.json is not JSON, and there is no fallback to input.json", () => rejects((r) => r.write("listing.json", "{corrupt"), /listing\.json: invalid JSON/));
    it("listing.json fails the schema", () => rejects((r) => r.write("listing.json", JSON.stringify({ listingId: "nightjar", lines: [] })), /listing\.json:/));
    it("listing.json is for another listing", async () => {
      const r = makeRun();
      runs.push(r);
      await withListing(r);
      const other = JSON.parse(r.text("listing.json"));
      other.listingId = "other";
      await rejects((x) => x.write("listing.json", JSON.stringify(other)), /listingId "other" differs/, { dir: r.dir });
    });
    it("input.json's listingId/scope/spec fail even when listing.json exists", async () => {
      const r = makeRun({ spec: { ...spec, postTitle: { keys: [32], screenContains: "" } } });
      runs.push(r);
      await withListing(r);
      await rejects(() => {}, /input\.json: spec\.postTitle\.screenContains/, { dir: r.dir, spec: { ...spec, postTitle: { keys: [32], screenContains: "" } } });
    });
    it("listing.json exists and input.json's lines are unusable: still starts", async () => {
      const r = makeRun({ raw: JSON.stringify({ listingId: "nightjar", scope: "title-path", spec, lines: 7, provisional: 7 }) });
      runs.push(r);
      await withListing(r);
      await expect(createTools(new StubCore(), r.dir)).resolves.toBeDefined();
    });
    it("the emulator throws while typing at start-up", async () => {
      const r = makeRun();
      runs.push(r);
      const boom = new StubCore();
      boom.queueKeys = () => { throw new Error("wasm trap"); };
      await expect(createTools(boom, r.dir)).rejects.toThrow(/emulator failed while typing.*wasm trap/);
      expect(r.files()).toEqual(["input.json"]);
    });
  });

  it("start-up while the run is already over types nothing and writes nothing (R2.5, R2.6)", async () => {
    for (const why of ["3 malformed calls", "emulator crashed twice"]) {
      const stub = new StubCore();
      const r = makeRun();
      runs.push(r);
      r.write("events.jsonl", JSON.stringify({ t: "x", k: "error", why }) + "\n");
      const before = [r.text("events.jsonl"), r.text("input.json")];
      const t = await createTools(stub, r.dir);
      expect(stub.keysLog).toEqual([]);
      expect(r.files()).toEqual(["events.jsonl", "input.json"]);
      expect([r.text("events.jsonl"), r.text("input.json")]).toEqual(before);
      const res = await call(t, "checksum_line", { lineno: 10, body: "END" });
      expect(res).toMatchObject({ isError: true });
      expect(res.text).toBe(`run is over: ${why}`);
      expect(t.list()).toHaveLength(6);
    }
  });
});

describe("malformed calls and the run-over state (R11)", () => {
  it("three in a row end the run; the third says so; every later call errors and writes nothing", async () => {
    const stub = new StubCore();
    const { r, t } = await setup({}, stub);
    const a = await call(t, "c64_run", { frames: 0 });
    const b = await call(t, "nope", {});
    expect(a.text).toMatch(/^c64_run: malformed call\nframes: /);
    expect(b.text).toMatch(/^nope: malformed call\nunknown tool; the tools are/);
    expect(a.text).not.toContain("run is over");
    const c = await call(t, "c64_press", { keys: [] });
    expect(c.isError).toBe(true);
    expect(c.text).toContain("run is over: 3 malformed calls");
    expect(r.events().map((e) => `${e.k}${e.why === "3 malformed calls" ? "!" : ""}`)).toEqual(["emu", "malformed", "malformed", "malformed", "error!"]);
    expect(r.events().filter((e) => e.k === "malformed").map((e) => e.tool)).toEqual(["c64_run", "nope", "c64_press"]);
    const snapshot = r.files().map((f) => [f, r.text(f)]);
    const keys = stub.keysLog.length;
    for (const [name, args] of [["checksum_line", { lineno: 10, body: "END" }], ["c64_reload", {}], ["nope", {}], ["apply_patch", {}]] as const) {
      const res = await call(t, name, args);
      expect(res.isError).toBe(true);
      expect(res.text).toBe("run is over: 3 malformed calls");
    }
    expect(r.files().map((f) => [f, r.text(f)])).toEqual(snapshot);
    expect(stub.keysLog.length).toBe(keys);
    expect(t.list()).toHaveLength(6); // tools/list still answers (R11.5)
  });

  it("a well-formed call in between resets the count, whatever it returns (R11.3)", async () => {
    const { r, t } = await setup({}, new StubCore());
    for (let round = 0; round < 3; round++) {
      await call(t, "c64_run", { frames: 0 });
      await call(t, "c64_run", { frames: 20001 });
      expect((await call(t, "checksum_line", { lineno: 10, body: "END" })).isError).toBe(false);
    }
    expect(r.events().filter((e) => e.k === "malformed")).toHaveLength(6);
    expect(r.events().some((e) => e.k === "error")).toBe(false);
    expect((await call(t, "checksum_line", { lineno: 10, body: "END" })).isError).toBe(false);
  });

  it("a missing arguments field is the empty object, and a null one too (R11.1)", async () => {
    const { t } = await setup({}, new StubCore());
    expect((await t.call("c64_read_screen", undefined)).isError).toBe(false);
    expect((await t.call("c64_read_screen", null)).isError).toBe(false);
    expect((await t.call("checksum_line", undefined)).isError).toBe(true);
  });

  it("a malformed call changes nothing but events.jsonl (R11.1)", async () => {
    const stub = new StubCore();
    const { r, t } = await setup({}, stub);
    const listing = r.text("listing.json");
    const keys = stub.keysLog.length;
    await call(t, "checksum_line", { lineno: "10", body: "END" });
    expect(r.text("listing.json")).toBe(listing);
    expect(r.has("state.json")).toBe(false);
    expect(stub.keysLog.length).toBe(keys);
    expect(r.events().at(-1)).toMatchObject({ k: "malformed", tool: "checksum_line" });
  });

  it("the run-over state survives a restart; the counter does not (R2.6, R11.7)", async () => {
    const stub = new StubCore();
    const { r, t } = await setup({}, stub);
    await call(t, "nope");
    await call(t, "nope");
    const t2 = await createTools(stub, r.dir); // restart after two: the counter starts again at 0
    await call(t2, "nope");
    await call(t2, "nope");
    expect((await call(t2, "checksum_line", { lineno: 10, body: "END" })).isError).toBe(false);
    for (let i = 0; i < 3; i++) await call(t2, "nope");
    const snapshot = r.text("events.jsonl");
    const keys = stub.keysLog.length;
    const t3 = await createTools(stub, r.dir);
    expect(stub.keysLog.length).toBe(keys); // nothing typed
    expect(r.text("events.jsonl")).toBe(snapshot);
    expect((await call(t3, "checksum_line", { lineno: 10, body: "END" })).text).toBe("run is over: 3 malformed calls");
  });

  it("a throw from the emulator is a crash (R12), never a malformed call; recovery that throws again ends the run (R12.3)", async () => {
    // claude-direct (P1b): written by Kiro in task 3 as an R11.6 internal error; task 6's withEmu makes any throw from
    // core/session code a crash (design.md "Crash recovery"), so the expectation follows the crash budget now.
    const stub = new StubCore();
    const { r, t } = await setup({}, stub);
    stub.queueKeys = () => { throw new Error("kaboom"); };
    const res = await call(t, "c64_reload");
    expect(res).toMatchObject({ isError: true, text: "emulator crashed twice; the run ends" });
    expect(r.events().filter((e) => e.k === "malformed")).toHaveLength(0);
    expect(r.events().at(-1)).toMatchObject({ k: "error", why: "emulator crashed twice" });
    expect((await call(t, "checksum_line", { lineno: 10, body: "END" })).text).toMatch(/run is over: emulator crashed twice/);
  });
});

describe("checksum_line (R9)", () => {
  const read = (t: C64Tools, lineno: number, body: string) => call(t, "checksum_line", { lineno, body });

  it("verified: the body's checksum equals the printed one", async () => {
    const { t } = await setup({}, new StubCore());
    const res = await read(t, 30, NIGHTJAR_BODIES[30]!);
    const c = computeChecksum(30, NIGHTJAR_BODIES[30]!);
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ lineno: 30, computed: c, exists: true, printed: c, status: "verified", matches: true });
    expect(res.text).toBe(`line 30: computed ${c}\nprinted ${c}\nstatus: verified\nmatches: true`);
  });

  it("digit-misread: matches, and says which reading", async () => {
    const c = computeChecksum(40, "END");
    expect(String(c).at(-1)).toMatch(/[689]/);
    const printed = Number(String(c).slice(0, -1) + "0");
    const { t } = await setup({ lines: nightjarLines().map((l) => (l.n === 40 ? { ...l, printed, status: "digit-misread" as const } : l)) }, new StubCore());
    const res = await read(t, 40, "END");
    expect(res.data).toMatchObject({ exists: true, printed, status: "digit-misread", matches: true, reading: c });
    expect(res.text).toContain(`reading: ${c}`);
  });

  it("mismatch: a wrong body does not match", async () => {
    const { t } = await setup({}, new StubCore());
    const res = await read(t, 30, BAD_PATCH_30);
    expect(res.data).toMatchObject({ exists: true, status: "mismatch", matches: false, computed: computeChecksum(30, BAD_PATCH_30) });
    expect(res.data).not.toHaveProperty("reading");
  });

  it("unreadable printed checksum: unverified, no match", async () => {
    const { t } = await setup({ lines: nightjarLines().map((l) => (l.n === 20 ? { ...l, printed: null, status: "unverified" as const } : l)) }, new StubCore());
    const res = await read(t, 20, NIGHTJAR_BODIES[20]!);
    expect(res.data).toMatchObject({ exists: true, printed: null, status: "unverified", matches: false });
    expect(res.text).toContain("printed unreadable");
  });

  it("unknown line: exists false, and neither printed, status nor matches", async () => {
    const { t } = await setup({}, new StubCore());
    const res = await read(t, 25, "END");
    expect(res.data).toEqual({ lineno: 25, computed: computeChecksum(25, "END"), exists: false });
    expect(res.text).toContain("exists: false");
  });

  it("counts spaces as nothing and is repeatable (R9.3)", async () => {
    const { t } = await setup({}, new StubCore());
    const a = await read(t, 20, 'GETA$ : IFA$="" THEN20');
    expect(a.data.computed).toBe(computeChecksum(20, 'GETA$:IFA$=""THEN20'));
    expect(await read(t, 20, 'GETA$ : IFA$="" THEN20')).toEqual(a);
  });

  it("leaves listing.json and events.jsonl byte-identical and touches no emulator (R9.3, R14.1 l)", async () => {
    const stub = new StubCore();
    const { r, t } = await setup({}, stub);
    const files = r.files();
    const [l, e] = [bytes(r, "listing.json"), bytes(r, "events.jsonl")];
    const steps = stub.steps, keys = stub.keysLog.length, boots = stub.booted;
    for (const [n, b] of [[10, "x"], [30, BAD_PATCH_30], [99, ""]] as const) await read(t, n, b);
    expect(Buffer.compare(bytes(r, "listing.json"), l)).toBe(0);
    expect(Buffer.compare(bytes(r, "events.jsonl"), e)).toBe(0);
    expect(r.files()).toEqual(files);
    expect([stub.steps, stub.keysLog.length, stub.booted]).toEqual([steps, keys, boots]);
  });
});

describe("list() and serial calls (R1.2, R1.6)", () => {
  it("names, order, object schemas, descriptions of at most 600 characters", async () => {
    const { t } = await setup({}, new StubCore());
    const list = t.list();
    expect(list.map((d) => d.name)).toEqual(["c64_reload", "c64_run", "c64_read_screen", "c64_press", "checksum_line", "apply_patch"]);
    for (const d of list) {
      expect(d.inputSchema.type).toBe("object");
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.description.length).toBeLessThanOrEqual(600);
    }
  });

  it("two overlapping calls run one after the other", async () => {
    // a read of the screen is only observable through `peek`: record how many events existed at each peek
    class Spy extends StubCore {
      seen: number[] = [];
      onPeek: () => void = () => {};
      override peek(a: number): number { this.onPeek(); return super.peek(a); }
    }
    const spy = new Spy();
    const { r, t } = await setup({}, spy);
    spy.onPeek = () => spy.seen.push(r.events().length);
    const order: string[] = [];
    const a = call(t, "c64_reload").then((x) => { order.push("reload"); return x; });
    const b = call(t, "c64_read_screen").then((x) => { order.push("read"); return x; });
    await Promise.all([a, b]);
    expect(order).toEqual(["reload", "read"]);
    // start-up wrote 1 event, the reload's own `emu load` is the 2nd: the read starts only after it. The reload peeks
    // too (loadProgram's running-program check, arch review 01), so: every peek is ordered, and the read's whole 40×25
    // screen (1000 peeks) comes after the 2nd event exists.
    expect(spy.seen.at(-1)).toBe(2);
    const firstAfter = spy.seen.indexOf(2);
    expect(spy.seen.slice(firstAfter).every((n) => n === 2)).toBe(true);
    expect(spy.seen.length - firstAfter).toBeGreaterThanOrEqual(1000);
    expect(spy.seen.slice(0, firstAfter).every((n) => n === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Task 4: c64_run and c64_press, the only verdict path (R6, R8, R3.5, R3.8, R13.5)
// ---------------------------------------------------------------------------------------------------------------

const RESURRECTED_HEADING = "TITLE-PATH RESURRECTED · 4/4 checksum-consistent";
const resurrectedMentions = (text: string) => text.split("\n").filter((l) => l.includes("RESURRECTED"));

describe("c64_run (R6)", () => {
  it("reload → run → read → press round trip: RESURRECTED only after a passing run on all-verified lines (a)", async () => {
    const { r, t } = await setup();
    expect(r.json("listing.json").contract.state).toBe("NOT-RESURRECTED"); // nothing has run yet
    await call(t, "c64_reload");
    expect(r.json("listing.json").contract.state).toBe("NOT-RESURRECTED"); // a reload proves nothing

    const run = await call(t, "c64_run");
    expect(run.isError).toBe(false);
    const lines = run.text.split("\n");
    expect(lines.slice(0, 5)).toEqual([RESURRECTED_HEADING, "error: none", "titleSeen: true", "postTitle: pass", "untypeable: none"]);
    expect(run.text).toContain("--- AFTER RUN ---");
    expect(run.text).toContain("--- TITLE ---");
    expect(run.text).toContain("--- POST-TITLE ---");
    expect(run.data).toMatchObject({
      hash: canonicalHash(nightjarLines()), iteration: 0, error: null, titleSeen: true, postTitle: "pass",
      heading: RESURRECTED_HEADING, failed: [], untypeable: [],
    });
    expect(Object.keys(run.data).sort()).toEqual(["counts", "error", "failed", "frames", "hash", "heading", "iteration", "postTitle", "screens", "stoppedOn", "titleSeen", "untypeable"]);
    const screens = run.data.screens as { afterRun: string; title?: string; postTitle?: string };
    expect(screens.title).toContain("NIGHTJAR");
    expect(screens.postTitle).toContain("LAUNCHED");
    expect(run.text).toContain(`--- POST-TITLE ---\n${screens.postTitle}`);
    expect(run.data.counts).toMatchObject({ verified: 4, present: 4, missing: 0 });

    const f = r.json("listing.json");
    expect(f.contract).toMatchObject({ state: "RESURRECTED", heading: RESURRECTED_HEADING, scope: "title-path", failed: [] });
    expect(f.postTitle).toBe("pass");
    expect(f.contract.lines.map((l: any) => [l.n, l.status, l.provisional])).toEqual([[10, "verified", false], [20, "verified", false], [30, "verified", false], [40, "verified", false]]);
    expect(r.json("state.json")).toMatchObject({ iteration: 0, error: null, titleSeen: true, postTitle: "pass" });
    expect(r.json("state.json").screen).toBe(screens.postTitle);
    const ev = r.events().filter((e) => e.k === "emu" && e.op === "run");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ error: null, titleSeen: true, postTitle: "pass", hash: f.hash });
    expect(typeof ev[0].frames).toBe("number");
    expect(typeof ev[0].stoppedOn).toBe("string");
    expect(Array.from(dumpBasic(core))).toEqual(Array.from(image(nightjarLines())));

    const listingBefore = bytes(r, "listing.json");
    const read = await call(t, "c64_read_screen");
    expect(read.isError).toBe(false);
    expect(Buffer.compare(bytes(r, "listing.json"), listingBefore)).toBe(0);

    const press = await call(t, "c64_press", { keys: ["SPACE"] });
    expect(press.isError).toBe(false);
    expect(press.data).toMatchObject({ keys: ["SPACE"], checkpoint: "postTitle", error: null });
    expect(press.data.pass).toBe((press.data.screen as string).includes("LAUNCHED"));
    expect(Buffer.compare(bytes(r, "listing.json"), listingBefore)).toBe(0);
    expect(r.events().at(-1)).toMatchObject({ k: "emu", op: "press", keys: ["SPACE"], checkpoint: "postTitle", pass: press.data.pass });
    expect(r.json("state.json").screen).toBe(press.data.screen);
  });

  it("a broken line shows the C64's own ?SYNTAX  ERROR IN 20 (double space) and no title (R6.6)", async () => {
    const { r, t } = await setup({ lines: brokenLines() });
    const run = await call(t, "c64_run");
    expect(run.isError).toBe(false);
    expect(run.text).toContain("error: ?SYNTAX  ERROR IN 20");
    expect(run.text).toContain("?SYNTAX  ERROR IN 20");
    expect(run.text).not.toContain("?SYNTAX ERROR");
    expect(run.data).toMatchObject({ error: { kind: "SYNTAX", line: 20 }, titleSeen: false, postTitle: "not-reached", stoppedOn: "error" });
    expect((run.data.screens as any).afterRun).toContain("?SYNTAX  ERROR IN 20");
    expect((run.data.screens as any).title).toBeUndefined();
    expect(run.text).not.toContain("--- TITLE ---");
    expect(run.text).not.toContain("--- POST-TITLE ---");
    expect(run.text.split("\n")[0]).toMatch(/^NO-TITLE NOT RESURRECTED · 3\/4 checksum-consistent$/);
    expect(r.json("state.json").screen).toContain("?SYNTAX  ERROR IN 20");
    expect(r.json("state.json")).toMatchObject({ error: { kind: "SYNTAX", line: 20 }, titleSeen: false, postTitle: "not-reached" });
    expect(r.json("listing.json").contract.state).toBe("NOT-RESURRECTED");
    // the contract's measured clauses come from this run: clause 1 (no title) and clause 4 (line 20 unverified)
    expect(run.data.failed).toEqual(expect.arrayContaining([{ clause: 1, lines: [] }, { clause: 4, lines: [20] }]));
    expect(r.events().at(-1)).toMatchObject({ k: "emu", op: "run", error: { kind: "SYNTAX", line: 20 }, titleSeen: false, postTitle: "not-reached" });
  });

  it("an untypeable line is reported in the run result and the run still happens (m)", async () => {
    const { t } = await setup({ lines: untypeableLines() });
    const run = await call(t, "c64_run");
    expect(run.text).toContain("untypeable: line 40: control-outside-quotes");
    expect(run.data.untypeable).toEqual([{ n: 40, why: "control-outside-quotes" }]);
    expect(run.data).toMatchObject({ titleSeen: true, postTitle: "pass" });
    expect(String(run.data.heading)).not.toContain("RESURRECTED ·"); // clause 6: the resident program lacks line 40
    expect(run.data.failed).toEqual(expect.arrayContaining([{ clause: 6, lines: [] }]));
  });

  it("provisional lines block RESURRECTED until a passing run clears them; a failing run does not (f)", async () => {
    const { r, t } = await setup({ provisional: [20] });
    const before = r.json("listing.json");
    expect(before.contract.failed).toEqual(expect.arrayContaining([{ clause: 4, lines: [20] }]));
    expect(before.contract.lines.find((l: any) => l.n === 20).provisional).toBe(true);

    // a failing run (the post-title text never appears): provisional stays, the verdict is only BOOTED
    const failSpec = { ...spec, postTitle: { keys: [32], screenContains: "NEVER PRINTED" } };
    r.write("input.json", JSON.stringify({ listingId: "nightjar", scope: "title-path", spec: failSpec, lines: nightjarLines(), provisional: [20] }));
    const t1 = await createTools(core, r.dir);
    const failing = await call(t1, "c64_run");
    expect(failing.data).toMatchObject({ titleSeen: true, postTitle: "fail" });
    expect(failing.data.heading).toContain("BOOTED — PARTIAL");
    expect(failing.data.failed).toEqual(expect.arrayContaining([{ clause: 2, lines: [] }, { clause: 4, lines: [20] }]));
    let f = r.json("listing.json");
    expect(f.postTitle).toBe("fail");
    expect(f.contract.state).toBe("BOOTED-PARTIAL");
    expect(f.lines.find((l: any) => l.n === 20).provisional).toBe(true);
    expect(f.contract.lines.find((l: any) => l.n === 20).provisional).toBe(true);

    // a restart carries provisional and the stored contract (R2.3, R2.5); then the real spec passes and clears it
    r.write("input.json", JSON.stringify({ listingId: "nightjar", scope: "title-path", spec, lines: [], provisional: [] }));
    const t2 = await createTools(core, r.dir);
    f = r.json("listing.json");
    expect(f.lines.find((l: any) => l.n === 20).provisional).toBe(true);
    expect(f.contract.state).toBe("BOOTED-PARTIAL");
    const passing = await call(t2, "c64_run");
    expect(passing.data).toMatchObject({ postTitle: "pass", heading: RESURRECTED_HEADING, failed: [] });
    f = r.json("listing.json");
    expect(f.lines.every((l: any) => l.provisional === false)).toBe(true);
    expect(f.contract.lines.every((l: any) => l.provisional === false)).toBe(true);
    expect(f.contract.state).toBe("RESURRECTED");
  });

  it("a run that never reaches the title leaves provisional unchanged (f)", async () => {
    const { r, t } = await setup({ lines: brokenLines(), provisional: [30] });
    await call(t, "c64_run");
    const f = r.json("listing.json");
    expect(f.lines.find((l: any) => l.n === 30).provisional).toBe(true);
    expect(f.contract.lines.find((l: any) => l.n === 30).provisional).toBe(true);
  });

  it("honours `frames`: the cap is passed to the run, never clamped", async () => {
    const never = { ...spec, titlePredicate: { screenContains: "NEVER ON SCREEN" } }; // no keys: the run waits out its frames
    const { t } = await setup({ spec: never });
    const short = await call(t, "c64_run", { frames: 1 });
    expect(short.data).toMatchObject({ frames: 50, stoppedOn: "frames", titleSeen: false }); // one check interval
    const longer = await call(t, "c64_run", { frames: 120 });
    expect(longer.data).toMatchObject({ frames: 150, stoppedOn: "frames" });
    expect((await call(t, "c64_run", { frames: 0 })).isError).toBe(true);
    expect((await call(t, "c64_run", { frames: 20001 })).isError).toBe(true);
  });

  it("records the requested budget as maxFrames, so REPLAY re-runs the same experiment (arch review 01)", async () => {
    const { replayBudget } = await import("../../src/replay/replay.ts");
    const never = { ...spec, titlePredicate: { screenContains: "NEVER ON SCREEN" } };
    const { t, r } = await setup({ spec: never });
    await call(t, "c64_run", { frames: 120 });
    const ev = r.events().at(-1)!;
    expect(ev).toMatchObject({ k: "emu", op: "run", frames: 150, maxFrames: 120, stoppedOn: "frames" });
    expect(replayBudget(ev)).toBe(120);
    // a pre-arch-01 event (no maxFrames): out of budget → exactly its elapsed frames; stopped early → any budget ≥ 3000
    expect(replayBudget({ k: "emu", op: "run", frames: 150, stoppedOn: "frames" })).toBe(150);
    expect(replayBudget({ k: "emu", op: "run", frames: 4200, stoppedOn: "predicate" })).toBe(4200);
    expect(replayBudget({ k: "emu", op: "run", frames: 900, stoppedOn: "error" })).toBe(3000);
    expect(replayBudget({ k: "emu", op: "run" })).toBe(3000);
    // a corrupt recording never asks for more than the tool's own range
    expect(replayBudget({ k: "emu", op: "run", maxFrames: 1e9 })).toBe(3000);
    expect(replayBudget({ k: "emu", op: "run", maxFrames: 12.5, frames: 150, stoppedOn: "frames" })).toBe(150);
  });

  it("with no typeable line it still runs and reports what the machine did, inventing nothing (R6.7)", async () => {
    const all = [10, 20, 30, 40].map((n) => line(n, "{CLR}END"));
    const { t } = await setup({ lines: all });
    const run = await call(t, "c64_run", { frames: 100 });
    expect(run.isError).toBe(false);
    expect(run.data).toMatchObject({ error: null, titleSeen: false, postTitle: "not-reached" });
    expect((run.data.untypeable as unknown[]).length).toBe(4);
    expect(run.text).toContain("untypeable: line 10: control-outside-quotes");
    expect(Array.from(dumpBasic(core))).toEqual(Array.from(image([]))); // an empty program: nothing was typed
  });

  it("RESURRECTED appears in results only inside the contract heading (r, R13.5)", async () => {
    const { r, t } = await setup();
    const results = [await call(t, "c64_reload"), await call(t, "c64_run"), await call(t, "c64_read_screen"), await call(t, "c64_press", { keys: ["SPACE"] }), await call(t, "c64_press", { keys: ["A"] }), await call(t, "checksum_line", { lineno: 10, body: "x" }), await call(t, "nope")];
    const heading = r.json("listing.json").contract.heading;
    for (const res of results) {
      for (const l of resurrectedMentions(res.text)) expect(l, res.text).toBe(heading);
      expect(JSON.stringify(res.data).replaceAll(heading, "")).not.toMatch(/"RESURRECTED"|RESURRECTED"/);
    }
    expect(results[1]!.text.startsWith(heading)).toBe(true);
    expect(results.filter((x, i) => i !== 1 && x.text.includes("RESURRECTED"))).toHaveLength(0);
  });
});

describe("c64_press (R8)", () => {
  it("an unlisted key is a tool error naming the allowed keys; nothing is queued, stepped or recorded (d)", async () => {
    const { r, t } = await setup();
    await call(t, "c64_run");
    const screen = (await call(t, "c64_read_screen")).data.screen;
    const events = r.text("events.jsonl");
    const state = r.text("state.json");
    const listing = bytes(r, "listing.json");
    for (const keys of [["A"], ["SPACE", "A"], ["RETURN"], ["a", "SPACE"]]) {
      const res = await call(t, "c64_press", { keys });
      expect(res.isError, JSON.stringify(keys)).toBe(true);
      expect(res.text).toBe("key not allowed. Allowed keys: SPACE");
      expect(core.pendingKeys()).toBe(0);
    }
    expect((await call(t, "c64_read_screen")).data.screen).toBe(screen);
    expect(r.text("events.jsonl")).toBe(events);
    expect(Buffer.compare(bytes(r, "listing.json"), listing)).toBe(0);
    expect(r.text("state.json")).not.toBe(""); // the read above rewrote it; the refused presses did not
    expect(state).toContain("iteration");
  });

  it("a refused press never reaches the core (stub core: no key queued, no step, no event)", async () => {
    const stub = new StubCore();
    const { r, t } = await setup({}, stub);
    const keys = stub.keysLog.length, steps = stub.steps, events = r.text("events.jsonl");
    expect((await call(t, "c64_press", { keys: ["SPACE", "SPACE", "A"] })).isError).toBe(true);
    expect([stub.keysLog.length, stub.steps]).toEqual([keys, steps]);
    expect(r.text("events.jsonl")).toBe(events);
    expect(r.has("state.json")).toBe(false);
  });

  it("an allowed press queues all its keys in order and records them as sent", async () => {
    const stub = new StubCore();
    const multi = { ...spec, titlePredicate: { screenContains: "NIGHTJAR", keys: [32, 13, 65] } };
    const { r, t } = await setup({ spec: multi }, stub);
    const keys = stub.keysLog.length;
    const res = await call(t, "c64_press", { keys: ["a", "RETURN", "SPACE"] });
    expect(res.isError).toBe(false);
    expect(stub.keysLog.slice(keys)).toEqual([65, 13, 32]);
    expect(res.data).toMatchObject({ keys: ["a", "RETURN", "SPACE"], checkpoint: "title" });
    expect(res.data).not.toHaveProperty("pass");
    expect(r.events().at(-1)).toEqual(expect.objectContaining({ k: "emu", op: "press", keys: ["a", "RETURN", "SPACE"], checkpoint: "title" }));
    expect(r.events().at(-1)).not.toHaveProperty("pass");
    const refused = await call(t, "c64_press", { keys: ["B"] });
    expect(refused.text).toBe("key not allowed. Allowed keys: SPACE, RETURN, A");
  });

  it("an empty allowed set says no key may be pressed for this listing", async () => {
    for (const titlePredicate of [{ screenContains: "NIGHTJAR" }, { screenContains: "NIGHTJAR", keys: [] }]) {
      const stub = new StubCore();
      const { t } = await setup({ spec: { ...spec, titlePredicate } }, stub);
      const res = await call(t, "c64_press", { keys: ["SPACE"] });
      expect(res).toMatchObject({ isError: true, text: "no key may be pressed for this listing" });
      expect(stub.keysLog.filter((k) => k === 32)).toHaveLength(0);
    }
  });

  it("a refused press is a well-formed call: it resets the malformed counter (R11.3)", async () => {
    const { r, t } = await setup({}, new StubCore());
    await call(t, "nope");
    await call(t, "nope");
    expect((await call(t, "c64_press", { keys: ["A"] })).text).toContain("key not allowed");
    await call(t, "nope");
    await call(t, "nope");
    expect(r.events().some((e) => e.k === "error")).toBe(false);
    expect((await call(t, "checksum_line", { lineno: 10, body: "END" })).isError).toBe(false);
  });

  it("checkpoint is title before a run and postTitle after one that reached the title; a press leaves the contract alone (R8.4, R8.5)", async () => {
    const { r, t } = await setup();
    const first = await call(t, "c64_press", { keys: ["SPACE"] });
    expect(first.data.checkpoint).toBe("title");
    expect(r.events().at(-1)).not.toHaveProperty("pass");
    await call(t, "c64_run");
    const listing = bytes(r, "listing.json");
    const contract = r.json("listing.json").contract;
    const second = await call(t, "c64_press", { keys: ["SPACE"] });
    expect(second.data.checkpoint).toBe("postTitle");
    expect(typeof second.data.pass).toBe("boolean");
    expect(r.json("listing.json").contract).toEqual(contract);
    expect(Buffer.compare(bytes(r, "listing.json"), listing)).toBe(0);
    await call(t, "c64_read_screen");
    expect(r.json("listing.json").contract).toEqual(contract);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Task 5: apply_patch, the gate behind the server (R10, R3.7, R3.8)
// ---------------------------------------------------------------------------------------------------------------

const replace = (lineno: number, new_body: string) => ({ op: "replace", lineno, new_body });
const renumber = (lineno: number, new_lineno: number) => ({ op: "renumber", lineno, new_lineno });
const patch = (t: C64Tools, ops: unknown[], extra: Record<string, unknown> = {}) => call(t, "apply_patch", { ops, reason: "test", ...extra });
const stripProvisional = (ls: any[]) => ls.map(({ provisional: _p, ...l }) => l);
const gateReason = (lines: any[], ops: any[], counts: Record<number, number> = {}, force = false) =>
  applyPatch(stripProvisional(lines), ops.map((o) => (o.op === "replace" ? { type: "replace", lineno: o.lineno, new_body: o.new_body } : { type: "renumber", lineno: o.lineno, new_lineno: o.new_lineno })), spec.expectedLines, { force_unverified: force, refusalCounts: counts });
/** BASIC memory the canonical listing in listing.json must produce (untypeable lines are never typed) */
const canonicalImage = (r: Run) => {
  const f = r.json("listing.json");
  const bad = new Set(f.untypeable.map((u: any) => u.n));
  return Array.from(image(f.lines.filter((l: any) => !bad.has(l.n))));
};

describe("apply_patch: accepted (R10.6, R10.7)", () => {
  it("is typed at once and is what the next run executes; the verdict resets until then (b, k)", async () => {
    const { r, t } = await setup({ lines: brokenLines() });
    const broken = await call(t, "c64_run");
    expect(broken.data.error).toMatchObject({ kind: "SYNTAX", line: 20 });

    const res = await patch(t, [replace(20, NIGHTJAR_BODIES[20]!)], { reason: "OCR lost the =" });
    expect(res.isError).toBe(false);
    const f = r.json("listing.json");
    const c20 = computeChecksum(20, NIGHTJAR_BODIES[20]!);
    expect(res.text).toBe(`ACCEPTED: 20: checksum ${c20} = printed ${c20}\nhash ${f.hash}\nuntypeable: none\nCall c64_run next.`);
    expect(res.data).toMatchObject({ verdict: "accepted", hash: f.hash, iteration: 1, untypeable: [] });
    expect(res.data.perOp).toEqual([{ line: 20, printed: c20, computed: c20, ok: true, why: `checksum ${c20} = printed ${c20}` }]);
    expect(f.hash).toBe(canonicalHash([...nightjarLines()]));
    expect(f.lines.find((l: any) => l.n === 20)).toMatchObject({ body: NIGHTJAR_BODIES[20], status: "verified", source: "gate", provisional: false });
    expect(f).toMatchObject({ iteration: 1, postTitle: "not-reached" });
    // the machine holds exactly the canonical listing, right after the patch...
    expect(Array.from(dumpBasic(core))).toEqual(canonicalImage(r));
    expect(Array.from(dumpBasic(core))).toEqual(Array.from(image(nightjarLines())));
    // ...and the events are proposal, gate (with the new hash), load
    expect(r.events().slice(-3).map((e) => `${e.k}:${e.verdict ?? e.op}`)).toEqual(["proposal:undefined", "gate:accepted", "emu:load"]);
    expect(r.events().at(-2).hash).toBe(f.hash);
    expect(r.events().at(-1).hash).toBe(f.hash);

    const run = await call(t, "c64_run");
    expect(run.data).toMatchObject({ error: null, titleSeen: true, postTitle: "pass", heading: RESURRECTED_HEADING, iteration: 1, hash: f.hash });
    expect(Array.from(dumpBasic(core))).toEqual(canonicalImage(r));
    expect(r.json("listing.json").contract.state).toBe("RESURRECTED");
  });

  it("resets postTitle and contract to the before-run value, which equals the pure evaluate() value (k)", async () => {
    const { r, t } = await setup();
    await call(t, "c64_run");
    expect(r.json("listing.json")).toMatchObject({ postTitle: "pass", contract: { state: "RESURRECTED" } });
    const res = await patch(t, [replace(30, 'PRINT "LAUNCHED"')]); // same checksum: spaces count nothing
    expect(res.data.verdict).toBe("accepted");
    const f = r.json("listing.json");
    expect(f.postTitle).toBe("not-reached");
    const expected = evaluate({
      listing: stripProvisional(f.lines), expectedLines: spec.expectedLines, titleSeen: false, postTitle: "not-reached",
      residentBytes: new Uint8Array(0), provisional: new Set<number>(f.lines.filter((l: any) => l.provisional).map((l: any) => l.n)),
    });
    expect(f.contract).toMatchObject({ state: expected.verdict, heading: expected.heading, counts: expected.counts, failed: expected.failed, scope: "title-path" });
    expect(f.contract.state).toBe("NOT-RESURRECTED");
    expect(f.contract.heading.startsWith("NO-TITLE")).toBe(true);
    expect(f.contract.lines).toHaveLength(4);
    expect(r.json("state.json").postTitle).toBe("pass"); // state.json is observational and untouched by a patch
    expect((await call(t, "c64_run")).data.heading).toBe(RESURRECTED_HEADING);
  });

  it("an accepted patch that makes a line untypeable is accepted and reports it (R10.7, m)", async () => {
    const { r, t } = await setup({ lines: patchableToUntypeableLines() });
    const res = await patch(t, [replace(40, PATCH_TO_UNTYPEABLE)]);
    expect(res.isError).toBe(false);
    expect(res.data.verdict).toBe("accepted");
    expect(res.text).toContain("untypeable: line 40: digit-leading-body");
    expect(res.text.endsWith("Call c64_run next.")).toBe(true);
    expect(res.data.untypeable).toEqual([{ n: 40, why: "digit-leading-body" }]);
    const f = r.json("listing.json");
    expect(f.untypeable).toEqual([{ n: 40, why: "digit-leading-body" }]);
    expect(f.lines.find((l: any) => l.n === 40).body).toBe(PATCH_TO_UNTYPEABLE); // kept, so the agent can repair it
    expect(Array.from(dumpBasic(core))).toEqual(Array.from(image(nightjarLines().filter((l) => l.n !== 40))));
  });

  it("persists listing.json before typing: a failure while typing never loses the patch (R10.6)", async () => {
    const stub = new StubCore();
    const { r, t } = await setup({ lines: brokenLines() }, stub);
    stub.queueKeys = () => { throw new Error("wasm trap while typing"); };
    const res = await patch(t, [replace(20, NIGHTJAR_BODIES[20]!)]);
    expect(res.isError).toBe(true);
    const f = r.json("listing.json");
    expect(f.lines.find((l: any) => l.n === 20).body).toBe(NIGHTJAR_BODIES[20]);
    expect(f.iteration).toBe(1);
    expect(r.events().some((e) => e.k === "gate" && e.verdict === "accepted" && e.hash === f.hash)).toBe(true);
  });
});

describe("apply_patch: refused (R10.5)", () => {
  it("changes nothing but iteration, leaves BASIC memory byte-identical, and the text is the gate's reason (c, P2)", async () => {
    const { r, t } = await setup({ lines: badChecksumLines(), provisional: [20] });
    await call(t, "c64_run");
    const before = r.json("listing.json");
    const memory = Array.from(dumpBasic(core));
    const state = r.text("state.json");
    const eventsBefore = r.events().length;

    const ops = [replace(30, BAD_PATCH_30)];
    const res = await patch(t, ops);
    const expected = gateReason(before.lines, ops);
    expect(expected.verdict).toBe("refused");
    expect(res.isError).toBe(true);
    expect(res.text).toBe(expected.reason); // byte for byte
    expect(res.text).toMatch(/^REFUSED \(R4\.15\): line 30 checksum mismatch — printed :rem \d+, computed \d+\./);
    expect(res.data).toMatchObject({ verdict: "refused", reason: expected.reason, iteration: 1 });

    const after = r.json("listing.json");
    expect({ ...after, iteration: 0 }).toEqual({ ...before, iteration: 0 });
    expect(after.iteration).toBe(1);
    expect(Array.from(dumpBasic(core))).toEqual(memory);
    expect(r.text("state.json")).toBe(state);
    expect(r.events().slice(eventsBefore).map((e) => `${e.k}:${e.verdict ?? ""}`)).toEqual(["proposal:", "gate:refused"]);
    expect(r.events().at(-1)).not.toHaveProperty("hash");
    expect(r.events().at(-1)).toMatchObject({ reason: expected.reason, refusalCounts: {} });
  });

  it("every gate refusal reaches the agent verbatim (P8)", async () => {
    const { r, t } = await setup({}, new StubCore());
    const lines = r.json("listing.json").lines;
    const cases: unknown[][] = [
      [replace(20, "")], // R4.4 deletion
      [replace(25, "END")], // R4.5 not in the listing
      [replace(10, 'PRINT"SOMETHING ELSE ENTIRELY"')], // R4.7 too large an edit
      [renumber(20, 25)], // R4.8 not in the inventory
      [renumber(20, 30)], // R4.9
      [replace(30, 'PRINT"LAUNCHED"'), replace(20, "END")],
    ];
    for (const ops of cases) {
      const res = await patch(t, ops);
      const direct = gateReason(lines, ops);
      expect(direct.verdict, JSON.stringify(ops)).toBe("refused");
      expect(res).toMatchObject({ isError: true, text: direct.reason });
    }
    expect(r.json("listing.json").lines).toEqual(lines);
    expect(r.json("listing.json").iteration).toBe(cases.length);
  });

  it("force_unverified with refusals.json counts 0, 1, 2 gives refused, refused, forced (g, R10.8)", async () => {
    const { r, t } = await setup({ lines: badChecksumLines() });
    const ops = [replace(30, BAD_PATCH_30)];
    const first = await patch(t, ops, { force_unverified: true });
    expect(first).toMatchObject({ isError: true });
    expect(first.text).toMatch(/^REFUSED \(R4\.17\): force_unverified needs at least 2 earlier refusals of line 30; it has 0\./);
    r.write("refusals.json", '{"30":1}\n');
    const second = await patch(t, ops, { force_unverified: true });
    expect(second.text).toMatch(/it has 1\./);
    expect(second.isError).toBe(true);
    r.write("refusals.json", '{"30":2}\n');
    const third = await patch(t, ops, { force_unverified: true });
    expect(third.isError).toBe(false);
    expect(third.data.verdict).toBe("forced");
    expect(third.text).toMatch(/^FORCED: 30: FORCED after 2 refusals: printed \d+, computed \d+; never verified\nhash [0-9a-f]{64}\nuntypeable: none\nCall c64_run next\.$/);
    const f = r.json("listing.json");
    expect(f.iteration).toBe(3);
    expect(f.lines.find((l: any) => l.n === 30)).toMatchObject({ body: BAD_PATCH_30, status: "forced", source: "gate" });
    expect(r.events().filter((e) => e.k === "gate").map((e) => [e.verdict, e.refusalCounts])).toEqual([["refused", {}], ["refused", { 30: 1 }], ["forced", { 30: 2 }]]);
    expect(r.text("refusals.json")).toBe('{"30":2}\n'); // never written by the server (R13.4)
    // a forced line can never produce RESURRECTED (clause 5)
    const run = await call(t, "c64_run");
    expect(run.data).toMatchObject({ titleSeen: true, postTitle: "pass" });
    expect(String(run.data.heading)).toContain("BOOTED — PARTIAL");
    expect(run.data.failed).toEqual(expect.arrayContaining([{ clause: 5, lines: [30] }]));
    expect(r.json("listing.json").contract.state).toBe("BOOTED-PARTIAL");
  });

  it("a damaged refusals.json counts as {} and can never unlock force_unverified", async () => {
    for (const damaged of ['{"30":2', '{"30":-2}', '{"30":"2"}', '{"30":2,"x":9}', "[2]", '{"30":2.5}', "null"]) {
      const { r, t } = await setup({ lines: badChecksumLines() }, new StubCore());
      r.write("refusals.json", damaged);
      const res = await patch(t, [replace(30, BAD_PATCH_30)], { force_unverified: true });
      expect(res.isError, damaged).toBe(true);
      expect(res.text, damaged).toMatch(/it has 0\./);
      expect(r.events().at(-1)).toMatchObject({ k: "gate", verdict: "refused", refusalCounts: {} });
      expect(r.text("refusals.json")).toBe(damaged);
    }
  });

  it("without force_unverified a count of 2 changes nothing: the plain refusal stands", async () => {
    const { r, t } = await setup({ lines: badChecksumLines() }, new StubCore());
    r.write("refusals.json", '{"30":2}');
    const res = await patch(t, [replace(30, BAD_PATCH_30)]);
    expect(res.text).toMatch(/^REFUSED \(R4\.15\)/);
  });
});

describe("apply_patch: provisional follows the line (R3.8, j)", () => {
  /** line 20 holds line 30's body with line 30's checksum, and the other way round (OCR swapped the numbers) */
  const swapped = () => nightjarLines().map((l) => {
    if (l.n === 20) return { ...l, body: NIGHTJAR_BODIES[30]!, printed: computeChecksum(30, NIGHTJAR_BODIES[30]!), status: "unverified" as const };
    if (l.n === 30) return { ...l, body: NIGHTJAR_BODIES[20]!, printed: computeChecksum(20, NIGHTJAR_BODIES[20]!), status: "unverified" as const };
    return l;
  });

  it("a renumber keeps the flag with the line at its new number", async () => {
    const lines = nightjarLines().map((l) => (l.n === 40 ? { ...l, n: 45 } : l));
    const { r, t } = await setup({ lines, provisional: [45] }, new StubCore());
    expect(r.json("listing.json").lines.map((l: any) => [l.n, l.provisional])).toEqual([[10, false], [20, false], [30, false], [45, true]]);
    const res = await patch(t, [renumber(45, 40)]);
    expect(res.data.verdict).toBe("accepted");
    const f = r.json("listing.json");
    expect(f.lines.map((l: any) => [l.n, l.provisional])).toEqual([[10, false], [20, false], [30, false], [40, true]]);
    expect(f.contract.lines.find((l: any) => l.n === 40)).toMatchObject({ provisional: true, status: "verified" });
    expect(f.hash).toBe(canonicalHash(nightjarLines()));
  });

  it("a two-line swap keeps the flag with its line and creates none", async () => {
    const { r, t } = await setup({ lines: swapped(), provisional: [20] }, new StubCore());
    const res = await patch(t, [renumber(20, 30), renumber(30, 20)]);
    expect(res.data.verdict, res.text).toBe("accepted");
    const f = r.json("listing.json");
    expect(f.lines.map((l: any) => [l.n, l.body === NIGHTJAR_BODIES[l.n], l.provisional])).toEqual([[10, true, false], [20, true, false], [30, true, true], [40, true, false]]);
    expect(f.hash).toBe(canonicalHash(nightjarLines()));
    // and with nothing provisional, nothing becomes provisional
    const plain = await setup({ lines: swapped(), provisional: [] }, new StubCore());
    await patch(plain.t, [renumber(20, 30), renumber(30, 20)]);
    expect(plain.r.json("listing.json").lines.every((l: any) => l.provisional === false)).toBe(true);
  });

  it("a replace keeps the flag; a non-provisional replace stays non-provisional", async () => {
    const { r, t } = await setup({ lines: brokenLines(), provisional: [20] }, new StubCore());
    await patch(t, [replace(20, NIGHTJAR_BODIES[20]!)]);
    expect(r.json("listing.json").lines.map((l: any) => [l.n, l.provisional])).toEqual([[10, false], [20, true], [30, false], [40, false]]);
    const other = await setup({ lines: brokenLines() }, new StubCore());
    await patch(other.t, [replace(20, NIGHTJAR_BODIES[20]!)]);
    expect(other.r.json("listing.json").lines.every((l: any) => l.provisional === false)).toBe(true);
  });
});

describe("apply_patch: iteration and events (R10.2, R4.4, R4.5)", () => {
  it("iteration counts well-formed calls only, refused or not", async () => {
    const { r, t } = await setup({ lines: brokenLines() }, new StubCore());
    const iter = () => r.json("listing.json").iteration;
    expect((await patch(t, [replace(20, "")])).isError).toBe(true); // refused: counts
    expect(iter()).toBe(1);
    expect((await patch(t, [{ op: "insert", lineno: 25, new_body: "END" }])).text).toMatch(/malformed call/);
    expect((await call(t, "apply_patch", { ops: [replace(20, "END")] })).text).toMatch(/malformed call/); // no reason
    expect(iter()).toBe(1);
    expect(r.events().filter((e) => e.k === "proposal")).toHaveLength(1);
    const ok1 = await patch(t, [replace(20, NIGHTJAR_BODIES[20]!)]);
    expect(ok1.data.iteration).toBe(2);
    expect(iter()).toBe(2);
    expect((await call(t, "c64_run", { frames: 1 })).data.iteration).toBe(2);
  });

  it("the proposal carries the ops exactly as sent; the gate event carries refusalCounts and hash; replay agrees (R4.5)", async () => {
    const { r, t } = await setup({ lines: badChecksumLines() }, new StubCore());
    const start = r.json("input.json").lines;
    r.write("refusals.json", '{"30":2,"20":1}');
    const ops = [replace(30, BAD_PATCH_30)];
    await patch(t, [replace(20, "")], { reason: "first" });
    await patch(t, ops, { reason: "force it", force_unverified: true });
    const ev = r.events().filter((e) => e.k === "proposal" || e.k === "gate");
    expect(ev.map((e) => e.k)).toEqual(["proposal", "gate", "proposal", "gate"]);
    expect(ev[0]).toMatchObject({ ops: [replace(20, "")], reason: "first", force_unverified: false });
    expect(ev[2]).toMatchObject({ ops, reason: "force it", force_unverified: true });
    expect(ev[1]).toMatchObject({ verdict: "refused", refusalCounts: { 20: 1 } });
    expect(ev[3]).toMatchObject({ verdict: "forced", refusalCounts: { 30: 2 } });
    expect(ev[1]).not.toHaveProperty("hash");
    expect(ev[3].hash).toBe(r.json("listing.json").hash);
    // replay from input.json's lines
    let listing = start;
    for (let i = 0; i < ev.length; i += 2) {
      const p = ev[i], g = ev[i + 1];
      const v = gateReason(listing, p.ops, g.refusalCounts, p.force_unverified);
      expect(v.verdict).toBe(g.verdict);
      if (v.verdict !== "refused") {
        listing = (v as any).listing;
        expect(canonicalHash(listing)).toBe(g.hash);
      }
    }
  });
});
