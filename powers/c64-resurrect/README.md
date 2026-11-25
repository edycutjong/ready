# c64-resurrect — a Kiro Power

The same three parts the `resurrector` agent uses, packaged for one install:

| Part | Source in this repo |
|---|---|
| `mcp.json` → the `c64` MCP server (`c64_reload`, `c64_run`, `c64_read_screen`, `c64_press`, `checksum_line`, `apply_patch`) | `mcp/c64-server/` |
| `skills/petscii-notation/` | a byte-equal copy of `.kiro/skills/petscii-notation/SKILL.md` |
| `skills/commodore-basic-v2/` | the body of `.kiro/steering/commodore-basic-v2.md`, with skill frontmatter |

`tests/unit/power.test.ts` fails if a copy drifts from its source.

**Install (Kiro CLI, from a clone of this repo):** `kiro-cli powers install ./powers/c64-resurrect`.

**Measured on kiro-cli 3.6.0, V3 headless (`evidence/power/activation-2026-11-26.md`):** with the Power installed, both skills
appear in the session catalogue (we did not observe a keyword loading a skill body). The Power's MCP server does **not** start: it registers as `power-c64-resurrect-c64`, then kiro-cli logs
`Failed to connect … Connection closed`. The suspected cause (not tested) is its relative server path
(`mcp/c64-server/server.ts`), which may not resolve from where kiro-cli spawns a Power's server. The `resurrector` agent gets its six tools from the workspace config
(`.kiro/settings/mcp.json`). So this Power currently packages the skills only; it is not a standalone package. The server
also needs `RUN_DIR` (the recorder sets it) and the C64 core (`c64-ready`, npm), which embeds Commodore ROMs: it is
installed from npm on your machine and never committed or served.
