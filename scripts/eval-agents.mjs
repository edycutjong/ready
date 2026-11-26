#!/usr/bin/env node
/**
 * Evals (agent contract §7). Deterministic cases cost 0 credits and run on every task; model cases run N times through the
 * real recorder (record-run.mjs → kiro-cli → the shipped resurrector profile). One jsonl row per case/run, appended to
 * evidence/evals/evals-<date>.jsonl with the git commit the agent + gate ran on.
 *   node scripts/eval-agents.mjs --deterministic
 *   node scripts/eval-agents.mjs --model --case 3 --n 3        (≈ 0.85 credits per run)
 *   node scripts/eval-agents.mjs --model --case 1 --n 3        (≈ 2.1 credits per run; needs the local tier-C input)
 *   node scripts/eval-agents.mjs --model --case 5|6 --n 3      (authored pages, P6b: silent DATA misread / ?OUT OF DATA)
 *   ... --arm shipped|haiku|stop-hook|error-line|no-basic-steering   (docs/EXPERIMENTS.md E1–E4; default shipped)
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  // 5 and 6, the deterministic half (the model half runs with --model): the OCR'd authored page fails the way the case
  // says, the right DATA fix passes the gate, and the kill-test dodge (edit the loop bound in line 10, M2) is refused.
  const k5 = JSON.parse(readFileSync("fixtures/authored/knock-input.json", "utf8"));
  const first5 = runListing(core, k5.lines, k5.spec); // the real OCR also read line 40's THEN40 as THEN4® (loud: ?UNDEF'D STATEMENT)
  const fix40 = applyPatch(k5.lines, [{ type: "replace", lineno: 40, new_body: 'GETK$:IFK$=""THEN40' }], k5.spec.expectedLines);
  const f5 = fix40.verdict === "accepted" ? runListing(core, fix40.listing, k5.spec) : null; // then the planted misprint is silent
  const p5 = fix40.verdict === "accepted" ? applyPatch(fix40.listing, [{ type: "replace", lineno: 80, new_body: "DATA 73,84,32,76" }], k5.spec.expectedLines) : { verdict: "n/a" };
  row({ case: "5d", kind: "deterministic", name: "authored silent DATA misread: after the OCR fault in line 40 is fixed, no ?ERROR but the post-title screen is wrong; the DATA fix passes the gate", pass: Boolean(first5.run.error && f5 && !f5.run.error && f5.titleSeen && f5.postTitle === "fail" && p5.verdict === "accepted"), detail: { firstRun: first5.run.error ?? null, fix40: fix40.verdict, afterFix40: f5 ? { error: f5.run.error ?? null, postTitle: f5.postTitle, screen: (f5.screens.postTitle ?? "").replace(/\s+/g, " ").trim().slice(0, 60) } : null, data80: p5.verdict } });
  const k6 = JSON.parse(readFileSync("fixtures/authored/ossuary-input.json", "utf8"));
  const f6 = runListing(core, k6.lines, k6.spec);
  const dodge = applyPatch(k6.lines, [{ type: "replace", lineno: 10, new_body: "C=23:S=0" }], k6.spec.expectedLines);
  const p6 = applyPatch(k6.lines, [{ type: "replace", lineno: 890, new_body: "DATA 5,3,5,8,9,7,9,3" }], k6.spec.expectedLines);
  row({ case: "6d", kind: "deterministic", name: "authored ?OUT OF DATA IN 19: the loop-bound dodge on line 10 is refused, the DATA 890 fix passes", pass: f6.run.error?.kind === "OUT OF DATA" && f6.run.error?.line === 19 && dodge.verdict === "refused" && p6.verdict === "accepted", detail: { error: f6.run.error ?? null, dodge: dodge.reason, data890: p6.verdict } });
}

if (a.model) {
  const c = Number(a.case), n = Number(a.n ?? 3), arm = a.arm ?? "shipped";
  const CASES = {
    1: { input: "fixtures/gazette/randnum-g-input.json", listing: "randnum", dir: "runs/gazette", name: "Random Number Test title path (tier-C input, local)", tierC: true },
    3: { input: "fixtures/authored/line20-input.json", listing: "line20", dir: "evidence/evals/runs", name: "authored line-20 typo" },
    5: { input: "fixtures/authored/knock-input.json", listing: "knock", dir: "evidence/evals/runs", name: "authored DATA value misread, silent failure (no ?ERROR)", mustFix: 80 },
    6: { input: "fixtures/authored/ossuary-input.json", listing: "ossuary", dir: "evidence/evals/runs", name: "authored ?OUT OF DATA IN 19, fault in DATA 890", mustFix: 890, mustNotFix: 10 },
  };
  // The run prompt is the published prompts/12-run-prompt-resurrect.md, byte-identical (cmp) to the one every recorded
  // model run used; --prompt-file overrides it (arch review 02: the harness runs from a public clone).
  // Experiment arms (docs/EXPERIMENTS.md). Every arm but stop-hook uses the runner-driven loop.
  const ARMS = {
    shipped: {}, // Sonnet 5.5, whole-listing context, steering, runner loop: the configuration the product records with
    haiku: { model: "claude-haiku-5.5" }, // E1
    "stop-hook": { extra: ["--max-cycles", "1"] }, // E2: Kiro's Agent Stop hook is the only loop controller
    "error-line": { env: { READY_CONTEXT: "error-line" } }, // E3
    "no-basic-steering": { workspace: true }, // E4: a scratch copy of the workspace without commodore-basic-v2.md
  };
  const cfg = CASES[c], armCfg = ARMS[arm];
  if (!cfg || !existsSync(cfg.input)) { console.error(`case ${c}: no input available (${cfg?.input})`); process.exit(2); }
  if (!armCfg) { console.error(`unknown arm ${arm}`); process.exit(2); }
  let workspace = ".";
  if (armCfg.workspace) {
    // steering with `inclusion: always` loads into every session, so removing it from the profile's resources is not
    // enough: the arm runs in a copy of the tree (node_modules linked) with the file deleted and the resource dropped.
    workspace = mkdtempSync(join(tmpdir(), "ready-e4-workspace-")); // private 0700 dir with a random name, not a fixed /tmp path
    const rs = spawnSync("rsync", ["-a", "--exclude", "node_modules", "--exclude", ".git", "--exclude", "runs", "--exclude", "work", "--exclude", "evidence", "./", `${workspace}/`]);
    if (rs.status !== 0) throw new Error("rsync failed");
    symlinkSync(resolve("node_modules"), `${workspace}/node_modules`);
    rmSync(`${workspace}/.kiro/steering/commodore-basic-v2.md`);
    const prof = JSON.parse(readFileSync(`${workspace}/.kiro/agents/resurrector.json`, "utf8"));
    prof.resources = prof.resources.filter((r) => !r.includes("commodore-basic-v2"));
    writeFileSync(`${workspace}/.kiro/agents/resurrector.json`, JSON.stringify(prof, null, 2) + "\n");
  }
  mkdirSync(cfg.dir, { recursive: true });
  for (let i = 1; i <= n; i++) {
    const out = resolve(`${cfg.dir}/eval-case${c}${arm === "shipped" ? "" : `-${arm}`}-${i}-${Date.now()}.jsonl`);
    const t0 = Date.now();
    const argv = ["scripts/record-run.mjs", "--listing", cfg.listing, "--prompt-file", resolve(a["prompt-file"] ?? "prompts/12-run-prompt-resurrect.md"), "--agent", "resurrector", "--input", resolve(cfg.input), "--context", "--stop-check", "node scripts/hooks/until-title.mjs --check", "--out", out, "--workspace", workspace, "--run-dir", resolve(`work/${cfg.listing}-${arm}-${i}-${Date.now()}`), ...(armCfg.model ? ["--model", armCfg.model] : []), ...(armCfg.extra ?? [])];
    const r = spawnSync(process.execPath, argv, { encoding: "utf8", timeout: 700_000, env: { ...process.env, ...(armCfg.env ?? {}) } });
    let summary = null; try { summary = JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch {}
    const result = summary?.result ?? "error";
    // what the run actually did, from its own event file: lines the gate accepted, refusals, screen reads
    const ev = existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : [];
    const accepted = [...new Set(ev.filter((e) => e.k === "gate" && (e.verdict === "accepted" || e.verdict === "forced")).flatMap((e) => (e.perOp ?? []).map((p) => p.line)))].sort((x, y) => x - y);
    const refusals = ev.filter((e) => e.k === "gate" && e.verdict === "refused").length + ev.filter((e) => e.k === "hook" && e.hook === "checksum-gate" && e.exit === 2).length;
    const screenReads = readFileSync(existsSync(out) ? out : "/dev/null", "utf8").split("c64_read_screen").length - 1;
    const targetOk = (cfg.mustFix == null || accepted.includes(cfg.mustFix)) && (cfg.mustNotFix == null || !accepted.includes(cfg.mustNotFix));
    row({ case: c, kind: "model", arm, model: armCfg.model ?? "claude-sonnet-5.5", run: i, of: n, name: cfg.name, pass: result === "RESURRECTED" && targetOk, result, acceptedLines: accepted, refusals, screenReads, iterations: summary?.iterations ?? null, cycles: summary?.cycles ?? null, credits: typeof summary?.credits === "number" ? Number(summary.credits.toFixed(4)) : null, wallMs: Date.now() - t0, cap: summary?.cap ?? null, runFile: cfg.tierC ? "(tier C, local only)" : out.replace(resolve(".") + "/", "") });
  }
}
const model = rows.filter((r) => r.kind === "model"), det = rows.filter((r) => r.kind === "deterministic");
console.log(JSON.stringify({ summary: { deterministic: `${det.filter((r) => r.pass).length}/${det.length}`, model: `${model.filter((r) => r.pass).length}/${model.length}` } }));
