# Bugfix Requirements: boot detection misses short titles and mistakes program output for a C64 error

## Introduction

The success predicate is code, never the model. In the kill test before this build, a harness bug made the success check miss a boot screen the program had cleared, and a run was judged wrong. `afterLastRun` handles a cleared screen now. Two more defects in the same boot-detection path were measured on the real C64 core (`c64-ready@3.4.0`) on 2026-11-25. Both make the check say something false about a program that behaved correctly. A third probe shows a gap that stays open (see Known Limitation).

Measured probes. `{CLR}` is the clear-screen control inside the quotes. Title text is `THE CRYPT`, post-title text is `OPENED`.

| Probe | Listing | Measured | Correct |
|---|---|---|---|
| a | `10 PRINT"{CLR}THE CRYPT"` / `20 FORI=1TO300:NEXT` / `30 PRINT"{CLR}PRESS RETURN"` / `40 GETK$:IFK$=""THEN40` / `50 PRINT"OPENED"` | `titleSeen:false, stoppedOn:"frames"` | title was on screen: `titleSeen` true |
| b | `10 PRINT"{CLR}THE CRYPT"` / `20 PRINT"RUN"` / `30 GETK$:IFK$=""THEN30` / `40 PRINT"OPENED"` | `titleSeen:false` | out of scope, see Known Limitation |
| c | `10 PRINT"{CLR}?SYNTAX  ERROR IN 99"` / `20 PRINT"THE CRYPT"` / `30 GETK$:IFK$=""THEN30` / `40 PRINT"OPENED"` | `error:{SYNTAX,99}, stoppedOn:"error"` while the program still runs in its GET loop | no error: the program printed that text, BASIC never stopped |
| d | `10 PRIMT"X"` / `20 PRINT"THE CRYPT"` (no CLR) | `error:{SYNTAX,10}, titleSeen:false` | correct today |
| e | `10 PRINT"{CLR}THE CRYPT"` / `20 END` | `titleSeen:true, postTitle:"fail"` | correct today |

## Current Behavior (Defect)

- **C1 (probe a).** WHEN a program shows its title for fewer than `checkEvery` (50) frames and then replaces it, THEN `runProgram` never samples the title screen, returns `stoppedOn:"frames"`, and `runListing` reports `titleSeen:false`. The listing is judged as not booting although the title was on screen.
- **C2 (probe c).** WHEN a running program prints text shaped like a BASIC error (`?SYNTAX  ERROR IN 99`), THEN `runProgram` calls `parseError(screen)` on screen text alone, returns `error:{SYNTAX,99}, stoppedOn:"error"`, and `runListing` treats the run as failed at line 99. `programRunning(core)` (MSGFLG `$9D` = `$00` in program mode, `$80` after an error or END) is not consulted.
- **C3 (same cause as C2, other call sites; not yet measured).** The two other places that call `parseError` on screen text alone have the same flaw: the last line of `runProgram` (frame budget exhausted) and `runListing` after the title-key press (`parseError(titleScreen)`). Task 1 measures a fixture for each. If one does not reproduce, it moves to Unchanged and C3 is narrowed to the site that does.

## Expected Behavior (Correct)

- **E1 (fixes C1).** WHEN the title predicate holds on any single frame after `RUN` has executed, THEN the run reports the title as seen: `runListing` returns `titleSeen:true`, `run.stoppedOn:"predicate"`, `run.error:null`, and `screens.title` holds the screen as it was on the frame the predicate first held, not the screen at the next 50-frame check. Probe a gives `titleSeen:true` and `postTitle:"pass"`.
- **E2 (fixes C2).** An error counts as a BASIC error only when `parseError(screen)` matches AND `programRunning(core)` is false. WHILE the program is still running, error-shaped text is program output and is ignored. Probe c gives `error:null`, `titleSeen:true`, `postTitle:"pass"`.
- **E3 (fixes C3).** The same gate (E2) applies at the budget-exhausted return of `runProgram` and at the post-key `parseError(titleScreen)` in `runListing`.
- **E4 (determinism).** The per-frame title check depends only on the core state. The same listing on the same core version gives the same `titleSeen`, `frames` and screens on every run, which is what REPLAY needs.

## Unchanged Behavior (Regression Prevention)

