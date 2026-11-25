# Spike K2 — Agent Stop hook headless (PARTIAL: one forced turn per prompt)

**Same session as K1.** `hook-stop.mjs` returns `{"decision":"block","reason":"Not finished … call @c64/apply_patch …
lineno 30 …"}` on the first stop.

| Run | Stop hook firings (`stop-count`) | forced turn? | evidence |
|---|---|---|---|
| K1/K2 (sonnet-5.5), block on stop 1 | **1** | **yes** — a second turn called `apply_patch` line 30 (server log, `reason: "stop-hook turn"`) | `k1-k2-server-calls.jsonl`, `k1-k2-hook-events.jsonl` |
| K2b (haiku-5.5), hook asked to block stops 1–3 | **1** | yes, once — after the forced turn the hook was **not called again** and the run ended | `k2b-stop-count` = 1, `k2b-server-calls.jsonl` (2 calls), credits 0.0566 |

**Verdict: PARTIAL.** In `kiro-cli chat --v3 --no-interactive` (3.5.0) a Stop hook's block forces exactly one more
turn per prompt; it does not re-fire at the end of that turn. A Stop hook alone cannot hold a 15-iteration loop open.
**Pre-decided fallback (agent contract §3), applied in its lighter form:** the Stop hook stays in the profile (it does fire,
and it forces the first continue), and `scripts/record-run.mjs` runs cycles: when a kiro-cli process ends, it runs the
same stop predicate and, if stopping is not allowed and no cap is hit, resumes **the same session** (`--resume-id`)
with the predicate's reason. Proven on the probe: 2 cycles, same session id, refusal + forced turn + resumed turn,
0.1313 credits (`record-run-probe.jsonl`). The write-up names the headless Stop hook as "fires once per prompt".
