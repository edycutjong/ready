#!/usr/bin/env node
/**
 * Judge path on a DEPLOYED URL (no install, clean profile): time to a playable page, press Resurrect, check the recorded
 * run plays to its end, the certificate + stamp appear, Cheat is refused, /kiro lists real hook rows, the page logs no console error or failed request, and no ROM WASM is served.
 *   node scripts/live-judge-path.mjs <baseUrl> [out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("requestfailed", (r) => consoleErrors.push(`requestfailed ${r.url()}`));
page.on("response", (r) => { if (r.status() >= 400) consoleErrors.push(`${r.status()} ${r.url()}`); });
const t0 = Date.now();
await page.goto(base + "/?still=1");
await page.waitForFunction(() => window.__ready && window.__ready.steps > 0, null, { timeout: 60_000 });
const firstPlayableMs = Date.now() - t0;
check("first playable paint ≤ 60 s, no install, clean profile", firstPlayableMs <= 60_000, { ms: firstPlayableMs });
const mode = await page.evaluate(() => window.__ready.mode);
check("mode is stated (RECORDED PLAYBACK while ROM rights are not cleared)", mode === "recorded" || mode === "replay", { mode });
await page.click("[data-testid=resurrect]");
await page.waitForFunction(() => window.__ready.step === window.__ready.steps, null, { timeout: 60_000 });
const st = await page.evaluate(() => window.__ready);
check("the recorded run plays to its end", st.step === st.steps && st.steps > 0, { steps: st.steps });
check("certificate shows the recorded RESURRECTED result", /RESURRECTED/.test(await page.textContent("[data-testid=certificate]")), null);
check("IT LIVES stamp lands, captioned 'as recorded' when nothing was re-run", (await page.locator("[data-testid=stamp-lives]").count()) === 1 && (mode !== "recorded" || /as recorded/.test(await page.textContent("[data-testid=stamp-caption]"))), { mode });
const screen = await page.textContent("[data-testid=screen]");
check("C64 pane shows the program's own screen, not the tool report", /THE SPIRITS ANSWER/.test(screen) && !/titleSeen|postTitle:/.test(screen), screen.split("\n").filter(Boolean).slice(0, 3));
await page.click("[data-testid=cheat]");
const cheat = await page.textContent("[data-testid=cheat-out]");
check("Cheat is refused by the gate", /REFUSED/.test(cheat), cheat);
// a2a judge r01: "fix it yourself" runs the visitor's line through the agent's gate (no C64): the agent's fix passes, a guess does not
await page.fill("[data-testid=mine]", '20 PRINT"   ** THE LAST SEANCE **"');
await page.click("[data-testid=mine-judge]");
const mineOk = await page.textContent("[data-testid=mine-out]");
await page.fill("[data-testid=mine]", '20 PRINT"   ** THE LOST SEANCE **"');
await page.click("[data-testid=mine-judge]");
const mineBad = await page.textContent("[data-testid=mine-out]");
check("fix it yourself: the agent's line 20 is ACCEPTED, a line that breaks the printed checksum is REFUSED", /ACCEPTED/i.test(mineOk) && /REFUSED/i.test(mineBad), [mineOk, mineBad]);
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=dl-prg]")]);
check(".PRG download works", /\.prg$/.test(dl.suggestedFilename()), dl.suggestedFilename());
// arch review 02: the .PRG holds exactly the page-inventory lines (the ones typed and compared by clause 6), in order
{
  const prg = readFileSync(await dl.path()), nums = [];
  for (let at = 2; at + 4 <= prg.length;) { const link = prg[at] | (prg[at + 1] << 8); if (link === 0) break; nums.push(prg[at + 2] | (prg[at + 3] << 8)); at = link - 0x0801 + 2; }
  const runFile = (await (await fetch(base + "/runs/index.json")).json()).runs.find((r) => r.id === "line20-hero").file;
  const start = (await (await fetch(base + runFile)).text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.k === "start");
  const want = [...start.input.spec.expectedLines].sort((a, b) => a - b);
  check(".PRG loads at $0801 and lists the run's page-inventory lines in order (the hero has no orphan; tests/unit/replay.test.ts proves the orphan filter)", prg[0] === 0x01 && prg[1] === 0x08 && JSON.stringify(nums) === JSON.stringify(want), { lines: nums.length, want: want.length });
}
check("judge path page: 0 console errors, 0 failed or 4xx/5xx requests", consoleErrors.length === 0, consoleErrors.slice(0, 5));
// arch review 02: the URL a judge actually opens (no ?still=1) autoplays: says it is playing, reaches the certificate, logs nothing
{
  const auto = await ctx.newPage(), autoErr = [];
  auto.on("console", (m) => { if (m.type() === "error") autoErr.push(m.text()); });
  auto.on("requestfailed", (r) => autoErr.push(`requestfailed ${r.url()}`));
  auto.on("response", (r) => { if (r.status() >= 400) autoErr.push(`${r.status()} ${r.url()}`); });
  await auto.goto(base + "/");
  await auto.waitForFunction(() => window.__ready && window.__ready.steps > 0, null, { timeout: 60_000 });
  await auto.waitForTimeout(1200);
  const cap = await auto.textContent("[data-testid=screen-caption]");
  check("/ autoplays: the caption never asks to press Resurrect while the run plays", !/Press Resurrect/.test(cap), cap);
  await auto.waitForFunction(() => window.__ready.step === window.__ready.steps, null, { timeout: 90_000 });
  check("/ autoplay reaches the RESURRECTED certificate", /RESURRECTED/.test(await auto.textContent("[data-testid=certificate]")), null);
  check("/ autoplay: 0 console errors, 0 failed or 4xx/5xx requests", autoErr.length === 0, autoErr.slice(0, 5));
  await auto.close();
}
// a2a judge r01: the two harder public authored runs (eval cases 5 and 6) play to their certificates on the same page
for (const [id, post, blamed] of [["knock-case5", /THE WALL SAYS: IT LIVES/, null], ["ossuary-case6", /24 BONES, SUM 115/, /^19 /]]) {
  const pg = await ctx.newPage(), errs = [];
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  pg.on("response", (r) => { if (r.status() >= 400 && !/\/c64\.wasm$/.test(r.url())) errs.push(`${r.status()} ${r.url()}`); });
  await pg.goto(`${base}/?still=1&run=${id}`);
  await pg.waitForFunction(() => window.__ready && window.__ready.steps > 0, null, { timeout: 60_000 });
  await pg.click("[data-testid=resurrect]");
  await pg.waitForFunction(() => window.__ready.step === window.__ready.steps, null, { timeout: 90_000 });
  const cert = await pg.textContent("[data-testid=certificate]"), scr = await pg.textContent("[data-testid=screen]");
  const pre = await pg.inputValue("[data-testid=mine]");
  let mine = "";
  if (blamed) { await pg.click("[data-testid=mine-judge]"); mine = await pg.textContent("[data-testid=mine-out]"); }
  check(`${id}: plays to its recorded RESURRECTED certificate and the program's own post-title screen, 0 errors${blamed ? "; the line the C64 blamed (19), judged as read, already matches its printed checksum" : ""}`,
    /RESURRECTED/.test(cert) && post.test(scr) && errs.length === 0 && (!blamed || (blamed.test(pre) && /already matches its printed checksum/.test(mine))), { errs: errs.slice(0, 3), prefill: pre, mine });
  await pg.close();
}
await page.goto(base + "/kiro");
await page.waitForFunction(() => document.querySelectorAll("[data-testid=kiro-rows] tbody tr").length > 0, null, { timeout: 30_000 });
const hook = await page.$$eval("[data-testid=kiro-rows] tbody tr", (t) => t.map((r) => r.textContent).filter((x) => /hook /.test(x)));
check("/kiro lists ≥ 1 real hook firing from the recorded run", hook.length >= 1, hook.slice(0, 2));
const wasm = await fetch(base + "/c64.wasm");
check("no ROM-bearing WASM is served", wasm.status === 404, wasm.status);
const p = await fetch(base + "/api/page?id=1984-06-computegazette&n=177&w=800");
check("/api/page serves the real archive.org page image", p.status === 200 && /image\/jpeg/.test(p.headers.get("content-type")), { status: p.status, bytes: (await p.arrayBuffer()).byteLength });
await browser.close();
const ok = checks.every((c) => c.pass);
const res = { base, date: new Date().toISOString(), ok, checks };
if (out) writeFileSync(out, JSON.stringify(res, null, 1) + "\n");
console.log(JSON.stringify(res, null, 1));
process.exit(ok ? 0 : 1);
