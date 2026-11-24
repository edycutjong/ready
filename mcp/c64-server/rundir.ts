/**
 * Everything the c64 server does to files lives here, and only here (R13.1): the only module of `mcp/c64-server/`
 * that imports `node:fs`, `node:path` and `node:crypto`. Every path is a constant joined to RUN_DIR; no tool
 * argument ever becomes part of a path. It reads `input.json` and `refusals.json` and never writes them (R13.4).
 */
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  InputFull, InputHead, ListingFile, RefusalCounts, issuesText,
  type InputFullT, type InputHeadT, type ListingFileT, type RefusalCountsT, type StateFileT,
} from "./schemas.ts";

/** The files this server may touch, as constants (R13.1). */
const FILES = { input: "input.json", listing: "listing.json", state: "state.json", events: "events.jsonl", refusals: "refusals.json" } as const;

/** R3.2: sha256 hex of `n body` lines sorted by n and joined with "\n". Ignores status, printed, source, provisional. */
export function canonicalHash(lines: readonly { n: number; body: string }[]): string {
  const text = [...lines].sort((a, b) => a.n - b.n).map((l) => `${l.n} ${l.body}`).join("\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/** R1.1: `RUN_DIR` as an absolute path, or `null` when it is unset, empty or not an existing directory. */
export function resolveRunDir(value: string | undefined): string | null {
  if (!value) return null;
  const abs = resolve(value);
  return isDirectory(abs) ? abs : null;
}

/** R3.3: full text to `<target>.tmp` in the same directory, then rename over the target. */
export function writeJsonAtomic(dir: string, name: "listing.json" | "state.json", value: unknown): void {
  const target = join(dir, name);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1) + "\n", "utf8");
  renameSync(tmp, target);
}

export function writeListing(dir: string, value: ListingFileT): void { writeJsonAtomic(dir, FILES.listing, value); }
export function writeState(dir: string, value: StateFileT): void { writeJsonAtomic(dir, FILES.state, value); }

export type ServerEventBody = { k: string; [key: string]: unknown };

/**
 * R4.3: append one `{ t, k, ... }` line, synchronously. Never truncates or rewrites. A hook that crashed mid-line may
 * have left a file with no final newline; the new event then starts on its own line instead of fusing with the torn one.
 */
export function appendEvent(dir: string, event: ServerEventBody): void {
  const file = join(dir, FILES.events);
  const { t: _ignored, ...rest } = event;
  const line = JSON.stringify({ t: new Date().toISOString(), ...rest }) + "\n";
  appendFileSync(file, endsWithNewlineOrEmpty(file) ? line : "\n" + line, "utf8");
}

function endsWithNewlineOrEmpty(file: string): boolean {
  let fd: number | undefined;
  try {
    const size = statSync(file).size;
    if (size === 0) return true;
    fd = openSync(file, "r");
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] === 0x0a;
  } catch {
    return true; // no file yet
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export type EventScan = {
  /** `why` of the last fatal `{k:"error"}` event, or null (R2.6) */
  fatal: string | null;
  /** number of `{k:"emu", op:"restart", cause:"crash"}` events (R2.6) */
  crashes: number;
};

const FATAL_WHY = new Set(["3 malformed calls", "emulator crashed twice"]);

/** R2.6: one pass over events.jsonl, skipping every line that is not a JSON object. */
export function scanEvents(dir: string): EventScan {
  const out: EventScan = { fatal: null, crashes: 0 };
  const file = join(dir, FILES.events);
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw) continue;
    let e: unknown;
    try { e = JSON.parse(raw); } catch { continue; }
    if (typeof e !== "object" || e === null) continue;
    const ev = e as { k?: unknown; why?: unknown; op?: unknown; cause?: unknown };
    if (ev.k === "error" && typeof ev.why === "string" && FATAL_WHY.has(ev.why)) out.fatal = ev.why;
    else if (ev.k === "emu" && ev.op === "restart" && ev.cause === "crash") out.crashes++;
  }
  return out;
}

/**
 * R10.3: `refusals.json` as `{ lineno: count }`. Absent → `{}`. Unreadable, not a JSON object, a key that is not a
 * non-negative decimal integer, or a value that is not a non-negative integer → the WHOLE file counts as `{}`
 * (fail closed: a damaged file can never unlock `force_unverified`). Read afresh on every call.
 */
export function readRefusalCounts(dir: string): RefusalCountsT {
  const file = join(dir, FILES.refusals);
  let parsed: unknown;
  try {
    if (!existsSync(file)) return {};
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  const r = RefusalCounts.safeParse(parsed);
  if (!r.success) return {};
  const out: RefusalCountsT = {};
  for (const [k, v] of Object.entries(r.data)) {
    const n = Number(k);
    out[n] = n in out ? Math.min(out[n]!, v) : v; // "07" and "7" both name line 7: the smaller count can only refuse more
  }
  return out;
}

function readJson(dir: string, name: string): unknown {
  let text: string;
  try { text = readFileSync(join(dir, name), "utf8"); } catch (e) { throw new Error(`${name}: cannot read (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`); }
  try { return JSON.parse(text); } catch (e) { throw new Error(`${name}: invalid JSON (${(e as Error).message})`); }
}

/** R2.1, R2.4: `input.json`, either all of it (`full`, first start) or only listingId, scope and spec (`head`). */
export function readInput(dir: string, mode: "head"): InputHeadT;
export function readInput(dir: string, mode: "full"): InputFullT;
export function readInput(dir: string, mode: "head" | "full"): InputHeadT | InputFullT {
  const r = (mode === "full" ? InputFull : InputHead).safeParse(readJson(dir, FILES.input));
  if (!r.success) throw new Error(`input.json: ${issuesText(r.error).replaceAll("\n", "; ")}`);
  return r.data;
}

export function listingExists(dir: string): boolean { return existsSync(join(dir, FILES.listing)); }

/** R2.3, R2.4: `listing.json` validated against the schema of R3.1. Throws when it is unreadable, invalid or malformed. */
export function readListing(dir: string): ListingFileT {
  const r = ListingFile.safeParse(readJson(dir, FILES.listing));
  if (!r.success) throw new Error(`listing.json: ${issuesText(r.error).replaceAll("\n", "; ")}`);
  return r.data;
}
