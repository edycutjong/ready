#!/usr/bin/env node
/**
 * Print an AUTHORED 2026 listing the way a 1984 magazine would: every line gets the Gazette `:rem` checksum of the
 * INTENDED line, then the planted misprints are applied to the printed text only — so the page disagrees with its own
 * checksums exactly where a typesetting or OCR fault would. Deterministic precheck (0 credits) on the real C64 core:
 * the intended listing must reach the title AND the post-title text, and the printed one must not.
 *   node scripts/author-page.mjs --id knock --misprint '80=DATA 73,84,32,78'
 *   node scripts/author-page.mjs --id ossuary --misprint '890=DATA 5,3,5.8,9,7,9,3'
 * Reads fixtures/authored/<id>.intended.bas + data/listings.json[<id>].spec; writes fixtures/authored/<id>.bas
 * (the page as printed, input of scripts/typeset-authored.mjs) and prints the precheck as one JSON line.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { computeChecksum } from "../src/basic/checksum.ts";
import { bootNodeCore } from "../src/emu/node.ts";
import { runListing } from "../src/emu/session.ts";

const argv = process.argv.slice(2);
const id = argv[argv.indexOf("--id") + 1];
const misprints = new Map(argv.flatMap((v, i) => (v === "--misprint" ? [argv[i + 1]] : [])).map((m) => { const k = m.indexOf("="); return [Number(m.slice(0, k)), m.slice(k + 1)]; }));
const spec = JSON.parse(readFileSync(new URL("../data/listings.json", import.meta.url), "utf8"))[id]?.spec;
if (!spec) throw new Error(`data/listings.json has no spec for ${id}`);
const intended = readFileSync(`fixtures/authored/${id}.intended.bas`, "utf8").split("\n").filter((l) => /^\d/.test(l)).map((l) => {
  const m = l.match(/^(\d+) (.*)$/);
  return { n: Number(m[1]), body: m[2] };
});
const missing = spec.expectedLines.filter((n) => !intended.some((l) => l.n === n));
if (missing.length || intended.length !== spec.expectedLines.length) throw new Error(`inventory mismatch: ${missing}`);
for (const n of misprints.keys()) if (!intended.some((l) => l.n === n)) throw new Error(`misprint on absent line ${n}`);

const printedLines = intended.map((l) => ({ n: l.n, body: misprints.get(l.n) ?? l.body, rem: computeChecksum(l.n, l.body) }));
const header = [
  `; authored 2026 for this repo (MIT) — NOT from any magazine. The page as PRINTED: Gazette notation, :rem = the`,
  `; Gazette checksum of the INTENDED line (fixtures/authored/${id}.intended.bas). Planted misprints (scripts/author-page.mjs):`,
  ...[...misprints].map(([n, b]) => `;   line ${n} printed as "${b}" — intended "${intended.find((l) => l.n === n).body}"`),
];
writeFileSync(`fixtures/authored/${id}.bas`, [...header, ...printedLines.map((l) => `${l.n} ${l.body}  :rem ${l.rem}`)].join("\n") + "\n");

const asListing = (ls) => ls.map((l) => ({ n: l.n, body: l.body, printed: computeChecksum(l.n, intended.find((x) => x.n === l.n).body), status: "verified", source: "ocr" }));
const core = await bootNodeCore();
const good = runListing(core, asListing(intended), spec);
const bad = runListing(core, asListing(printedLines), spec);
const facts = (f) => ({ error: f.run.error ?? null, titleSeen: f.titleSeen, postTitle: f.postTitle, screen: (f.screens.postTitle ?? f.screens.title ?? f.screens.afterRun).replace(/\s+/g, " ").trim().slice(0, 160) });
const pre = { id, misprints: Object.fromEntries(misprints), intended: facts(good), printed: facts(bad) };
pre.pass = good.titleSeen && good.postTitle === "pass" && !(bad.titleSeen && bad.postTitle === "pass");
console.log(JSON.stringify(pre));
process.exit(pre.pass ? 0 : 1);
