/** mcp/c64-server/rundir.ts (the file contract) and render.ts (result text): R2.6, R3.2, R3.3, R4.3, R5.3, R6.5, R6.6, R10.3, R13. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { appendEvent, canonicalHash, listingExists, readInput, readListing, readRefusalCounts, resolveRunDir, scanEvents, writeJsonAtomic } from "../../mcp/c64-server/rundir.ts";
import { errorLine, patchResult, pressResult, reloadResult, runResult, screenResult, untypeableReport } from "../../mcp/c64-server/render.ts";
import { makeRun, nightjarLines, type Run } from "../fixtures/mcp-fixture.ts";

const runs: Run[] = [];
const mk = (o = {}) => { const r = makeRun(o); runs.push(r); return r; };
afterEach(() => { while (runs.length) runs.pop()!.cleanup(); });

describe("canonicalHash (R3.2)", () => {
  // printf '10 A\n20 B' | shasum -a 256
  const PRECOMPUTED = "b1daf2526ec407c205c11e03ec77759a55f6ddf18d6d5365a8143d960f9f627a";
  it("equals a precomputed SHA-256 of the sorted `n body` text, whatever order the lines come in", () => {
    expect(canonicalHash([{ n: 20, body: "B" }, { n: 10, body: "A" }])).toBe(PRECOMPUTED);
    expect(canonicalHash([{ n: 10, body: "A" }, { n: 20, body: "B" }])).toBe(PRECOMPUTED);
  });
  it("covers the body text only: status, printed, source and provisional do not change it", () => {
    const a = nightjarLines().map((l) => ({ ...l, provisional: false }));
    const b = a.map((l) => ({ ...l, status: "forced" as const, printed: null, source: "typed", provisional: true }));
    expect(canonicalHash(b)).toBe(canonicalHash(a));
    expect(canonicalHash(a.map((l) => (l.n === 30 ? { ...l, body: l.body + " " } : l)))).not.toBe(canonicalHash(a));
  });
  it("hashes `n body` with no trailing newline", () => {
    expect(canonicalHash([{ n: 10, body: "END" }])).toBe(createHash("sha256").update("10 END").digest("hex"));
    expect(canonicalHash([])).toBe(createHash("sha256").update("").digest("hex"));
  });
});

describe("writeJsonAtomic (R3.3)", () => {
  it("leaves no .tmp and writes valid JSON", () => {
    const r = mk();
    writeJsonAtomic(r.dir, "state.json", { a: 1 });
    expect(r.files()).toEqual(["input.json", "state.json"]);
    expect(r.json("state.json")).toEqual({ a: 1 });
    writeJsonAtomic(r.dir, "state.json", { a: 2 });
    expect(r.json("state.json")).toEqual({ a: 2 });
    expect(r.files().some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("a reader in another process during many writes sees the old or the new file, never half of one", async () => {
    const r = mk();
    const big = (i: number) => ({ i, pad: "x".repeat(200_000) });
    writeJsonAtomic(r.dir, "state.json", big(0));
    const reader = `
      const fs = require("node:fs");
      const f = process.argv[1] + "/state.json", stop = process.argv[1] + "/stop";
      let reads = 0, torn = 0, last = -1, backwards = 0;
      console.log("ready");
      while (!fs.existsSync(stop)) {
        try { const j = JSON.parse(fs.readFileSync(f, "utf8")); reads++; if (j.i < last) backwards++; last = j.i; } catch { torn++; }
      }
      console.log(JSON.stringify({ reads, torn, backwards }));`;
    const child = spawn(process.execPath, ["-e", reader, r.dir], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    await new Promise<void>((res) => { const t = setInterval(() => { if (out.includes("ready")) { clearInterval(t); res(); } }, 5); });
    for (let i = 1; i <= 150; i++) writeJsonAtomic(r.dir, "state.json", big(i));
    writeFileSync(r.file("stop"), "");
    await new Promise<void>((res) => child.on("close", () => res()));
    const stats = JSON.parse(out.trim().split("\n").at(-1)!);
    expect(stats.reads).toBeGreaterThan(0);
    expect(stats.torn).toBe(0);
    expect(stats.backwards).toBe(0);
  }, 30_000);
});

describe("appendEvent (R4.3)", () => {
  it("adds t first, then k, and never rewrites earlier lines", () => {
    const r = mk();
    appendEvent(r.dir, { k: "malformed", tool: "x", why: "a" });
    const first = r.text("events.jsonl");
    appendEvent(r.dir, { k: "error", why: "b", t: "forged" });
    const all = r.text("events.jsonl");
    expect(all.startsWith(first)).toBe(true);
    const [a, b] = r.events();
    expect(Object.keys(a)).toEqual(["t", "k", "tool", "why"]);
    expect(new Date(a.t).toISOString()).toBe(a.t);
    expect(b.t).not.toBe("forged");
    expect(all.endsWith("\n")).toBe(true);
  });
  it("starts on its own line after a torn last line", () => {
    const r = mk();
    appendFileSync(r.file("events.jsonl"), '{"k":"hook","half');
    appendEvent(r.dir, { k: "error", why: "after torn" });
    expect(r.events().map((e) => e.k)).toEqual(["error"]);
    expect(r.text("events.jsonl").split("\n")).toHaveLength(3);
  });
});

describe("scanEvents (R2.6)", () => {
  it("is empty without a file", () => {
    expect(scanEvents(mk().dir)).toEqual({ fatal: null, crashes: 0 });
  });
  it("skips a torn last line and bad lines; finds the 3-malformed error and counts crash restarts", () => {
    const r = mk();
    r.write("events.jsonl", [
      JSON.stringify({ t: "x", k: "emu", op: "load", hash: "h", untypeable: [] }),
      "not json at all",
      JSON.stringify({ t: "x", k: "emu", op: "restart", cause: "crash" }),
      "[1,2]",
      "null",
      JSON.stringify({ t: "x", k: "error", why: "internal", message: "m" }),
      JSON.stringify({ t: "x", k: "emu", op: "restart", cause: "crash" }),
      JSON.stringify({ t: "x", k: "emu", op: "restart", cause: "other" }),
      JSON.stringify({ t: "x", k: "error", why: "3 malformed calls" }),
      '{"t":"x","k":"error","why":"emulator crashed tw',
    ].join("\n"));
    expect(scanEvents(r.dir)).toEqual({ fatal: "3 malformed calls", crashes: 2 });
  });
  it("an internal error is not fatal; a crash-twice error is", () => {
    const r = mk();
    r.write("events.jsonl", JSON.stringify({ k: "error", why: "internal" }) + "\n");
    expect(scanEvents(r.dir).fatal).toBeNull();
    appendEvent(r.dir, { k: "error", why: "emulator crashed twice" });
    expect(scanEvents(r.dir).fatal).toBe("emulator crashed twice");
  });
});

describe("readRefusalCounts (R10.3)", () => {
  const counts = (text: string | null) => {
    const r = mk();
    if (text !== null) r.write("refusals.json", text);
    return readRefusalCounts(r.dir);
  };
  it("absent → {}", () => expect(counts(null)).toEqual({}));
  it("valid → numbers", () => expect(counts('{"20":2,"30":0}')).toEqual({ 20: 2, 30: 0 }));
  it("empty object → {}", () => expect(counts("{}")).toEqual({}));
  it("invalid JSON → {}", () => expect(counts("{")).toEqual({}));
  it("not an object → {}", () => {
    for (const t of ["[1,2]", "5", '"x"', "null", "true"]) expect(counts(t), t).toEqual({});
  });
  it("one negative value empties the whole file", () => expect(counts('{"20":2,"30":-1}')).toEqual({}));
  it("one non-integer value empties the whole file", () => {
    expect(counts('{"20":2,"30":1.5}')).toEqual({});
    expect(counts('{"20":"2"}')).toEqual({});
  });
  it("one bad key empties the whole file", () => {
    expect(counts('{"20":2,"x":1}')).toEqual({});
    expect(counts('{"-20":2}')).toEqual({});
    expect(counts('{"2.5":2}')).toEqual({});
    expect(counts('{"":2}')).toEqual({});
  });
  it("is read afresh on each call", () => {
    const r = mk();
    expect(readRefusalCounts(r.dir)).toEqual({});
    r.write("refusals.json", '{"20":2}');
    expect(readRefusalCounts(r.dir)).toEqual({ 20: 2 });
  });
  it("never writes the file", () => {
    const r = mk();
    readRefusalCounts(r.dir);
    expect(r.has("refusals.json")).toBe(false);
  });
});

describe("input and listing readers (R2.1, R2.3, R2.4)", () => {
  it("readInput head ignores lines; full needs them; neither modifies input.json", () => {
    const r = mk({ lines: [] });
    const before = r.text("input.json");
    expect(readInput(r.dir, "head").listingId).toBe("nightjar");
    expect(readInput(r.dir, "full").lines).toEqual([]);
    expect(r.text("input.json")).toBe(before);
  });
  it("names the file and the cause on a missing, invalid or malformed file", () => {
    const missing = mk();
    writeFileSync(missing.file("input.json"), "{");
    expect(() => readInput(missing.dir, "head")).toThrow(/input\.json: invalid JSON/);
    const bad = mk({ raw: JSON.stringify({ listingId: "", scope: "s" }) });
    expect(() => readInput(bad.dir, "head")).toThrow(/input\.json: listingId/);
    const none = mk();
    expect(() => readListing(none.dir)).toThrow(/listing\.json: cannot read/);
    expect(listingExists(none.dir)).toBe(false);
    none.write("listing.json", "{}");
    expect(listingExists(none.dir)).toBe(true);
    expect(() => readListing(none.dir)).toThrow(/listing\.json:/);
  });
  it("resolveRunDir needs an existing directory", () => {
    const r = mk();
    expect(resolveRunDir(r.dir)).toBe(r.dir);
    expect(resolveRunDir(r.file("input.json"))).toBeNull();
    expect(resolveRunDir(r.file("nope"))).toBeNull();
    expect(resolveRunDir("")).toBeNull();
    expect(resolveRunDir(undefined)).toBeNull();
  });
});

describe("render (R5.3, R6.5, R6.6)", () => {
  const screen = "RUN\n\n?SYNTAX  ERROR IN 20\nREADY.";
  const err = { kind: "SYNTAX", line: 20 };
  it("keeps the double space of the C64's error text", () => {
    expect(errorLine(screen, err)).toBe("error: ?SYNTAX  ERROR IN 20");
    expect(errorLine(screen, null)).toBe("error: none");
    expect(errorLine("", err)).toBe("error: ?SYNTAX  ERROR IN 20");
    expect(screenResult(screen, err).text).toContain("?SYNTAX  ERROR IN 20");
    expect(pressResult({ screen, error: err, keys: ["SPACE"], checkpoint: "title" }).text).toContain("?SYNTAX  ERROR IN 20");
  });
  it("reports untypeable lines one per line, or none", () => {
    expect(untypeableReport([])).toBe("untypeable: none");
    expect(untypeableReport([{ n: 40, why: "control-outside-quotes" }, { n: 50, why: "too-long" }])).toBe("untypeable: line 40: control-outside-quotes\nuntypeable: line 50: too-long");
    expect(reloadResult("h", []).text).toBe("hash h\nuntypeable: none");
    expect(reloadResult("h", [{ n: 40, why: "digit-leading-body" }]).data).toEqual({ hash: "h", untypeable: [{ n: 40, why: "digit-leading-body" }] });
  });
  it("run text is in order and holds screens verbatim; data carries the structure", () => {
    const view = {
      hash: "h", iteration: 0, frames: 50, stoppedOn: "error", error: err, titleSeen: false, postTitle: "not-reached" as const,
      heading: "NO-TITLE NOT RESURRECTED · 3/4 checksum-consistent",
      counts: { verified: 3, digitMisread: 0, eyeVerified: 0, forced: 0, unverified: 1, present: 4, typed: 0, missing: 0, orphansExcluded: 0 },
      failed: [], untypeable: [], screens: { afterRun: screen },
    };
    const r = runResult(view);
    const lines = r.text.split("\n");
    expect(lines.slice(0, 5)).toEqual([view.heading, "error: ?SYNTAX  ERROR IN 20", "titleSeen: false", "postTitle: not-reached", "untypeable: none"]);
    expect(r.text).toContain(`--- AFTER RUN ---\n${screen}`);
    expect(r.text).not.toContain("--- TITLE ---");
    expect(r.isError).toBe(false);
    expect((r.data.screens as any).afterRun).toBe(screen);
    expect(runResult({ ...view, screens: { afterRun: "a", title: "t", postTitle: "p" } }).text).toMatch(/--- AFTER RUN ---\na\n--- TITLE ---\nt\n--- POST-TITLE ---\np$/);
  });
  it("patch text is reason, hash, untypeable report, then the call to action", () => {
    const r = patchResult({ verdict: "accepted", reason: "ACCEPTED: 20: ok", perOp: [], hash: "abc", iteration: 1, untypeable: [] });
    expect(r.text).toBe("ACCEPTED: 20: ok\nhash abc\nuntypeable: none\nCall c64_run next.");
    expect(readFileSync(new URL("../../mcp/c64-server/render.ts", import.meta.url), "utf8")).not.toContain("RESURRECTED");
  });
});
