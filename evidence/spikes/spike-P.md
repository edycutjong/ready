# Spike P — /api/page on Vercel, measured from the deployed URL (2026-11-25)

Verdict: **PASS (proxy + CDN cache + in-tab OCR)**.

Target: `https://ready.edycu.dev/api/page?id=1984-06-computegazette&n=177[&w=…]` → archive.org `/download/<id>/page/n177[_w…].jpg`.
Measured with a hand-run `curl` loop from the builder's machine (Indonesia) against the production alias on 2026-11-24 (UTC; 2026-11-25 local); the raw curl output was not archived, so the timings below are single hand-run measurements (a re-probe on 2026-11-25 by the evidence reviewer found HITs of ~0.14 s, but also MISSes after the 24 h `s-maxage` window: `w=1600` took 6.27 s and the full page 4.33 s, with upstream 4.6 s and 2.7 s, so upstream time varies run to run and the MISS column below is a lower-end single sample); function = `api/page.js`, Node runtime,
Vercel Hobby limits (default function duration; response ≤ 4.5 MB). No disk is used; the CDN caches via `Cache-Control: s-maxage=86400`.

| width param | bytes | status | first request (MISS) | next 2 requests (HIT) | upstream ms (archive.org, from the function) |
|---|---|---|---|---|---|
| `w=800` | 390,309 | 200 image/jpeg | 3.71 s (first ever call, function cold start included) | 0.38 s, 0.15 s | 2259 |
| `w=1600` | 1,162,505 | 200 image/jpeg | 3.04 s | 0.14 s, 0.12 s | 1382 |
| omitted (full page) | 1,162,505 (2376 × 3204 px, `file`) | 200 image/jpeg | 2.73 s | 0.14 s, 0.14 s | 1087 |

- `w=1600` and the full page are the same bytes (1,162,505, `file`: 2376 × 3204): archive.org serves the full-resolution page for any `_w` ≥ 1600.
- Not allow-listed item → 400 in 0.38 s; width outside {800, 1600} → 400; page out of range → 400 (`tests/api-page.test.ts`, 5 tests).
- Function duration is bounded by the 8 s upstream timeout inside the function; the slowest measured upstream fetch was 2.26 s, below the function's own 8 s upstream timeout (`api/page.js`); the re-probe's slowest upstream fetch, 4.6 s, is also under it. Vercel's docs (checked 2026-11-25 by the evidence reviewer) list a 300 s default and maximum duration for Hobby with fluid compute, so duration is not the binding limit; the 4.5 MB response limit is the one the function guards.
- Gazette pixels are archive.org's own public page images, fetched on demand and never stored in the repo (tier C: the OCR text exists only in the judge's tab).
- Finding (observed during `vercel build` on 2026-11-24; the error text is not archived): `vercel build` fails with "Cannot read properties of undefined (reading 'readFile')" when the function is TypeScript, because `@vercel/node` reads sources through `ts.sys`, which TypeScript 7.0.2 no longer exposes. The function is therefore plain JS with a hand-written `api/page.d.ts`.
- Previews are behind Vercel SSO (they answered 302 to curl; not archived), so the measurement used the production alias.

## ScanQuality stops
Source width stops are 800 / 1600 / 2376 px (never labelled "dpi"). Their OCR yield is the P1a spike O result on the same page: tesseract.js 7.0.0 → 4/28, 8/27, 6/24 checksum-valid lines (`spike-O.md`).

## OCR in the tab (live, 2026-11-25) — `scripts/live-ocr.mjs` → `spike-P-ocr-live.json`
Chromium (Playwright, builder machine, run 2026-11-24 20:06 UTC), `https://ready.edycu.dev/scan`: Read the real 1984 page (`n177`, two columns, each column read on its own) through `/api/page`, then self-hosted tesseract.js 7.0.0 (worker, WASM core, traineddata all from `/ocr/`; **0 third-party origins requested**).
| ScanQuality stop | lines found | checksum-matching (✓) | OCR time in the tab |
|---|---|---|---|
| 800 px wide | 55 | 2 | 4.9 s |
| 1600 px wide | 83 | 16 | 5.5 s |
| 2376 px wide (full) | 82 | 11 | 6.9 s |
One run per stop (N=1); the numbers describe this page on this machine, not a general rate. Finding on the way: reading the two-column page as one block interleaves the columns (0–1 ✓); reading each column on its own is what makes the checksum useful.
