/**
 * Every tool of the c64 MCP server over a `C64Core` and a run directory (R1.8). `server.ts` only wires stdio around
 * `createTools(core, runDir).call`, so every behaviour here is reachable without a transport.
 *
 * This module decides nothing about correctness: statuses come from `applyPatch`, verdicts from `judge`/`evaluate`,
 * checksums from `computeChecksum`/`checkLine`, typing decisions from `loadCanonical`/`untypeableLines` (R13.5).
 * It imports no `node:` module and neither `c64-ready` nor `src/emu/node.ts` (R1.4, R13.2): files go through `rundir.ts`.
 */
import { computeChecksum } from "../../src/basic/checksum.ts";
import type { CanonicalLine } from "../../src/basic/types.ts";
import { afterLastRun, parseError, pressKeys, readScreenText, type C64Core, type C64Error } from "../../src/emu/core.ts";
import { judge, loadCanonical, runListing, untypeableLines, type Untypeable } from "../../src/emu/session.ts";
import { applyPatch, checkLine, type PatchOp } from "../../src/gate/checksum-gate.ts";
import { evaluate, type ContractResult } from "../../src/gate/contract.ts";
import { appendEvent, canonicalHash, listingExists, readInput, readListing, readRefusalCounts, scanEvents, writeListing, writeState } from "./rundir.ts";
import { fail, checksumResult, pressResult, reloadResult, runResult, screenResult, patchResult, type ToolResult } from "./render.ts";
import {
  TOOL_NAMES, descriptors, issuesText, keyName, keyToPetscii, tools,
  type ChecksumArgs, type ContractFile, type ListingLine, type PatchArgs, type PatchOpInput, type PressArgs, type RunArgs, type SpecT, type ToolDescriptor, type ToolName,
} from "./schemas.ts";

/** A fatal emulator condition (R12.3): the run is over and the message is the tool error. */
class CrashFatal extends Error {
  constructor(message: string) { super(message); this.name = "CrashFatal"; }
}

const byNumber = (a: { n: number }, b: { n: number }): number => a.n - b.n;

/** The gate's op names are `type`, the tool's are `op` (design.md "Data shapes"). */
function toGateOp(op: PatchOpInput): PatchOp {
  return op.op === "replace"
    ? { type: "replace", lineno: op.lineno, new_body: op.new_body }
    : { type: "renumber", lineno: op.lineno, new_lineno: op.new_lineno };
}

export class C64Tools {
  private readonly core: C64Core;
  private readonly dir: string;
  private readonly listingId: string;
  private readonly scope: string;
  private readonly spec: SpecT;
  private lines: ListingLine[];
  private iteration: number;
  private postTitle: "pass" | "fail" | "not-reached";
  private contract: ContractFile;
  private malformedRun: number;
  private crashes: number;
  private over: string | null;
  private chain: Promise<unknown>;

  /** Use `createTools`: it validates the run directory and types the listing before an instance exists. */
  constructor(core: C64Core, dir: string, head: { listingId: string; scope: string; spec: SpecT }, state: { lines: ListingLine[]; iteration: number; postTitle: "pass" | "fail" | "not-reached"; contract: ContractFile | null }, scan: { fatal: string | null; crashes: number }) {
    this.core = core;
    this.dir = dir;
    this.listingId = head.listingId;
    this.scope = head.scope;
    this.spec = head.spec;
    this.lines = [...state.lines].sort(byNumber);
    this.iteration = state.iteration;
    this.postTitle = state.postTitle;
    this.malformedRun = 0; // R11.7: memory only
    this.crashes = scan.crashes; // R2.6
    this.over = scan.fatal; // R2.6
    this.chain = Promise.resolve();
    this.contract = state.contract ?? this.beforeRunContract(); // R2.2 / R2.3: a restart carries the stored contract
  }

  // -----------------------------------------------------------------------------------------------------------
  // state helpers
  // -----------------------------------------------------------------------------------------------------------

