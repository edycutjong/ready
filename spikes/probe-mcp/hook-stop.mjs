// Agent Stop hook (probe): the first stop is blocked with {decision:"block", reason}; later stops are allowed.
import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
const RUN_DIR = process.env.RUN_DIR || "/tmp/ready-probe";
mkdirSync(RUN_DIR, { recursive: true });
let raw = ""; try { raw = readFileSync(0, "utf8"); } catch {}
const f = `${RUN_DIR}/stop-count`;
const n = existsSync(f) ? Number(readFileSync(f, "utf8")) + 1 : 1;
writeFileSync(f, String(n));
const block = n <= Number(process.env.STOP_BLOCKS || 1);
const out = block ? { decision: "block", reason: `Not finished: the title has not appeared. Call @c64/apply_patch once more with ops [{op:'replace', lineno:${20 + 10 * n}, new_body:'PRINT ${n + 1}'}] and reason 'stop-hook turn ${n}', then stop.` } : null;
appendFileSync(`${RUN_DIR}/hook-events.jsonl`, JSON.stringify({ t: new Date().toISOString(), hook: "until-title", label: "day-1 probe", stopN: n, decision: block ? "block" : "allow", event: raw.slice(0, 500) }) + "\n");
if (out) process.stdout.write(JSON.stringify(out));
process.exit(0);
