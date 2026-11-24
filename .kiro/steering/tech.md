---
inclusion: always
---
# Tech
- TypeScript (strict, ESM, `.ts` import suffixes), Node ≥ 20, Vite + Preact SPA, plain CSS tokens.
- Tests: Vitest + fast-check. Property tests live in `tests/prop/`, unit tests in `tests/unit/`. `npm test` runs all.
- Emulator: `c64-ready@3.4.0` behind the `C64Core` interface in `src/emu/core.ts` (its WASM embeds Commodore ROMs:
  installed from npm, never committed, never copied into the repo).
- `src/basic/**` and `src/gate/**` are pure and isomorphic (no `node:` imports, no DOM): they run in the browser,
  in the MCP server and in the Kiro hooks.
- No new runtime dependencies without a reason written in the commit message.
