/**
 * Shared fixture of the c64 MCP server tests (.kiro/specs/c64-mcp-server, design.md "Test design").
 * NIGHTJAR is an original 2026 four-line BASIC program written for this repository; every printed checksum is
 * computed here by `computeChecksum`. No magazine text is committed (R14.4).
 *
 *   10 PRINT"{CLR}NIGHTJAR"        title screen
 *   20 GETA$:IFA$=""THEN20         waits for a key (the title predicate's key is SPACE)
 *   30 PRINT"LAUNCHED"             what the post-title key must produce
 *   40 END
 */
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeChecksum } from "../../src/basic/checksum.ts";
import type { CanonicalLine } from "../../src/basic/types.ts";
import type { C64Core } from "../../src/emu/core.ts";
import type { ListingSpec } from "../../src/emu/session.ts";
import { checkLine } from "../../src/gate/checksum-gate.ts";

export const NIGHTJAR_BODIES: Readonly<Record<number, string>> = Object.freeze({
  10: 'PRINT"{CLR}NIGHTJAR"',
  20: 'GETA$:IFA$=""THEN20',
  30: 'PRINT"LAUNCHED"',
  40: "END",
});

export const spec: ListingSpec = {
  expectedLines: [10, 20, 30, 40],
  titlePredicate: { screenContains: "NIGHTJAR", keys: [32] },
  postTitle: { keys: [32], screenContains: "LAUNCHED" },
};

/**
 * A canonical line whose printed checksum is that of `printedFor` (default: the body itself). The status is the one
 * `scripts/make-run-input.mjs` assigns: verified / digit-misread from `checkLine`, a mismatch starts `unverified`.
 */
export function line(n: number, body: string, printedFor: string = body, source = "ocr"): CanonicalLine {
  const printed = computeChecksum(n, printedFor);
  const c = checkLine(n, body, printed);
  return { n, body, printed, status: c.status === "mismatch" ? "unverified" : c.status, source };
}

/** The four correct lines, all `verified`. */
export function nightjarLines(): CanonicalLine[] {
  return [10, 20, 30, 40].map((n) => line(n, NIGHTJAR_BODIES[n]!));
}

/** Line 20 as OCR misread it (`=` lost): the C64 answers `?SYNTAX  ERROR IN 20`; its printed checksum is the true line's. */
export const BROKEN_BODY_20 = 'GETA$:IFA$""THEN20';
export function brokenLines(): CanonicalLine[] {
  return nightjarLines().map((l) => (l.n === 20 ? line(20, BROKEN_BODY_20, NIGHTJAR_BODIES[20]) : l));
}

/** Line 40 holds a control code outside quotes, which the C64 editor would execute: `loadCanonical` never types it. */
export const UNTYPEABLE_BODY_40 = "{CLR}END";
export function untypeableLines(): CanonicalLine[] {
  return nightjarLines().map((l) => (l.n === 40 ? line(40, UNTYPEABLE_BODY_40) : l));
}

/**
 * Line 40 is `END` but the page printed the checksum of `1END`: patching it to `1END` is accepted by the gate and
 * leaves a digit-leading body the C64 would merge into the line number, so the patch result must report it untypeable.
 */
export const PATCH_TO_UNTYPEABLE = "1END";
export function patchableToUntypeableLines(): CanonicalLine[] {
  return nightjarLines().map((l) => (l.n === 40 ? line(40, "END", PATCH_TO_UNTYPEABLE) : l));
}

/** Line 30 whose printed checksum matches neither its body nor the one-character edit `BAD_PATCH_30` (gate refusal, then force). */
export const BAD_PATCH_30 = 'PRINT"LAUNCHED."';
export function badChecksumLines(): CanonicalLine[] {
  const body = NIGHTJAR_BODIES[30]!;
  let printed = 0;
  for (let p = (computeChecksum(30, body) + 40) % 256, i = 0; i < 256; i++, p = (p + 1) % 256) {
    if (checkLine(30, body, p).status === "mismatch" && checkLine(30, BAD_PATCH_30, p).status === "mismatch") { printed = p; break; }
  }
  return nightjarLines().map((l) => (l.n === 30 ? { ...l, printed, status: "unverified" as const } : l));
}

/** Line 20 broken and provisional (a recovered line), plus the matching input. */
export function provisionalLines(): CanonicalLine[] {
  return nightjarLines().map((l) => (l.n === 20 ? { ...l, source: "typed" } : l));
}