  /** The canonical listing without `provisional`: the only thing ever typed or judged (R10.4). */
  private plain(): CanonicalLine[] {
    return this.lines.map(({ n, body, printed, status, source }) => ({ n, body, printed, status, source }));
  }

  private provisionalSet(): Set<number> {
    return new Set(this.lines.filter((l) => l.provisional).map((l) => l.n));
  }

  private hash(): string {
    return canonicalHash(this.lines);
  }

  private toContractFile(res: ContractResult): ContractFile {
    return {
      state: res.verdict,
      scope: this.scope,
      heading: res.heading,
      counts: res.counts,
      failed: res.failed,
      lines: [...this.lines].sort(byNumber).map((l) => ({ n: l.n, status: l.status, source: l.source, provisional: l.provisional })),
    };
  }

  /** R3.5: a pure function of the listing, no emulator needed. `failed` is a placeholder, not a measured fact. */
  beforeRunContract(): ContractFile {
    return this.toContractFile(evaluate({
      listing: this.plain(),
      expectedLines: this.spec.expectedLines,
      titleSeen: false,
      postTitle: "not-reached",
      residentBytes: new Uint8Array(0),
      provisional: this.provisionalSet(),
    }));
  }

  /** R3.1, R3.3: the whole file, atomically. `hash` and `untypeable` are recomputed from the lines. */
  writeListing(): void {
    writeListing(this.dir, {
      listingId: this.listingId,
      scope: this.scope,
      expectedLines: [...this.spec.expectedLines],
      lines: this.lines,
      hash: this.hash(),
      untypeable: untypeableLines(this.plain()),
      iteration: this.iteration,
      postTitle: this.postTitle,
      contract: this.contract,
    });
  }

  /** R4.1: observational only, nothing in it feeds `contract`. */
  writeState(v: { screen: string; error: C64Error | null; titleSeen: boolean; postTitle: "pass" | "fail" | "not-reached" }): void {
    writeState(this.dir, { iteration: this.iteration, screen: v.screen, error: v.error, titleSeen: v.titleSeen, postTitle: v.postTitle, at: new Date().toISOString() });
  }

  /**
   * Runs the emulator part of a tool with crash recovery (design.md "Crash recovery", R12): any throw from core or
   * session code is a crash → reboot, re-type the canonical listing, record `restart` + `load`, re-run the section
   * once. The crash budget is per RUN, not per process (R2.6: seeded from events.jsonl), so the second crash —
   * including one during recovery — ends the run.
   * claude-direct (P1b): Kiro credit line c64-mcp-server reached its cap after task 5 (docs/DX-REPORT.md).
   */
  protected async withEmu<T>(section: () => T): Promise<T> {
    for (;;) {
      try { return section(); } catch {
        this.crashes++;
        if (this.crashes >= 2) this.fatal("emulator crashed twice");
        let untypeable: Untypeable[];
        try {
          await this.core.boot();
          untypeable = loadCanonical(this.core, this.plain());
        } catch {
          this.crashes++;
          this.fatal("emulator crashed twice");
        }
        appendEvent(this.dir, { k: "emu", op: "restart", cause: "crash" });
        appendEvent(this.dir, { k: "emu", op: "load", hash: this.hash(), untypeable: untypeable! });
      }
    }
  }

  private fatal(why: "emulator crashed twice"): never {
    appendEvent(this.dir, { k: "error", why });
    this.over = why;
    throw new CrashFatal(`${why}; the run ends`);
  }

  /** R2.5: type the loaded listing, record it, persist it. A throw here rejects `createTools` (no tool is running). */
  startUp(): void {
    let untypeable: Untypeable[];
    try {
      untypeable = loadCanonical(this.core, this.plain());
    } catch (e) {
      throw new Error(`emulator failed while typing the listing at start-up: ${e instanceof Error ? e.message : String(e)}`);
    }
    appendEvent(this.dir, { k: "emu", op: "load", hash: this.hash(), untypeable });
    this.writeListing();
  }

