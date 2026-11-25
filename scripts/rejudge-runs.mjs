#!/usr/bin/env node
/**
 * Re-judge every recorded run on disk with the CURRENT code: replay() re-executes each recorded patch through the gate,
 * re-runs the C64 on the real core and recomputes the contract; a run passes when replay reports 0 mismatches and the
 * recomputed verdict equals the recorded one (bugfix-boot-detect U8; agent contract §6). Fail closed (arch review 02): a run
 * with no recorded result or no recomputed contract is NOT ok, and finding no recording at all exits 1.
 *   node scripts/rejudge-runs.mjs [--out evidence/boot-detect/rejudge.json]
 * Public runs: public/runs/*.jsonl, evidence/evals/runs/*.jsonl. Tier-C runs (runs/gazette/, local only) are re-judged
 * when present and only their counts are written.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { bootNodeCore, c64ReadyWasmSha256 } from "../src/emu/node.ts";
import { replay } from "../src/replay/replay.ts";

const argv = process.argv.slice(2);
const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
const dirs = [["public/runs", "public"], ["evidence/evals/runs", "public"], ["runs/gazette", "tier-c"]];
const files = dirs.flatMap(([d, tier]) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".jsonl")).sort().map((f) => ({ path: `${d}/${f}`, tier })) : []));
const core = await bootNodeCore();
const sha = c64ReadyWasmSha256();
const rows = [];
for (const f of files) {
  const events = readFileSync(f.path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  if (!events.some((e) => e.k === "start" && e.input)) { rows.push({ file: f.tier === "public" ? f.path : "(tier C)", tier: f.tier, skipped: "no start.input" }); continue; }
  const recorded = events.findLast((e) => e.k === "end")?.result ?? null;
  const r = replay(events, core, { wasmSha256: sha });
  const recomputed = r.contract?.verdict ?? r.contract?.result ?? null;
  const same = typeof recorded === "string" && typeof recomputed === "string" && recorded.toUpperCase() === recomputed.toUpperCase();
  rows.push({ file: f.tier === "public" ? f.path : "(tier C)", tier: f.tier, recorded, recomputed, mismatches: r.mismatches.length, refused: r.refused, ok: same && r.mismatches.length === 0 && !r.refused, _path: f.path, _mm: [...(same ? [] : [`verdict: recorded ${recorded}, recomputed ${recomputed}`]), ...r.mismatches].slice(0, 4) });
}
const judged = rows.filter((x) => !x.skipped);
const summary = { runs: judged.length, ok: judged.filter((x) => x.ok).length, mismatches: judged.reduce((a, x) => a + x.mismatches, 0), skipped: rows.length - judged.length, byTier: { public: judged.filter((x) => x.tier === "public").length, tierC: judged.filter((x) => x.tier === "tier-c").length } };
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ t: new Date().toISOString(), commit: execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim(), codeClean: execFileSync("git", ["status", "--porcelain", "src", "mcp"]).toString().trim() === "", summary, rows: rows.map(({ _path, _mm, ...x }) => (x.tier === "public" ? { ...x, mismatchText: _mm } : x)) }, null, 1) + "\n"); }
console.log(JSON.stringify(summary));
for (const x of judged.filter((y) => !y.ok)) console.log("NOT OK (console only)", x._path, JSON.stringify(x._mm).slice(0, 600));
process.exit(summary.runs > 0 && summary.ok === summary.runs && summary.skipped === 0 ? 0 : 1); // a recording that cannot be replayed fails too
