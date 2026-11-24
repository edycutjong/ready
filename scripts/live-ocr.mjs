#!/usr/bin/env node
// Live check of ASSISTED part 1 on a deployed URL: node scripts/live-ocr.mjs <baseUrl> [out.json]
// For each ScanQuality stop: Read the real 1984 page (via /api/page) → in-tab tesseract.js → checksum flags. Records timings + counts.
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch();
const results = [];
const external = new Set();
for (const stop of [800, 1600, 2376]) {
  const page = await browser.newPage();
  page.on("request", (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && !u.protocol.startsWith("blob") && !u.protocol.startsWith("data")) external.add(u.origin); });
  await page.goto(base + "/scan");
  await page.selectOption("[data-testid=stop]", String(stop));
  const t0 = Date.now();
  await page.click("[data-testid=read-archive]");
  await page.waitForFunction(() => window.__scan && window.__scan.done, null, { timeout: 300_000 });
  const s = await page.evaluate(() => window.__scan);
  results.push({ stop, wallMs: Date.now() - t0, ...s });
  if (stop === 1600) await page.screenshot({ path: "/tmp/shots/scan-live-1600.png", fullPage: false });
  await page.close();
}
await browser.close();
const rec = { base, date: new Date().toISOString(), engine: "tesseract.js 7.0.0 self-hosted", externalOrigins: [...external], results };
if (out) writeFileSync(out, JSON.stringify(rec, null, 1) + "\n");
console.log(JSON.stringify(rec));
