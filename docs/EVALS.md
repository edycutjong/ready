# Evals — release 1 (2026-11-25)

Source of truth: `evidence/evals/evals-2026-11-24.jsonl` (one row per case/run, with the git commit the agent + gate ran on).
Harness: `scripts/eval-agents.mjs` (`--deterministic` costs 0 credits and runs on every task; `--model --case N --n 3` goes through the real recorder → `kiro-cli` → the shipped `resurrector` profile).

| # | Case | Kind | Result | Credits |
|---|---|---|---|---|
| 1 | Random Number Test title path (June 1984, tier-C input stays local) | model, N=3 | **3/3** TITLE-PATH RESURRECTED (5, 6, 6 iterations; 58–114 s; the run files are tier-C and withheld, so only these counts are public) | 8.34 total |
| 2 | clean listing boots at 0 iterations, the agent is never called | deterministic | pass — stand-in: the authored page with line 20 fixed; the Power BASIC Gazette OCR is tier C and not in the repo | 0 |
| 3 | authored line-20 typo (`PRIMT`) | model, N=3 | **3/3** RESURRECTED (1 accepted patch each; 24.8–26.4 s; run files in `evidence/evals/runs/`) | 2.61 total |
| 4 | Cheat: empty the error line | deterministic | pass — REFUSED (R4.4) | 0 |
| 5 | authored misnumbered DATA line (silent failure) | model | **NOT RUN** — the authored fixture is not written yet | — |
| 6 | `?OUT OF DATA` with the fault in DATA 885+ | model | **NOT RUN** — needs its fixture | — |
| 7 | unreadable scan stops at the OCR quality gate | deterministic | pass, 0 credits | 0 |
| 8 | a line > 80 characters is flagged before typing | deterministic | pass (`too-long`) | 0 |
| 9 | forced patch after 0 / 1 / 2 prior refusals | deterministic | pass — refused, refused, FORCED | 0 |

**Pass count: 7 of 9 cases run and passing (model cases at N=3, all 6 runs RESURRECTED); cases 5 and 6 are not run.** This is not "9/9".
Model-case spend: 10.95 credits (metered by kiro-cli per run). Two commits appear in the file (`749656d` for the deterministic rows, which were run from the working tree before the harness was committed in `f9ef749`; `f9ef749` for the model rows). The agent profile, the steering and the gate were unchanged from the sha256 freeze in `evidence/freeze/freeze-2026-11-25.txt` through every model run (`shasum -c` over its 21 hashes passed at the recording commit `f9ef749`; five of those files changed later in the P1d architecture review, and `freeze-2026-11-25-2.txt` (24 hashes) passes at HEAD once its header lines and the `(changed)/(added)` annotations are stripped: `grep -E '^[0-9a-f]{64}  ' f | sed 's/   (.*//' | shasum -a 256 -c`). The freeze file was committed together with the first recording, so it proves no drift, not the time it was written.
Caveats: N=3 per case on one machine; case 1's input is the single Random Number Test (June 1984) page's tesseract.js read, so it measures the loop on that input, not a rate across listings. The figures above are the harness's own jsonl rows; the case-1 run streams are not published. Source-exact counts are measured per run by `record-run.mjs --reference` and are not part of this table.

Re-judged after the architecture review (P1d, 2026-11-25): REPLAY re-runs all 6 model runs on the real C64 core and
re-judges every patch; at HEAD all 6 agree with their recorded verdict (0 mismatches). Before the loader fix in that
round, case 1 run 3 did not: an earlier call left the title's GET loop waiting, and REPLAY typed the next program into it
(BOOTED-PARTIAL, clause 6). The recorded result stands as recorded; the fix made REPLAY independent of that history
(`evidence/freeze/freeze-2026-11-25-2.txt`).
