#!/usr/bin/env node
/**
 * bugfix-boot-detect U9: what the per-frame title latch costs. Medians over N runs on THIS machine, real C64 core:
 *   static   runProgram 3000 frames on a program that prints once and waits in GET (no latch vs latch), N=5
 *   hero     runListing on the authored line-20 input as fixed (title + post-title), N=5
 *   knock    runListing on the case-5 input (an OCR fault stops it at line 40), N=5
 *   node scripts/bench-boot-detect.mjs [--out evidence/boot-detect/cost.json]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { bootNodeCore } from "../src/emu/node.ts";
import { runProgram } from "../src/emu/core.ts";
import { loadCanonical, runListing } from "../src/emu/session.ts";

const argv = process.argv.slice(2);
const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
const core = await bootNodeCore();
const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = (n, f) => { const t = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); f(); t.push(performance.now() - t0); } return Math.round(med(t)); };
const waitProg = ['PRINT"{CLR}WAITING"', 'GETK$:IFK$=""THEN20'].map((body, i) => ({ n: (i + 1) * 10, body, printed: null, status: "forced", source: "bench" }));
const hero = JSON.parse(readFileSync("fixtures/authored/line20-input.json", "utf8"));
const heroFixed = hero.lines.map((l) => (l.n === 20 ? { ...l, body: 'PRINT"   ** THE LAST SEANCE **" ' } : l));
const knock = JSON.parse(readFileSync("fixtures/authored/knock-input.json", "utf8"));
const rows = {
  staticNoLatchMs: time(5, () => { loadCanonical(core, waitProg); runProgram(core, { maxFrames: 3000 }); }),
  staticLatchMs: time(5, () => { loadCanonical(core, waitProg); runProgram(core, { maxFrames: 3000, latch: (s) => s.includes("NEVER SHOWN") }); }),
  heroRunListingMs: time(5, () => runListing(core, heroFixed, hero.spec)),
  knockRunListingMs: time(5, () => runListing(core, knock.lines, knock.spec)),
};
const res = { t: new Date().toISOString(), node: process.version, n: 5, ...rows, latchOverhead: Number((rows.staticLatchMs / rows.staticNoLatchMs).toFixed(2)) };
if (out) { mkdirSync("evidence/boot-detect", { recursive: true }); writeFileSync(out, JSON.stringify(res, null, 1) + "\n"); }
console.log(JSON.stringify(res));
