#!/usr/bin/env node
// Screenshots of the judge path for design review: node scripts/screenshots.mjs <baseUrl> <outDir> [--play]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [name, w, h] of [["1440", 1440, 900], ["375", 375, 812]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(base + "/");
  await page.waitForFunction(() => window.__ready && ["replay", "recorded"].includes(window.__ready.mode) && window.__ready.steps > 0, null, { timeout: 60_000 });
  await page.screenshot({ path: `${out}/S1-start-${name}.png`, fullPage: false });
  await page.click("[data-testid=resurrect]");
  await page.waitForFunction(() => window.__ready.step === window.__ready.steps, null, { timeout: 120_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/S1-raised-${name}.png`, fullPage: true });
  await page.locator("[data-testid=certificate]").screenshot({ path: `${out}/certificate-${name}.png` });
  await page.goto(base + "/kiro"); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/kiro-${name}.png`, fullPage: true });
  await page.goto(base + "/scan"); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/scan-${name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log("screenshots →", out);
