# Tasks — resurrect-loop

Each task lists the requirements it closes and how it is checked. Part B files already exist (T1).

- [x] **T1. Agent surface.** `.kiro/agents/resurrector.json`, `.kiro/steering/resurrector.md`,
  `.kiro/skills/petscii-notation/SKILL.md`, `.kiro/settings/mcp.json` (server `c64`, `RUN_DIR` from the environment).
  Add `tests/unit/resurrector-profile.test.ts`: no CLI 2.x field, tools `["@c64","read"]`, the permission rules, exactly
  three PascalCase hooks with their matcher, four resources that exist, `inclusion: manual`, prompt ≤ 6 sentences, every
  trust-list entry ⊆ the seven tools. Covers R1.6, R5.1–R5.6, R5.9, P11.
  Status: files written except `mcp.json` (the workspace denied the write; create it with the content in the final report); the test is not written.

- [ ] **T2. One stop rule.** Rewrite `decide` in `scripts/hooks/until-title.mjs` to the order and rules of R3.3–R3.9: iteration
  count from `credits.json` and refused hook events (not the sum of `refusals.json`), run-over, actionable-failure
  definition including the machine failure with every checksum consistent, `result` always one of the three states,
  Stop-hook and `--check` share one function. Tests: the truth table of design §4 as unit tests; fast-check P2, P3, P4, P6.
  Covers R3.1–R3.10, R4.2, R6.10.

- [ ] **T3. The runner loop.** In `scripts/record-run.mjs` and `runner/budget.ts`: preflight (R1.1, R1.2, R1.6), `stalled` cap
  from the progress definition (R4.5), `permissionDenied` on an `@c64` tool ends the run (R9.1), `afterCap` marking (R4.6),
  the final judge through `bootNodeCore` + `runListing` + `judge` when a patch is unrun at the cap (R4.7), `end` event fields
  and `result` never `"error"` (R7.1–R7.6), `readAudit` and `tainted` (R5.8), no stderr log content in the record (R8.7).
  Tests with a stub `KIRO_BIN` (scripted stream, real hooks, real core): P1, P5, P7, P13, P14.

- [ ] **T4. Hook, server and REPLAY agree.** Property tests that the Pre Tool Use hook, the server's `apply_patch` and
  `replay()` return the same verdict for the same listing, ops and counts (P8), that `refusals.json` is monotone and only
  the hook writes it, that `force_unverified` unlocks only at a count of 2 on a mismatch and a damaged file means `{}`
  (P9), that the hook is inert for other tools, and that one refused call has exactly one replay-relevant record (R8.3).
  Covers R6.1–R6.10, R8.2, R8.3. No `src/` change expected; if P8 or P9 fail, the fix goes in the owning spec.

- [ ] **T5. REPLAY fidelity and drift.** Replay a recorded fixture run in file order, recompute every verdict and the final
  contract, list mismatches, and report each changed line's edit ratio against `start.input` with the 0.4 flag (R8.4–R8.6, R8.8).
  Add the `unreproducible` label rule. Covers P12 and the drift report of A1.

- [ ] **T6. One real recorded run and the measurements.** Run `scripts/record-run.mjs` once with the real `resurrector` on a
  listing, within the caps (≤ 8 credits). Record in `evidence/`: `${RUN_DIR}` expansion, the built-in read tool's trust name,
  whether `SessionStart` fires on `--resume-id`, deny-over-allow for `fs_read`, the `@c64/apply_patch` matcher (design §10), and
  the run's `end` event. Replay it (T5). Any assumption that fails becomes a change to the owning requirement, not a silent workaround.
  Covers R1.5, R2.2–R2.4, R5.8, R8.8 and design §10.
