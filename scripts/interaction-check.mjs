#!/usr/bin/env node
/**
 * Interaction QA (byte-diff method): for every interactive element on each route, hover it and compare screenshots of its
 * box before/after (pixel bytes must differ), focus it with the keyboard and require a visible focus ring, and check every
 * same-origin link answers 200. node scripts/interaction-check.mjs <baseUrl> [out.json]
 */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch();
const rep = [];
const sha = (b) => createHash("sha256").update(b).digest("hex");
for (const route of ["/", "/scan", "/kiro"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + route);
  await page.waitForTimeout(route === "/" ? 3500 : 800);
  const sel = "a[href], button:not(:disabled), select, input[type=file], input[type=range]";
  const els = await page.$$(sel);
  for (const el of els) {
    if (!(await el.isVisible())) continue;
    const label = await el.evaluate((e) => (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().replace(/\s+/g, " ").slice(0, 44));
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (!box) continue;
    const clip = { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.width + 12, height: box.height + 12 };
    await page.mouse.move(2, 2);
    await page.waitForTimeout(260);
    const before = sha(await page.screenshot({ clip }));
    await el.hover();
    await page.waitForTimeout(380);
    const hover = sha(await page.screenshot({ clip }));
    await page.mouse.move(2, 2);
    await el.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(260);
    const focused = await el.evaluate((e) => e === document.activeElement && getComputedStyle(e).outlineStyle !== "none" && parseFloat(getComputedStyle(e).outlineWidth) > 0);
    // native selects / file inputs paint their own hover (OS chrome)
    const nativeHover = tag === "input" || tag === "select";
    let status = null;
    if (tag === "a") {
      const href = await el.getAttribute("href");
      if (href && href.startsWith("/")) status = (await fetch(base + href)).status;
    }
    rep.push({ route, label, tag, hoverChanged: before !== hover, focusRing: focused, nativeHover, linkStatus: status });
  }
  await page.close();
}
await browser.close();
const fails = rep.filter((r) => (!r.hoverChanged && !r.nativeHover) || !r.focusRing || (r.linkStatus !== null && r.linkStatus !== 200));
const res = { base, date: new Date().toISOString(), checked: rep.length, failing: fails.length, fails, all: rep };
if (out) writeFileSync(out, JSON.stringify(res, null, 1) + "\n");
console.log(JSON.stringify({ checked: rep.length, failing: fails.length, fails }, null, 1));
