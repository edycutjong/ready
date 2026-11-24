#!/usr/bin/env node
/**
 * Typeset an AUTHORED 2026 listing into a magazine-layout page image (Atkinson Hyperlegible Mono, OCR-clean), run the
 * real OCR the product ships (tesseract.js, psm 6) once, and pin its output as a LABELLED fixture. The page is ours
 * (MIT); the OCR output is whatever tesseract.js read — nothing is corrected by hand (seed-data.md, Day-2 evening).
 *   node scripts/typeset-authored.mjs fixtures/authored/line20.bas --font <atkinson-mono.woff> --cache <tess cache dir>
 * Writes fixtures/authored/<id>.page.png and fixtures/authored/fixture-authored-ocr.json.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { chromium } from "playwright";
import { createWorker } from "tesseract.js";
import { splitLine } from "../src/basic/checksum.ts";

const a = Object.fromEntries(process.argv.slice(3).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const src = process.argv[2];
const id = basename(src, ".bas");
const printed = readFileSync(src, "utf8").split("\n").filter((l) => /^\d/.test(l));
const font = readFileSync(a.font).toString("base64");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = `<!doctype html><html><head><style>
@font-face { font-family: Mono; src: url(data:font/woff;base64,${font}) format("woff"); }
body { margin: 0; background: #fff; color: #111; }
.page { width: 1100px; padding: 60px 70px; font-family: Georgia, serif; }
h2 { font-size: 30px; margin: 0 0 6px; } .by { font-size: 16px; margin: 0 0 28px; color: #333; }
pre { font-family: Mono; font-size: 22px; line-height: 1.55; margin: 0; }
</style></head><body><div class="page"><h2>Program 1: The Last Seance</h2><p class="by">An original type-in listing, written in 2026 for this project.</p><pre>${printed.map(esc).join("\n")}</pre></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const png = await page.locator(".page").screenshot();
await browser.close();
const pngPath = `fixtures/authored/${id}.page.png`;
writeFileSync(pngPath, png);

const worker = await createWorker("eng", 1, a.cache ? { cachePath: a.cache } : {});
await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
const { data } = await worker.recognize(png);
await worker.terminate();
const tjs = JSON.parse(readFileSync(new URL("../node_modules/tesseract.js/package.json", import.meta.url), "utf8")).version;
const lines = data.text.split("\n").map((raw) => ({ raw, ...splitLine(raw) })).filter((l) => l.n !== null).map(({ raw, n, body, printed }) => ({ raw, n, body, printed }));
const out = {
  label: "authored 2026 page — typeset by us, real OCR, line 20 typo planted",
  listing: id, source: src, page: pngPath, pageSha256: createHash("sha256").update(png).digest("hex"),
  ocr: { engine: `tesseract.js ${tjs}`, psm: 6, lang: "eng", font: "Atkinson Hyperlegible Mono 500, 22 px @2x" },
  printedLines: printed.length, ocrLines: lines.length, text: data.text, lines,
};
writeFileSync(`fixtures/authored/fixture-authored-ocr.json`, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ page: pngPath, printed: printed.length, ocrLines: lines.length, ocrNumbers: lines.map((l) => l.n) }));
