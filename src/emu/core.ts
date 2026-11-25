/**
 * Headless C64 core slice (isomorphic: Node for the MCP server / recorder / tests, browser for the desk).
 *
 * `C64Core` is the only surface the rest of the app sees, so the emulator can be swapped
 * (licence decision, spike E) without touching the gate, the contract or the UI.
 * Everything here is mechanical: type bytes into the KERNAL keyboard buffer, step frames,
 * read screen RAM, dump BASIC memory. No judgement lives in this file.
 */

/** The minimal machine the app needs. */
export interface C64Core {
  readonly id: string; // e.g. "c64-ready@3.4.0"
  /** Power-cycle to a fresh `READY.` prompt. */
  boot(): Promise<void>;
  /** Hardware reset to a fresh `READY.` prompt, synchronously (the loaded emulator is kept; queued keys are dropped). */
  reset(): void;
  /** Advance the machine by `frames` 20 ms ticks, feeding queued keys into the KERNAL buffer. */
  step(frames: number): void;
  /** Queue PETSCII key codes for the KERNAL keyboard buffer ($0277, count at $C6). */
  queueKeys(codes: readonly number[]): void;
  /** Keys still waiting to be fed. */
  pendingKeys(): number;
  /** Read a byte as the CPU sees it (no side effects). */
  peek(addr: number): number;
}

export const SCREEN_RAM = 0x0400;
export const BASIC_START = 0x0801;
const KEYBUF = 0x0277;
const KEYBUF_COUNT = 0xc6;
const VARTAB = 0x2d; // pointer to end of BASIC program + 1 (start of variables)

/** Screen code (upper-case/graphics set) → printable ASCII; reverse-video bit dropped. */
export function screenCodeToChar(code: number): string {
  const c = code & 0x7f;
  if (c === 0) return "@";
  if (c <= 26) return String.fromCharCode(64 + c);
  if (c === 27) return "[";
  if (c === 28) return "£"; // pound
  if (c === 29) return "]";
  if (c === 30) return "^";
  if (c === 31) return "←"; // left arrow
  if (c < 64) return String.fromCharCode(c);
  return " "; // graphics glyphs: not needed for diagnosis
}

/** 40×25 screen as text, trailing spaces trimmed per row. */
export function readScreenText(core: C64Core): string {
  return decodeScreen(readScreenRam(core));
}

function readScreenRam(core: C64Core): Uint8Array {
  const raw = new Uint8Array(1000);
  for (let i = 0; i < 1000; i++) raw[i] = core.peek(SCREEN_RAM + i);
  return raw;
}

