# Architecture

Three times matter: **build time** (Kiro specs and tasks wrote the tokenizer/checksum oracle, the MCP tool layer, the agent
profile and the boot-detect fix; the gate, contract, `server.ts` and REPLAY were `claude-direct`), **record time** (a Kiro
agent fixes a listing through the gate on the builder's machine), and **judge time** (the visitor's browser replays and
re-judges that recording). One pure gate, `src/gate/`, sits on the deploy line: the Kiro PreToolUse hook and the MCP
server call it at record time, and REPLAY, `/scan` and the landing page's `gate.js` call the same file in the browser.
Everything below exists in this repository.

<img src="docs/architecture.png" alt="Architecture, as built. Build time: four Kiro specs (checksum-oracle, c64-mcp-server, resurrect-loop, bugfix-boot-detect) wrote src/basic, the MCP tools, the agent profile and the boot-detect fix. Record time, on the builder's machine: the recorder spawns the Kiro agent resurrector (claude-sonnet-5.5, only the six @c64 tools); its apply_patch calls pass the PreToolUse checksum-gate hook (exit 2 refuses) to a six-tool MCP server, the other five tools go straight to the server; the server types and runs the listing on a C64 core with the real ROMs, the C64's screen and memory feed a six-clause contract, and the Stop hook until-title blocks the agent's stop until the contract says RESURRECTED or a cap hits. One pure gate in src/gate straddles the deploy line, called by the hook and the MCP server above it and by REPLAY, /scan and the landing page below it. The recorded runs straddle the line too; the ROM-bearing C64 WASM is stopped at it by a sha256 check. At ready.edycu.dev: / REPLAY re-judges every recorded patch over recorded screens, /kiro lists the hook firings, /scan reads a page with self-hosted tesseract.js and checks each line against its printed checksum, fetching archive.org pages through the /api/page function. Receipts: rejudge-runs, live-judge-path, eval-agents, bench and the sha256 freeze pins." width="100%">

The same map as text:

```mermaid
flowchart TB
  subgraph build["Build time: kiro-cli spec sessions (.kiro/specs/)"]
    S1["checksum-oracle: tasks 1–6 → src/basic/"]
    S2["c64-mcp-server: tasks 1–5 → mcp/c64-server/"]
    S3["resurrect-loop: T1 → .kiro/agents/"]
    S4["bugfix-boot-detect: tasks 1, 4, 5 → src/emu/"]
  end
  subgraph record["Record time: the builder's machine (nothing here is deployed)"]
    REC["recorder: scripts/record-run.mjs + runner/ (caps 15 patches, 8 credits, 600 s)"] -->|spawns kiro-cli| AGENT["agent resurrector: .kiro/agents/resurrector.json (@c64 tools only)"]
    AGENT -->|apply_patch| HOOK["PreToolUse hook checksum-gate (scripts/hooks/)"]
    HOOK -->|exit 2: refused| AGENT
    HOOK -->|exit 0| MCP["MCP server c64: mcp/c64-server/ (6 tools, stdio)"]
    AGENT -->|the other 5 tools| MCP
    MCP -->|type, run| EMU["C64 core: src/emu/ + c64-ready 3.4.0 (real ROMs, npm)"]
    EMU -->|screen RAM + BASIC memory| CON["contract: src/gate/contract.ts (6 clauses)"]
    CON -->|verdict| STOP["Stop hook until-title"]
    STOP -->|block: keep going| AGENT
    REC -->|writes| RUNS["recorded runs: runs/<listing>/<time>.jsonl → public/runs/*.jsonl"]
  end
  GATE["one pure gate: src/gate/ + src/basic/ (applyPatch, checkLine) — bundled on both sides"]
  HOOK --> GATE
  MCP --> GATE
  EMU -. "ROM WASM: refused by sha256 (scripts/check-no-rom.mjs)" .-x DEPLOY(["deploy line"])
  subgraph judge["Judge time: ready.edycu.dev on Vercel"]
    REPLAY["/ REPLAY desk: src/replay/ + src/ui/ (RECORDED PLAYBACK)"] --> GATE
    SCAN["/scan: src/ocr/ + self-hosted tesseract.js 7 (public/ocr/)"] -->|checkLine| GATE
    LAND["/landing/ + /deck/: scripts/landing/build-site.mjs (gate.js)"] --> GATE
    KIRO["/kiro: hook rows + tool calls"]
    REPLAY -. "if present" .-> WASM["/c64.wasm: not served (404)"]
    SCAN -->|fetch page| API["api/page.js (Vercel function)"]
    API -->|proxy| ARCH["archive.org: COMPUTE!'s Gazette, June 1984"]
  end
  RUNS --> REPLAY
  RUNS --> KIRO
```

