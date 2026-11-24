#!/usr/bin/env node
/**
 * The ONE stop rule (agents.md §4 "Stop condition"). The model cannot declare success; this decides.
 *   Kiro Agent Stop hook (default mode): STDOUT {"decision":"block","reason":…} keeps the agent working; exit 0 with
 *     no output lets it stop.
 *   Runner mode (`--check`, used by scripts/record-run.mjs between resumed cycles, spike K2): STDOUT
 *     {"stop": bool, "reason": str, "result": str}. Same predicate, same files.
 * Stop is allowed when (a) the contract computed by the MCP server is RESURRECTED, or (b) every remaining non-verified
 * line is one the agent cannot fix (lost, unparseable printed checksum), or (c) a cap hits (15 iterations, 8 credits,
 * 600 s). The title alone is BOOTED, never success: the hook blocks with the list of fixable lines.
 * Reads $RUN_DIR/{listing,state}.json (MCP server), credits.json (runner), events.jsonl (hook refusals).
 * A shell hook cannot call MCP and does not see the credit stream, hence the files.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPS } from "../../runner/budget.ts";

const check = process.argv.includes("--check");
const runDir = process.env.RUN_DIR;
let event = {};
if (!check) { try { event = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no stdin */ } }

const d = runDir ? decide(runDir) : { stop: true, reason: "no RUN_DIR: nothing to supervise", result: "error" };
if (check) {
  process.stdout.write(JSON.stringify(d) + "\n");
} else {
  if (runDir) appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ t: new Date().toISOString(), k: "hook", hook: "until-title", via: "kiro-stop", sessionId: event.session_id ?? null, exit: 0, decision: d.stop ? "allow" : "block", reason: d.reason, result: d.result }) + "\n");
  if (!d.stop) process.stdout.write(JSON.stringify({ decision: "block", reason: d.reason }) + "\n");
}
process.exit(0);

function read(name) {
  const f = join(runDir, name);
  try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; }
}

function events() {
  const f = join(runDir, "events.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
}

function decide() {
  const listing = read("listing.json");
  const credits = read("credits.json") ?? {};
  if (!listing) return { stop: true, reason: "the c64 server never wrote listing.json; the run cannot be judged", result: "error" };
  const result = String(listing.contract?.state ?? "NOT-RESURRECTED").toLowerCase();

  // (c) caps — iterations = fix attempts: calls the server received + CALLS the hook refused before the server
  // (one refused call = one attempt, however many lines it named; QA P1b r1)
  const refused = events().filter((e) => e.k === "hook" && e.hook === "checksum-gate" && e.exit === 2 && e.via === "kiro-pre-tool-use").length;
  const iterations = Math.max(Number(credits.iterations ?? 0), Number(listing.iteration ?? 0) + refused);
  const spent = credits.metered ? Number(credits.credits ?? 0) : null;
  const wall = credits.startedAt ? Date.now() - Number(credits.startedAt) : 0;
  const cap = iterations >= CAPS.iterations ? `iteration cap (${iterations}/${CAPS.iterations})` : spent !== null && spent >= CAPS.credits ? `credit cap (${spent.toFixed(2)}/${CAPS.credits})` : wall >= CAPS.wallMs ? `wall cap (${Math.round(wall / 1000)} s/${CAPS.wallMs / 1000} s)` : null;
  if (cap) return { stop: true, reason: `${cap} reached — the run ends ${result.toUpperCase()}`, result, cap };

  // the contract must describe what the C64 last RAN: a gated change with no run after it is unjudged
  const ev = events();
  const lastRun = ev.findLastIndex((e) => e.k === "emu" && e.op === "run");
  const lastChange = ev.findLastIndex((e) => e.k === "gate" && (e.verdict === "accepted" || e.verdict === "forced"));
  if (lastRun < 0) return { stop: false, reason: "The program has not been RUN yet. Call c64_run and read the screen.", result };
  if (lastChange > lastRun) return { stop: false, reason: "Your last accepted patch has not been RUN. Call c64_run to see what it did.", result };

  // (a) the contract, computed by code from the final listing and the emulator
  if (listing.contract?.state === "RESURRECTED") return { stop: true, reason: listing.contract.heading ?? "RESURRECTED", result };

  // (b) only unfixable lines left?
  const expected = new Set(listing.expectedLines ?? []);
  const lines = (listing.lines ?? []).filter((l) => expected.has(l.n));
  const untypeable = new Map((listing.untypeable ?? []).map((u) => [u.n, u.why]));
  const fixable = [];
  for (const l of lines) {
    if (untypeable.has(l.n)) fixable.push(`${l.n} (untypeable: ${untypeable.get(l.n)})`);
    else if (l.status === "forced") fixable.push(`${l.n} (FORCED: printed :rem ${l.printed} still does not match)`);
    else if (l.status === "unverified" && l.printed !== null && l.printed !== undefined) fixable.push(`${l.n} (checksum mismatch: printed :rem ${l.printed})`);
  }
  const present = new Set(lines.map((l) => l.n));
  const missing = [...expected].filter((n) => !present.has(n));
  const screen = read("state.json");
  const seen = screen?.titleSeen ? "The title appeared, but that alone is BOOTED — PARTIAL, not success." : `Last screen error: ${screen?.error ? `?${screen.error.kind} ERROR${screen.error.line != null ? ` IN ${screen.error.line}` : ""}` : "none (no title yet)"}.`;
  // every present line is consistent, nothing is missing, yet the C64 still fails: a checksum collision or a misread
  // the checksum cannot see — keep working until a cap (QA P1b r1: "consistent" is not "runs")
  const failing = (listing.contract?.failed ?? []).some((f) => f.clause === 1 || f.clause === 2 || f.clause === 6);
  if (fixable.length === 0 && missing.length === 0 && failing) {
    return { stop: false, reason: `Every line matches its printed checksum, but the program still fails. ${seen} A checksum match is necessary, not sufficient (mod-256 collisions; spaces are not counted): look at the line the error names and at swapped or misnumbered lines, test candidates with checksum_line, then apply_patch and c64_run.`, result };
  }
  if (fixable.length === 0) {
    const why = [missing.length ? `missing (recovery-only, never the model): ${missing.join(", ")}` : "", lines.some((l) => l.printed == null) ? "unparseable printed checksums stay unverified" : ""].filter(Boolean).join("; ");
    return { stop: true, reason: `no line the agent can fix remains${why ? ` — ${why}` : ""}; the run ends ${result.toUpperCase()}`, result };
  }
  return { stop: false, reason: `Not done. ${seen} Lines still failing their printed checksum (fix with apply_patch, then c64_run): ${fixable.slice(0, 12).join("; ")}${fixable.length > 12 ? ` … and ${fixable.length - 12} more` : ""}.`, result };
}
