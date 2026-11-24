#!/usr/bin/env node
/**
 * Judge-path E2E on the local desk (vite dev = builder routes: the c64.wasm and local tier-C runs):
 *   1. open a recorded run → REPLAY mode (the in-browser C64 re-runs every accepted patch)
 *   2. replay agrees with the record (0 mismatches) and the recomputed contract equals the recorded end result
 *   3. the C64 screen RAM text shows the listing's post-title text when RESURRECTED (or the honest PARTIAL state)
 *   4. Cheat is refused by the gate
 *   5. /kiro lists ≥ 1 real hook firing from that run
 *   node scripts/e2e-replay.mjs --run <id> [--expect-screen "RANDOM SEEDS."] [--out evidence/e2e/<file>.json]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const port = 5199;
const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
await new Promise((res, rej) => { vite.stdout.on("data", (d) => /Local:/.test(d.toString()) && res()); setTimeout(() => rej(new Error("vite did not start")), 30_000); });
const browser = await chromium.launch();
const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass: Boolean(pass), detail }); };
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/?run=${encodeURIComponent(a.run)}`);
  await page.waitForFunction(() => window.__ready && ["replay", "recorded", "error"].includes(window.__ready.mode) && window.__ready.steps > 0, null, { timeout: 180_000 });
  const st = await page.evaluate(() => window.__ready);
  check("mode is REPLAY (in-browser C64 re-executes)", st.mode === "replay", st.mode);
  check("replay agrees with the record", Array.isArray(st.mismatches) && st.mismatches.length === 0, st.mismatches);
  const rec = String(st.recordedEnd?.result ?? "").toUpperCase();
  check("recomputed contract = recorded end result", st.contract && st.contract.verdict === rec, { recomputed: st.contract?.verdict, recorded: rec, heading: st.contract?.heading });
  const screen = await page.textContent("[data-testid=screen]");
  if (st.contract?.verdict === "RESURRECTED") check(`screen RAM text shows "${a["expect-screen"]}"`, a["expect-screen"] ? screen.includes(a["expect-screen"]) : true, screen.split("\n").filter(Boolean).slice(-6));
  else check("honest PARTIAL/NOT state shown on the certificate", /PARTIAL|NOT RESURRECTED/.test(await page.textContent("[data-testid=certificate]")), st.contract?.heading);
  await page.click("[data-testid=cheat]");
  const cheat = await page.textContent("[data-testid=cheat-out]");
  check("Cheat refused by the gate", /REFUSED/.test(cheat), cheat);
  await page.goto(`http://localhost:${port}/kiro`);
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=kiro-rows] tbody tr").length > 0, null, { timeout: 30_000 });
  const hookRows = await page.$$eval("[data-testid=kiro-rows] tbody tr", (trs) => trs.map((t) => t.textContent).filter((t) => /hook /.test(t)));
  check("/kiro lists ≥ 1 real hook firing", hookRows.length >= 1, hookRows.slice(0, 3));
} finally {
  await browser.close();
  vite.kill();
}
const out = { t: new Date().toISOString(), run: a.run, pass: checks.every((c) => c.pass), checks };
if (a.out) { mkdirSync(dirname(a.out), { recursive: true }); writeFileSync(a.out, JSON.stringify(out, null, 1) + "\n"); }
console.log(JSON.stringify(out, null, 1));
process.exit(out.pass ? 0 : 1);
