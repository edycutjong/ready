# Evals — release 2 (2026-11-26; release 1 was 2026-11-25)

Source of truth: `evidence/evals/evals-2026-11-24.jsonl` (release 1) and `evidence/evals/evals-2026-11-25.jsonl` (release 2: cases 5 and 6, and the E1–E4 arms in `docs/EXPERIMENTS.md`) — one row per case/run, with the git commit the agent + gate ran on.
Harness: `scripts/eval-agents.mjs` (`--deterministic` costs 0 credits and runs on every task; `--model --case N --n 3` goes through the real recorder → `kiro-cli` → the shipped `resurrector` profile).

| # | Case | Kind | Result | Credits |
|---|---|---|---|---|
| 1 | Random Number Test title path (June 1984, tier-C input stays local) | model, N=3 | **3/3** TITLE-PATH RESURRECTED (5, 6, 6 iterations; 58–114 s; the run files are tier-C and withheld, so only these counts are public) | 8.34 total |
| 2 | clean listing boots at 0 iterations, the agent is never called | deterministic | pass — stand-in: the authored page with line 20 fixed; the Power BASIC Gazette OCR is tier C and not in the repo | 0 |
| 3 | authored line-20 typo (`PRIMT`) | model, N=3 | **3/3** RESURRECTED (1 accepted patch each; 24.8–26.4 s; run files in `evidence/evals/runs/`) | 2.61 total |
| 4 | Cheat: empty the error line | deterministic | pass — REFUSED (R4.4) | 0 |
| 5 | authored silent failure (`knock`, an original 2026 page): DATA line 80 misprinted (`76` → `78`), so the program runs with no error and prints `IT NIVES`; the real OCR also read line 40's `THEN40` as `THEN4®`, so the first run stops loudly at line 40 | model, N=3 (+ deterministic half `5d`) | **3/3** RESURRECTED, each with 2 accepted patches (lines 40 and 80) and only those; 29.1–29.5 s; run files in `evidence/evals/runs/`. `5d`: after the line-40 fix the run is silent and the post-title text is wrong; the DATA fix passes the gate | 3.00 total |
| 6 | `?OUT OF DATA ERROR IN 19` with the fault in DATA 890 (`ossuary`, an original 2026 page with the kill-test pattern: a comma printed as a full stop, so the READ loop runs out) | model, N=3 (+ deterministic half `6d`) | **3/3** RESURRECTED, each with 1 accepted patch (line 890); line 10's loop bound was never patched; 25.1–26.4 s. `6d`: the kill-test dodge (`C=23` in line 10) is REFUSED by the gate | 2.71 total |
| 7 | unreadable scan stops at the OCR quality gate | deterministic | pass, 0 credits | 0 |
| 8 | a line > 80 characters is flagged before typing | deterministic | pass (`too-long`) | 0 |
| 9 | forced patch after 0 / 1 / 2 prior refusals | deterministic | pass — refused, refused, FORCED | 0 |

**Pass count: 9 of 9 cases run and passing.** Model cases at N=3: 12 of 12 runs RESURRECTED (cases 1 and 3 in release 1, cases 5 and 6 in release 2). Cases 3, 5 and 6 patched only the faulted lines; case 1 patched the 18 lines that failed their checksum. N=3 per case is small: it shows the loop works on these inputs, not a rate.

Release 2 (P6b, 2026-11-26): cases 5 and 6 were written as **authored 2026 pages** (`fixtures/authored/{knock,ossuary}.bas`, printed by `scripts/author-page.mjs` with the checksum of the intended line and the misprint applied to the printed text only, typeset and read by the real tesseract.js by `scripts/typeset-authored.mjs`). So their run files are public, unlike case 1. Case 5 was specified as a *misnumbered* DATA line; a misnumbered line is renumbered or excluded by the recovery code before the agent runs (`src/ocr/recover.ts`), so the agent-facing silent case is a misread DATA *value*. Model rows ran at commit `657ac88` under freeze #3 (`evidence/freeze/freeze-2026-11-26-p6b.txt`, 24/24 hashes). Spend: 5.71 credits.
Model-case spend: 10.95 credits (metered by kiro-cli per run). Two commits appear in the file (`749656d` for the deterministic rows, which were run from the working tree before the harness was committed in `f9ef749`; `f9ef749` for the model rows). The agent profile, the steering and the gate were unchanged from the sha256 freeze in `evidence/freeze/freeze-2026-11-25.txt` through every model run (`shasum -c` over its 21 hashes passed at the recording commit `f9ef749`; five of those files changed later in the P1d architecture review, and `freeze-2026-11-25-2.txt` (24 hashes) passes at HEAD once its header lines and the `(changed)/(added)` annotations are stripped: `grep -E '^[0-9a-f]{64}  ' f | sed 's/   (.*//' | shasum -a 256 -c`). The freeze file was committed together with the first recording, so it proves no drift, not the time it was written.
Caveats: N=3 per case on one machine; case 1's input is the single Random Number Test (June 1984) page's tesseract.js read, so it measures the loop on that input, not a rate across listings. The figures above are the harness's own jsonl rows; the case-1 run streams are not published. Source-exact counts are measured per run by `record-run.mjs --reference` and are not part of this table.

Re-judged after the architecture review (P1d, 2026-11-25): REPLAY re-runs all 6 model runs on the real C64 core and
re-judges every patch; at P1d all 6 agreed with their recorded verdict (0 mismatches). Before the loader fix in that
round, case 1 run 3 did not: an earlier call left the title's GET loop waiting, and REPLAY typed the next program into it
(BOOTED-PARTIAL, clause 6). The recorded result stands as recorded; the fix made REPLAY independent of that history
(`evidence/freeze/freeze-2026-11-25-2.txt`).