// ---------------------------------------------------------------------------------------------------------------
// RUN_DIR
// ---------------------------------------------------------------------------------------------------------------

export type InputOverrides = {
  listingId?: string;
  scope?: string;
  spec?: ListingSpec;
  lines?: CanonicalLine[];
  provisional?: number[];
  /** replaces the whole input.json text (for malformed-input tests) */
  raw?: string;
  /** use an existing directory instead of a fresh `mkdtemp` one */
  dir?: string;
};

export type Run = {
  dir: string;
  file(name: string): string;
  has(name: string): boolean;
  text(name: string): string;
  json<T = any>(name: string): T;
  /** parsed lines of events.jsonl (bad lines skipped) */
  events(): any[];
  /** names of the files in the directory, sorted */
  files(): string[];
  write(name: string, text: string): void;
  cleanup(): void;
};

/** A fresh temporary RUN_DIR holding `input.json`. The test calls `cleanup()` in `afterEach`. */
export function makeRun(over: InputOverrides = {}): Run {
  const dir = over.dir ?? mkdtempSync(join(tmpdir(), "ready-mcp-"));
  const input = {
    listingId: over.listingId ?? "nightjar",
    scope: over.scope ?? "title-path",
    spec: over.spec ?? spec,
    lines: over.lines ?? nightjarLines(),
    provisional: over.provisional ?? [],
  };
  writeFileSync(join(dir, "input.json"), over.raw ?? JSON.stringify(input, null, 1) + "\n");
  const file = (name: string) => join(dir, name);
  return {
    dir,
    file,
    has: (name) => existsSync(file(name)),
    text: (name) => readFileSync(file(name), "utf8"),
    json: (name) => JSON.parse(readFileSync(file(name), "utf8")),
    events: () => (existsSync(file("events.jsonl")) ? readFileSync(file("events.jsonl"), "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []),
    files: () => readdirSync(dir).sort(),
    write: (name, text) => writeFileSync(file(name), text),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Cores
// ---------------------------------------------------------------------------------------------------------------

/**
 * A `C64Core` that only accepts typed keys: `step` drains the queue, `peek` returns 0. Enough for every tool except a
 * run (a run on it would never see a screen). `keysLog` holds every key ever queued; `booted` counts `boot()` calls.
 */
export class StubCore implements C64Core {
  readonly id = "stub";
  queue: number[] = [];
  keysLog: number[] = [];
  booted = 0;
  steps = 0;
  async boot(): Promise<void> { this.booted++; this.queue = []; }
  step(frames: number): void { this.steps += frames; this.queue = []; }
  queueKeys(codes: readonly number[]): void { this.queue.push(...codes); this.keysLog.push(...codes); }
  pendingKeys(): number { return this.queue.length; }
  resets = 0;
  reset(): void { this.resets++; this.queue = []; }
  peek(_addr: number): number { return 0; }
}

/** A real core wrapped so the test can make it throw a plain `Error` on chosen `step` calls (an emulator crash). */
export class ThrowingCore implements C64Core {
  readonly id: string;
  /** every `step` call so far, never reset */
  stepCalls = 0;
  bootCalls = 0;
  /** `step` call numbers (1-based, cumulative) that throw */
  failOn = new Set<number>();
  failBoot = false;
  private readonly real: C64Core;
  constructor(real: C64Core, opts: { onStep?: number | number[] } = {}) {
    this.real = real;
    this.id = real.id;
    for (const n of opts.onStep === undefined ? [] : [opts.onStep].flat()) this.failOn.add(n);
  }
  /** make the k-th `step` call from now throw */
  failAfter(k: number): void { this.failOn.add(this.stepCalls + k); }
  async boot(): Promise<void> {
    this.bootCalls++;
    if (this.failBoot) throw new Error("boot failed (test)");
    await this.real.boot();
  }
  step(frames: number): void {
    this.stepCalls++;
    if (this.failOn.has(this.stepCalls)) throw new Error(`emulator crash on step ${this.stepCalls} (test)`);
    this.real.step(frames);
  }
  queueKeys(codes: readonly number[]): void { this.real.queueKeys(codes); }
  pendingKeys(): number { return this.real.pendingKeys(); }
  reset(): void { this.real.reset(); }
  peek(addr: number): number { return this.real.peek(addr); }
}

export function throwingCore(real: C64Core, opts: { onStep?: number | number[] } = {}): ThrowingCore {
  return new ThrowingCore(real, opts);
}
