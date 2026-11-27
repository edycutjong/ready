#!/usr/bin/env node
/**
 * node scripts/source-split.mjs --run <run.jsonl> --reference <transcript.txt> [--run <run2.jsonl> ...]
 *
 * EVALUATION ONLY, counts only. Splits a recorded run's source-exact count (runner/source-check.ts) into the lines the
 * agent repaired and the lines it never touched, and says whether each non-exact line differs from the reference only
 * in spaces (the Gazette checksum ignores spaces, so the gate cannot tell those apart). The final listing is rebuilt
 * from the run stream: the `start` event's input lines, then every `proposal` the gate answered `accepted`, in order.
 * It prints line numbers and counts, never line text, so its output may be published for a tier-C page.
 */
import { readFileSync } from "node:fs";
import { parseReference, sourceCheck } from "../runner/source-check.ts";

const args = process.argv.slice(2);
const runs = args.flatMap((v, i) => (v === "--run" ? [args[i + 1]] : []));
const refFile = args[args.indexOf("--reference") + 1];
if (!runs.length || args.indexOf("--reference") < 0) { console.error("usage: --run <run.jsonl> [--run ...] --reference <transcript.txt>"); process.exit(2); }
const reference = parseReference(readFileSync(refFile, "utf8"));

const spaces = (s) => (s ?? "").replace(/ /g, "");
const outsideQuotes = (s) => { let q = false, o = ""; for (const c of s ?? "") { if (c === '"') q = !q; if (!q && c === " ") continue; o += c; } return o; };

for (const file of runs) {
  const ev = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const start = ev.find((e) => e.k === "start");
  const lines = new Map(start.input.lines.map((l) => [l.n, { body: l.body, before: l.status }]));
  const repaired = new Set();
  ev.forEach((e, i) => {
    if (e.k !== "proposal" || !e.ops) return;
    const verdict = ev.slice(i + 1).find((x) => x.k === "gate");
    if (verdict?.verdict !== "accepted") return;
    for (const o of e.ops) if (o.new_body !== undefined) { lines.get(o.lineno).body = o.new_body; repaired.add(o.lineno); }
  });
  const r = sourceCheck([...lines].map(([n, l]) => ({ n, body: l.body })), reference, start.input.spec.expectedLines, "reference");
  const rows = r.lines.map((l) => ({ n: l.n, repaired: repaired.has(l.n), exact: l.exact,
    diff: l.exact ? null : spaces(l.final) !== spaces(l.reference) ? "text" : outsideQuotes(l.final) === outsideQuotes(l.reference) ? "spaces outside quotes" : "spaces inside quotes" }));
  const rep = rows.filter((x) => x.repaired), kept = rows.filter((x) => !x.repaired);
  console.log(JSON.stringify({
    run: file.split("/").at(-1), sourceExact: r.sourceExact, total: r.total,
    repaired: { lines: rep.length, exact: rep.filter((x) => x.exact).length },
    untouched: { lines: kept.length, exact: kept.filter((x) => x.exact).length },
    notExact: rows.filter((x) => !x.exact).map(({ n, repaired: rp, diff }) => ({ n, repaired: rp, diff })),
  }));
}