| Component | Path | Notes |
|---|---|---|
| Kiro specs | `.kiro/specs/` | `checksum-oracle`, `c64-mcp-server`, `resurrect-loop`, `bugfix-boot-detect`; which tasks Kiro ran is in [`docs/DX-REPORT.md`](docs/DX-REPORT.md) |
| Agent | `.kiro/agents/resurrector.json` | `claude-sonnet-5.5`; `@c64` tools only; file read, shell, write and web denied; 3 steering files + skill `petscii-notation` as resources; its three hooks are inline |
| Hooks | `scripts/hooks/`; `.kiro/hooks/prop-tests-on-save.json` | SessionStart `listing-context`, PreToolUse `checksum-gate` (matcher `@c64/apply_patch`, exit 2 refuses), Stop `until-title`; File Save `prop-tests-on-save` runs `tests/prop` at build time |
| Recorder | `scripts/record-run.mjs`, `runner/` | spawns `kiro-cli` headless with one run dir, merges the hook and server events into the run; caps 15 patches, 8 credits, 600 s |
| MCP server | `mcp/c64-server/` | tools `c64_reload`, `c64_run`, `c64_read_screen`, `c64_press`, `checksum_line`, `apply_patch`; no `node:` import in `tools.ts` |
| C64 core | `src/emu/core.ts`, `node.ts`, `session.ts` | `c64-ready` 3.4.0 over the real KERNAL/BASIC; the ROM-bearing WASM is never deployed (`scripts/check-no-rom.mjs`) |
| Gate | `src/gate/checksum-gate.ts`, `src/basic/` | `applyPatch` and `checkLine`: typeable, `:rem` checksum equals the printed one (or fits only a misread printed digit), 40% edit cap; pure and isomorphic, so one file runs in the hook, the MCP server and the browser |
| Contract | `src/gate/contract.ts` | 6 clauses (title seen, post-title text, every line once, checksums, none forced, C64 memory equals the tokenized listing) → RESURRECTED / BOOTED-PARTIAL / NOT-RESURRECTED; needs a C64 core, so it is not recomputed on the public site |
| REPLAY | `src/replay/` | in the deployed browser (RECORDED PLAYBACK): the gate re-judges every patch over the recorded screens and the certificate shows the recorded verdict; with the C64 core (node, `vite dev`) it also re-runs each accepted patch and recomputes the contract; `certificate.ts` renders it |
| OCR | `src/ocr/` | self-hosted tesseract.js 7.0.0 worker (`public/ocr/`), per-column reading for two-column pages; `flag.ts` checks each line with the gate's `checkLine` |
| Landing + deck + judge guide | `scripts/landing/build-site.mjs` → `public/landing/`, `public/deck/`, `public/judge/` | figures read from the run log and evidence files; `gate.js` is the real gate, bundled |
| Page proxy | `api/page.js` | plain JS (the build tool cannot read TypeScript 7); host allow-list (`data/pages.json`), https-only redirects checked per hop, streamed byte cap |
| Evidence | `scripts/rejudge-runs.mjs`, `scripts/live-judge-path.mjs`, `scripts/eval-agents.mjs`, `scripts/bench.mjs`, `evidence/` | every recording re-judged by current code, the judge path on the live URL, agent evals, benchmarks; `evidence/freeze/` pins the sha256 of the files the agent and the gate run on |
| Hosting + CI | `vercel.json`, `.github/workflows/` | Vercel only; six workflows: `CI`, `E2E`, `CodeQL`, `Security`, `Quality`, `Deploy` (deploys `main` after `CI` passes, refuses the ROM WASM by sha256, smoke-tests the live routes) |
