# Design — resurrect-loop

Requirements: `requirements.md` (75 requirements, R1–R9). Measured facts used: spike K1 (the hook's stderr reaches the
model inside a fixed preamble), K2 (in `--v3 --no-interactive`, an Agent Stop hook's block forces one extra turn per
prompt), K3 (credit usage arrives once per process, at its end). Everything else in this document that is not measured
is marked ASSUMED and has a check in task T6.

## 1. Components and who owns what

| Component | File | Owns |
|---|---|---|
| Runner | `scripts/record-run.mjs`, `runner/budget.ts`, `runner/stream.ts` | cycles, caps, `credits.json`, the record, the final judge |
| Agent | `.kiro/agents/resurrector.json` + steering + skill | proposals only |
| Session Start hook | `scripts/hooks/listing-context.mjs` | the context text |
| Pre Tool Use hook | `scripts/hooks/checksum-gate.mjs` | `refusals.json`, refusals before the server |
| Stop rule | `scripts/hooks/until-title.mjs` | `decide(RUN_DIR)`, the Stop-hook output |
| MCP server | `mcp/c64-server/` | `listing.json`, `state.json`, `events.jsonl`, the emulator |
| Gate / contract | `src/gate/*` | what a patch may do, the three states (pure, shared) |
| REPLAY | `src/replay/replay.ts` | re-judging a record |

No component reads another's memory. They share files in `RUN_DIR`, so every decision can be rebuilt from the files.

## 2. Sequence

```mermaid
sequenceDiagram
  participant R as Runner
  participant K as kiro-cli (agent)
  participant H as PreToolUse hook
  participant S as c64 MCP server
  participant C as Stop rule (--check / Stop hook)
  R->>R: validate args, fresh RUN_DIR, copy input.json (R1)
  loop cycle n (resume the same session from n=2)
    R->>K: spawn, RUN_DIR in env, exact --trust-tools
    K->>K: SessionStart hook prints listing context (R5.9)
    K->>S: c64_run
    S-->>K: screen, error, contract heading
    K->>H: apply_patch(ops)  [counted: iterations++]
    alt gate refuses
      H-->>K: exit 2, stderr = printed vs computed; refusals.json += lines
    else gate allows
      H->>S: call proceeds
      S->>S: applyPatch again, persist listing.json, retype
      S-->>K: ACCEPTED / FORCED + hash
    end
    K->>C: Stop hook (may block once, K2)
    K-->>R: process ends
    R->>R: merge events.jsonl, caps, then
    R->>C: --check
    alt stop false
      C-->>R: reason (failing lines, last error)
      R->>K: resume same session, prompt = reason
    else stop true
      C-->>R: result, cap?
    end
  end
  R->>R: final judge if a patch is unrun (R4.7), end event, ledger
```

One cycle = one process. The runner never reads the agent's text for a decision. The only thing the runner sends the
agent after the first prompt is the stop rule's reason (R2.2).

## 3. Files in `RUN_DIR`

`RUN_DIR` is `work/<listing>-<iso>` (fresh, R1.2). Every file is one writer.

| File | Writer | Readers | Content |
|---|---|---|---|
| `input.json` | runner (copy) | server, Session Start hook, hook (before first write) | `listingId, scope, spec, lines, provisional` |
| `listing.json` | server (atomic) | stop rule, hook, runner | gated lines, `iteration`, `postTitle`, `contract`, `expectedLines`, `untypeable` |
| `state.json` | server (atomic) | stop rule | last screen, parsed error, `titleSeen` |
| `events.jsonl` | server, hooks (append) | stop rule, runner (merge), REPLAY | `emu`, `proposal`, `gate`, `hook`, `malformed`, `error` |
| `refusals.json` | Pre Tool Use hook only | hook, server (read), REPLAY (via events) | `{ "<line>": count }` |
| `credits.json` | runner only | stop rule | `metered, credits, iterations, startedAt` |
| `kiro-stderr.log` | runner | humans | never copied into the record (R8.7) |

`runs/<listing>/<iso>.jsonl` is the record (R8). It holds a copy of `input` and every event, so it needs none of the above to replay.

## 4. The stop rule

