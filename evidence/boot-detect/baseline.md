# bugfix-boot-detect — measured before / after (2026-11-26, real C64 core c64-ready@3.4.0, Node 22.22)

Probe a with a delay loop of N iterations between the title and the next `{CLR}` (`tests/prop/boot-detect.prop.ts`),
one reused core, delays run in order (`runListing`, title `THE CRYPT`, post-title `OPENED`):

| Code | 0 | 1 | 25 | 50 | 100 | 200 | 300 | 400 | 600 | 1000 |
|---|---|---|---|---|---|---|---|---|---|---|
| pre-fix (commit 90cbeec, 50-frame sampling) | MISSED | MISSED | MISSED | MISSED | MISSED | MISSED | MISSED | MISSED | MISSED | seen / pass |
| Kiro's latch (turn 14), before review — measured ad hoc on the working tree (no commit holds Kiro's latch alone: `ef82fea` has it with the fixes) | seen / pass | seen / **fail** | seen / **fail** | seen / **fail** | seen / **fail** | seen / **fail** | seen / **fail** | seen / pass | seen / pass | seen / pass |
| final (latch + CLR/HOME before RUN + budget-end rule) | seen / pass | seen / pass | seen / pass | seen / pass | seen / pass | seen / pass | seen / pass | seen / pass | seen / pass | seen / pass |

The middle row's failures came from a reused core: rows below the new RUN echo still held the previous run's output, the
per-frame latch caught that stale title, and its stale `OPENED` made the post-title press look pre-satisfied (clause 2
fails closed). On the code of that middle row, the re-judge also flagged 4 per-run fact differences in one local
recording (console output, not saved). Both are gone in the final code. Re-judge of every recording on disk (20 public,
15 tier-C; tier-C rows carry counts only): `rejudge-before.json` at the pre-fix commit `90cbeec` 35/35, 0 mismatches;
`rejudge-after.json` at `3e13355` (final code) 35/35, 0 mismatches. Cost: `cost.json` (latch overhead 1.01× at HEAD on 3000
static frames, N=5; `scripts/bench-boot-detect.mjs`).
