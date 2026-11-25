# Design: boot detection fixes (C1–C3)

## Root cause

`runProgram` (`src/emu/core.ts`) steps `checkEvery` = 50 frames, then reads the screen and decides everything from that one sample:

1. **C1.** A title visible for under 50 frames falls between two samples. Probe a: line 20 is a 300-iteration delay, then line 30 clears and prints `PRESS RETURN`. Both samples see `PRESS RETURN`, so `until` never holds. Nothing is wrong with `afterLastRun`; the title is never read.
2. **C2/C3.** `parseError(screen)` is a text match. The machine fact that distinguishes a real error from program output already exists: `programRunning(core)` (MSGFLG `$9D`: `$00` in program mode, `$80` after an error or END; measured, core.ts:103). It is not used on the error path.

## The fix

### F1. Real-error gate (C2, C3, E2, E3)

Add one private helper in `core.ts`:

```ts
/** A BASIC error, not program output: the text matches AND the machine is no longer running a program. */
function realError(core: C64Core, screen: string): C64Error | null {
  const err = parseError(screen);
  return err && !programRunning(core) ? err : null;
}
```

Use it at the three sites: the in-loop check, the budget-exhausted return in `runProgram`, and `runListing`'s post-key check (`session.ts`, the `parseError(titleScreen)` line). `parseError` is not edited (U6).

Effect on a true error: BASIC's error handler ends in READY with MSGFLG `$80`. An error is therefore visible to the gate from the first sample after the READY prompt appears. If a sample lands in the few cycles between the message print and READY, the gate says "still running", the loop continues, and the next check sees it. No error is lost and none is invented.

`programRunning` also requires the last screen row not to be `READY.`. That second condition only makes the gate stricter toward "not running", which is the safe side for real errors.

### F2. Per-frame title latch (C1, E1, E4)

Inside the `runProgram` loop, replace one `core.step(every)` by `every` calls of `core.step(1)`. After each frame, when `opts.until` exists and `core.pendingKeys() === 0`, run a title probe:

```
raw = read screen RAM $0400..$07E7 (1000 bytes)
if raw equals the previous frame's raw: skip              // static screen: no decode, no predicate
else: text = decode(raw); if opts.latch(afterLastRun(text)) and no latch yet: latched = text
```

* Cost control: the screen is decoded and the predicate evaluated only on frames where the 1000 screen bytes changed. A static screen costs one 1000-byte compare per frame and nothing else. If `C64Core` has a bulk memory read, use it; otherwise use `peek`. Task 2 measures before choosing.
* Only the title predicate is evaluated per frame. `parseError` and `waiting()` stay at the 50-frame cadence (U7). `until(afterLastRun(screen))` is still called once per check with the same argument as today.
* `runProgram` takes a new optional `latch?: (screenAfterRun: string) => boolean`. `runListing` passes the same `title` function it already uses for `until`, so the title predicate lives in one place. MCP callers that pass nothing see no change.
* At a check, the existing order is kept: pending keys → real error (F1) → `until`. After those, if a latch exists and `until` did not already hold, return `{ screen, error: null, frames, stoppedOn: "predicate", latched }`. The run stops at a check, not on the latched frame, so the program has the same settling time before post-title keys as today and the 50-frame cadence of recorded runs stays. `latched` is the screen text on the frame the predicate first held. It is an optional field of `RunResult`, set only in this branch, so a run whose title is visible at the check returns exactly what it returns today (U8).
* A real error at the check wins over a latch: a program that showed the title and then crashed is a crash (matches existing `!run.error && title(...)`).

`runListing` (`session.ts`):

```ts
let titleSeen = !run.error && (title(run.screen) || run.latched !== undefined);
...
if (titleSeen && titleScreen === undefined) titleScreen = run.latched ?? readScreenText(core);
```

The post-title clause then computes `before` from the latched title screen (U3). When `run.latched` is set, the title was seen without any title key press, so the `spec.titlePredicate.keys` branch is skipped. `titleSeen` stays false when `run.error` is set.

### Why not the alternatives

| Option | Verdict |
|---|---|
| Lower `checkEvery` to 1 or 5 | Samples a window, still misses shorter titles (cannot prove a title of N frames is caught for any N). Also changes every recorded run's `frames`. Rejected. |
| Stop on the exact latched frame | Presses post-title keys while the program is mid-delay, which changes timing for every recorded run. Rejected for U8. |
| Gate errors on text only, with a stricter regex | Error-shaped program output is exactly what the program printed. No regex separates it. Rejected: C2 needs the machine fact. |
| Fix probe b here | Needs RUN echo row tracking through scrolling. Out of scope (bugfix.md Known Limitation). |

## Cost (U9)

Stated mechanism: step by 1 frame, one 1000-byte screen compare per frame, decode + predicate only on a changed screen. `readScreenText` per frame was rejected because it decodes 1000 bytes on every frame.

The test (P5, in `boot-detect.test.ts`) measures it on the real core: a static-screen program (`10 PRINT"A"` / `20 GETK$:IFK$=""THEN20`) over 3000 frames, `runProgram` with a never-true `latch`, against a baseline loop in the test: `core.step(50)` + `readScreenText` × 60. Median of 5 runs each. Pass criteria, chosen not measured:

