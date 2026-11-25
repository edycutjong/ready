# Power `c64-resurrect` — activation test (kiro-cli 3.6.0, V3 headless, 2026-11-26)

Installed with `kiro-cli powers install ./powers/c64-resurrect` (prints `Installed power "c64-resurrect"`), tested, then
uninstalled. Prompt (both runs): a Gazette listing with `?SYNTAX ERROR` — name the Power's tools and skills, then call
its `checksum_line` once. `--trust-tools=*checksum_line*`, Sonnet 5.5, effort low.

| Run | Workspace | Skills the session catalogue listed from the Power | Power MCP server | Credits |
|---|---|---|---|---|
| 1 | this repo (its `.kiro/settings/mcp.json` also defines `c64`) | `plugin::c64-resurrect::skill::commodore-basic-v2`, `plugin::c64-resurrect::skill::petscii-notation` | not distinguishable: the `checksum_line` call went to `@c64` (the workspace server, same name) | 0.726 |
| 2 | scratch dir with no `.kiro/` (repo code linked in) | the same two | registered as `power-c64-resurrect-c64`; kiro-cli logged `Failed to connect … Connection closed`; no Power tool in the catalogue | 0.481 |

Result: with the Power installed, both skills appear in the session catalogue (we did not observe a keyword loading a
skill body); the Power's MCP server does not start. Suspected causes, not tested: its server path is relative
(`mcp/c64-server/server.ts`) and may not resolve from where kiro-cli spawns a Power's server, and the server exits
when `RUN_DIR` does not name an existing directory. The
`resurrector` agent therefore keeps using the workspace MCP config, and the Power is packaging for the skills only.
