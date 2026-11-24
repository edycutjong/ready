#!/usr/bin/env node
/**
 * First-viewport check (P1e rubric gate): a visitor who does nothing must see the run play, and the page must not
 * overflow sideways on a phone. Local vite dev (the same page the build ships).
 *   node scripts/first-viewport-check.mjs [--out evidence/e2e/first-viewport.json] [--shots <dir>]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const port = 5198;
const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
await new Promise((res, rej) => { vite.stdout.on("data", (d) => /Local:/.test(d.toString()) && res()); setTimeout(() => rej(new Error("vite did not start")), 30_000); });
const browser = await chromium.launch();
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=resurrect]").length > 0, null, { timeout: 30_000 });
  const done0 = await page.locator(".strip li.done").count();
  await page.waitForTimeout(3500);
  const done1 = await page.locator(".strip li.done").count();
  check("autoplay: the recorded run advances with no click", done1 > done0, { stepsDoneAtLoad: done0, after3_5s: done1 });
  if (a.shots) { mkdirSync(a.shots, { recursive: true }); await page.screenshot({ path: `${a.shots}/first-viewport-1440.png` }); }
  const still = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await still.goto(`http://localhost:${port}/?still=1`);
  await still.waitForFunction(() => document.querySelectorAll("[data-testid=resurrect]").length > 0, null, { timeout: 30_000 });
  await still.waitForTimeout(3000);
  check("?still=1 keeps the run still", (await still.locator(".strip li.done").count()) === 0, null);
  for (const w of [390, 375]) {
    const m = await browser.newPage({ viewport: { width: w, height: 844 } });
    await m.goto(`http://localhost:${port}/?still=1`);
    await m.waitForFunction(() => document.querySelectorAll("[data-testid=resurrect]").length > 0, null, { timeout: 30_000 });
    const o = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, nav: Math.round(document.querySelector("nav")?.getBoundingClientRect().height ?? 0) }));
    check(`no horizontal overflow at ${w}px`, o.sw <= o.iw, o);
    if (a.shots) await m.screenshot({ path: `${a.shots}/first-viewport-${w}.png` });
  }
} finally { await browser.close(); vite.kill(); }
const ok = checks.every((c) => c.pass);
if (a.out) { mkdirSync(dirname(a.out), { recursive: true }); writeFileSync(a.out, JSON.stringify({ at: new Date().toISOString(), ok, checks }, null, 2)); }
console.log(JSON.stringify({ ok, checks }, null, 1));
process.exit(ok ? 0 : 1);
