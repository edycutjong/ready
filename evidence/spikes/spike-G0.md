# Spike G0 — input and recovery feasibility, 0 credits (PASS)

**Input:** the tesseract.js @1600 px read (spike O), diffed against `expectedLines` (28 title-path lines with printed
sums). **No model call.** Script `specs/spikes/g0.mjs` (kitchen).

| Step | Result |
|---|---|
| numbers present after the OCR parse (incl. `¢`/`@`→`0` in the number token) | 27 / 28 |
| absent | 1 line (OCR read its number as a digit confusion → orphan with that line's printed sum) |
| re-OCR of the gap crop (2×, PSM 6 / 4, plus PSM 7 per row) | **recovered**: one candidate, checksum-valid, equal to the reference (source `re-ocr`) |
| orphan rows | 1 → re-OCR'd, its number now taken by the recovered line → **excluded by code** (`orphan-excluded`) |
| TYPED needed | **0** — the person-typing prompt exists (`scripts/type-lost-lines.mjs`: shows each lost line's crop, a person types it, source `typed`, checksum shown) but no line needed it |
| lines present / checksum-valid going into the agent loop | **28 / 28 present, 10 checksum-valid → 18 for the agent** |

**Second read of the reference** (`expectedLines`, from a vision transcript, 28/28 checksum-valid): tesseract.js
(any width) produced a checksum-valid read equal to the reference for **11/28** lines, **0 disagreements** — those 11
are independently confirmed by a second engine. The other **17/28 rest on the single vision read** (plus their
printed checksums). A visual comparison of the crop by Claude found no disagreement, but it is the same model family
as the reference and was not recorded line by line, so it is **not counted**. Reference origin for the certificate:
**"vision transcript; 11/28 confirmed by a second OCR engine"** until a person reads it (HUMAN-TODO #5).

Full spike G (the gated Kiro run on this recovered input, ≤ 8 credits) runs on build Day 2 as planned.
