#!/usr/bin/env node
/**
 * OCR a listing page and recover lost lines BY CODE (agents.md §4; spike G0's pipeline, now in the repo):
 *   1. tesseract.js (psm 6) on the page → physical rows with boxes → logical lines (src/ocr/recover.ts)
 *   2. diff against the page's line inventory (data/listings.json expectedLines + scopeRanges)
 *   3. every absent line: re-OCR its gap crop at 2× (psm 6 and 4); exactly one distinct checksum-valid reading →
 *      recovered (provisional), else left for a PERSON to type (scripts/type-lost-lines.mjs) — never the model
 *   4. every orphan (a number not in the inventory): re-OCR its rows; a re-read inventory number keeping the printed
 *      sum → renumbered, else excluded; 5. number collisions kept apart and resolved by checksum
 * Writes { lines, recovery[], summary, ocr } for scripts/make-run-input.mjs. Builder's machine (macOS `sips` crops).
 *   node scripts/recover-listing.mjs --listing randnum --page <page.png> --out <recovered.json> [--cache <tess cache>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createWorker } from "tesseract.js";
import { computeChecksum } from "../src/basic/checksum.ts";
import { chooseRecovered, logicalFromRows, logicalFromText, planRecovery, resolveOrphan } from "../src/ocr/recover.ts";

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const meta = JSON.parse(readFileSync(new URL("../data/listings.json", import.meta.url), "utf8"))[a.listing];
const expected = meta.spec.expectedLines;
const page = a.page;
const width = Number(execFileSync("sips", ["-g", "pixelWidth", page], { encoding: "utf8" }).match(/pixelWidth: (\d+)/)[1]);
const worker = await createWorker("eng", 1, a.cache ? { cachePath: a.cache } : {});
await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
const { data } = await worker.recognize(page, {}, { blocks: true, text: true });
const rows = [];
for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) rows.push({ text: l.text.replace(/\n$/, ""), bbox: l.bbox });
const plan = planRecovery(logicalFromRows(rows), rows, expected, meta.scopeRanges);

async function reocr(y0, y1, psm) {
  const h = Math.max(8, y1 - y0), tmp = `/tmp/ready-recover-${process.pid}-${y0}-${psm}.png`;
  execFileSync("sips", ["-c", String(h + 8), String(width), "--cropOffset", String(Math.max(0, y0 - 4)), "0", page, "--out", tmp], { stdio: "ignore" });
  execFileSync("sips", ["--resampleWidth", String(width * 2), tmp, "--out", tmp], { stdio: "ignore" });
  await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
  const r = await worker.recognize(tmp);
  await worker.setParameters({ tessedit_pageseg_mode: "6" });
  return r.data.text;
}

const recovery = [];
const lines = plan.inScope.filter((l) => expected.includes(l.n)).map((l) => ({ n: l.n, body: l.body, printed: l.printed, source: "ocr" }));
const present = new Set(lines.map((l) => l.n));
for (const gap of plan.absent) {
  const cands = [];
  for (const psm of [6, 4]) cands.push(...logicalFromText(await reocr(gap.gap[0], gap.gap[1], psm)));
  const c = chooseRecovered(gap.n, cands);
  recovery.push({ k: "recovery", op: "re-ocr", line: gap.n, outcome: c.outcome, candidates: cands.length, validDistinct: c.validDistinct, gap: gap.gap });
  if (c.line) { lines.push({ n: gap.n, body: c.line.body, printed: c.line.printed, source: "re-ocr" }); present.add(gap.n); }
}
for (const o of plan.orphans) {
  const hit = resolveOrphan(o, logicalFromText(await reocr(rows[o.rows[0]].bbox.y0, rows[o.rows.at(-1)].bbox.y1, 6)), expected, present);
  recovery.push(hit ? { k: "recovery", op: "orphan", ocrNumber: o.n, outcome: "renumbered-by-re-ocr", to: hit.n } : { k: "recovery", op: "orphan", ocrNumber: o.n, outcome: "orphan-excluded" });
  if (hit) { lines.push({ n: hit.n, body: hit.body, printed: hit.printed, source: "re-ocr" }); present.add(hit.n); }
}
// collisions: two candidates for one number → keep the checksum-valid one (never silently overwrite)
const byN = new Map();
for (const l of lines) byN.set(l.n, [...(byN.get(l.n) ?? []), l]);
const final = [];
for (const [n, ls] of byN) {
  if (ls.length === 1) { final.push(ls[0]); continue; }
  const valid = ls.filter((l) => l.printed !== null && computeChecksum(l.n, l.body) === l.printed);
  const keep = valid.length === 1 ? valid[0] : ls[0];
  recovery.push({ k: "recovery", op: "collision", line: n, kept: keep.source, dropped: ls.length - 1 });
  final.push(keep);
}
await worker.terminate();
final.sort((x, y) => x.n - y.n);
const valid = (l) => l.printed !== null && computeChecksum(l.n, l.body) === l.printed;
const tjs = JSON.parse(readFileSync(new URL("../node_modules/tesseract.js/package.json", import.meta.url), "utf8")).version;
const out = { lines: final.map((l) => ({ ...l, checksumValid: valid(l) })), recovery, ocr: { engine: `tesseract.js ${tjs}`, psm: 6, pageWidthPx: width, physicalRows: rows.length },
  summary: { expected: expected.length, present: final.length, missing: expected.filter((n) => !present.has(n)), checksumValid: final.filter(valid).length, typedNeeded: expected.filter((n) => !present.has(n)).length } };
writeFileSync(a.out, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ summary: out.summary, recovery: recovery.map((r) => `${r.op}:${r.line ?? r.ocrNumber}:${r.outcome}`) }));
