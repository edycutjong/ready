#!/usr/bin/env node
/**
 * Evals (agent contract §7). Deterministic cases cost 0 credits and run on every task; model cases run N times through the
 * real recorder (record-run.mjs → kiro-cli → the shipped resurrector profile). One jsonl row per case/run, appended to
 * evidence/evals/evals-<date>.jsonl with the git commit the agent + gate ran on.
 *   node scripts/eval-agents.mjs --deterministic
 *   node scripts/eval-agents.mjs --model --case 3 --n 3        (≈ 0.85 credits per run)
 *   node scripts/eval-agents.mjs --model --case 1 --n 3        (≈ 2.1 credits per run; needs the local tier-C input)
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { applyPatch } from "../src/gate/checksum-gate.ts";
import { cheat } from "../src/replay/replay.ts";
import { runListing, untypeableLines } from "../src/emu/session.ts";
import { bootNodeCore } from "../src/emu/node.ts";
import { logicalFromText } from "../src/ocr/recover.ts";
import { scanQuality } from "../src/ocr/flag.ts";

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]] : acc), []));
const day = new Date().toISOString().slice(0, 10);
mkdirSync("evidence/evals", { recursive: true });
const outFile = `evidence/evals/evals-${day}.jsonl`;
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
const rows = [];
const row = (r) => { const full = { t: new Date().toISOString(), commit, ...r }; rows.push(full); appendFileSync(outFile, JSON.stringify(full) + "\n"); console.log(JSON.stringify(full)); };

const input20 = JSON.parse(readFileSync("fixtures/authored/line20-input.json", "utf8"));

if (a.deterministic) {
  const core = await bootNodeCore();
  // 2: a listing that already boots → the first RUN shows the title, so the agent is never called (0 iterations)
  const clean = input20.lines.map((l) => (l.n === 20 ? { ...l, body: 'PRINT"   ** THE LAST SEANCE **" ', status: "verified" } : l));
  const facts = runListing(core, clean, input20.spec);
  row({ case: 2, kind: "deterministic", name: "clean authored listing boots at 0 iterations (stand-in for Power BASIC, whose Gazette OCR is tier C)", pass: !facts.run.error && facts.titleSeen === true, agentCalls: 0, detail: { error: facts.run.error ?? null, titleSeen: facts.titleSeen } });
  // 4: Cheat — empty the error line → refused
  const ch = cheat(input20.lines, input20.spec.expectedLines, 20);
  row({ case: 4, kind: "deterministic", name: "Cheat: empty the error line", pass: ch.verdict.verdict === "refused", detail: ch.verdict.reason });
  // 7: unreadable scan → the quality gate stops with 0 credits
  const q = scanQuality(logicalFromText("~~ .. ,, ''\n  ;;  \n`` ..."));
  row({ case: 7, kind: "deterministic", name: "unreadable scan stops at the OCR quality gate", pass: q.readable === false, credits: 0, detail: q.reason });
  // 8: a line > 80 chars after notation expansion is flagged before typing
  const long = [{ n: 10, body: `PRINT"${"A".repeat(90)}"`, printed: 1, status: "unverified", source: "ocr" }];
  const un = untypeableLines(long);
  row({ case: 8, kind: "deterministic", name: "a line > 80 chars is flagged before typing", pass: un.length === 1 && un[0].why === "too-long", detail: un });
  // 9: a forced patch after 0, 1, then 2 prior refusals on that line: refused, refused, then applied and marked FORCED
  const listing = [{ n: 20, body: 'PRIMT"X"', printed: 159, status: "unverified", source: "ocr" }];
  const verdicts = [0, 1, 2].map((k) => applyPatch(listing, [{ type: "replace", lineno: 20, new_body: 'PRINT"Y"' }], [20], { force_unverified: true, refusalCounts: { 20: k } }).verdict);
  row({ case: 9, kind: "deterministic", name: "forced patch after 0/1/2 prior refusals", pass: JSON.stringify(verdicts) === JSON.stringify(["refused", "refused", "forced"]), detail: verdicts });
}

if (a.model) {
  const c = Number(a.case), n = Number(a.n ?? 3);
  const cfg = { 1: { input: "fixtures/gazette/randnum-g-input.json", listing: "randnum", dir: "runs/gazette" }, 3: { input: "fixtures/authored/line20-input.json", listing: "line20", dir: "evidence/evals/runs" } }[c];
  if (!cfg || !existsSync(cfg.input)) { console.error(`case ${c}: no input available (${cfg?.input})`); process.exit(2); }
  mkdirSync(cfg.dir, { recursive: true });
  for (let i = 1; i <= n; i++) {
    const out = `${cfg.dir}/eval-case${c}-${i}-${Date.now()}.jsonl`;
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ["scripts/record-run.mjs", "--listing", cfg.listing, "--prompt-file", "../kiro-prompts/run-prompt-resurrect.md", "--agent", "resurrector", "--input", cfg.input, "--context", "--stop-check", "node scripts/hooks/until-title.mjs --check", "--out", out, "--workspace", "."], { encoding: "utf8", timeout: 700_000 });
    let summary = null; try { summary = JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch {}
    const result = summary?.result ?? "error";
    row({ case: c, kind: "model", run: i, of: n, name: c === 1 ? "Random Number Test title path (tier-C input, local)" : "authored line-20 typo", pass: result === "RESURRECTED", result, iterations: summary?.iterations ?? null, credits: typeof summary?.credits === "number" ? Number(summary.credits.toFixed(4)) : null, wallMs: Date.now() - t0, cap: summary?.cap ?? null, runFile: c === 3 ? out : "(tier C, local only)" });
  }
}
const model = rows.filter((r) => r.kind === "model"), det = rows.filter((r) => r.kind === "deterministic");
console.log(JSON.stringify({ summary: { deterministic: `${det.filter((r) => r.pass).length}/${det.length}`, model: `${model.filter((r) => r.pass).length}/${model.length}` } }));
