# Experiments

## E0 — does a model add anything over search? (0 credits)
**Protocol (also the header comment of `scripts/e0-search.mjs`):** the same run input the agent gets (OCR → code recovery →
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

## E1–E4 — what changes the outcome? (2026-11-26, 18 new runs + reused shipped rows, 68.89 credits)
**Protocol** (`kiro-plan.md` §3, harness `scripts/eval-agents.mjs --model --case <1|6> --arm <arm> --n 2`): every arm
runs eval case 1 (the June 1984 Random Number Test title path, tier-C input kept local) and case 6 (the authored
`?OUT OF DATA IN 19` page), N=2 per case. One thing changes per arm against `shipped` (Sonnet 5.5, whole-listing
context with printed checksums, steering, runner-driven loop). Every run went through the real recorder, the real
`kiro-cli` and the shipped gate; code computed each verdict. Same commit for all rows (`657ac88`, freeze #3).
Table: `node scripts/experiments-table.mjs` → `evidence/experiments/e1-e4.json` (the harness's own rows, no run re-judged).

- **E1 `haiku`**: the fixer model is Haiku 5.5.
- **E2 `stop-hook`**: the recorder never resumes a session (`--max-cycles 1`): Kiro's own Agent Stop hook is the only loop controller.
- **E3 `error-line`**: the context shows only the line the C64 stops on, not the whole listing with its checksums (`READY_CONTEXT=error-line`).
- **E4 `no-basic-steering`**: `commodore-basic-v2.md` removed from the profile AND the workspace (it is `inclusion: always`), in a scratch copy of the tree.

| Arm | Case | N | RESURRECTED | PARTIAL | target lines right | iterations p50 | credits p50 | credits total | runner cycles max | Kiro Stop-hook firings (per run) | caps hit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| shipped | 1 | 2 | 2 | 0 | 2 | 5 | 3.0022 | 9.009 | 1 | 1, 1 | none |
| shipped | 6 | 3 | 3 | 0 | 3 | 1 | 0.9033 | 2.709 | 1 | 1, 1, 1 | none |
| haiku | 1 | 2 | 1 | 1 | 1 | 11 | 0.3874 | 0.387 (+1 unmetered) | 1 | 1, 1 | iterations |
| haiku | 6 | 2 | 2 | 0 | 2 | 1 | 0.0713 | 0.146 | 1 | 1, 1 | none |
| stop-hook | 1 | 2 | 2 | 0 | 2 | 5 | 2.359 | 4.851 | 1 | 1, 1 | none |
| stop-hook | 6 | 2 | 2 | 0 | 2 | 1 | 0.868 | 1.795 | 1 | 1, 1 | none |
| error-line | 1 | 2 | 0 | 2 | 0 | 7 | 15.2062 | 31.883 | 3 | 3, 2 | credits, credits |
| error-line | 6 | 2 | 2 | 0 | 2 | 1 | 3.2765 | 13.227 | 5 | 5, 2 | credits |
| no-basic-steering | 1 | 2 | 2 | 0 | 2 | 5 | 2.5916 | 5.936 | 1 | 1, 1 | none |
| no-basic-steering | 6 | 2 | 2 | 0 | 2 | 1 | 0.8094 | 1.653 | 1 | 1, 1 | none |

**What the runs say (N=2 per cell: directions, not rates):**
- **E3 is the large effect.** With only the error line in view, case 1 ended BOOTED-PARTIAL twice at 15.21 and 16.68
  credits (both stopped by the 8-credit cap, which is checked between cycles, so a cycle overshoots it), against 2 of 2
  RESURRECTED at 3.00 and 6.01 for `shipped`. On case 6 it still reached RESURRECTED, but at 3.28 and 9.95 credits
  against about 0.9. The whole-listing context with printed checksums is what makes the loop converge and keeps it cheap.
- **E1:** Haiku 5.5 is an order of magnitude cheaper (case 6: 0.07 per run) and solved case 6 twice, but on the 1984
  page it resurrected 1 of 2 and the other run hit the 15-iteration cap (BOOTED-PARTIAL; its credits were not reported,
  so that cell's total is a lower bound).
- **E2 found no difference, and the reason is measured:** Kiro's Agent Stop hook blocked a premature stop in 13 of the
  17 runs outside E3, and 12 of those 13 then ended RESURRECTED inside the same `kiro-cli` process; the runner never had
  to resume a session (0 of 17). The runner's resume loop is a safety net these inputs never needed.
- **E4:** no measurable difference at N=2 (2 of 2 RESURRECTED on both cases, credits within the `shipped` range). We do
  not claim a steering effect.

**`/goal` (one try, qualitative, not an arm):** sent as the prompt of a headless `kiro-cli chat --v3 --no-interactive`
run on case 5, twice (with and without the listing context): each time the turn ended in about 4 s with no tool call
and no metered credits (`evidence/experiments/goal-try-knock*.jsonl`). On kiro-cli 3.6.0, `/goal` did nothing in a
headless session. It also inverts this project's rule (the agent verifies its own goal; here code decides).

**Workflow (`.kiro/workflows/resurrect-ab.workflow.yaml`):** one experiment's two arms in parallel plus an aggregator.
Ran once headless through `run_workflow` (case 6, shipped vs haiku, N=1): both arms RESURRECTED, all three steps
completed (`evidence/experiments/workflow-run-2026-11-26.md`). The E1–E4 table above was run by the harness directly,
not through the workflow.

