#!/usr/bin/env node
/**
 * Judge path on a DEPLOYED URL (no install, clean profile): time to a playable page, press Resurrect, check the recorded
 * run plays to its end, the certificate + stamp appear, Cheat is refused, /kiro lists real hook rows, and no ROM WASM is served.
 *   node scripts/live-judge-path.mjs <baseUrl> [out.json]
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
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
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=dl-prg]")]);
check(".PRG download works", /\.prg$/.test(dl.suggestedFilename()), dl.suggestedFilename());
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
