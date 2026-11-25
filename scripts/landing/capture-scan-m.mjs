#!/usr/bin/env node
// Phone crop for the landing's card I (public/landing/img/scan-m.webp): the LIVE /scan page at 390×844 @2x in
// Playwright's bundled Chromium, "Read our authored page" → in-tab tesseract.js → the ASSISTED table; rows 10–30
// (incl. the line-20 mismatch) cropped. Prints the row states so the alt text can be checked against this capture.
//   node scripts/landing/capture-scan-m.mjs <baseUrl> <out.png>   then: cwebp -q 84 -m 6 out.png -o public/landing/img/scan-m.webp
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
const [base, out] = process.argv.slice(2);
if (!base || !out) { console.error("usage: capture-scan-m.mjs <baseUrl> <out.png>"); process.exit(2); }
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto(base + "/scan");
await p.click("[data-testid=read-authored]");
await p.waitForFunction(() => window.__scan && window.__scan.done, null, { timeout: 300_000 });
await p.waitForTimeout(800);
const rows = await p.$$eval("[data-testid=assisted] tbody tr", (t) => t.map((r) => `${/\bbad\b/.test(r.className) ? "mismatch" : "ok"} ${r.querySelector("td.n")?.textContent.trim()}`));
console.log(JSON.stringify({ browser: b.version(), rows }));
const full = out.replace(/\.png$/, "-full.png");
await p.locator("[data-testid=assisted]").screenshot({ path: full });
await b.close();
execFileSync("magick", [full, "-crop", "716x450+0+662", "+repage", out]); // rows 10–30 at 390 px @2x (measured 2026-11-26)
