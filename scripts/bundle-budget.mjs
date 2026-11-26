#!/usr/bin/env node
// Bundle budget for the judge path: the JS and CSS that dist/index.html loads, gzipped, must stay under budget.
// Budgets sit about 25% above the size measured on 2026-11-27 (JS 32.5 KB gz, CSS 3.7 KB gz), so a regression fails CI
// while normal edits do not. Run after `npm run build`: node scripts/bundle-budget.mjs [dist]
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = process.argv[2] ?? "dist";
const BUDGET_KB = { js: 40, css: 5 };
const html = readFileSync(join(dist, "index.html"), "utf8");
const assets = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(js|css))"/g)].map((m) => ({ path: m[1], kind: m[2] }));
if (!assets.some((a) => a.kind === "js")) { console.error(`bundle-budget: no JS entry referenced by ${dist}/index.html`); process.exit(1); }
const rows = assets.map((a) => {
  const raw = readFileSync(join(dist, a.path));
  return { ...a, rawKb: raw.length / 1024, gzKb: gzipSync(raw, { level: 9 }).length / 1024 };
});
const total = (kind) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.gzKb, 0);
const results = Object.entries(BUDGET_KB).map(([kind, budget]) => ({ kind, gzKb: total(kind), budget, ok: total(kind) <= budget }));
const lines = [
  "| asset | raw KB | gzip KB |", "|---|---:|---:|",
  ...rows.map((r) => `| \`${r.path}\` | ${r.rawKb.toFixed(1)} | ${r.gzKb.toFixed(1)} |`),
  "", "| budget | gzip KB | limit KB | result |", "|---|---:|---:|---|",
  ...results.map((r) => `| ${r.kind} | ${r.gzKb.toFixed(1)} | ${r.budget} | ${r.ok ? "pass" : "FAIL"} |`),
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bundle budget\n\n${lines.join("\n")}\n`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
