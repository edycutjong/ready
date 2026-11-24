# Spike K1 — Pre Tool Use gate + least privilege, headless (PASS)

**Command** (probe workspace `spikes/probe-mcp/`, MCP server named `c64` with echo tools `apply_patch` and `c64_poke`):
```
RUN_DIR=/tmp/ready-k1-1795539149 kiro-cli chat --v3 --no-interactive --trust-workspace --agent probe \
  --trust-tools=@c64/apply_patch --output-format stream-json "<3-step probe prompt>"
```
kiro-cli 3.5.0, engine `v3`, model claude-sonnet-5.5. Profile `probe.json`: `tools: ["@c64","read"]`,
`includeMcpJson: true`, permissions allow `c64/*` except `c64/c64_poke`, deny `c64/c64_poke`, shell, fs_write, web;
inline hooks `PreToolUse` matcher `@c64/apply_patch` → `node hook-gate.mjs`, `Stop` → `node hook-stop.mjs`.
Never `--trust-all-tools`. Streams: `k1-k2-stream.jsonl`; hook log `k1-k2-hook-events.jsonl`; server-side call log
`k1-k2-server-calls.jsonl` (written by the MCP server itself, so "did it run" is not taken from the model's words).

| Check | Result (real output) |
|---|---|
| V3 loads MCP tools on demand | `tool_call "Tool Load" {"id":"tool::c64::apply_patch"}` → completed, then `@c64/apply_patch` — `tool_load` was **not** blocked by the exact trust list (it runs as the built-in `load_resource`) |
| hook refuses with exit 2 | step 1 (empty body) → `status: failed`, text `Tool "mcp_c64_apply_patch" was intercepted by PreToolUse hooks before execution … REFUSED by checksum-gate (day-1 probe): replace line 20 with an empty body deletes the line — hard refusal, the model cannot override it. The tool was NOT executed.` — the server log has **no** call for it |
| allowed call runs with the hook attached | step 2 → hook exit 0 → server log `apply_patch {"lineno":20,"new_body":"PRINT 1"}` → `applied 1 op(s)` |
| denied tool does not run | step 3 → `Blocked by a permission rule (deny mcp matching "c64/c64_poke"); the user did not reject it.` — no server log line |
| `$RUN_DIR` reaches hook processes | hook log `runDirSeen: /tmp/ready-k1-1795539149` = the value the runner set; the MCP server saw the same |
| credits | `credits.usage` 0.7336 for the session |

The exit-2 STDERR above is a **day-1 probe** hook event: shown only in `/kiro` with that label, never as the video's refusal.
