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
   your tab and the magazine's per-line checksum flags the misread lines. No Kiro call, 0 credits, repair withheld.

## From a clone

```bash
npm ci
node scripts/vendor-ocr.mjs                  # self-hosted tesseract.js worker, needed for /scan
npm test                                   # 41 files, 492 tests
node scripts/bench.mjs                     # p50/p95 → evidence/bench/bench-<date>.json (N stated per row)
node scripts/eval-agents.mjs --deterministic   # 0 credits: cases 2, 4, 7, 8, 9
node scripts/e0-search.mjs --input fixtures/authored/line20-input.json --out /tmp/e0.json   # experiment E0 baseline, authored row only (0 credits)
node scripts/live-judge-path.mjs https://ready.edycu.dev out.json   # the judge path on the deployed URL
node scripts/verify_offline.mjs            # OCR + checksum + emulator + REPLAY with network blocked
```

Model runs (`scripts/record-run.mjs`, `scripts/eval-agents.mjs --model`) need a logged-in `kiro-cli` and spend credits;
the hero run (`public/runs/`) and the case-3 runs (`evidence/evals/runs/`) are committed and re-judged by REPLAY; the case-1 recordings are withheld (rights), and `--model` needs the builder's local prompt file.

## Recorded numbers and where they live

| Claim | File |
|---|---|
| 492 tests, 41 files | `npm test` on HEAD |
| gate p50 0.009 ms · boot p50 641 ms · REPLAY p50 2485 ms · OCR p50 903 ms (N = 2000 / 10 / 10 / 5) | `evidence/bench/bench-2026-11-24.json` |
| evals: 7 of 9 cases run and passing; 6 of 6 model runs RESURRECTED | `evidence/evals/evals-2026-11-24.jsonl`, `docs/EVALS.md` |
| E0: search fixed 3 of 18 failing lines on the real page; the agent 18 of 18 (N=2) | `evidence/experiments/e0.json`, `docs/EXPERIMENTS.md` |
| Live judge path, interaction and first-viewport checks | `evidence/e2e/` |
| Kiro credits per session | `docs/DX-REPORT.md` |
