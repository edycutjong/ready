# Contributing

1. `npm ci` (Node ≥ 22.18).
2. `npm run typecheck && npm test` must be green before a pull request. The suite keeps one known limitation as an
   expected failure (`it.fails` in `tests/unit/boot-detect.test.ts`, README Honest limits 7); vitest fails the run if
   that test ever starts passing.
3. Keep changes small and say what was measured; numbers in docs must trace to `evidence/`.
4. Do not edit a file pinned in `evidence/freeze/` (the agent profile, steering, hooks, gate, MCP server, REPLAY) without
   recording a new freeze: the recorded runs are re-judged against those exact hashes.

## What CI runs on a pull request

| Workflow | Checks |
|---|---|
| `CI` | `node --check` on every script, JSON parse, actionlint; `tsc --noEmit`; the test suite on Node 22 and 24; the production build and the ROM check |
| `E2E` | `scripts/verify_offline.mjs`: the recorded run replays to RESURRECTED on a real in-browser C64 and `/scan` OCRs a page, with every non-local request blocked |
| `CodeQL` | JavaScript/TypeScript and GitHub Actions, `security-extended` queries |
| `Security` | gitleaks over the full history, `npm audit`, dependency review |
| `Quality` | Lighthouse CI on `/`, `/kiro`, `/scan`, `/landing/`, `/deck/` (budgets in `lighthouserc.json`) and the gzip bundle budget (`scripts/bundle-budget.mjs`) |

`Deploy` runs only on `main`, after `CI` passes, and is followed by the live judge path (`E2E`).