- **U1 (probe d).** A real error still stops the run: `error:{SYNTAX,10}`, `stoppedOn:"error"`, `titleSeen:false`. Title text in the typed source never counts.
- **U2 (probe e).** A title followed by `END` still gives `titleSeen:true, postTitle:"fail"` (the post-title text was not produced by a key press).
- **U3 (post-title clause).** The press must PRODUCE the post-title text. When the text is already on screen below the RUN row before the press, `postTitle` stays `"fail"` (fail closed). With E1, "before the press" is judged against the latched title screen.
  *Amended after an architecture review (claude-direct, 2026-11-26):* the latched screen alone let a program that cleared a short title and printed the post-title text by itself pass clause 2, so "before the press" is now the latched title screen AND the screen read right before the press (test U3b); a real BASIC error after the title-key press now clears `titleSeen` (test U3c). All 35 recordings re-judge with 0 mismatches on the amended code (`evidence/boot-detect/rejudge-p6c.json`).
- **U4 (`afterLastRun` anchoring).** Title text in the typed listing above the RUN row never counts (P1a QA r2). The per-frame check does not run while keys are still queued (`core.pendingKeys() > 0`), so a half-typed `RUN` line cannot produce a false title.
- **U5 (budget).** `runListing` default budget stays 3000 frames and `runProgram` default stays 6000. A program that never shows its title still ends `stoppedOn:"frames"` at that budget.
- **U6 (error parsing).** `?SYNTAX  ERROR IN n` is parsed with two spaces, and every existing `parseError` unit test passes unchanged. `parseError` itself is not edited.
- **U7 (`waiting()` rule).** For titles that need a key first, `waiting()` still declares "waiting for input" after 3 consecutive identical non-empty checks at the 50-frame cadence. The per-frame check does not feed `waiting()`; the `until` callback is still called once per check.
- **U8 (replay).** Every recorded run re-judges with 0 mismatches: `scripts/e2e-replay.mjs` and the REPLAY re-judge in `src/replay/replay.ts` reach the same verdicts (9 recorded runs today). The recorded-run format is not changed: any new `RunResult` field is optional, absent unless the latch is the only title evidence, and not written into existing recordings.
- **U9 (cost).** The 492-test suite and MCP `c64_run` are not noticeably slower. Criteria in design.md "Cost".
- **U10 (judge).** `src/gate/contract.ts`, `judge()` and the model's role are untouched. The model never declares success.

## Known Limitation (not fixed here)

Probe b: `10 PRINT"{CLR}THE CRYPT"` / `20 PRINT"RUN"` / `30 GETK$:IFK$=""THEN30` / `40 PRINT"OPENED"`. Measured `titleSeen:false`. The program prints a row that is exactly `RUN`, and `afterLastRun` anchors on the last such row, so it treats the program's own output as the RUN echo and cuts the title away. A correct fix has to track the real RUN echo row through screen scrolling. That is separate work. Probe b is committed as an `it.fails`-style known-limitation test (design.md, test K1) so nobody assumes it is fixed, and so it flips loudly when someone fixes it.

## Review findings after the fix (P6b, 2026-11-26, claude-direct — measured, `evidence/boot-detect/`)

- **R1 (new defect in the first fix, now fixed).** On a reused core the rows below the new `RUN` echo still held the previous run's output, and the per-frame latch caught that stale title in the first frames after `RUN`; its stale post-title text then made clause 2 fail closed. Probe a failed the post-title press at every sampled delay from 1 to 300 (1, 25, 50, 100, 200, 300) on a reused core, and the re-judge flagged 4 per-run fact differences in one local recording (console output, not saved). Fix: `runProgram` types CLR/HOME (PETSCII 147) before `RUN`, so only this run's output is ever on screen below the RUN row. New Unchanged item **U11**: output of an earlier run on the same core never counts as this run's title or post-title text.
- **R2 (C3 f1 reproduced, now fixed).** With CLR/HOME queued, a budget spent before `RUN` is even typed left the typed listing on screen, and `parseError` matched error-shaped text inside it while the machine was in direct mode (so `realError` alone could not help). Fix: no error is reported at the budget-end return while keys are still queued. C3 is fixed at both sites (f1, f2); nothing moved to Unchanged.
- **U8 holds:** every recording on disk re-judges with 0 mismatches on the pre-fix code (`90cbeec`) and on the final code (`evidence/boot-detect/rejudge-before.json`, `rejudge-after.json`; `scripts/rejudge-runs.mjs`).

