#!/usr/bin/env node
/**
 * Spike-G0 recovery step 2 (agent contract §4 "Lost lines"): for every line still lost after re-OCR, show its page crop
 * and let a PERSON type it. No model is involved. Output lines carry source "typed" and are counted on the
 * certificate ("N lines typed from the page by a person").
 *   node scripts/type-lost-lines.mjs <recovery.json>   (recovery.json: { lost: [{ n, printed, crop }] , out })
 */
import { createInterface } from "node:readline/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { computeChecksum } from "../src/basic/checksum.ts";
const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
// Piped STDIN (a prepared answers file, tests): readline drops lines that arrive before a question is asked and
// exits 13 on EOF with a question pending (found by the P1b smoke test), so read every answer up front instead.
const piped = stdin.isTTY ? null : readFileSync(0, "utf8").split("\n");
const rl = piped ? null : createInterface({ input: stdin, output: stdout });
const ask = async (q) => { if (!piped) return rl.question(q); const a = piped.shift() ?? ""; stdout.write(q + a + "\n"); return a; };
const typed = [];
for (const l of job.lost) {
  console.log(`\nLine ${l.n} was lost by OCR. Open the crop: ${l.crop}\nType the body exactly as printed (Gazette notation, without the line number and :rem). Empty = leave it lost.`);
  const body = (await ask(`${l.n} `)).trim();
  if (!body) { typed.push({ n: l.n, source: "lost" }); continue; }
  const sum = computeChecksum(l.n, body);
  const ok = l.printed == null ? null : sum === l.printed;
  console.log(ok === null ? "printed checksum unreadable: the line stays unverified" : ok ? `checksum ${sum} = printed ${l.printed} ✓` : `checksum ${sum} ≠ printed ${l.printed} — kept, the gate will judge it`);
  typed.push({ n: l.n, body, printed: l.printed ?? null, source: "typed", typedAt: new Date().toISOString(), checksumOk: ok });
}
rl?.close();
writeFileSync(job.out, JSON.stringify(typed, null, 1) + "\n");
console.log(`\n${typed.filter((t) => t.source === "typed").length} line(s) typed → ${job.out}`);
