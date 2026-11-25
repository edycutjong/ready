# Prompts sent to Kiro, in order

Every prompt sent to Kiro (kiro-cli) through phase P1c of the build, in order (the P6b sessions — bugfix spec, bugfix tasks 1/4/5, Power activation, workflow run — are added at the final publish). One line per file: prompt, what it produced,
build commit. Credits are what `kiro-cli` reported (`credits.usage`); the full ledger and who-wrote-what is in
[`docs/DX-REPORT.md`](../docs/DX-REPORT.md).

| File | What it did | Build commit | Credits |
|---|---|---|---|
| `01-checksum-oracle-spec.md` | feature spec `checksum-oracle`: EARS requirements, analyze-requirements pass, design, tasks | `6969675` | 22.35 |
| `02-probe-hooks-mcp.md` | mechanism probe: the Pre Tool Use hook refuses an empty-body patch through the `c64` MCP tools | evidence in `evidence/spikes/` | 0.73 |
| `03-probe-stop-hook.md` | probe: Stop hook asked to block 3 times; it fired once | evidence in `evidence/spikes/` | 0.06 |
| `04-probe-meter-v3.md` | probe: credit metering, `--v3` | evidence in `evidence/spikes/` | 0.03 |
| `05-probe-meter-plain.md` | probe: credit metering, plain `--no-interactive` | evidence in `evidence/spikes/` | 0.01 |
| `06-probe-cheat-refusal.md` | probe: the checksum gate refuses a cheating patch | evidence in `evidence/spikes/` | 0.13 |
| `07-checksum-oracle-tasks.md` | tasks 1–6 of `checksum-oracle` (types, keyword table, tokenizer, notation, checksum) | `2ddfe94` | 28.91 |
| `08-file-save-hook-edit.md` | one doc-comment edit to prove a clean File Save hook firing | `6a2857b` | 0.07 |
| `09-c64-mcp-server-spec.md` | feature spec `c64-mcp-server` | `b2aedff` | 42.95 |
| `10-c64-mcp-server-tasks.md` | tasks 1–5 of `c64-mcp-server` | `7c1139a` | 25.76 |
| `11-resurrect-loop-spec.md` | feature spec `resurrect-loop` + the `resurrector` agent, steering, skill | `da509e9` | 12.69 |
| `12-run-prompt-resurrect.md` | the runtime prompt the product sends the `resurrector` agent on every run | `runner/prompts/resurrect.md` | per run |

Prompts 02–06 are tiny by design: they measure how Kiro's hooks and metering behave; they are not feature work.
