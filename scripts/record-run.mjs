#!/usr/bin/env node
/**
 * Local recorder: one real Kiro run → runs/<listing>/<iso>.jsonl (the REPLAY source). Builder's machine only;
 * never deployed, never holds a credential (kiro-cli uses the builder's own login).
 *
 *   node scripts/record-run.mjs --listing <id> --prompt-file <f> [--agent resurrector] [--model claude-sonnet-5.5]
 *        [--workspace .] [--trust-tools @c64/apply_patch,...] [--stop-check "node scripts/hooks/until-title.mjs --check"]
 *        [--out runs/<id>/<iso>.jsonl] [--ledger ledger]
 *
 * Measured on kiro-cli 3.5.0 (spike K2, evidence/spikes/): in `--v3 --no-interactive` an Agent Stop hook's
 * {decision:"block"} forces ONE more turn per prompt and does not fire again. So the recorder runs cycles: after
 * each kiro-cli process ends it asks the stop check (the same predicate the Stop hook uses); if stopping is not
 * allowed and no cap is hit, it resumes the SAME session (--resume-id) with the check's reason as the next prompt.
 * Caps per run: 15 iterations (apply_patch calls), 8 credits, 600 s wall (runner/budget.ts). Never --trust-all-tools.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseLine, sessionIdOf } from "../runner/stream.ts";
import { CAPS, capHit, addToLedger } from "../runner/budget.ts";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1] ?? "true"]] : a), []));
const listing = args.listing ?? "probe";
const iso = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(args.out ?? `runs/${listing}/${iso}.jsonl`);
const workspace = resolve(args.workspace ?? ".");
const runDir = resolve(args["run-dir"] ?? `work/${listing}-${iso}`);
const model = args.model ?? "claude-sonnet-5.5";
const trust = args["trust-tools"] ?? "@c64/c64_reload,@c64/c64_run,@c64/c64_read_screen,@c64/c64_press,@c64/checksum_line,@c64/apply_patch,read_file";
if (/trust-all/.test(trust)) throw new Error("never --trust-all-tools");
if (!args["stop-check"]) throw new Error("--stop-check is required: the model never decides when to stop"); // validated before any credit is spent
const prompt0 = readFileSync(args["prompt-file"], "utf8");
mkdirSync(dirname(out), { recursive: true });
mkdirSync(runDir, { recursive: true });

const t = () => new Date().toISOString();
const emit = (e) => appendFileSync(out, JSON.stringify({ t: t(), ...e }) + "\n");
const state = { iterations: 0, credits: null, startedAt: Date.now() };
let metered = false;
let sessionId = null;
let cycles = 0;
let stop = { stop: false, reason: "", result: "not-resurrected" };

emit({ k: "start", model, mode: "live", listing, runner: { kiroCli: kiroVersion(), agent: args.agent ?? null, trustTools: trust.split(","), caps: CAPS } });

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
const final = finalResult();
emit({ k: "end", result: final.result, iterations: state.iterations, wallMs: Date.now() - state.startedAt, cap: capReason, cycles, ...final.extra });
const ledger = addToLedger(resolve(args.ledger ?? "ledger"), metered ? state.credits : null);
console.log(JSON.stringify({ out, runDir, cycles, iterations: state.iterations, credits: metered ? state.credits : "unmetered", cap: capReason, result: final.result, ledger }));

function runKiro(cliArgs, timeoutMs) {
  return new Promise((res) => {
    const child = spawn("kiro-cli", cliArgs, { cwd: workspace, env: { ...process.env, RUN_DIR: runDir } });
    let buf = "";
    let killed = false;
    const stop = (why) => { if (killed) return; killed = why; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); };
    const timer = setTimeout(() => stop("wall"), Math.max(1000, timeoutMs));
    const calls = new Map();
    // live caps: iterations are counted from the stream as they happen; credits arrive once per process (K3), so
    // the credit cap can only be checked between cycles — a cycle may overshoot it by its own spend (logged).
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
  if (ev.k === "credits") { metered = true; state.credits = (state.credits ?? 0) + ev.usage; emit({ k: "credits", metered: true, delta: ev.usage, total: state.credits }); return; }
  if (ev.k === "tool_load") { emit({ k: "kiro", op: "tool_load", id: ev.id }); return; }
  if (ev.k === "tool_call") {
    calls.set(ev.toolCallId, ev);
    if (/apply_patch/.test(ev.title)) { state.iterations++; liveCheck(); }
    emit({ k: "kiro", op: "tool_call", title: ev.title, server: ev.server, input: ev.input });
    return;
  }
  if (ev.k === "tool_result") {
    const call = calls.get(ev.toolCallId);
    if (ev.hookRefusal) { state.iterations++; liveCheck(); } // a refused fix attempt is an iteration too (the hook stops it before the server)
    if (ev.hookRefusal) emit({ k: "hook", hook: "checksum-gate", exit: 2, stderr: hookText(ev.text), tool: call?.title });
    else emit({ k: "kiro", op: "tool_result", title: call?.title, status: ev.status, permissionDenied: ev.permissionDenied, text: ev.text.slice(0, 4000) });
    return;
  }
  if (ev.k === "finished") emit({ k: "kiro", op: "finished", status: ev.status, stopReason: ev.stopReason, finalText: ev.finalText.slice(0, 4000) });
}

function hookText(text) {
  // kiro-cli 3.5.0 wraps the hook's STDERR between a fixed preamble and a fixed epilogue (measured in K1)
  const m = text.match(/address:\s*\n\n([\s\S]*?)\n\nThe tool was NOT executed/);
  return (m ? m[1] : text).trim().slice(0, 2000);
}

let mergedLines = 0;
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
  const r = spawnSync("kiro-cli", ["--version"], { encoding: "utf8" });
  return (r.stdout || "").trim();
}
