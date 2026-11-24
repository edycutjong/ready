#!/usr/bin/env node
/**
 * Experiment E0 (kiro-plan.md §3, a2a r01) — "does a model add anything over search?" A NON-LLM baseline on the same
 * run input the agent gets: for every line failing its printed checksum, enumerate edits from the MEASURED OCR
 * confusions (gazette-notation steering; kill test REPORT row 2) — 1 or 2 substitutions, or 1 deletion / dropped-quote
 * insertion — and line-number readings from the page inventory; keep candidates whose Gazette checksum equals the
 * printed one and that pass the gate's 40% cap. One candidate → applied through the gate. Several → the real C64
 * decides between them (re-run each; never accept the first collision); still several → the line is left unfixed.
 * A comparison arm only: no search pre-pass ships in the product (a2a r02). 0 credits.
 *   node scripts/e0-search.mjs --input <input.json> [--out <result.json>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { computeChecksum } from "../src/basic/checksum.ts";
import { applyPatch, editRatio, MAX_EDIT_RATIO } from "../src/gate/checksum-gate.ts";
import { bootNodeCore } from "../src/emu/node.ts";
import { judge, runListing } from "../src/emu/session.ts";

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const input = JSON.parse(readFileSync(a.input, "utf8"));
const spec = input.spec;
const PAIRS = [["0", "8"], ["0", "9"], ["0", "@"], ["0", "G"], ["0", "O"], ["0", "¢"], ["S", "$"], ["S", "5"], ["1", "l"], ["1", "I"], ["I", "l"], ["{", "("], ["{", "["], ["}", ")"], ["}", "]"], ["B", "8"], ["Z", "2"], ["M", "N"], ['"', "™"], ['"', "“"], ['"', "”"], ['"', "'"], [":", ";"], [",", "."]];
const SUBS = new Map();
for (const [x, y] of PAIRS) { SUBS.set(x, [...(SUBS.get(x) ?? []), y]); SUBS.set(y, [...(SUBS.get(y) ?? []), x]); }

function* depth1(body) {
  for (let i = 0; i < body.length; i++) {
    for (const r of SUBS.get(body[i]) ?? []) yield body.slice(0, i) + r + body.slice(i + 1);
    if (body[i] !== " ") yield body.slice(0, i) + body.slice(i + 1); // stray character
  }
  for (let i = 0; i <= body.length; i++) yield body.slice(0, i) + '"' + body.slice(i); // dropped quote
}
function* substitutions(body) { for (let i = 0; i < body.length; i++) for (const r of SUBS.get(body[i]) ?? []) yield body.slice(0, i) + r + body.slice(i + 1); }

function candidates(line, missingNumbers) {
  const out = new Set();
  const numbers = [line.n, ...missingNumbers];
  const consider = (n, b) => { if (computeChecksum(n, b) === line.printed && editRatio(line.body, b) <= MAX_EDIT_RATIO) out.add(`${n}\u0000${b}`); };
  for (const n of numbers) consider(n, line.body);
  for (const b1 of depth1(line.body)) {
    for (const n of numbers) consider(n, b1);
    for (const b2 of substitutions(b1)) consider(line.n, b2);
  }
  out.delete(`${line.n}\u0000${line.body}`);
  return [...out].map((k) => { const [n, b] = k.split("\u0000"); return { n: Number(n), body: b }; });
}

const t0 = Date.now();
const core = await bootNodeCore();
let listing = input.lines.map(({ n, body, printed, status, source }) => ({ n, body, printed, status, source }));
const expected = spec.expectedLines;
const missing = () => expected.filter((n) => !listing.some((l) => l.n === n));
const perLine = [];
const facts0 = runListing(core, listing, spec);
const score = (f) => (f.postTitle === "pass" ? 1e6 : f.titleSeen ? 5e5 : 0) + (f.run.error?.line ?? 0);
for (const line of listing.filter((l) => l.status === "unverified" && l.printed !== null)) {
  const cands = candidates(line, missing());
  let chosen = null, how = "none";
  if (cands.length === 1) { chosen = cands[0]; how = "unique"; }
  else if (cands.length > 1 && cands.length <= 40) {
    const scored = cands.map((c) => {
      const ops = c.n === line.n ? [{ type: "replace", lineno: line.n, new_body: c.body }] : [{ type: "renumber", lineno: line.n, new_lineno: c.n }, ...(c.body === line.body ? [] : [{ type: "replace", lineno: line.n, new_body: c.body }])];
      const v = applyPatch(listing, ops, expected);
      return v.verdict === "accepted" ? { c, ops, s: score(runListing(core, v.listing, spec)) } : null;
    }).filter(Boolean).sort((x, y) => y.s - x.s);
    if (scored.length === 1 || (scored.length > 1 && scored[0].s > scored[1].s)) { chosen = scored[0].c; how = "emulator"; } else how = "ambiguous";
  } else if (cands.length > 40) how = "too-many";
  if (chosen) {
    const ops = chosen.n === line.n ? [{ type: "replace", lineno: line.n, new_body: chosen.body }] : [{ type: "renumber", lineno: line.n, new_lineno: chosen.n }, ...(chosen.body === line.body ? [] : [{ type: "replace", lineno: line.n, new_body: chosen.body }])];
    const v = applyPatch(listing, ops, expected);
    if (v.verdict === "accepted") listing = v.listing; else how = `gate-${v.verdict}`;
  }
  perLine.push({ n: line.n, candidates: cands.length, how });
}
const facts = runListing(core, listing, spec);
const contract = judge(listing, spec, facts, new Set(facts.postTitle === "pass" ? [] : input.provisional ?? []));
const result = {
  experiment: "E0 checksum-constrained confusable search + emulator re-run (no model)", listing: input.listingId, credits: 0, wallMs: Date.now() - t0,
  start: { error: facts0.run.error, titleSeen: facts0.titleSeen, unverified: input.lines.filter((l) => l.status === "unverified").length },
  fixed: perLine.filter((p) => p.how === "unique" || p.how === "emulator").length, attempted: perLine.length,
  outcomes: perLine.reduce((m, p) => ({ ...m, [p.how]: (m[p.how] ?? 0) + 1 }), {}),
  end: { error: facts.run.error, titleSeen: facts.titleSeen, postTitle: facts.postTitle, verdict: contract.verdict, heading: contract.heading, counts: contract.counts },
  perLine: perLine.map(({ n, candidates, how }) => ({ n, candidates, how })), // numbers and counts only (tier C: no listing text)
};
if (a.out) writeFileSync(a.out, JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify({ ...result, perLine: undefined }));