function decodeScreen(raw: Uint8Array): string {
  const rows: string[] = [];
  for (let r = 0; r < 25; r++) {
    let row = "";
    for (let c = 0; c < 40; c++) row += screenCodeToChar(raw[r * 40 + c]);
    rows.push(row.trimEnd());
  }
  return rows.join("\n");
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type C64Error = { kind: string; line: number | null };

/**
 * Last BASIC error on screen. Real C64 prints a double space: `?SYNTAX  ERROR IN 20`.
 * Only text after the last `RUN` is considered when `afterRun` is set.
 */
export function parseError(screen: string, afterRun = true): C64Error | null {
  const s = afterRun ? afterLastRun(screen) : screen;
  const all = [...s.matchAll(/\?([A-Z' ]+?)\s+ERROR(?: IN (\d+))?/g)];
  const m = all.at(-1);
  if (!m) return null;
  return { kind: m[1].replace(/\s+/g, " ").trim(), line: m[2] ? Number(m[2]) : null };
}

/** Feed `codes` and step until the buffer is drained and BASIC has had time to process it. */
export function typeAndSettle(core: C64Core, codes: readonly number[], settleFrames = 20, maxFrames = 200_000): number {
  core.queueKeys(codes);
  let frames = 0;
  while (core.pendingKeys() > 0 && frames < maxFrames) {
    core.step(10);
    frames += 10;
  }
  core.step(settleFrames);
  return frames + settleFrames;
}

const RETURN = 13;

/** PETSCII bytes for plain ASCII text (A–Z, digits, punctuation). Lower-case is folded to upper. */
export function asciiToPetscii(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    if (ch === "\n") { out.push(RETURN); continue; }
    const u = ch.toUpperCase().charCodeAt(0);
    if (u >= 32 && u <= 95) out.push(u);
  }
  return out;
}

/**
 * `NEW`, then type every line (already PETSCII, line number included, no RETURN) followed by RETURN.
 * This is the one path a listing reaches the machine: `c64_reload` and an accepted `apply_patch` both use it.
 */
/**
 * A program is still running when BASIC is in program mode (MSGFLG $9D = $00; $80 in direct mode) and the screen does
 * not end at `READY.` (a defensive second check). Measured on c64-ready@3.4.0: READY $80; GET wait $00; INPUT wait $00;
 * after END $80; after an error $80 (arch review 01).
 */
export function programRunning(core: C64Core): boolean {
  if (core.peek(0x9d) !== 0) return false;
  const rows = readScreenText(core).split("\n").map((r) => r.trim()).filter(Boolean);
  return rows.at(-1) !== "READY.";
}

/**
 * NEW + type every line. If a program is still running (a GET or INPUT wait after a run), the typed keys would go to
 * the program instead of the screen editor, so the machine is reset to READY. first. Without this a load right after
 * a run that left the title's GET loop waiting depended on history: REPLAY of a recorded run typed once into the loop
 * and stored the wrong program, where the live session had happened to type twice (arch review 01).
 */
export function loadProgram(core: C64Core, lines: readonly (readonly number[])[]): number {
  if (programRunning(core)) core.reset();
  let frames = typeAndSettle(core, [...asciiToPetscii("NEW"), RETURN]);
  for (const l of lines) frames += typeAndSettle(core, [...l, RETURN], 2);
  return frames;
}

/** A BASIC error, not program output: the text matches AND the machine is no longer running a program. */
export function realError(core: C64Core, screen: string): C64Error | null {
  const err = parseError(screen);
  return err && !programRunning(core) ? err : null;
}

/**
 * `latched` is set only when `opts.latch` held on some frame between two checks and the title is no longer on screen at the
 * check: the screen as it was on the first frame the latch held. Absent otherwise (recorded runs never carry it).
 */
export type RunResult = { screen: string; error: C64Error | null; frames: number; stoppedOn: "error" | "predicate" | "frames"; latched?: string };

/**
 * Type `RUN` and step until an error appears, `until(screen)` holds, or `maxFrames` pass.
 * Checks every `checkEvery` frames. With `latch`, the machine is stepped one frame at a time and `latch(screenAfterRun)`
 * is evaluated on every frame whose screen RAM changed (never while keys are pending); the first frame it holds is kept,
 * so a title shown for fewer than `checkEvery` frames is still seen. The run still stops at a check, not on that frame.
 */
const CLR_HOME = 147;

export function runProgram(core: C64Core, opts: { maxFrames?: number; until?: (screen: string) => boolean; checkEvery?: number; latch?: (screenAfterRun: string) => boolean } = {}): RunResult {
  const maxFrames = opts.maxFrames ?? 6000;
  const every = opts.checkEvery ?? 50;
  const latch = opts.latch;
  // CLR/HOME (PETSCII 147) typed in direct mode clears the screen before RUN (bugfix-boot-detect, P6b, claude-direct): on a
  // reused core the rows below the new RUN echo still held the previous run's output, and the per-frame latch caught that
  // stale title in the first frames after RUN (then its stale post-title text failed clause 2). Only this run's own
  // output is ever on screen below the RUN row now; the typed listing is gone from the screen, which nothing reads.
  core.queueKeys([CLR_HOME, ...asciiToPetscii("RUN"), RETURN]);
  let frames = 0;
  let screen = "";
  let latched: string | undefined;
  let prev: Uint8Array | null = null;
  while (frames < maxFrames) {
    if (latch) {
      for (let i = 0; i < every; i++) {
        core.step(1);
        if (latched !== undefined || core.pendingKeys() > 0) continue;
        const raw = readScreenRam(core);
        if (prev && sameBytes(raw, prev)) continue;
        prev = raw;
        const text = decodeScreen(raw);
        if (latch(afterLastRun(text))) latched = text;
      }
    } else core.step(every);
    frames += every;
    screen = readScreenText(core);
    if (core.pendingKeys() > 0) continue;
    const err = realError(core, screen);
    if (err) return { screen, error: err, frames, stoppedOn: "error" };
    if (opts.until && opts.until(afterLastRun(screen))) return { screen, error: null, frames, stoppedOn: "predicate" };
    if (latched !== undefined) return { screen, error: null, frames, stoppedOn: "predicate", latched };
  }
  // Budget spent while keys are still queued: RUN was never typed, so no error on screen can be this run's (the typed
  // listing itself may hold error-shaped text — bugfix-boot-detect C3 f1, P6b claude-direct).
  return { screen, error: core.pendingKeys() > 0 ? null : realError(core, screen), frames, stoppedOn: "frames" };
}

/** Press keys (PETSCII) while a program waits in GET, then step `frames`. */
export function pressKeys(core: C64Core, codes: readonly number[], frames = 100): string {
  core.queueKeys(codes);
  let f = 0;
  while (core.pendingKeys() > 0 && f < 10_000) { core.step(5); f += 5; }
  core.step(frames);
  return readScreenText(core);
}

/**
 * Screen text after the echoed `RUN` command: the last ROW that is exactly "RUN" (P1a QA r2: a bare lastIndexOf
 * matched "RUN" inside program output such as "RUNNING", hiding earlier text). If the program cleared the screen
 * the echo is gone and the whole screen is program output.
 */
export function afterLastRun(screen: string): string {
  const rows = screen.split("\n");
  for (let r = rows.length - 1; r >= 0; r--) if (rows[r].trim() === "RUN") return rows.slice(r + 1).join("\n");
  return screen;
}

/** The tokenized program resident in BASIC memory: bytes $0801 .. VARTAB-1 (contract clause 6). */
export function dumpBasic(core: C64Core): Uint8Array {
  const end = core.peek(VARTAB) | (core.peek(VARTAB + 1) << 8);
  const len = Math.max(0, Math.min(end - BASIC_START, 0x9fff - BASIC_START));
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = core.peek(BASIC_START + i);
  return out;
}

// ---------------------------------------------------------------------------
// c64-ready implementation (MIT npm package; its WASM embeds Commodore ROMs — see README licence note).
// The WASM is never committed: Node reads it from node_modules, the browser loads it only when the
// rights line is signed (until then the site is RECORDED PLAYBACK).
// ---------------------------------------------------------------------------

type C64EmulatorLike = {
  start(): void;
  reset(): void;
  tick(dTime?: number): void;
  cpuReadNS(addr: number): number;
  cpuWrite(addr: number, v: number): void;
};

export const C64_READY_VERSION = "3.4.0";

/**
 * `wasm` is a URL (browser) or the raw bytes (Node). Bytes are passed as a `data:` URL because
 * c64-ready's loader uses `fetch`, and Node's fetch does not read `file:` URLs.
 */
export function createC64ReadyCore(wasm: string | Uint8Array): C64Core {
  let emu: C64EmulatorLike | null = null;
  const queue: number[] = [];
  const url = typeof wasm === "string" ? wasm : `data:application/wasm;base64,${toBase64(wasm)}`;
  const need = (): C64EmulatorLike => {
    if (!emu) throw new Error("C64Core: boot() first");
    return emu;
  };
  return {
    id: `c64-ready@${C64_READY_VERSION}`,
    async boot() {
      const mod = (await import("c64-ready/emulator")) as unknown as { C64Emulator: { load(u: string): Promise<C64EmulatorLike> } };
      emu = await mod.C64Emulator.load(url);
      emu.start();
      queue.length = 0;
      for (let i = 0; i < 200; i++) emu.tick(20); // power-on to READY.
    },
    step(frames: number) {
      const e = need();
      for (let i = 0; i < frames; i++) {
        if (queue.length && e.cpuReadNS(KEYBUF_COUNT) === 0) {
          const chunk = queue.splice(0, 10);
          chunk.forEach((v, j) => e.cpuWrite(KEYBUF + j, v));
          e.cpuWrite(KEYBUF_COUNT, chunk.length);
        }
        e.tick(20);
      }
    },
    reset() {
      const e = need();
      e.reset();
      queue.length = 0;
      for (let i = 0; i < 200; i++) e.tick(20); // reset to READY. (same settle as boot)
    },
    queueKeys(codes) { queue.push(...codes); },
    pendingKeys() { return queue.length + (emu ? emu.cpuReadNS(KEYBUF_COUNT) : 0); },
    peek(addr) { return need().cpuReadNS(addr & 0xffff); },
  };
}

function toBase64(bytes: Uint8Array): string {
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
