---
inclusion: always
---
# Structure
- `src/basic/` — `checksum.ts` (Gazette `:rem` oracle), `notation.ts` (magazine notation ⇄ PETSCII), `tokenizer.ts` (BASIC V2 tokenizer = what the KERNAL stores at `$0801`).
- `src/gate/` — `checksum-gate.ts` (the patch gate: hard refusals, checksum rule, confusables), `contract.ts` (terminal states).
- `src/emu/` — `core.ts` (`C64Core`, type/run/read/dump), `node.ts` (Node loader).
- `scripts/` — `record-run.mjs` (local recorder), `hooks/*.mjs` (Kiro hook commands).
- `tests/unit`, `tests/prop`, `tests/fixtures` (authored 2026 listings only — no magazine text is committed).
- `evidence/` — measured outputs (spike verdicts, hook logs, runs). `.kiro/` — specs, steering, hooks, agents.
