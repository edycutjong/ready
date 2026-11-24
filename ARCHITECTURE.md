# Architecture

Three times matter: **build time** (Kiro specs and tasks wrote the tokenizer/checksum oracle and the MCP tool layer; the gate, contract, `server.ts` and REPLAY were `claude-direct`), **record time** (a Kiro
agent fixes a listing through the gate on the builder's machine), and **judge time** (the visitor's browser replays and
re-judges that recording). Everything below exists in this repository.

```mermaid
flowchart LR
  subgraph record["Record time (builder machine)"]
    REC["scripts/record-run.mjs"] --> KIRO["kiro-cli: agent resurrector (.kiro/agents)"]
    KIRO -->|"MCP stdio, 6 tools"| MCP["mcp/c64-server"]
    HOOKS["hooks: listing-context, checksum-gate, until-title (+ prop-tests-on-save at build time)"] -.-> KIRO
    STEER[".kiro/steering + skill petscii-notation"] -.-> KIRO
    MCP --> GATE["src/gate: applyPatch + 6-clause contract"]
    MCP --> EMU["src/emu: c64-ready core"]
    GATE --> BAS["src/basic: tokenizer, checksum"]
    REC --> RUNS["runs/listing/iso.jsonl, copied to public/runs"]
  end
  subgraph judge["Judge time (visitor's browser, ready.edycu.dev)"]
    SPA["src/ui: Preact SPA (/, /scan, /kiro)"] --> REPLAY["src/replay: re-judge every patch"]
    RUNS --> REPLAY
    REPLAY --> GATE2["same gate + tokenizer code (no C64 ROM here: screens are recorded)"]
    SPA --> OCR["src/ocr: tesseract.js 7 worker"]
    OCR --> FLAG["checksum flags per line"]
    SPA -->|"fetch"| API["api/page.js (Vercel function)"]
    API --> ARCH["archive.org page image"]
  end
```

| Component | Path | Notes |
|---|---|---|
| C64 core | `src/emu/core.ts`, `node.ts`, `session.ts` | `c64-ready` 3.4.0 over the real KERNAL/BASIC; the ROM-bearing WASM is never deployed (`scripts/check-no-rom.mjs`) |
| Tokenizer, notation, checksum | `src/basic/` | KERNAL-equality property test against the real core |
| Gate and contract | `src/gate/checksum-gate.ts`, `contract.ts` | decides line status and the RESURRECTED / BOOTED-PARTIAL / NOT-RESURRECTED verdict |
| MCP server | `mcp/c64-server/` | tools `c64_reload`, `c64_run`, `c64_read_screen`, `c64_press`, `checksum_line`, `apply_patch`; no `node:` import in `tools.ts` |
| Agent | `.kiro/agents/resurrector.json` | `@c64` tools only; file read, shell, write and web denied |
| Hooks | inline in the agent profile; `.kiro/hooks/prop-tests-on-save.json` | scripts in `scripts/hooks/` |
| REPLAY | `src/replay/` | in the deployed browser: the gate re-judges every patch and recomputes the verdict over recorded screens; with the C64 core (node, `vite dev`) it also re-runs each accepted patch; `certificate.ts` renders it |
| OCR | `src/ocr/` | self-hosted tesseract.js 7.0.0 worker, per-column reading for two-column pages |
| Page proxy | `api/page.js` | plain JS (the build tool cannot read TypeScript 7); host allow-list, https-only redirects checked per hop, streamed byte cap |
| Hosting | `vercel.json`, `.github/workflows/` | Vercel only; `ci.yml` and `deploy.yml` |
