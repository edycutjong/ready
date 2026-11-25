# Declarative workflow `resurrect-ab` — one real headless run (kiro-cli 3.6.0, V3, 2026-11-26)

Recipe: `.kiro/workflows/resurrect-ab.workflow.yaml` (a `parallel` node with two `wf-coder` steps, each running
`node scripts/eval-agents.mjs --model --case <case> --arm <arm> --n <n>`, then a `wf-planner` aggregate step).

1. **Validation.** Asked headless to run `validate_workflow`: kiro-cli 3.6.0 offers no such tool in a `--no-interactive`
   session (it lists `run_workflow`, `inspect_workflow`, `update_workflow`). It did list the recipe in the `run_workflow`
   catalogue with inputs `case`, `armA`, `armB`, `n`, so the file was discovered and parsed. (0.267 credits)
2. **Run.** Launched with `case=6, armA=shipped, armB=haiku, n=1` through `run_workflow`, followed with
   `inspect_workflow`. Run id `wf_b8f32d75b82c5e02`: `armA`, `armB` and `aggregate` all completed; no step paused for
   approval or input. Both arms started in the same second (run files `eval-case6-1-1795630318286.jsonl` and
   `eval-case6-haiku-1-1795630318799.jsonl` in `evidence/evals/runs/`), so they ran in parallel.

| Arm | Result (the harness's own row) | Lines the gate accepted | Credits (recorder-metered) | Wall |
|---|---|---|---|---|
| shipped (Sonnet 5.5) | RESURRECTED | 890 | 0.8873 | 24.0 s |
| haiku (Haiku 5.5) | RESURRECTED | 890 | 0.0899 | 29.5 s |

Parent session: 1.0135 credits. The step agents' own session credits are not reported in the parent's stream:
**UNMEASURED**. The aggregate step's table did not reach the parent's captured output (it reported only "Both arms
returned RESURRECTED"); the rows above come from `evidence/evals/evals-2026-11-25.jsonl`. N=1 per arm: this run
shows the workflow mechanism works, not a rate. The measured E1–E4 table (N=2) is in `docs/EXPERIMENTS.md`.
