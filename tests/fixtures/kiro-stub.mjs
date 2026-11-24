#!/usr/bin/env node
// Stand-in for kiro-cli in recorder tests: prints a stream-json session in the kiro-cli 3.5.0 shapes that
// runner/stream.ts parses (measured in spikes K1–K3). STUB_CALLS apply_patch calls, STUB_DELAY ms apart.
if (process.argv.includes("--version")) { console.log("kiro-cli stub 0.0.0"); process.exit(0); }
const calls = Number(process.env.STUB_CALLS ?? 1), delay = Number(process.env.STUB_DELAY ?? 5);
const sid = "sess_stub-0001";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const up = (u) => out({ type: "sessionUpdate", data: { sessionId: sid, update: u } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 1; i <= calls; i++) {
  up({ sessionUpdate: "tool_call", toolCallId: `c${i}`, title: "@c64/apply_patch", rawInput: { ops: [{ op: "replace", lineno: 20, new_body: `PRINT ${i}` }], reason: `try ${i}` } });
  await sleep(delay);
  up({ sessionUpdate: "tool_call_update", toolCallId: `c${i}`, status: "completed", content: [{ content: { text: `ACCEPTED ${i}` } }] });
  await sleep(delay);
}
// STUB_PREP=<dir>: copy that dir's listing.json + events.jsonl into RUN_DIR (a server state the test prepared)
if (process.env.STUB_PREP && process.env.RUN_DIR) { const fs = await import("node:fs"); for (const f of ["listing.json", "events.jsonl"]) fs.copyFileSync(`${process.env.STUB_PREP}/${f}`, `${process.env.RUN_DIR}/${f}`); }
if (process.env.STUB_EVENT && process.env.RUN_DIR) (await import("node:fs")).appendFileSync(`${process.env.RUN_DIR}/events.jsonl`, JSON.stringify({ t: new Date().toISOString(), k: "emu", op: "run", error: null, titleSeen: false }) + "\n");
out({ type: "runFinished", data: { status: "end_turn", finalText: "stub done", credits: [{ usage: Number(process.env.STUB_CREDITS ?? 0.25) }] } });
