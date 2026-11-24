#!/usr/bin/env node
/**
 * Kiro Pre Tool Use hook on `@c64/apply_patch` (agents.md §4). Runs the SAME gate code as the MCP server and the
 * browser (`src/gate/checksum-gate.ts`) on the agent's proposed ops BEFORE the call reaches the server.
 *   refused → exit 2, STDERR = the gate's reason (kiro-cli returns it to the model; the server never sees the call)
 *   allowed → exit 0
 * Other exit codes never block (hooks__types.md); if this script crashes, the server's own gate still judges.
 * The hook OWNS the per-line refusal counts ($RUN_DIR/refusals.json): refused calls never reach the server, so only
 * the hook can count them, and `force_unverified` is allowed by the gate only at ≥ 2 refusals on that line.
 * Every firing appends one event to $RUN_DIR/events.jsonl (merged into the recorded run, shown on /kiro).
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPatch } from "../../src/gate/checksum-gate.ts";
import { refusedLines, toGateOp } from "../../src/replay/replay.ts"; // one rule for charging refusals: hook and REPLAY

const runDir = process.env.RUN_DIR;
let event = {};
try { event = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no stdin */ }

// matcher is @c64/apply_patch; stay inert for anything else (defensive: a broader matcher must not block)
if (!runDir || !/apply_patch$/.test(String(event.tool_name ?? ""))) process.exit(0);

const input = event.tool_input ?? {};
const verdict = judge(runDir, input);
const ev = { t: new Date().toISOString(), k: "hook", hook: "checksum-gate", via: "kiro-pre-tool-use", sessionId: event.session_id ?? null, ops: input.ops ?? null, force_unverified: Boolean(input.force_unverified) };
if (verdict.verdict === "refused") {
  const counts = bumpRefusals(runDir, verdict.lines);
  appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ ...ev, exit: 2, decision: "refused", stderr: verdict.reason, refusals: counts }) + "\n");
  process.stderr.write(verdict.reason + "\n");
  process.exit(2);
}
appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ ...ev, exit: 0, decision: verdict.verdict, reason: verdict.reason }) + "\n");
process.exit(0);

/**
 * Judge the tool input against the server's current canonical listing. Returns
 * { verdict: "accepted" | "forced" | "refused" | "malformed", reason, lines }.
 */
function judge(dir, toolInput) {
  const listingFile = join(dir, "listing.json");
  const inputFile = join(dir, "input.json");
  if (!existsSync(listingFile) && !existsSync(inputFile)) return { verdict: "allowed", reason: "no run state yet; the server's gate judges", lines: [] };
  const state = JSON.parse(readFileSync(existsSync(listingFile) ? listingFile : inputFile, "utf8"));
  const expected = state.expectedLines ?? state.spec?.expectedLines ?? [];
  const listing = (state.lines ?? []).map(({ n, body, printed, status, source }) => ({ n, body, printed, status, source }));
  const ops = Array.isArray(toolInput.ops) ? toolInput.ops : [];
  const patch = ops.map(toGateOp);
  const refusals = readRefusals(dir);
  const v = applyPatch(listing, patch, expected, { force_unverified: Boolean(toolInput.force_unverified), refusalCounts: refusals });
  const lines = refusedLines(v, patch);
  return { verdict: v.verdict, reason: v.reason, lines };
}

function readRefusals(dir) {
  const f = join(dir, "refusals.json");
  try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}; } catch { return {}; }
}

function bumpRefusals(dir, lines) {
  const counts = readRefusals(dir);
  for (const n of lines) counts[n] = (counts[n] ?? 0) + 1;
  writeFileSync(join(dir, "refusals.json"), JSON.stringify(counts) + "\n");
  return counts;
}
