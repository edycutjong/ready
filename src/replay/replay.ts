/**
 * REPLAY (agents.md §6, spec "judge path"): re-execute a RECORDED real Kiro run. The recorded events carry the run's
 * exact OCR input (`start.input`) and every fix attempt (`hook` refusals from the Pre Tool Use gate, `proposal` +
 * `gate` from the MCP server, `emu run` from the C64). Replay re-judges every attempt with the SAME gate code
 * (`applyPatch`), re-runs the program on a C64 core after every accepted patch, and recomputes the contract — so a
 * judge sees the gate and the machine decide again, not a video of them. Every recomputed verdict is compared with
 * the recorded one; any disagreement is reported, never smoothed over. Isomorphic (browser + Node), no I/O.
 *
 * Without a core (no ROM rights on the public URL) only the gate is re-executed; the screens shown are the recorded
 * ones, and the UI labels that mode RECORDED PLAYBACK.
 */
import { applyPatch, type GateVerdict, type PatchOp } from "../gate/checksum-gate.ts";
import type { ContractResult } from "../gate/contract.ts";
import type { CanonicalListing, CanonicalLine } from "../basic/types.ts";
import type { C64Core } from "../emu/core.ts";
import { judge, runListing, type ListingSpec, type MachineFacts } from "../emu/session.ts";

export type RunEvent = { k: string; t?: string; [key: string]: unknown };
export type RunInput = { listingId: string; scope: string; spec: ListingSpec; lines: (CanonicalLine & { provisional?: boolean })[]; provisional?: number[] };
type OpIn = { op?: string; type?: string; lineno: number; new_body?: string; new_lineno?: number };

export type ReplayStep =
  | { kind: "attempt"; source: "hook" | "server"; ops: OpIn[]; reason: string; force: boolean; recorded: string; recomputed: GateVerdict; match: boolean; listingAfter: CanonicalListing }
  | { kind: "run"; recorded: { error: unknown; titleSeen: boolean; postTitle?: string }; facts: MachineFacts | null; match: boolean | null; listing: CanonicalListing };

export type ReplayResult = {
  input: RunInput;
  steps: ReplayStep[];
  final: CanonicalListing;
  contract: ContractResult | null; // recomputed (needs a core); null in recorded playback
  recordedEnd: RunEvent | null;
  mismatches: string[];
};

export function toGateOp(o: OpIn): PatchOp {
  const t = o.op ?? o.type;
  if (t === "renumber") return { type: "renumber", lineno: Number(o.lineno), new_lineno: Number(o.new_lineno) };
  if (t === "replace") return { type: "replace", lineno: Number(o.lineno), new_body: String(o.new_body ?? "") };
  return { type: String(t) as "replace", lineno: Number(o.lineno), new_body: "" }; // unknown op: the gate refuses it (R4.6)
}

/**
 * Lines a refusal is charged to (the Pre Tool Use hook's rule, agents.md §4 "Forced lines"): only lines the gate
 * refused on their CHECKSUM (perOp entries with ok false). A deletion, a 40% rewrite or an out-of-inventory renumber
 * charges nothing, so it can never unlock `force_unverified` (QA P1b r1).
 */
export function refusedLines(v: GateVerdict, _patch: readonly PatchOp[]): number[] {
  return [...new Set((v.perOp ?? []).filter((p) => !p.ok).map((p) => p.line))];
}

const plain = (l: CanonicalListing): CanonicalListing => l.map(({ n, body, printed, status, source }) => ({ n, body, printed, status, source }));

/** The attempts and runs of a recorded run, in order. Server-side events only (no model text is trusted). */
/**
 * The frame budget a recorded `c64_run` used, so REPLAY re-executes the same experiment (a2a arch-01). Events
 * since arch-01 carry `maxFrames`. Older ones carry only the elapsed `frames` and `stoppedOn`: a run that stopped on
 * an error or the title stops at the same frame under any budget at least that long, and one that ran out of budget
 * used exactly its elapsed frames (runProgram steps in whole checks, so the count is reproduced exactly).
 */
export function replayBudget(e: RunEvent): number {
  // the c64_run schema's own range (1..20000): a corrupt recording can never ask this tab for an unbounded run
  if (Number.isInteger(e.maxFrames) && (e.maxFrames as number) >= 1 && (e.maxFrames as number) <= 20000) return e.maxFrames as number;
  const elapsed = Number.isInteger(e.frames) && (e.frames as number) > 0 ? Math.min(e.frames as number, 20000) : 0;
  // Legacy edge: runListing reports "error" when the title-key press after an out-of-budget run raised one; a budget
  // under 3000 is then replayed as 3000, and any difference shows as a REPLAY mismatch, never as a silent verdict.
  return e.stoppedOn === "frames" && elapsed > 0 ? elapsed : Math.max(3000, elapsed);
}

export function attemptsOf(events: readonly RunEvent[]): RunEvent[] {
  return events.filter((e) => (e.k === "hook" && e.hook === "checksum-gate" && e.via === "kiro-pre-tool-use" && e.exit === 2)
    || e.k === "proposal" || e.k === "gate" || (e.k === "emu" && e.op === "run"));
}

/**
 * Spec F9: REPLAY refuses re-execution on a different emulator — a different c64-ready version (core id) or different
 * WASM bytes (sha256, when both sides know it). Refused = the gate still re-judges every attempt, but no C64 re-runs
 * anything (recorded playback), and the refusal is reported as a mismatch.
 */
