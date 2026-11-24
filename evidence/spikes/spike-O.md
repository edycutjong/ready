# Spike O — tesseract.js on the real scan (PASS)

**Question:** does in-browser-grade OCR (tesseract.js) reproduce the failure class the agent loop exists for, at the
three ScanQuality stops? **Input:** archive.org `1984-06-computegazette` leaf n177, right column (the randnum title
path), resampled to 800 / 1600 / 2376 px source width. tesseract.js **7.0.0**, `eng.traineddata` sha256
`5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747`, PSM 6. Script `specs/spikes/spike-o.mjs` (kitchen).

| Engine / width | numbered lines (title path) | checksum-valid | rate | numbers not seen | orphan numbers | ms |
|---|---|---|---|---|---|---|
| CLI tesseract (kill test) | 24 | 3 | 0.125 | 10 | 6 | — |
| tesseract.js @800 | 28 | 4 | 0.143 | 1 | 0 | 1563 |
| tesseract.js @1600 | 27 | 8 | 0.296 | 2 | 1 | 2494 |
| tesseract.js @2376 | 24 | 6 | 0.250 | 9 | 5 | 3181 |

**Confusables, measured across the 3 widths (frozen at the end of this spike):**
- line-number token: `0`→`9` ×6, `0`→`8` ×5, `0`→`¢` ×3, `0`→`6` ×2, `0`→`@` ×1, `0`→`2` ×1, `0`→`4` ×1.
- printed `:rem` digits: **no misreads observed** in tesseract.js output → the gate's digit-misread set stays the
  three pairs measured in the kill test: `0↔8`, `0↔9`, `0↔6`. Not extended.
- OCR-parse rule (code, before any agent): the non-digit slashed-zero glyphs `¢` and `@` in a line-number token read
  as `0`. Digit-for-digit confusions are left to checksum-proven `renumber` (they are ambiguous by themselves).

**Recount (open count issue, seed-data.md):** the randnum listing spans three columns: n177 right (lines 1–2000,
44 numbered lines), n178 left (2002–4200, 49) and n178 right top (4210–5000, 12) = **105 numbered lines,
PROVISIONAL** — counted by one machine read of the page images (Claude vision); tesseract.js corroborated 10 of the
12 on n178 right. The earlier 74 (CLI) and 44 (vision, n177 only) were both partial. The title-path scope (28) is
unaffected. Not quoted anywhere until a person confirms it (HUMAN-TODO).
