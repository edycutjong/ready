// Pre Tool Use hook on @c64/apply_patch (probe). Refuses an emptying replace with exit 2 + STDERR (the only
// blocking code), allows anything else with exit 0. Logs the event and the RUN_DIR it saw.
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
const RUN_DIR = process.env.RUN_DIR || "";
let raw = ""; try { raw = readFileSync(0, "utf8"); } catch {}
let ev = {}; try { ev = JSON.parse(raw); } catch {}
const input = ev.tool_input ?? ev.toolInput ?? ev.input ?? {};
const ops = input.ops ?? [];
const empty = ops.find((o) => o.op === "replace" && (o.new_body ?? "").trim() === "");
const decision = empty ? "refused" : "allowed";
const stderr = empty ? `REFUSED by checksum-gate (day-1 probe): replace line ${empty.lineno} with an empty body deletes the line — hard refusal, the model cannot override it.` : "";
if (RUN_DIR) { mkdirSync(RUN_DIR, { recursive: true }); appendFileSync(`${RUN_DIR}/hook-events.jsonl`, JSON.stringify({ t: new Date().toISOString(), hook: "checksum-gate", label: "day-1 probe", runDirSeen: RUN_DIR, event: ev, exit: empty ? 2 : 0, stderr }) + "\n"); }
if (empty) { process.stderr.write(stderr); process.exit(2); }
process.exit(0);
