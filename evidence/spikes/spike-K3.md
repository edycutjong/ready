# Spike K3 (Day-1 part) — is `credits.usage` metered? (PASS, all three modes)

One probe call per invocation mode, kiro-cli 3.5.0:

| Invocation | engine | `credits.usage` present | value |
|---|---|---|---|
| `--v3 --no-interactive --agent probe` (profile) | v3 | **yes** | 0.7336 (K1/K2 session, sonnet-5.5) |
| `--v3 --no-interactive` (no profile) | v3 | **yes** | 0.0264 (haiku-5.5, "Reply OK") |
| `--no-interactive` (plain, the kill test's mode) | **v3** (3.5.0 defaults to v3) | **yes** | 0.0076 (haiku-5.5) |

Every invocation the recorder uses is metered, so the 8-credit cap is enforced on measured spend (checked between
cycles: the stream reports credits once per process, at the end). The K3 cost session (one Stop-hook-driven session on
eval case 1) runs on Day 2 after the MCP server exists.
