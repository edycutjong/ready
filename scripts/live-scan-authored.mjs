#!/usr/bin/env node
// Live check of /scan on OUR authored line-20 page: node scripts/live-scan-authored.mjs <baseUrl> [out.json] [runs]
// Runs in Playwright's bundled Chromium AND in the installed Google Chrome (channel "chrome", when present): the page is
// resampled to the scan width on a canvas (imageSmoothingQuality "high"), and that resampler differs between browser builds,
// so the OCR can read a line differently per build. Both are recorded with their versions; nothing is averaged away.
// Each run: fresh tab → "Read our authored page" → in-tab tesseract.js → checksum flags. Records the heading, every row as
// shown (line number, ok/bad, the text in the editable field, the mark) and the engine timings, so the rows a judge sees on
// /scan (including any misread the OCR adds on its own) are on file, not just in a video.
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
const [base, out, runsArg] = process.argv.slice(2);
if (!base) { console.error("usage: live-scan-authored.mjs <baseUrl> [out.json] [runs]"); process.exit(2); }
const runs = Math.max(1, Number(runsArg) || 3);
const results = [];
const external = new Set();
const browsers = [];
for (const channel of [undefined, "chrome"]) {
  let browser;
  try { browser = await chromium.launch(channel ? { channel } : {}); } catch (e) { browsers.push({ channel: channel ?? "bundled chromium", skipped: String(e.message).split("\n")[0] }); continue; }
  const version = browser.version();
  browsers.push({ channel: channel ?? "bundled chromium", version });
  for (let i = 0; i < runs; i++) {
    const page = await browser.newPage();
    page.on("request", (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && !u.protocol.startsWith("blob") && !u.protocol.startsWith("data")) external.add(u.origin); });
    await page.goto(base + "/scan");
    const t0 = Date.now();
    await page.click("[data-testid=read-authored]");
    await page.waitForFunction(() => window.__scan && window.__scan.done, null, { timeout: 300_000 });
    const s = await page.evaluate(() => window.__scan);
    const shown = await page.evaluate(() => ({
      heading: document.querySelector("[data-testid=assisted-heading]")?.textContent.trim() ?? null,
      meta: document.querySelector("[data-testid=ocr-meta]")?.textContent.trim() ?? null,
      rows: [...document.querySelectorAll("[data-testid=assisted] tbody tr")].map((t) => ({
        n: t.querySelector("td.n")?.textContent.trim() ?? "",
        state: /\bbad\b/.test(t.className) ? "mismatch" : /\bok\b/.test(t.className) ? "ok" : t.className,
        text: (t.querySelector("input")?.value ?? t.querySelector("td.body")?.textContent ?? "").trim(),
        rem: t.querySelector("td.rem")?.textContent.trim() ?? "",
        mark: t.querySelector("td.mk")?.textContent.trim() ?? "",
      })),
    }));
    results.push({ browser: channel ?? "bundled chromium", version, run: i + 1, wallMs: Date.now() - t0, scan: s, ...shown });
    await page.close();
  }
  await browser.close();
}
const key = (r) => JSON.stringify(r.rows.map((x) => [x.n, x.state, x.text]));
const perBrowser = browsers.filter((b) => b.version).map((b) => {
  const rs = results.filter((r) => r.version === b.version && r.browser === b.channel);
  return { ...b, runs: rs.length, identicalRowsAcrossRuns: rs.every((r) => key(r) === key(rs[0])), heading: rs[0]?.heading ?? null,
    mismatchRows: rs[0] ? rs[0].rows.filter((x) => x.state === "mismatch").map((x) => `${x.n}: ${x.text}`) : [], wallMs: rs.map((r) => r.wallMs) };
});
const rec = {
  base, date: new Date().toISOString(), engine: "tesseract.js 7.0.0 self-hosted", page: "our authored 2026 line-20 page (typeset by us; not a 1984 scan)",
  runsPerBrowser: runs, browsers, perBrowser, externalOrigins: [...external], results,
};
if (out) writeFileSync(out, JSON.stringify(rec, null, 1) + "\n");
console.log(JSON.stringify({ perBrowser, browsers, externalOrigins: rec.externalOrigins }, null, 1));
