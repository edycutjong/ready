#!/usr/bin/env node
/**
 * Local recorder: one real Kiro run → runs/<listing>/<iso>.jsonl (the REPLAY source). Builder's machine only;
 * never deployed, never holds a credential (kiro-cli uses the builder's own login).
 *
 *   node scripts/record-run.mjs --listing <id> --prompt-file <f> [--agent resurrector] [--model claude-sonnet-5.5]
 *        [--workspace .] [--trust-tools @c64/apply_patch,...] [--stop-check "node scripts/hooks/until-title.mjs --check"]
 *        [--out runs/<id>/<iso>.jsonl] [--ledger ledger] [--input <input.json>] [--kiro-bin kiro-cli]
 *        [--reference <transcript> --reference-origin "two machine reads"]   (evaluation-only source check, after the run)
 *
 * --input: the run's $RUN_DIR/input.json (listingId, scope, spec, canonical lines after recovery, provisional) that
 * the c64 MCP server types in at start; copied into RUN_DIR and stored whole in the `start` event (replay fidelity,
 * agents.md §6: REPLAY re-executes the patches on this exact OCR input, never on the judge's own OCR).
 *
 * Measured on kiro-cli 3.5.0 (spike K2, evidence/spikes/): in `--v3 --no-interactive` an Agent Stop hook's
 * {decision:"block"} forces ONE more turn per prompt and does not fire again. So the recorder runs cycles: after
 * each kiro-cli process ends it asks the stop check (the same predicate the Stop hook uses); if stopping is not
 * allowed and no cap is hit, it resumes the SAME session (--resume-id) with the check's reason as the next prompt.
 * Caps per run: 15 iterations (apply_patch calls), 8 credits, 600 s wall (runner/budget.ts). Never --trust-all-tools.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseLine, sessionIdOf } from "../runner/stream.ts";
import { CAPS, capHit, addToLedger } from "../runner/budget.ts";
import { parseReference, sourceCheck } from "../runner/source-check.ts";
import { bootNodeCore, c64ReadyWasmSha256 } from "../src/emu/node.ts";
import { judge, runListing } from "../src/emu/session.ts";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1] ?? "true"]] : a), []));
const listing = args.listing ?? "probe";
const iso = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(args.out ?? `runs/${listing}/${iso}.jsonl`);
const workspace = resolve(args.workspace ?? ".");
const runDir = resolve(args["run-dir"] ?? `work/${listing}-${iso}`);
const model = args.model ?? "claude-sonnet-5.5";
const trust = args["trust-tools"] ?? "@c64/c64_reload,@c64/c64_run,@c64/c64_read_screen,@c64/c64_press,@c64/checksum_line,@c64/apply_patch";
if (/trust-all/.test(trust)) throw new Error("never --trust-all-tools");
if (!args["stop-check"]) throw new Error("--stop-check is required: the model never decides when to stop"); // validated before any credit is spent
let prompt0 = readFileSync(args["prompt-file"], "utf8");
const kiroBin = args["kiro-bin"] ?? process.env.KIRO_BIN ?? "kiro-cli"; // tests swap in a stub child
mkdirSync(dirname(out), { recursive: true });
mkdirSync(runDir, { recursive: true });
let runInput = null;
if (args.input) { copyFileSync(resolve(args.input), join(runDir, "input.json")); runInput = JSON.parse(readFileSync(join(runDir, "input.json"), "utf8")); }

const t = () => new Date().toISOString();
const emit = (e) => appendFileSync(out, JSON.stringify({ t: t(), ...e }) + "\n");
const state = { iterations: 0, credits: null, startedAt: Date.now() };
let metered = false;
let sessionId = null;
let cycles = 0;
let stop = { stop: false, reason: "", result: "not-resurrected" };
let mergedLines = 0; // declared before the loop (spike G attempt 1 crashed here: TDZ on the first merge)

// --context: the runner also puts the Session Start context (scripts/hooks/listing-context.mjs, same script the hook
// runs) into the FIRST prompt, so the run never depends on whether V3 headless injects a Session Start hook's STDOUT
// (unmeasured); resumed cycles get the hook's refreshed context and the stop check's reason.
if (args.context && runInput) {
  const c = spawnSync(process.execPath, ["scripts/hooks/listing-context.mjs"], { cwd: workspace, env: { ...process.env, RUN_DIR: runDir, READY_HOOK_VIA: "runner-context" }, encoding: "utf8" });
  prompt0 = `${prompt0}\n\n${c.stdout}`;
}
emit({ k: "start", model, mode: "live", listing, emulator: { id: "c64-ready@3.4.0", wasmSha256: c64ReadyWasmSha256() }, runDir: runDir.replace(workspace, "."), runner: { kiroCli: kiroVersion(), agent: args.agent ?? null, trustTools: trust.split(","), caps: CAPS }, input: runInput });
writeCredits();

let prompt = prompt0;
let liveCheck = () => {};
let capReason = null;
while (true) {
  cycles++;
  const cli = ["chat", "--v3", "--no-interactive", "--trust-workspace", "--model", model, `--trust-tools=${trust}`, "--output-format", "stream-json"];
  if (args.agent) cli.push("--agent", args.agent);
  if (sessionId) cli.push("--resume-id", sessionId);
  cli.push(prompt);
  const remaining = CAPS.wallMs - (Date.now() - state.startedAt);
  const r = await runKiro(cli, remaining);
  emit({ k: "cycle", n: cycles, exit: r.code, killed: r.killed, sessionId });
  mergeServerEvents();
  if (r.killed) { capReason = r.killed; break; }
  capReason = capHit(state);
  if (capReason) break;
  stop = stopCheck();
  emit({ k: "hook", hook: "until-title", exit: 0, decision: stop.stop ? "allow" : "block", stderr: stop.stop ? undefined : stop.reason, via: "runner-cycle" });
  if (stop.stop) break;
  if (!sessionId) { emit({ k: "error", why: "no session id in stream; cannot resume" }); break; }
  prompt = stop.reason;
}
// a killed cycle never reports its credits (they arrive at process end, K3): the total is then a lower bound
emit({ k: "credits", metered, delta: null, total: metered ? state.credits : null, lowerBound: Boolean(capReason && capReason !== "credits") });
await finalJudgeIfStale();
const final = finalResult();
// evaluation-only source check (agents.md §4): the reference is read only now, after the run, never by the agent
if (args.reference && existsSync(join(runDir, "listing.json"))) {
  const l = JSON.parse(readFileSync(join(runDir, "listing.json"), "utf8"));
  const sc = sourceCheck(l.lines, parseReference(readFileSync(resolve(args.reference), "utf8")), l.expectedLines, args["reference-origin"] ?? "unstated");
  final.extra.counts = { ...(final.extra.counts ?? {}), sourceExact: sc.sourceExact, sourceTotal: sc.total };
  final.extra.sourceReference = sc.origin;
}
emit({ k: "end", result: final.result, iterations: state.iterations, wallMs: Date.now() - state.startedAt, cap: capReason, cycles, ...final.extra });
const ledger = addToLedger(resolve(args.ledger ?? "ledger"), metered ? state.credits : null);
console.log(JSON.stringify({ out, runDir, cycles, iterations: state.iterations, credits: metered ? state.credits : "unmetered", cap: capReason, result: final.result, ledger }));

function runKiro(cliArgs, timeoutMs) {
  return new Promise((res) => {
    const child = spawn(kiroBin, cliArgs, { cwd: workspace, env: { ...process.env, RUN_DIR: runDir } });
    let buf = "";
    let killed = false;
    const stop = (why) => { if (killed) return; killed = why; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); };
    const timer = setTimeout(() => stop("wall"), Math.max(1000, timeoutMs));
    const calls = new Map();
    // live caps: iterations are counted from the stream as they happen; credits arrive once per process (K3), so
    // the credit cap can only be checked between cycles — a cycle may overshoot it by its own spend (logged).
    // The iteration kill is armed on the RESULT of the cap-reaching call (QA P1a r2): killing on the call itself
    // raced its tool_result, so the 15th fix attempt's verdict was lost from the record.
    liveCheck = () => { if (state.iterations >= CAPS.iterations) stop("iterations"); };
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!sessionId) sessionId = sessionIdOf(line);
        for (const ev of parseLine(line)) onEvent(ev, calls);
      }
    });
    child.stderr.on("data", (d) => appendFileSync(join(runDir, "kiro-stderr.log"), d));
    child.on("close", (code) => { clearTimeout(timer); res({ code, killed }); });
  });
}

function onEvent(ev, calls) {
  if (ev.k === "credits") { metered = true; state.credits = (state.credits ?? 0) + ev.usage; emit({ k: "credits", metered: true, delta: ev.usage, total: state.credits }); writeCredits(); return; }
  if (ev.k === "tool_load") { emit({ k: "kiro", op: "tool_load", id: ev.id }); return; }
  if (ev.k === "tool_call") {
    calls.set(ev.toolCallId, ev);
    if (/apply_patch/.test(ev.title)) { state.iterations++; writeCredits(); }
    emit({ k: "kiro", op: "tool_call", title: ev.title, server: ev.server, input: ev.input });
    return;
  }
  if (ev.k === "tool_result") {
    const call = calls.get(ev.toolCallId);
    // a hook-refused fix attempt has a tool_call too (counted above); its result is the hook's STDERR
    if (ev.hookRefusal) emit({ k: "hook", hook: "checksum-gate", exit: 2, stderr: hookText(ev.text), tool: call?.title, via: "kiro-stream" });
    else emit({ k: "kiro", op: "tool_result", title: call?.title, status: ev.status, permissionDenied: ev.permissionDenied, text: ev.text.slice(0, 4000) });
    if (/apply_patch/.test(call?.title ?? "")) liveCheck();
    return;
  }
  if (ev.k === "finished") emit({ k: "kiro", op: "finished", status: ev.status, stopReason: ev.stopReason, finalText: ev.finalText.slice(0, 4000) });
}

/** $RUN_DIR/credits.json — the runner is the only writer; until-title.mjs reads it for the caps (agents.md §3). */
function writeCredits() {
  writeFileSync(join(runDir, "credits.json"), JSON.stringify({ metered, credits: metered ? state.credits : null, iterations: state.iterations, startedAt: state.startedAt }) + "\n");
}