```
decide(RUN_DIR):
  listing = read listing.json                      -> none:     stop, NOT-RESURRECTED, error "no-listing"   (R3.4)
  if events has error "3 malformed calls" | "emulator crashed twice"
                                                    -> stop, cap "run-over", result = listing.contract.state (R3.9)
  iterations = max(credits.iterations,
                   listing.iteration + count(events: hook checksum-gate, decision "refused"))              (R4.2)
  cap = iterations >= 15 | credits.metered && credits >= 8 | now - startedAt >= 600 s
                                                    -> stop, cap, result = listing.contract.state          (R4)
  lastRun    = index of last emu/run event
  lastChange = index of last gate event with verdict accepted|forced
  lastRun   < 0            -> continue, "run the program"                                                  (R3.5)
  lastChange > lastRun     -> continue, "your last patch has not been run"                                 (R3.5)
  contract.state == RESURRECTED                     -> stop, RESURRECTED                                    (R3.6)
  A = actionable failures (R3.7): unverified+printed, forced, untypeable lines;
      if A empty and contract.failed has clause 1 or 2: machine failure is actionable
  A empty                                           -> stop, result = contract.state                       (R3.7)
  else                                              -> continue, reason(last error, A[:12])                (R3.8)
```

Stalled (R4.5) is evaluated by the runner after the stop check, because it needs the cycle history. The Stop hook does
not know it; a hook block after a stalled cycle costs at most one bonus turn before the runner ends the run.

Examples (truth table):

| Listing / machine | Contract | Stop? | Why |
|---|---|---|---|
| all ✓, title, post-title pass, nothing forced, bytes equal | RESURRECTED | yes | R3.6 |
| title seen, line 140 ✗ | BOOTED-PARTIAL | no | line 140 actionable; the title alone is not success |
| title seen, 140 FORCED | BOOTED-PARTIAL | no, until cap | forced is actionable (a verified fix could still replace it) |
| lines 150, 160 lost by OCR, all present lines ✓, title seen | BOOTED-PARTIAL | yes | only missing lines remain; recovery only |
| all ✓, `?SYNTAX ERROR IN 90` | NOT-RESURRECTED | no | clause 1 machine failure, checksum collision possible |
| 15th attempt accepted, never run | placeholder | yes, cap | runner judges the final listing (R4.7) |
| server run-over | last | yes, cap `run-over` | R3.9 |

## 5. Caps and the final judgement

| Cap | Counted by | Checked | Kill |
|---|---|---|---|
| `iterations` 15 | runner, from `apply_patch` tool calls as issued (hook-refused included) | live and between cycles | after the 15th call's result is recorded |
| `credits` 8 | runner, usage events | between cycles only (K3) | none; overshoot recorded |
| `wall` 600 s | runner clock from start | live timer per cycle | SIGTERM, SIGKILL after 5 s |
| `stalled` | runner: 2 cycles in a row without progress | between cycles | none (process already ended) |
| `run-over` | `events.jsonl` | stop rule | none |

Final judge (R4.7), only when a cap ended the run and the last accepted or forced `gate` event is newer than the last
`emu run`: `bootNodeCore()` → `runListing(core, listing.lines, input.spec)` → `judge(...)`. The result goes into `end`;
`listing.json` is untouched. This is the same computation REPLAY does, so a capped run and its replay agree.

## 6. Refusal accounting and `force_unverified`

