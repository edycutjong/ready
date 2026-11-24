#!/usr/bin/env node
/**
 * node scripts/source-check.mjs --run-dir <RUN_DIR> --reference <transcript.txt> --origin "two machine reads" [--json]
 * Prints `source-exact n/N (reference: <origin>)` for the run's final canonical listing (listing.json). Evaluation
 * only: the reference never enters the run directory before the run ends. Copy may say "matches the magazine" only
 * for exact lines with a person-read reference; with a machine-only reference it says "matches the two-read reference".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseReference, sourceCheck } from "../runner/source-check.ts";
const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1]]] : acc), []));
const listing = JSON.parse(readFileSync(join(a["run-dir"], "listing.json"), "utf8"));
const r = sourceCheck(listing.lines, parseReference(readFileSync(a.reference, "utf8")), listing.expectedLines, a.origin ?? "unstated");
console.log(a.json ? JSON.stringify(r) : `source-exact ${r.sourceExact}/${r.total} (reference: ${r.origin})`);