  // -----------------------------------------------------------------------------------------------------------
  // public surface (R1.8)
  // -----------------------------------------------------------------------------------------------------------

  list(): ToolDescriptor[] {
    return descriptors();
  }

  /** Strictly one call at a time, in arrival order (R1.6). Never rejects: every failure is a tool result. */
  call(name: string, args: unknown): Promise<ToolResult> {
    const run = () => this.dispatch(name, args);
    const next = this.chain.then(run, run);
    this.chain = next;
    return next;
  }

  private async dispatch(name: string, args: unknown): Promise<ToolResult> {
    try {
      if (this.over) return fail(`run is over: ${this.over}`); // R11.5: no emulator, no write, no event
      const label = String(name);
      const schema = Object.hasOwn(tools, label) ? tools[label as ToolName] : null;
      const parsed = schema ? schema.safeParse(args ?? {}) : null;
      if (!parsed || !parsed.success) {
        return this.malformed(label, parsed ? issuesText(parsed.error) : `unknown tool; the tools are ${TOOL_NAMES.join(", ")}`);
      }
      this.malformedRun = 0; // R11.3
      try {
        return await this.handle(label as ToolName, parsed.data);
      } catch (e) {
        if (e instanceof CrashFatal) return fail(e.message); // R12.3
        const message = e instanceof Error ? e.message : String(e);
        appendEvent(this.dir, { k: "error", why: "internal", tool: label, message });
        return fail(`internal error: ${message}`);
      }
    } catch (e) {
      // the event or the file write itself failed: still a tool result, never an exception out of `call`
      return fail(`internal error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** R11.1, R11.4: count, record, and end the run on the third in a row. */
  private malformed(tool: string, issues: string): ToolResult {
    this.malformedRun++;
    appendEvent(this.dir, { k: "malformed", tool, why: issues.replaceAll("\n", "; ") });
    let text = `${tool}: malformed call\n${issues}`;
    if (this.malformedRun >= 3) {
      appendEvent(this.dir, { k: "error", why: "3 malformed calls" });
      this.over = "3 malformed calls";
      text += `\nrun is over: ${this.over}`;
    }
    return fail(text);
  }

  private async handle(name: ToolName, args: unknown): Promise<ToolResult> {
    switch (name) {
      case "c64_reload": return this.reload();
      case "c64_read_screen": return this.readScreen();
      case "checksum_line": return this.checksumLine(args as ChecksumArgs);
      case "c64_run": return this.runTool(args as RunArgs);
      case "c64_press": return this.press(args as PressArgs);
      case "apply_patch": return this.applyPatchTool(args as PatchArgs);
    }
  }

  // -----------------------------------------------------------------------------------------------------------
  // tools
  // -----------------------------------------------------------------------------------------------------------

  /** R5: type the canonical listing again; no file is written. */
  private async reload(): Promise<ToolResult> {
    const untypeable = await this.withEmu(() => loadCanonical(this.core, this.plain()));
    const hash = this.hash();
    appendEvent(this.dir, { k: "emu", op: "load", hash, untypeable });
    return reloadResult(hash, untypeable);
  }

  /** R7: read-only on the machine; writes state.json only. */
  private async readScreen(): Promise<ToolResult> {
    const screen = await this.withEmu(() => readScreenText(this.core));
    const error = parseError(screen);
    this.writeState({ screen, error, titleSeen: this.titleOnScreen(screen, error), postTitle: this.postTitle });
    return screenResult(screen, error);
  }

  /** R4.2: `titleSeen` for observation only, from the screen text after the last RUN. */
  private titleOnScreen(screen: string, error: C64Error | null): boolean {
    return !error && afterLastRun(screen).includes(this.spec.titlePredicate.screenContains);
  }

  /** R9: pure, no I/O. */
  private checksumLine(a: ChecksumArgs): ToolResult {
    const computed = computeChecksum(a.lineno, a.body);
    const line = this.lines.find((l) => l.n === a.lineno);
    if (!line) return checksumResult({ lineno: a.lineno, computed, exists: false });
    const c = checkLine(a.lineno, a.body, line.printed);
    const matches = c.status === "verified" || c.status === "digit-misread";
    const reading = c.status === "digit-misread" ? c.reading : undefined;
    return checksumResult({ lineno: a.lineno, computed, exists: true, printed: line.printed, status: c.status, matches, ...(reading === undefined ? {} : { reading }) });
  }

  /**
   * R6: the only verdict path. `runListing` re-types the canonical listing first (so what runs is exactly the gated
   * state), runs it, presses the title and post-title keys itself, and returns facts; `judge` turns them into the
   * contract. Order: clear provisional on a pass, judge, event, listing.json, state.json (R6.4).
   */
  private async runTool(a: RunArgs): Promise<ToolResult> {
    const { facts, screen } = await this.withEmu(() => {
      const f = runListing(this.core, this.plain(), this.spec, a.frames);
      return { facts: f, screen: readScreenText(this.core) };
    });
    if (facts.postTitle === "pass") for (const l of this.lines) l.provisional = false; // R3.8
    const res = judge(this.plain(), this.spec, facts, this.provisionalSet(), this.scope);
    this.postTitle = facts.postTitle;
    this.contract = this.toContractFile(res);
    const hash = this.hash();
    appendEvent(this.dir, {
      k: "emu", op: "run", error: facts.run.error, titleSeen: facts.titleSeen, frames: facts.run.frames,
      stoppedOn: facts.run.stoppedOn, postTitle: facts.postTitle, hash,
    });
    this.writeListing();
    this.writeState({ screen, error: facts.run.error, titleSeen: facts.titleSeen, postTitle: facts.postTitle });
    return runResult({
      hash, iteration: this.iteration, frames: facts.run.frames, stoppedOn: facts.run.stoppedOn, error: facts.run.error,
      titleSeen: facts.titleSeen, postTitle: facts.postTitle, heading: this.contract.heading, counts: this.contract.counts,
      failed: this.contract.failed, untypeable: facts.untypeable, screens: facts.screens,
    });
  }

  /**
   * R8: only the keys the listing's title screen allows, all or nothing. A press is never evidence: it writes
   * state.json and one event, and changes neither listing.json nor the contract.
   */
  private async press(a: PressArgs): Promise<ToolResult> {
    const codes = a.keys.map((k) => keyToPetscii(k) as number); // the schema guarantees non-null
    const allowed = new Set<number>(this.spec.titlePredicate.keys ?? []);
    if (codes.some((c) => !allowed.has(c))) {
      return fail(allowed.size === 0
        ? "no key may be pressed for this listing"
        : `key not allowed. Allowed keys: ${[...allowed].map(keyName).join(", ")}`);
    }
    const screen = await this.withEmu(() => pressKeys(this.core, codes, 100));
    const error = parseError(screen);
    const checkpoint = this.postTitle === "not-reached" ? "title" : "postTitle";
    const pass = checkpoint === "postTitle" ? screen.includes(this.spec.postTitle.screenContains) : undefined;
    appendEvent(this.dir, { k: "emu", op: "press", keys: a.keys, checkpoint, ...(pass === undefined ? {} : { pass }) });
    this.writeState({ screen, error, titleSeen: this.titleOnScreen(screen, error), postTitle: this.postTitle });
    return pressResult({ screen, error, keys: a.keys, checkpoint, ...(pass === undefined ? {} : { pass }) });
  }

  /**
   * R10: the gate behind the server. It judges again what the Pre Tool Use hook already judged and adds no rule of its
   * own. A refusal changes only `iteration`. An accepted or forced patch is persisted (listing.json) BEFORE it is typed,
   * so a crash while typing never loses it, and it resets the verdict until the next run (R3.7).
   */
  private async applyPatchTool(a: PatchArgs): Promise<ToolResult> {
    this.iteration++; // R10.2: well-formed calls only; a malformed call never reaches here
    appendEvent(this.dir, { k: "proposal", ops: a.ops, reason: a.reason, force_unverified: a.force_unverified });
    const counts = readRefusalCounts(this.dir); // R10.3: afresh, `{}` when absent or damaged
    const before = this.plain();
    const verdict = applyPatch(before, a.ops.map(toGateOp), this.spec.expectedLines, { force_unverified: a.force_unverified, refusalCounts: counts });
    const named: Record<number, number> = {}; // the counts the gate could have read: REPLAY feeds them back (R4.5)
    for (const op of a.ops) for (const n of op.op === "renumber" ? [op.lineno, op.new_lineno] : [op.lineno]) if (n in counts) named[n] = counts[n]!;

    if (verdict.verdict === "refused") {
      appendEvent(this.dir, { k: "gate", verdict: verdict.verdict, reason: verdict.reason, perOp: verdict.perOp, refusalCounts: named });
      this.writeListing(); // only `iteration` differs
      return fail(verdict.reason, { verdict: verdict.verdict, reason: verdict.reason, perOp: verdict.perOp, iteration: this.iteration });
    }

    // accepted | forced. `applyPatch` maps over its input, so entry i of the result is entry i of the input (R3.8).
    if (verdict.listing.length !== before.length) throw new Error("gate returned a listing of a different length");
    const next: ListingLine[] = verdict.listing.map((l, i) => ({ ...l, provisional: this.lines[i]!.provisional })).sort(byNumber);
    const hash = canonicalHash(next);
    appendEvent(this.dir, { k: "gate", verdict: verdict.verdict, reason: verdict.reason, perOp: verdict.perOp, refusalCounts: named, hash });
    this.lines = next;
    this.postTitle = "not-reached"; // R3.7
    this.contract = this.beforeRunContract(); // R3.5
    this.writeListing(); // R10.6: persisted before typing
    const untypeable = await this.withEmu(() => loadCanonical(this.core, this.plain()));
    appendEvent(this.dir, { k: "emu", op: "load", hash, untypeable });
    return patchResult({ verdict: verdict.verdict, reason: verdict.reason, perOp: verdict.perOp, hash, iteration: this.iteration, untypeable });
  }
}

/** First start: lines from `input.json`. Restart: lines, iteration, postTitle and contract from `listing.json` (R2.2, R2.3). */
export async function createTools(core: C64Core, runDir: string): Promise<C64Tools> {
  const head = readInput(runDir, "head"); // R2.3: listingId, scope, spec only
  let state: { lines: ListingLine[]; iteration: number; postTitle: "pass" | "fail" | "not-reached"; contract: ContractFile | null };
  if (listingExists(runDir)) {
    const f = readListing(runDir); // a corrupt file rejects: no fallback to input.json (R2.4)
    if (f.listingId !== head.listingId) throw new Error(`listing.json: listingId "${f.listingId}" differs from input.json listingId "${head.listingId}"`);
    state = { lines: f.lines, iteration: f.iteration, postTitle: f.postTitle, contract: f.contract };
  } else {
    const full = readInput(runDir, "full");
    const seen = new Set<number>();
    for (const l of full.lines) {
      if (seen.has(l.n)) throw new Error(`input.json: two lines are numbered ${l.n}`);
      seen.add(l.n);
    }
    for (const n of full.provisional) if (!seen.has(n)) throw new Error(`input.json: provisional ${n} is not the number of a line`);
    const prov = new Set(full.provisional);
    state = { lines: full.lines.map((l) => ({ ...l, provisional: prov.has(l.n) })), iteration: 0, postTitle: "not-reached", contract: null };
  }
  const scan = scanEvents(runDir); // R2.6
  const tools_ = new C64Tools(core, runDir, head, state, scan);
  if (scan.fatal) return tools_; // R2.5: already over: type nothing, write nothing
  tools_.startUp();
  return tools_;
}
