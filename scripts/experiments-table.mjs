#!/usr/bin/env node
/**
 * E1–E4 (docs/EXPERIMENTS.md, kiro-plan.md §3): aggregate the eval harness's own rows — never re-judges a run.
 *   node scripts/experiments-table.mjs [--since 2026-11-25T16:53] [--commit 657ac88]
 * Reads evidence/evals/evals-*.jsonl rows with kind "model" (cases 1 and 6, every arm) at one commit, and for each run
 * whose event file is on disk counts Kiro's own Agent Stop hook firings (`until-title` via kiro-stop) and their
 * decisions. Case-1 run files are tier C (local only), so only their counts are published.
 * Writes evidence/experiments/e1-e4.json and prints a Markdown table.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const since = opt("since", "2026-11-25T16:53"), commit = opt("commit", "657ac88");
const rows = readdirSync("evidence/evals").filter((f) => /^evals-.*\.jsonl$/.test(f))
  .flatMap((f) => readFileSync(`evidence/evals/${f}`, "utf8").trim().split("\n").map((l) => JSON.parse(l)))
  .filter((r) => r.kind === "model" && r.t >= since && r.commit === commit && (r.case === 1 || r.case === 6));
const runFileOf = (r) => {
  if (!r.runFile.startsWith("(")) return r.runFile;
  // tier-C case 1: the harness names the local file by case, arm, run index and start time; match by the row's wall window
  const dir = "runs/gazette", tag = `eval-case1${r.arm === "shipped" ? "" : `-${r.arm}`}-${r.run}-`;
  if (!existsSync(dir)) return null;
  const end = Date.parse(r.t), start = end - r.wallMs - 5000;
  const f = readdirSync(dir).find((x) => x.startsWith(tag) && Number(x.slice(tag.length, -6)) >= start && Number(x.slice(tag.length, -6)) <= end);
  return f ? `${dir}/${f}` : null;
};
const stopHook = (file) => {
  if (!file || !existsSync(file)) return null;
  const ev = readFileSync(file, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const fired = ev.filter((e) => e.k === "hook" && e.hook === "until-title" && e.via === "kiro-stop");
  return { fired: fired.length, blocked: fired.filter((e) => e.decision === "block").length };
};
const p50 = (xs) => { const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const ARMS = ["shipped", "haiku", "stop-hook", "error-line", "no-basic-steering"];
const table = [];
for (const arm of ARMS) for (const c of [1, 6]) {
  const rs = rows.filter((r) => r.arm === arm && r.case === c);
  if (!rs.length) continue;
  const hooks = rs.map((r) => stopHook(runFileOf(r)));
  table.push({
    arm, case: c, n: rs.length,
    resurrected: rs.filter((r) => r.result === "RESURRECTED").length,
    partial: rs.filter((r) => r.result === "BOOTED-PARTIAL").length,
    notResurrected: rs.filter((r) => r.result !== "RESURRECTED" && r.result !== "BOOTED-PARTIAL").length,
    targetOk: rs.filter((r) => r.pass).length,
    iterationsP50: p50(rs.map((r) => r.iterations)), creditsP50: p50(rs.map((r) => r.credits)),
    creditsTotal: Number(rs.reduce((a, r) => a + (r.credits ?? 0), 0).toFixed(3)), unmetered: rs.filter((r) => r.credits == null).length,
    cyclesMax: Math.max(...rs.map((r) => r.cycles ?? 0)), caps: rs.map((r) => r.cap).filter(Boolean),
    wallSP50: p50(rs.map((r) => Math.round(r.wallMs / 100) / 10)),
    stopHookFired: hooks.every(Boolean) ? hooks.map((h) => h.fired) : null, stopHookBlocked: hooks.every(Boolean) ? hooks.map((h) => h.blocked) : null,
  });
}
// Kiro's own Agent Stop hook, over every run outside the error-line arm (E3 changes the context, not the loop):
// how often it blocked a stop at least once, and how those runs ended — straight from the run files.
const loopRuns = rows.filter((r) => r.arm !== "error-line").map((r) => ({ r, h: stopHook(runFileOf(r)) })).filter((x) => x.h);
const blockedRuns = loopRuns.filter((x) => x.h.blocked > 0);
const stopHookSummary = { runs: loopRuns.length, blockedAtLeastOnce: blockedRuns.length, blockedThenResurrected: blockedRuns.filter((x) => x.r.result === "RESURRECTED").length, runnerResumed: loopRuns.filter((x) => (x.r.cycles ?? 1) > 1).length };
writeFileSync("evidence/experiments/e1-e4.json", JSON.stringify({ since, commit, note: "aggregated from the harness rows; no run re-judged", stopHookSummary, table }, null, 1) + "\n");
const fmt = (x) => (x == null ? "—" : x);
console.log("| Arm | Case | N | RESURRECTED | PARTIAL | target lines right | iterations p50* | credits p50* | credits total | runner cycles max | Kiro Stop-hook firings (per run) | caps hit |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const t of table) console.log(`| ${t.arm} | ${t.case} | ${t.n} | ${t.resurrected} | ${t.partial} | ${t.targetOk} | ${fmt(t.iterationsP50)} | ${fmt(t.creditsP50)} | ${t.creditsTotal}${t.unmetered ? ` (+${t.unmetered} unmetered)` : ""} | ${t.cyclesMax} | ${t.stopHookFired ? t.stopHookFired.join(", ") : "—"} | ${t.caps.join(", ") || "none"} |`);
console.log(`\nKiro Agent Stop hook outside E3: blocked a stop in ${stopHookSummary.blockedAtLeastOnce} of ${stopHookSummary.runs} runs; ${stopHookSummary.blockedThenResurrected} of those ended RESURRECTED; the runner resumed a session in ${stopHookSummary.runnerResumed}.`);
console.log("\n* p50 with N=2 is the lower of the two runs; `credits total` gives the sum.");
