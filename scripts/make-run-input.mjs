#!/usr/bin/env node
/**
 * Build a run's $RUN_DIR/input.json from a recovered listing (after lost-line recovery by CODE, agents.md §4) and the
 * listing's spec in data/listings.json. Every line's starting status is computed by the same gate code
 * (`checkLine`): verified / digit-misread / unverified. Lines restored by recovery (re-OCR, TYPED) start provisional.
 *   node scripts/make-run-input.mjs --listing randnum --recovered <recovered.json> --out <input.json>
 * recovered.json: { lines: [{ n, body, printed, source }] } (e.g. spike G0's output). Tier C: Gazette-derived input
 * stays in the kitchen / gitignored paths; this script only transforms it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { checkLine } from "../src/gate/checksum-gate.ts";

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const listings = JSON.parse(readFileSync(new URL("../data/listings.json", import.meta.url), "utf8"));
const meta = listings[a.listing];
if (!meta) throw new Error(`unknown listing ${a.listing}`);
const rec = JSON.parse(readFileSync(a.recovered, "utf8"));
const expected = new Set(meta.spec.expectedLines);
const lines = rec.lines.map((l) => {
  const c = checkLine(l.n, l.body, l.printed ?? null);
  return { n: l.n, body: l.body, printed: l.printed ?? null, status: c.status === "mismatch" ? "unverified" : c.status, source: l.source ?? "ocr" };
});
const provisional = lines.filter((l) => l.source === "re-ocr" || l.source === "typed").map((l) => l.n);
const input = { listingId: a.listing, scope: meta.scope, spec: meta.spec, lines, provisional, origin: { recovered: a.recovered.split("/").pop(), note: meta.note } };
writeFileSync(a.out, JSON.stringify(input, null, 1) + "\n");
const by = (s) => lines.filter((l) => expected.has(l.n) && l.status === s).length;
console.log(JSON.stringify({ out: a.out, lines: lines.length, verified: by("verified"), digitMisread: by("digit-misread"), unverified: by("unverified"), provisional, outOfScope: lines.filter((l) => !expected.has(l.n)).map((l) => l.n) }));
