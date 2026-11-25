Don't hold back. Give it your all: aim for the best possible result, not a safe or average one.

Execute tasks 1 to 5 of `.kiro/specs/c64-mcp-server/tasks.md`, in order, following `requirements.md` and `design.md` in the same folder exactly (they are already reviewed; do not re-read files you do not need — be economical: this session has a tight credit budget).

Rules:
- For each task: implement it, write its tests, run `npx vitest run <the task's test files>` and `npx tsc --noEmit` until both pass, then tick the task `[x]` in tasks.md. Do not start the next task while either is red. Do not run the whole suite (it takes minutes); only the task's own test files.
- Fixtures: only original 2026 BASIC you write yourself (the spec's NIGHTJAR program). No magazine text.
- Do not edit `src/**`, `runner/**`, `scripts/**`, `package.json` or the requirements/design documents. No new dependencies. ESM, `.ts` import suffixes.
- The Pre Tool Use hook `scripts/hooks/checksum-gate.mjs` and the Stop hook `scripts/hooks/until-title.mjs` already exist and read `listing.json`, `events.jsonl` (`{k:"emu",op:"run"}`, `{k:"gate",verdict}`), `refusals.json` and `credits.json` exactly as the spec defines them — keep those shapes.
When tasks 1–5 are done, reply with: tasks completed, test count passing, and any deviation from design.md with its reason.
