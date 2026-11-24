#!/usr/bin/env node
// Kiro PostFileSave hook (src/basic/**, src/gate/**): run the property tests and append one log line to
// evidence/hooks/file-save.jsonl so every firing is on the record. Exit 0 always (PostFileSave cannot block);
// failures are reported on STDERR, which Kiro shows to the agent.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
let event = {};
try { event = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no stdin */ }
const t0 = Date.now();
const r = spawnSync("npx", ["vitest", "run", "tests/prop", "--reporter=dot"], { encoding: "utf8" });
const out = (r.stdout || "") + (r.stderr || "");
const m = out.match(/Tests\s+(?:(\d+) failed \|\s*)?(\d+) passed/);
mkdirSync("evidence/hooks", { recursive: true });
appendFileSync("evidence/hooks/file-save.jsonl", JSON.stringify({
  t: new Date().toISOString(), hook: "prop-tests-on-save", file: relative(process.cwd(), String(event.file_path ?? event.path ?? event.tool_input?.path ?? "")) || null,
  exit: r.status, failed: m?.[1] ? Number(m[1]) : 0, passed: m ? Number(m[2]) : null, ms: Date.now() - t0,
}) + "\n");
if (r.status !== 0) process.stderr.write(`property tests FAILED after save:\n${out.slice(-2000)}`);
process.exit(0);
