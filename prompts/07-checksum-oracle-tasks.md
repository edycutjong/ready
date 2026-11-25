Don't hold back. Give it your all: aim for the best possible result, not a safe or average one.

Execute tasks 1 to 6 of `.kiro/specs/checksum-oracle/tasks.md`, in order, following `requirements.md` and `design.md` in the same folder exactly. These are the pure modules `src/basic/{types,tokenizer,notation,checksum}.ts` (whatever file split design.md names).

Rules:
- For each task: implement it, write its unit tests in `tests/unit/` (and any fast-check properties the task names in `tests/prop/`, ≥ 100 runs each), run `npx vitest run` and `npx tsc --noEmit` until both pass, then mark the task `[x]` in tasks.md. Do not start the next task while either is red.
- Test fixtures: only text you write yourself in 2026 (e.g. short original BASIC lines). Do not put any magazine listing text in tests.
- Do not edit `src/emu/**`, `runner/**`, `scripts/**`, `package.json` or the spec documents (except ticking boxes). No new dependencies. ESM, `.ts` import suffixes, no `node:` imports in `src/basic/**`.
- Never brute-force checksums. The checksum rule in requirements.md R2 is exact (measured 43/43 on a real page): every literal space is ignored, inside quotes too; `{SPACE}` and `{n SPACES}` count 0.
- Keep each file readable: short functions, a comment on every non-obvious rule with its requirement id.
When tasks 1–6 are done, reply with: tasks completed, test count passing, and any requirement you found ambiguous and how you resolved it.
