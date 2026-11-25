# DEMO: what to click, what to run

Live: https://ready.edycu.dev · No account, no install, no key.

## In the browser (about 60 s)

1. Open `/`. The recorded run starts by itself once (`/?still=1` and reduced-motion keep it still). Press **Resurrect** to
   play it again.
2. Watch the C64 pane: the authored 2026 page has a planted misprint on line 20 and the C64 reports
   `?SYNTAX  ERROR IN 20`. The agent's patch is struck in red until the gate accepts it, then re-inked in blue.
3. The death certificate and the **IT LIVES** stamp appear at the end. The stamp is captioned "as recorded, not re-run on a
   C64 here" because no ROM is hosted (rights). In `vite dev` on your machine the same page can re-run on the C64 core.
4. Press **Cheat**: it empties the error line while the C64 shows one (line 20; after the run, line 10). The gate refuses it.
5. Open `/kiro`: the Pre Tool Use / Agent Stop / Session Start hook rows of the recorded run.
6. Open `/scan`: pick an archive.org Gazette page (fetched through `/api/page`) or upload a scan. Self-hosted tesseract.js reads it in
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
npm test                                   # 44 files, 508 tests + 1 expected fail
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
| 508 tests + 1 expected fail, 44 files | `npm test` on HEAD (`evidence/tests/npm-test-2026-11-26.txt`) |
| gate p50 0.01 ms (p95 0.03) · boot p50 829 ms · REPLAY p50 2295 ms · OCR p50 842 ms (N = 2000 / 10 / 10 / 5) | `evidence/bench/bench-2026-11-25.json` |
| evals: 9 of 9 cases run and passing; 12 of 12 model runs RESURRECTED | `evidence/evals/evals-2026-11-2{4,5}.jsonl`, `docs/EVALS.md` |
| experiments E1–E4 (N=2 per arm) | `node scripts/experiments-table.mjs` → `evidence/experiments/e1-e4.json`, `docs/EXPERIMENTS.md` |
| every recording re-judges, 0 mismatches (35 on the builder's machine; a clone has only the 20 public ones, and `experiments-table.mjs` needs the local tier-C files) | `node scripts/rejudge-runs.mjs` |
| E0: search fixed 3 of 18 failing lines on the real page; the agent 18 of 18 (N=2) | `evidence/experiments/e0.json`, `docs/EXPERIMENTS.md` |
| Live judge path, interaction and first-viewport checks | `evidence/e2e/` |
| Kiro credits per session | `docs/DX-REPORT.md` |

The demo video was cut on 2026-11-25 at commit `31c0a10`; its receipts (492 tests, the count of the last test run before the cut, on `2b4fadd`; 6 of 6 model runs) are evals release 1. The rows above are HEAD.