1. The hook runs `applyPatch(listing, ops, expectedLines, {force_unverified, refusalCounts})`.
2. On `refused`: `refusals[line] += 1` for every line in `refusedLines(verdict, ops)`; stderr = reason; exit 2.
3. A forced patch is judged at the gate: `count ≥ 2` for the line, `force_unverified` true, checksum mismatch.
4. Server and REPLAY read the same counts (server: afresh from `refusals.json`; REPLAY: from the `refusals` field of
   the recorded hook events and the `gate` events' `refusalCounts`).

Known imprecision (A9): a non-checksum refusal charges every op's line. Accepted and documented; the steering tells the
agent to split a batch after an edit-size or inventory refusal.

## 7. Terminal states

`result` ∈ {`RESURRECTED`, `BOOTED-PARTIAL`, `NOT-RESURRECTED`}, from `contract.evaluate()`:

- no title: `NOT-RESURRECTED`;
- title and every clause 2–6 holds: `RESURRECTED`;
- title and any of clauses 2–6 failing (post-title press fails, line missing or duplicated, a line not checksum-consistent or provisional, a forced line, bytes differ): `BOOTED-PARTIAL`.

The `end` event carries the verdict plus how it was judged (`finalJudge`), why the run ended (`cap`, `error`), and what
the agent touched (`readAudit`).

## 8. Correctness properties

Each property is a test (unit, property, or an integration test with a stub `kiro-cli` through `KIRO_BIN`).

| # | Property | Requirements | Kind |
|---|---|---|---|
| P1 | For any recorded `finished.finalText` and any tool-result text, the `end` event's `result` is unchanged (it is a function of the contract only). | R7.2, R7.7, R2.6 | property over stub streams |
| P2 | `decide` returns the same `{stop, result, cap}` through the Stop-hook and `--check` entry points for the same `RUN_DIR` and clock. | R3.1 | property over generated RUN_DIR states |
| P3 | `decide` is total and its `result` is always one of the three states; it never reads a path outside `RUN_DIR`. | R3.2, R3.4, R7.5 | property, plus path audit |
| P4 | For any sequence of N fix attempts of which k are hook-refused, the stop rule's iteration count equals N, independent of how many lines each refusal charged. | R4.2, R6.10 | property |
| P5 | The runner issues at most (15 + 1 in-flight) apply_patch calls and every record has its 15th result; the loop ends in ≤ 15 + cycles-without-patch bound cycles. | R4.5, R4.6 | stub integration |
| P6 | The title alone never yields a stop while an actionable line exists, and never yields `RESURRECTED`. | R3.6, R7.3 | property over contracts |
| P7 | A capped run with an unrun accepted patch ends with the contract of `runListing(finalListing)`, equal to what REPLAY recomputes. | R4.7, R8.5 | integration with a real core |
| P8 | For any listing, patch and counts, hook verdict = server verdict = REPLAY verdict. | R6.1, R6.4, R6.9 | property (fast-check) over `applyPatch` entry points |
| P9 | `refusals.json` is monotone, written only by the hook, and `force_unverified` is accepted only when the line's count ≥ 2 and the line mismatches; a damaged file means `{}`. | R6.3, R6.5, R6.8 | property |
| P10 | Every accepted patch preserves line count; no op can create or delete a line; a `replace` changes ≤ 40% of a line. | R5.7 (via checksum-oracle R4) | property reused |
| P11 | Trust list ⊆ the seven tools and never contains `*`/trust-all; the profile has no CLI 2.x field and exactly the three hooks. | R1.6, R5.1–R5.5 | profile unit test |
| P12 | REPLAY of a recorded `RESURRECTED` run gives `RESURRECTED`, zero mismatches. | R8.4, R8.5, R8.8 | replay test on a recorded fixture |
| P13 | A run's `readAudit` is empty for the demonstration runs; a read of a denied directory makes it non-empty. | R5.3, R5.8 | stub stream test |
| P14 | A refused start leaves no `RUN_DIR`, record or ledger entry. | R1.1, R1.2 | unit test |

## 9. Failure handling

| Failure | Detected by | Effect | Req |
|---|---|---|---|
| bad args, stale `RUN_DIR`, trust-all | runner preflight | exit non-zero, nothing created | R1.1, R1.2, R1.6 |
| `c64` server cannot start | stderr line, no tool calls in cycle | ends by `stalled` after 2 cycles | R9.5, R4.5 |
| `@c64` tool not trusted | `permissionDenied` in a tool result | end `error: tool-not-trusted` | R9.1 |
| `kiro-cli` exits ≠ 0 | `cycle.exit` | evaluated like any cycle | R9.2 |
| no session id | stream scan | end with `error` | R2.3 |
| stop check output invalid | JSON parse | end `error: stop-check` (fail closed) | R9.3 |
| Stop hook crashes | exit code | allowed in CLI; runner decides | R9.4 |
| Pre Tool Use hook crashes | exit ≠ 0/2 | server's gate judges; counts unchanged | R6.8 |
| `refusals.json` damaged | parse | treated `{}`, force locked | R6.8 |
| parallel `apply_patch` | stale listing at hook | server verdict wins; not counted | R6.9 |
| server run-over | `error` event | stop with `run-over` | R3.9 |
| emulator crash | server R12 | restart once; twice = run-over | R9.6 |
| wall cap mid-tool | timer | kill; atomic files stay valid | R4.4, R9.7 |
| credits unmetered | no usage | cap not enforceable; `metered:false` | R4.3 |
| credit overshoot | between-cycle check | recorded, run ends | R4.3 |
| cap with unrun patch | events order | runner final judge | R4.7 |
| agent reads a reference | tool-call audit | run `tainted` | R5.8 |

## 10. ASSUMED (to measure in T6)

1. `${RUN_DIR}` in `mcp.json` `env` expands from the runner's environment, and the hooks inherit `RUN_DIR`.
2. The built-in read tool's name in `--trust-tools` and the stream (the runner's default says `read_file`).
3. `SessionStart` fires again on `--resume-id`. If not, the resume prompt (R3.8) carries what the agent needs.
4. A `deny` rule on `fs_read` paths wins over the plain `allow`, with these glob forms relative to the workspace.
5. The `@c64/apply_patch` matcher matches the MCP tool's id in V3 hooks.

## 11. Test strategy

Unit tests for `decide` over hand-built `RUN_DIR`s (the truth table in §4). fast-check for P2, P4, P6, P8, P9 over generated
listings, patches and event logs. A stub `kiro-cli` (`KIRO_BIN`) that emits scripted stream-json and calls the real hook
and a real core for P1, P5, P7, P13. One real recorded run (T6) replayed for P12. Nothing is mocked on the demo path.
