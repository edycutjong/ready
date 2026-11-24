#!/usr/bin/env node
/**
 * Kiro Session Start hook (kiro-plan.md §1 item 5): injects the per-listing context the agent needs and the kill
 * test's fixer lacked (F3): the scope, the line inventory read from the page BEFORE the run, the title predicate and
 * which keys the agent may press, and the current canonical listing WITH its printed checksums and per-line status.
 * Prints to STDOUT (session context). Reads $RUN_DIR/listing.json (the server's gated state) or input.json at start.
 * Never prints a reference transcript: the agent sees only what the OCR read and what the gate accepted.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const runDir = process.env.RUN_DIR;
if (!runDir) process.exit(0);
const read = (f) => { try { return existsSync(join(runDir, f)) ? JSON.parse(readFileSync(join(runDir, f), "utf8")) : null; } catch { return null; } };
const input = read("input.json");
const listing = read("listing.json");
if (!input) process.exit(0);
const spec = input.spec;
const lines = (listing?.lines ?? input.lines).slice().sort((a, b) => a.n - b.n);
const expected = spec.expectedLines;
const present = new Set(lines.map((l) => l.n));
const missing = expected.filter((n) => !present.has(n));
const keyName = (c) => (c === 13 ? "RETURN" : c === 32 ? "SPACE" : String.fromCharCode(c));
const ranges = (ns) => {
  const out = []; let a = null, b = null;
  for (const n of [...ns].sort((x, y) => x - y)) { if (a === null) { a = b = n; continue; } if (n === b + 1) { b = n; continue; } out.push(a === b ? `${a}` : `${a}-${b}`); a = b = n; }
  if (a !== null) out.push(a === b ? `${a}` : `${a}-${b}`);
  return out.join(", ");
};
const mark = (l) => (l.status === "verified" ? "✓" : l.status === "digit-misread" ? "✓(checksum digits misread)" : l.status === "forced" ? "✗FORCED" : l.printed == null ? "?unparseable checksum" : "✗checksum mismatch");
const text = [
  `LISTING ${input.listingId} — scope: ${input.scope} (${expected.length} printed lines, inventory read from the page before the run).`,
  `Expected line numbers: ${ranges(expected)}.`,
  missing.length ? `Lost by OCR and not recovered (recovery code only, never you): ${missing.join(", ")}.` : "Every expected line is present.",
  `Title: the screen shows "${spec.titlePredicate.screenContains}"${spec.titlePredicate.keys?.length ? ` (the program waits for a key first; c64_press accepts only: ${spec.titlePredicate.keys.map(keyName).join(", ")})` : ""}. After the title the SERVER presses ${spec.postTitle.keys.map(keyName).join(", ")} and checks for "${spec.postTitle.screenContains}" — you never press it.`,
  "Success is computed by code, never declared: title + post-title + every expected line present once + every line's checksum consistent + nothing forced + the C64's memory equal to the gated listing.",
  "Current canonical listing (Gazette notation; :rem = the checksum PRINTED in the magazine; status from the gate):",
  ...lines.map((l) => `${l.n} ${l.body} :rem ${l.printed ?? "??"}   ${mark(l)}${l.provisional ? " (recovered, provisional)" : ""}${expected.includes(l.n) ? "" : "   [not in the page inventory]"}`),
].join("\n");
process.stdout.write(text + "\n");
appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ t: new Date().toISOString(), k: "hook", hook: "listing-context", via: process.env.READY_HOOK_VIA ?? "kiro-session-start", exit: 0, lines: lines.length, missing }) + "\n");
process.exit(0);
