# Architecture

Three times matter: **build time** (Kiro specs and tasks wrote the tokenizer/checksum oracle and the MCP tool layer; the gate, contract, `server.ts` and REPLAY were `claude-direct`), **record time** (a Kiro
agent fixes a listing through the gate on the builder's machine), and **judge time** (the visitor's browser replays and
re-judges that recording). Everything below exists in this repository.

<img src="docs/architecture.png" alt="Architecture, as built, at three times. Build time: three Kiro specs run in kiro-cli sessions; Kiro ran the first tasks of each, writing the tokenizer, the checksum and the MCP tools. Record time, on the builder's machine: a recorder spawns the Kiro agent resurrector; its apply_patch calls pass the PreToolUse checksum-gate hook (exit 2 refuses) to a six-tool MCP server that drives a C64 core with the real ROMs and calls the gate and its contract. The recorded run and the gate's code cross to the browser; the agent, the MCP server and the ROMs are never deployed. At ready.edycu.dev, REPLAY re-runs the gate on every recorded patch over recorded screens, /kiro lists the hook firings, and /scan reads a page with self-hosted tesseract.js and flags each line by its printed checksum, fetching page images from archive.org through one allow-listed Vercel function. No C64 runs on the public URL." width="100%">

The same map as text:

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
    REC --> RUNS["runs/listing/iso.jsonl; the hero run is committed in public/runs"]
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
| REPLAY | `src/replay/` | in the deployed browser (RECORDED PLAYBACK): the gate re-judges every patch over the recorded screens and the certificate shows the recorded verdict; with the C64 core (node, `vite dev`) it also re-runs each accepted patch and recomputes the contract; `certificate.ts` renders it |
| OCR | `src/ocr/` | self-hosted tesseract.js 7.0.0 worker, per-column reading for two-column pages |
| Page proxy | `api/page.js` | plain JS (the build tool cannot read TypeScript 7); host allow-list, https-only redirects checked per hop, streamed byte cap |
| Hosting | `vercel.json`, `.github/workflows/` | Vercel only; `ci.yml` and `deploy.yml` |
