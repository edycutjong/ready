# c64-resurrect — a Kiro Power

The same three parts the `resurrector` agent uses, packaged for one install:

| Part | Source in this repo |
|---|---|
| `mcp.json` → the `c64` MCP server (`c64_reload`, `c64_run`, `c64_read_screen`, `c64_press`, `checksum_line`, `apply_patch`) | `mcp/c64-server/` |
| `skills/petscii-notation/` | a byte-equal copy of `.kiro/skills/petscii-notation/SKILL.md` |
| `skills/commodore-basic-v2/` | the body of `.kiro/steering/commodore-basic-v2.md`, with skill frontmatter |

`tests/unit/power.test.ts` fails if a copy drifts from its source.

**Install (Kiro CLI, from a clone of this repo):** `kiro-cli powers install ./powers/c64-resurrect`.
The MCP server path is relative (`mcp/c64-server/server.ts`), so the Power works in a clone of this repository, where
the server, the gate and `node_modules` are. It is not a standalone package. The server needs `RUN_DIR` (the
recorder sets it; see `scripts/record-run.mjs`). The C64 core (`c64-ready`, npm) embeds Commodore ROMs: it is
installed from npm on your machine and never committed or served.
