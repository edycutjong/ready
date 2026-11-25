# Tasks: boot detection fixes

Tests first. Tasks 1 to 3 run against the unfixed code and must leave `src/` unchanged.

- [x] 1. **Write the exploration tests (red on defects, green on Unchanged).**
  Files: `tests/unit/boot-detect.test.ts` (new).
  Add tests `C1`, `C2`, `C3`, `U1`–`U7`, `K1` with probes a–e as fixtures and f1 (error-shaped text at budget end), f2 (error-shaped text after the title-key press), g (title needs a key). Run them on the unfixed code. Expected: `C1`, `C2` pass by asserting the defect; `U1`–`U7`, `K1` pass. Record each fixture's measured result in `evidence/boot-detect/baseline.md`. If f1 or f2 does not reproduce, move it to Unchanged (bugfix.md C3 narrowed) and say so there.

- [x] 2. **Measure cost baseline.**
  Files: `evidence/boot-detect/cost.md` (new); `tests/unit/boot-detect.test.ts` (add `U9`/`P5` with the baseline loop).
  Record: `npm test` wall time (median of 3); `runProgram` 3000 frames on a static screen (median of 5); the arguments MCP `c64_run` passes to `runProgram` (find with `grep -rn "runProgram" src/`); whether `C64Core` offers a bulk memory read (decides bulk read vs `peek` in F2).

- [x] 3. **Capture the replay baseline.**
  Files: `evidence/boot-detect/replay-before.txt` (new).
  Run `node scripts/e2e-replay.mjs` and the REPLAY re-judge (`src/replay/replay.ts` entry used by its tests). Save verdicts for all 9 recorded runs and the mismatch count (must be 0). Also add `P4` (error truthfulness over recordings) to `tests/unit/boot-detect.test.ts`.

- [x] 4. **Add the real-error gate (F1).**
  Files: `src/emu/core.ts`, `src/emu/session.ts`.
  Add `realError`; use it in the `runProgram` loop, in the budget-exhausted return, and at the post-key `parseError(titleScreen)` in `runListing`. Do not edit `parseError`. Turn `C2` into `E2`, and `C3` into `E3`, in `tests/unit/boot-detect.test.ts`. Run `U1`, `U6`, `U7` and the full unit suite.

- [x] 5. **Add the per-frame title latch (F2).**
  Files: `src/emu/core.ts`, `src/emu/session.ts`.
  Add `opts.latch`, the 1-frame stepping with the screen-RAM compare, `RunResult.latched?` set only when the title was latched but is not on screen at the check. In `runListing` pass `latch: title`, set `titleSeen` and `titleScreen` from `run.latched`. Turn `C1` into `E1`; add `E4`. Keep `U4`, `U5`, `U7` green (spy that `until` is called once per check and `latch` is never called while keys are pending).

- [x] 6. **Add the property test.**
  Files: `tests/prop/boot-detect.prop.test.ts` (new).
  `P1`: for delay N in 0..400 the title is always seen (≤ 25 runs). Confirm it fails on the pre-fix code by running it once with Task 5 stashed or reverted in a scratch copy, and record the failing N in `evidence/boot-detect/baseline.md`.

- [x] 7. **Prove Unchanged holds and cost is within bounds.**
  Files: `evidence/boot-detect/replay-after.txt`, `evidence/boot-detect/cost.md` (update).
  Run `npm test` (all, including the 492 existing tests plus the new ones). Run the replay again and `diff` it against `replay-before.txt`: no differences, 0 mismatches (P2). Run P3 over the recordings. Measure `P5`/`U9` and the `npm test` median: criteria in design.md "Cost". Check `git diff --stat` shows no change to `src/gate/`, `src/basic/`, `scripts/e2e-replay.mjs`, `src/replay/replay.ts` (U6, U8, U10). If any bound fails, change the implementation, not the bound.

- [x] 8. **Close out.**
  Files: `.kiro/specs/bugfix-boot-detect/bugfix.md` (only if Task 1 changed C3).
  Make sure `K1` stays in the suite as the Known Limitation marker. Delete any scratch files from Task 6. Report the measured numbers from `evidence/boot-detect/` only.

Tasks 1, 4, 5: Kiro (turn 14, 3.43 credits). Tasks 2, 3, 6, 7, 8 and the review fixes R1, R2 (bugfix.md): claude-direct, P6b.
Evidence: `evidence/boot-detect/` (baseline.md, cost.json, rejudge-before.json, rejudge-after.json); scripts `scripts/rejudge-runs.mjs`, `scripts/bench-boot-detect.mjs`.
Where the artefacts ended up (they differ from the names planned above): task 2's cost baseline is `evidence/boot-detect/cost.json` (from `scripts/bench-boot-detect.mjs`), task 3/7's replay baseline and check are `evidence/boot-detect/rejudge-before.json` / `rejudge-after.json` (from `scripts/rejudge-runs.mjs`, all recordings, not only the 9 of the original plan), task 6's property is `tests/prop/boot-detect.prop.ts`. P4, P5 and U9 are covered by those scripts and their JSON, not by unit tests in `boot-detect.test.ts`.