export function emulatorRefusal(start: RunEvent | undefined, core: C64Core | null, wasmSha256?: string): string | null {
  if (!core) return null;
  const rec = start?.emulator as { id?: string; wasmSha256?: string } | undefined;
  if (rec?.id && core.id !== rec.id) return `REPLAY refused: recorded on ${rec.id}, this browser has ${core.id}`;
  if (rec?.wasmSha256 && wasmSha256 && rec.wasmSha256 !== wasmSha256) return `REPLAY refused: recorded on WASM sha256 ${rec.wasmSha256.slice(0, 12)}…, this browser has ${wasmSha256.slice(0, 12)}…`;
  return null;
}

export function replay(events: readonly RunEvent[], coreIn: C64Core | null, opts: { wasmSha256?: string } = {}): ReplayResult & { refused: string | null } {
  const start = events.find((e) => e.k === "start");
  const input = start?.input as RunInput | undefined;
  if (!input) throw new Error("recorded run has no start.input: it cannot be replayed (agents.md §6)");
  const expected = input.spec.expectedLines;
  const emuMismatch = emulatorRefusal(start, coreIn, opts.wasmSha256);
  const core = emuMismatch ? null : coreIn;
  let listing: CanonicalListing = plain(input.lines);
  const provisional = new Set<number>(input.provisional ?? input.lines.filter((l) => l.provisional).map((l) => l.n));
  const counts: Record<number, number> = {};
  const steps: ReplayStep[] = [];
  const mismatches: string[] = [];
  if (emuMismatch) mismatches.push(emuMismatch);
  let lastFacts: MachineFacts | null = null;
  let pendingProposal: RunEvent | null = null;

  for (const e of attemptsOf(events)) {
    if (e.k === "hook") {
      const ops = (e.ops as OpIn[] | null) ?? [];
      const patch = ops.map(toGateOp);
      const v = applyPatch(listing, patch, expected, { force_unverified: Boolean(e.force_unverified), refusalCounts: counts });
      if (v.verdict === "refused") for (const n of refusedLines(v, patch)) counts[n] = (counts[n] ?? 0) + 1;
      const match = v.verdict === "refused";
      if (!match) mismatches.push(`hook refusal at ${e.t ?? "?"} re-judged ${v.verdict}`);
      steps.push({ kind: "attempt", source: "hook", ops, reason: String(e.stderr ?? ""), force: Boolean(e.force_unverified), recorded: "refused", recomputed: v, match, listingAfter: listing });
    } else if (e.k === "proposal") {
      pendingProposal = e;
    } else if (e.k === "gate") {
      const ops = ((pendingProposal?.ops as OpIn[] | undefined) ?? []);
      const patch = ops.map(toGateOp);
      const force = Boolean(pendingProposal?.force_unverified);
      const v = applyPatch(listing, patch, expected, { force_unverified: force, refusalCounts: counts });
      const match = v.verdict === e.verdict;
      if (!match) mismatches.push(`gate at ${e.t ?? "?"}: recorded ${String(e.verdict)}, re-judged ${v.verdict}`);
      if (v.verdict !== "refused") listing = plain(v.listing);
      steps.push({ kind: "attempt", source: "server", ops, reason: String(pendingProposal?.reason ?? ""), force, recorded: String(e.verdict), recomputed: v, match, listingAfter: listing });
      pendingProposal = null;
    } else if (e.k === "emu" && e.op === "run") {
      const recorded = { error: e.error ?? null, titleSeen: Boolean(e.titleSeen), postTitle: e.postTitle as string | undefined };
      let facts: MachineFacts | null = null;
      let match: boolean | null = null;
      if (core) {
        facts = runListing(core, listing, input.spec, replayBudget(e));
        lastFacts = facts;
        if (facts.postTitle === "pass") provisional.clear();
        match = facts.titleSeen === recorded.titleSeen && JSON.stringify(facts.run.error) === JSON.stringify(recorded.error)
          && (recorded.postTitle === undefined || facts.postTitle === recorded.postTitle);
        if (!match) mismatches.push(`run at ${e.t ?? "?"}: recorded ${JSON.stringify(recorded)}, re-run ${JSON.stringify({ error: facts.run.error, titleSeen: facts.titleSeen, postTitle: facts.postTitle })}`);
      }
      steps.push({ kind: "run", recorded, facts, match, listing });
    }
  }
  const contract = core && lastFacts ? judge(listing, input.spec, lastFacts, provisional, input.scope) : null;
  const recordedEnd = [...events].reverse().find((e) => e.k === "end") ?? null;
  if (contract && recordedEnd && typeof recordedEnd.result === "string" && recordedEnd.result.toUpperCase() !== contract.verdict) {
    mismatches.push(`contract: recorded ${recordedEnd.result}, recomputed ${contract.verdict}`);
  }
  return { input, steps, final: listing, contract, recordedEnd, mismatches, refused: emuMismatch };
}

/**
 * Cheat (agents.md §4 "Guaranteed refusal input"): empty the current error line — or, when the error has no line
 * number, the first ✗ line — through the SAME gate code the Kiro hook runs. Always refused (hard refusal R4.4).
 */
export function cheat(listing: CanonicalListing, expectedLines: readonly number[], errorLine: number | null): { line: number; verdict: GateVerdict } {
  const bad = listing.find((l) => l.status !== "verified" && l.status !== "digit-misread" && l.status !== "eye-verified");
  const line = errorLine ?? bad?.n ?? listing[0]?.n ?? 0;
  return { line, verdict: applyPatch(listing, [{ type: "replace", lineno: line, new_body: "" }], expectedLines) };
}