function hookText(text) {
  // kiro-cli 3.5.0 wraps the hook's STDERR between a fixed preamble and a fixed epilogue (measured in K1)
  const m = text.match(/address:\s*\n\n([\s\S]*?)\n\nThe tool was NOT executed/);
  return (m ? m[1] : text).trim().slice(0, 2000);
}

function mergeServerEvents() {
  // the MCP server (and hooks) append their own events to $RUN_DIR/events.jsonl; copy new lines in order
  const f = join(runDir, "events.jsonl");
  if (!existsSync(f)) return;
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
  for (const l of lines.slice(mergedLines)) appendFileSync(out, l + "\n");
  mergedLines = lines.length;
}

function stopCheck() {
  if (!args["stop-check"]) throw new Error("--stop-check is required: the model never decides when to stop");
  const [cmd, ...rest] = args["stop-check"].split(" ");
  const r = spawnSync(cmd, rest, { cwd: workspace, env: { ...process.env, RUN_DIR: runDir }, encoding: "utf8" });
  try { return JSON.parse(r.stdout); } catch { return { stop: true, reason: `stop check failed: ${r.stderr}`, result: "error" }; }
}

/**
 * R4.7 (resurrect-loop): a run that ends (cap, crash, agent stop) with an accepted patch never RUN has a stale
 * contract. The runner then judges the final canonical listing itself on a fresh headless C64 — code, not the model —
 * and records it as an `emu run` event `via: "runner-final"`, so the certificate always describes what the C64 ran.
 */
