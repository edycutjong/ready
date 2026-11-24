# Experiments

## E0 — does a model add anything over search? (0 credits)
**Protocol (written before the run, kiro-plan.md §3):** the same run input the agent gets (OCR → code recovery →
`input.json`). For every line failing its printed checksum, enumerate edits drawn from the OCR confusions measured on
1984 scans (slashed zero ↔ 0/8/9/@/G/O, `$`↔`S`, `1`↔`l`/`I`, bracket/brace swaps, quotes read as `™`/curly quotes,
plus `M`↔`N`, `5`↔`S`, `B`↔`8`, `Z`↔`2`, `:`↔`;`, `,`↔`.`): one or two substitutions, or one deletion / one inserted
quote, and every absent inventory number as a line-number reading. Keep candidates whose Gazette checksum equals the
printed one and that pass the gate's 40% cap. One candidate → applied through the gate. Several → the real C64 runs
each and a strictly better run wins; still tied → the line is left unfixed (never the first collision). A comparison
arm only: no search pre-pass ships. Script: `scripts/e0-search.mjs`.

**Result (2026-11-25, `evidence/experiments/e0.json`):**
| Input | Failing lines | Fixed by search | Ambiguous | End state |
|---|---|---|---|---|
| authored 2026 line-20 page (real OCR) | 1 | 1 (emulator broke the tie) | 0 | RESURRECTED |
| June 1984 Gazette title path (28 lines, same input as spike G) | 18 | 3 | 15 | NOT RESURRECTED, 13/28 checksum-consistent, no title |

Same input, the `resurrector` agent (spike G, `evidence/spikes/spike-G.json`): 18/18 failing lines made checksum-
consistent, TITLE-PATH RESURRECTED in both attempts (N = 2), 19/28 source-exact against the reference transcript.
On an easy page, search is enough; on the real 1984 page it is not.
