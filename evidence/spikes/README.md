# Day-1 spikes — verdicts (build Day 1, 2026-11-25 WIB)

Each file states PASS / FAIL / PARTIAL with the command that produced it and its real output. Raw material that
contains magazine text (OCR output, screen dumps of the 1984 program, crops) stays outside this repository until
the rights question is answered; here are only counts, hashes, verdicts and Kiro mechanism logs.

| Spike | Verdict | File |
|---|---|---|
| M5 RETURN test | PASS | `spike-M5-return.md` |
| E ROM-free core | FAIL (pre-decided kill rule applies) | `spike-E.md` |
| O tesseract.js OCR | PASS | `spike-O.md` |
| G0 input + recovery feasibility | PASS | `spike-G0.md` |
| K1 Pre Tool Use gate + permissions headless | PASS | `spike-K1.md` |
| K2 Agent Stop hook headless | PARTIAL (one forced turn per prompt) | `spike-K2.md` |
| K3 metering | PASS (metered in all 3 modes) | `spike-K3.md` |
