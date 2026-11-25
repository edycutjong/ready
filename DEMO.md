# DEMO: what to click, what to run

Live: https://ready.edycu.dev · No account, no install, no key.

## In the browser (about 60 s)

1. Open `/`. The recorded run starts by itself once (`/?still=1` and reduced-motion keep it still). Press **Resurrect** to
   play it again.
2. Watch the C64 pane: the authored 2026 page has a planted misprint on line 20 and the C64 reports
   `?SYNTAX  ERROR IN 20`. The misread line is struck in red; the agent's patch appears beneath it and re-inks to blue once the gate accepts it.
3. The certificate of resurrection and the **IT LIVES** stamp appear at the end. The stamp is captioned "as recorded, not re-run on a
   C64 here" because no ROM is hosted (rights). In `vite dev` on your machine the same page can re-run on the C64 core.
4. Press **Cheat**: it empties the error line while the C64 shows one (line 20; after the run, line 10). The gate refuses it.
   Below it, **fix it yourself** holds the line the C64 first blamed, as OCR read it (`20 PRIMT™   ** THE LAST SEANCE **"`).
   Edit it and press **Judge my line**: the agent's gate (`judgePatch` → `applyPatch`) judges it against the page as read.
   `20 PRINT"   ** THE LAST SEANCE **"` is ACCEPTED (checksum 159 = printed 159); `20 PRINT"   ** THE LOST SEANCE **"` is
   REFUSED by the checksum and `20 PRINT"IT LIVES"` by the 40% edit cap. The line as read is REFUSED (`™` is untypeable). Only the
   gate judges here: no C64 runs your line.
4b. Pick **The Ossuary** (eval case 6): the C64 says `?OUT OF DATA  ERROR IN 19`, the agent patches DATA line 890 (the page
   prints a period for a comma: our planted misprint). Judge line 19 as read: it already matches its printed checksum, so the line the C64 blames is not
   the misprinted one. Pick
   **The Ninth Knock** (eval case 5): OCR broke line 40, and a planted DATA misprint in line 80 would run silently and print
   `IT NIVES`; the agent fixes both, two accepted patches. Both are byte copies of `evidence/evals/runs/eval-case5-1-1795625618995.jsonl`
   and `eval-case6-1-1795625707333.jsonl` (`evidence/boot-detect/rejudge-p6d.json`, `identicalCopiesNotCounted`).
5. Open `/kiro`: the Pre Tool Use / Agent Stop / Session Start hook rows of the three recorded runs, in time order.
6. Open `/scan`: pick one of two June 1984 Gazette pages on archive.org (n177, n178; fetched through `/api/page`) or upload a scan. Self-hosted tesseract.js reads it in
   your tab; each line is checked against its printed checksum and the mismatches are flagged. No Kiro call, 0 credits, repair withheld.
   Or press **Read our authored page** (our typeset line-20 page, not a 1984 scan): in Chrome 158 it flags 2 of 12 lines, line 20 (the
   planted `PRIMT`) and line 60 (the OCR's own misread, `THEN5®`); Playwright's bundled Chromium 147 also flags line 90. Both builds
   OCR the same page after a canvas resample (`imageSmoothingQuality = "high"`); we attribute the difference to that resampler, which
   we have not isolated (`node scripts/live-scan-authored.mjs https://ready.edycu.dev evidence/e2e/scan-authored.json`, 3 runs per
   browser, rows identical within a build).

## From a clone

```bash
npm ci
node scripts/vendor-ocr.mjs                  # self-hosted tesseract.js worker, needed for /scan
npm test                                   # 45 files, 520 tests + 1 expected fail
node scripts/bench.mjs                     # p50/p95 → evidence/bench/bench-<date>.json (N stated per row)
node scripts/eval-agents.mjs --deterministic   # 0 credits: cases 2, 4, 7, 8, 9, 5d, 6d
node scripts/e0-search.mjs --input fixtures/authored/line20-input.json --out /tmp/e0.json   # experiment E0 baseline, authored row only (0 credits)
node scripts/live-judge-path.mjs https://ready.edycu.dev out.json   # the judge path on the deployed URL
node scripts/verify_offline.mjs            # OCR + checksum + emulator + REPLAY with network blocked
```

Model runs (`scripts/record-run.mjs`, `scripts/eval-agents.mjs --model`) need a logged-in `kiro-cli` and spend credits;
the hero run (`public/runs/`) and the case-3, 5 and 6 runs (`evidence/evals/runs/`) are committed and re-judged by REPLAY; the case-1 recordings are withheld (rights). `--model` sends the published run prompt `prompts/12-run-prompt-resurrect.md`, byte-identical to the one every recorded model run used (`--prompt-file` overrides it).

## Recorded numbers and where they live

| Claim | File |
|---|---|
| 520 tests + 1 expected fail, 45 files | `npm test` on 8d26d13 (`evidence/tests/npm-test-2026-11-26-p7.txt`) |
| gate p50 0.01 ms (p95 0.05) · boot p50 807 ms · REPLAY p50 2730 ms · OCR p50 1199 ms (N = 2000 / 10 / 10 / 5) | `evidence/bench/bench-2026-11-26-p7.json` |
| evals: 9 of 9 cases run and passing; 12 of 12 model runs RESURRECTED with the shipped profile (the E1–E4 ablation arms are not counted and include failures) | `evidence/evals/evals-2026-11-2{4,5}.jsonl`, `docs/EVALS.md` |
| experiments E1–E4 (18 new runs, N=2 per arm and case; the shipped case-6 row reuses release 2's 3 runs) | `node scripts/experiments-table.mjs` → `evidence/experiments/e1-e4.json`, `docs/EXPERIMENTS.md` |
| every recording re-judges, 0 mismatches (35 on the builder's machine; a clone has only the 20 public ones, and `experiments-table.mjs` needs the local tier-C files) | `node scripts/rejudge-runs.mjs` |
| E0: search fixed 3 of 18 failing lines on the real page; the agent 18 of 18 (N=2) | `evidence/experiments/e0.json`, `docs/EXPERIMENTS.md` |
| Live judge path, interaction and first-viewport checks | `evidence/e2e/` |
| Kiro credits per session | `docs/DX-REPORT.md` |

The demo video was cut on 2026-11-25; its receipts (492 tests, the count of the last test run before the cut, on `2b4fadd`; 6 of 6 model runs) are evals release 1. Each row above names the commit or file it was measured on.
