// Probe stop check for record-run.mjs: allow stop once >= 2 apply_patch calls reached the server.
import { existsSync, readFileSync } from "node:fs";
const f = `${process.env.RUN_DIR}/server-calls.jsonl`;
const n = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.includes('"apply_patch"')).length : 0;
process.stdout.write(JSON.stringify(n >= 2 ? { stop: true, reason: "", result: "probe-done" } : { stop: false, reason: `Not finished: ${n} patch(es) applied. Call @c64 apply_patch with ops [{"op":"replace","lineno":40,"new_body":"PRINT 4"}] and reason "runner cycle", then stop.`, result: "not-resurrected" }));
