#!/usr/bin/env node
/**
 * bench: p50/p95 of the product's own stages on THIS machine, N stated per row → evidence/bench/bench-<date>.json.
 *   gate          applyPatch on the authored listing (N=2000)
 *   emulator boot bootNodeCore + first screen (N=10)
 *   run           type the listing + RUN to the title on the node C64 (N=10)
 *   replay        replay() of the recorded authored run incl. gate re-judge + C64 re-run (N=10)
 *   ocr           tesseract.js 7 on the authored page image, psm 6, node (N=5; first run excluded = worker + data load)
 * Model-call timings are READ from the recorded runs (wallMs of end events), never re-measured (no credits).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createWorker } from "tesseract.js";
import { applyPatch } from "../src/gate/checksum-gate.ts";
import { bootNodeCore, c64ReadyWasmSha256 } from "../src/emu/node.ts";
import { runListing } from "../src/emu/session.ts";
import { replay } from "../src/replay/replay.ts";

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const row = (name, n, xs, unit = "ms") => ({ name, n, unit, p50: Number(pct(xs, 50).toFixed(3)), p95: Number(pct(xs, 95).toFixed(3)), min: Number(Math.min(...xs).toFixed(3)), max: Number(Math.max(...xs).toFixed(3)) });
const time = async (n, f) => { const xs = []; for (let i = 0; i < n; i++) { const t = performance.now(); await f(); xs.push(performance.now() - t); } return xs; };

const input = JSON.parse(readFileSync("fixtures/authored/line20-input.json", "utf8"));
const runFile = readdirSync("public/runs").find((f) => /^line20-.*\.jsonl$/.test(f));
const events = readFileSync(`public/runs/${runFile}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = [];

rows.push(row("gate: applyPatch (authored line-20 fix)", 2000, await time(2000, () => applyPatch(input.lines, [{ type: "replace", lineno: 20, new_body: 'PRINT"   ** THE LAST SEANCE **" ' }], input.spec.expectedLines))));
rows.push(row("emulator boot (c64-ready WASM, node)", 10, await time(10, () => bootNodeCore())));
const core = await bootNodeCore();
rows.push(row("type listing + RUN to the first screen (12 lines)", 10, await time(10, () => runListing(core, input.lines, input.spec))));
rows.push(row("REPLAY of the recorded run (gate re-judge + C64 re-run)", 10, await time(10, async () => { const c = await bootNodeCore(); replay(events, c, { wasmSha256: c64ReadyWasmSha256() }); })));
const worker = await createWorker("eng", 1, {});
await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
await worker.recognize("fixtures/authored/line20.page.png"); // warm-up, excluded
rows.push(row("OCR: tesseract.js 7 on the authored page image (node, warm worker)", 5, await time(5, () => worker.recognize("fixtures/authored/line20.page.png"))));
await worker.terminate();
const ends = events.filter((e) => e.k === "end");
const recorded = ends.map((e) => ({ file: runFile, result: e.result, wallMs: e.wallMs, iterations: e.iterations }));
const out = { date: new Date().toISOString(), machine: process.platform + " " + process.arch + " node " + process.version, emulator: `c64-ready@3.4.0 ${c64ReadyWasmSha256().slice(0, 12)}…`, rows, modelCallTimingsFromRecordedRuns: recorded, note: "Browser OCR on the deployed site is measured separately (spike-P-ocr-live.json). Model timings are read from the recorded run, not re-run." };
mkdirSync("evidence/bench", { recursive: true });
writeFileSync(`evidence/bench/bench-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 1) + "\n");
for (const r of rows) console.log(`${r.name.padEnd(70)} n=${String(r.n).padEnd(5)} p50=${r.p50}ms p95=${r.p95}ms`);