* new median ≤ 1.25 × baseline median; and
* whole-suite wall time (`npm test`, median of 3) ≤ 1.10 × the figure recorded in Task 2.

Both measured numbers are written to `evidence/boot-detect/cost.md` (Task 2 before, Task 7 after). Nothing in any doc quotes a number that is not in that file. The `c64_run` check calls its handler's underlying `runProgram` args (found by Task 2) on the same fixture and is held to the same 1.25× bound.

## Tests (`tests/unit/boot-detect.test.ts`, real core via `bootNodeCore`)

One test per item, named with its id. Fixtures are the probes, authored 2026 listings, built with the same canonical-listing helpers the other unit tests use. Specs: title `THE CRYPT`, post-title `OPENED` with key RETURN.

| Test | Item | Fixture | Asserts |
|---|---|---|---|
| `C1` | C1 | probe a, on current code | `titleSeen:false, stoppedOn:"frames"` (documents the defect; flipped to `E1` expectations in Task 5) |
| `C2` | C2 | probe c, current code | `error:{SYNTAX,99}, stoppedOn:"error"` |
| `C3` | C3 | fixtures f1 (budget-end), f2 (post-key) | each reproduces its false error, or Task 1 moves it to Unchanged |
| `E1` | E1 | probe a | `titleSeen:true`, `stoppedOn:"predicate"`, `error:null`, `screens.title` contains `THE CRYPT`, `postTitle:"pass"` |
| `E2` | E2 | probe c | `error:null`, `titleSeen:true`, `postTitle:"pass"` |
| `E3` | E3 | f1, f2 | `error:null` at both sites |
| `E4` | E4 | probe a twice on a fresh core each | identical `titleSeen`, `frames`, `screens` |
| `U1` | U1 | probe d | `error:{SYNTAX,10}`, `stoppedOn:"error"`, `titleSeen:false` |
| `U2` | U2 | probe e | `titleSeen:true, postTitle:"fail"` |
| `U3` | U3 | probe e variant where `OPENED` is printed before the title key wait | `postTitle:"fail"` |
| `U4` | U4 | probe d, plus a program whose source has `THE CRYPT` in a REM line and never prints it | `titleSeen:false` for both; during the run no latch fires while `pendingKeys()>0` (spy on `latch` calls) |
| `U5` | U5 | a program that never prints the title | `stoppedOn:"frames"`, `frames` = 3000 via `runListing`, 6000 via `runProgram` default |
| `U6` | U6 | `parseError` on two-space and malformed strings | existing behaviour; plus `grep` that `src/basic` / parseError file has no diff (Task 7) |
| `U7` | U7 | fixture g: program shows `PRESS A KEY`, waits in GET, prints `THE CRYPT` after the key; spec with `titlePredicate.keys` | the key is pressed after 3 stable checks, `titleSeen:true`; `until` call count equals `frames/50` (latch never calls `until`) |
| `U8` | U8 | all recordings | see P2 |
| `U9` | U9 | static-screen program | cost bounds above (named `P5`/`U9`) |
| `U10` | U10 | `git diff --stat` in Task 7 | `src/gate/contract.ts` untouched; no test changes it |
| `K1` | Known limitation | probe b | `it.fails`: asserts `titleSeen:true`. It passes today because the assertion fails. When someone fixes b it turns red on purpose. |

U8 is verified outside the unit file, because it uses recordings:

* **P1 (determinism property).** `fast-check` over delay length N in 0..400 for the shape `10 PRINT"{CLR}THE CRYPT"` / `20 FORI=1TO N:NEXT` / `30 PRINT"{CLR}OTHER"` / `40 GET loop`: `titleSeen` is true for every N. Put in `tests/prop/boot-detect.prop.test.ts`, bounded to ≤ 25 runs.
* **P2 (replay).** `node scripts/e2e-replay.mjs` before (Task 3) and after (Task 7) the change gives the same verdict for each of the 9 recorded runs, and the REPLAY re-judge reports 0 mismatches. Both outputs are saved to `evidence/boot-detect/replay-before.txt` / `replay-after.txt` and diffed. If a verdict differs the change is wrong, not the recording.
* **P3 (no spurious latch).** For every recorded listing, `runListing` after the fix returns a `run.latched` that is `undefined` or equal to a screen the old check also accepted. If any recording shows `latched` set, Task 7 explains it in `evidence/boot-detect/cost.md` before the change ships; it means a recorded run's `frames` or `screens` moved.
* **P4 (error truthfulness).** For every `?… ERROR IN n` produced by the recorded runs, `programRunning` was false at the moment of detection (assert in a unit test over the recordings), so F1 cannot hide a real error.

## Files touched

* `src/emu/core.ts`: `realError`, per-frame latch, `RunResult.latched?`, `runProgram` opts `latch?`.
* `src/emu/session.ts`: pass `latch: title`, use `run.latched`, use the gated error at the post-key site (`realError` exported for it, or inline `parseError(...) && !programRunning(core)`).
* `tests/unit/boot-detect.test.ts`, `tests/prop/boot-detect.prop.test.ts` (new).
* `evidence/boot-detect/*` (measured outputs).

Not touched: `src/gate/*`, `src/basic/*`, `scripts/e2e-replay.mjs`, `src/replay/replay.ts`, recordings.