async function finalJudgeIfStale() {
  const lf = join(runDir, "listing.json"), ef = join(runDir, "events.jsonl");
  if (!existsSync(lf) || !existsSync(ef) || !runInput) return;
  const ev = readFileSync(ef, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const lastRun = ev.findLastIndex((e) => e.k === "emu" && e.op === "run");
  const lastChange = ev.findLastIndex((e) => e.k === "gate" && (e.verdict === "accepted" || e.verdict === "forced"));
  if (lastChange <= lastRun) return;
  const l = JSON.parse(readFileSync(lf, "utf8"));
  const lines = l.lines.map(({ n, body, printed, status, source }) => ({ n, body, printed, status, source }));
  const facts = runListing(await bootNodeCore(), lines, runInput.spec);
  const prov = new Set(facts.postTitle === "pass" ? [] : l.lines.filter((x) => x.provisional).map((x) => x.n));
  const c = judge(lines, runInput.spec, facts, prov);
  l.lines = l.lines.map((x) => ({ ...x, provisional: prov.has(x.n) }));
  l.contract = { ...l.contract, state: c.verdict, heading: c.heading, counts: c.counts, failed: c.failed, lines: l.lines.map((x) => ({ n: x.n, status: x.status, source: x.source, provisional: x.provisional })) };
  l.postTitle = facts.postTitle;
  writeFileSync(lf, JSON.stringify(l, null, 1) + "\n");
  emit({ k: "emu", op: "run", via: "runner-final", error: facts.run.error, titleSeen: facts.titleSeen, postTitle: facts.postTitle, why: "an accepted patch was never RUN before the run ended" });
}

function finalResult() {
  const f = join(runDir, "listing.json");
  try {
    if (!existsSync(f)) throw new Error("no listing.json");
    const l = JSON.parse(readFileSync(f, "utf8"));
    if (l.contract) return { result: l.contract.state, extra: { scope: l.contract.scope, postTitle: l.postTitle ?? "not-reached", counts: l.contract.counts, lines: l.contract.lines } };
  } catch (e) { emit({ k: "error", why: `listing.json unreadable: ${e.message}` }); } // the end event is always written
  return { result: stop.result ?? "not-resurrected", extra: {} };
}

function kiroVersion() {
  const r = spawnSync(kiroBin, ["--version"], { encoding: "utf8" });
  return (r.stdout || "").trim();
}
