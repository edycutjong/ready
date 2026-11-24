# Requirements — resurrect-loop

## Purpose

The resurrect loop is the part of SYNTAX ERROR IN 20 that turns a scanned 1984 listing into a program that boots on
a real Commodore 64. A runner (`scripts/record-run.mjs`) starts a Kiro agent (`resurrector`) that proposes
fixes; a Pre Tool Use hook and the `c64` MCP server run the same deterministic gate on every proposal; the real
emulator runs the result; and one stop rule decides when the run ends. The model chooses where to look. Code
decides what is true and when to stop. Nothing in this loop is mocked, and nothing the model says is evidence.

This spec covers the loop itself: launch, cycles, stop rule, caps, the agent's configuration, the hook's refusal
accounting, terminal states, the recorded run and REPLAY. It does not re-specify the parts that exist:
the oracle, gate and contract (`.kiro/specs/checksum-oracle`) and the six tools (`.kiro/specs/c64-mcp-server`).
Where this spec depends on them it cites their ids.

Shared vocabulary (the terms `CanonicalLine`, `LineStatus`, `expectedLines`, `Group`, `RUN_DIR`, `Provisional set`,
`Run over` are those of the two specs above):

- **Run**: one recorded attempt on one listing, from the runner's `start` event to its `end` event. Its state lives
  in `RUN_DIR` and its record in `runs/<listing>/<iso>.jsonl`.
- **Cycle**: one `kiro-cli` process, the first or a `--resume-id` resumption of the same session.
- **Turn end**: the agent finishing a response. A turn end is not a stop: a **stop** is the stop rule allowing the
  run to end.
- **Fix attempt**: one `apply_patch` tool call the agent issues, counted from the tool-call stream as soon as it is
  issued, whatever its outcome (refused by the hook, refused by the server, accepted, forced, malformed).
- **Stop rule**: the single predicate `decide(RUN_DIR)` in `scripts/hooks/until-title.mjs`, reachable as the Agent
  Stop hook and as the runner's `--check`. Its answer is `{ stop, reason, result, cap? }`.
- **Actionable failure**: a failing fact the agent can act on with `apply_patch`: an expected line present with
  status `unverified` and a parsed `printed` value, a line with status `forced`, a line reported `untypeable`, or,
  when every line is checksum-consistent, a machine failure (no title, no post-title pass) that a
  checksum-consistent change could still fix. Missing lines and lines whose printed checksum is unparseable are
  not actionable (R3.7).
- **Cap**: one of `iterations` (15 fix attempts), `credits` (8), `wall` (600 s), `stalled` (R4.5), or `run-over`
  (the server's terminal state, R3.9).
- **Terminal state**: exactly one of `RESURRECTED`, `BOOTED-PARTIAL` (displayed `BOOTED — PARTIAL`),
  `NOT-RESURRECTED` (displayed `NOT RESURRECTED`), the `ContractResult.verdict` of `src/gate/contract.ts`.
- **Progress** (of a cycle): since the previous cycle ended, `events.jsonl` gained at least one `emu run` event, one
  `gate` event with verdict `accepted` or `forced`, or one `hook` event of `checksum-gate` with decision `refused`.

---

## R1 — Launch: what the runner refuses to start without

**User story**: as the builder paying credits for each run, I need a run that cannot start misconfigured, and a
start that cannot be silently contaminated by an earlier run.

R1.1 WHEN the runner starts, THE SYSTEM SHALL validate, before spawning any process and before spending any credit,
that `--listing`, `--prompt-file`, `--input` and `--stop-check` are given, that the prompt file exists, and that
`--input` parses as the `input.json` schema of c64-mcp-server R2.1. IF any check fails, THEN THE SYSTEM SHALL exit
non-zero with the reason on stderr and SHALL NOT create `RUN_DIR`, a record file, or a ledger entry.

R1.2 THE SYSTEM SHALL refuse to start (same exit as R1.1) IF `RUN_DIR` already contains any of `input.json`,
`listing.json`, `state.json`, `events.jsonl`, `refusals.json` or `credits.json`. A reused directory would make the
`c64` server resume from a stale `listing.json` (c64-mcp-server R2.3) and the stop rule judge an old run.

R1.3 THE SYSTEM SHALL copy `--input` to `$RUN_DIR/input.json` and store the same parsed object whole in the `start`
event (`start.input`), so REPLAY never needs the original OCR.

R1.4 THE SYSTEM SHALL build `input.json`'s `lines` only from OCR output plus lost-line recovery done by code
(`source: "recovered"`, `provisional: true`) or by a person (`source: "typed"`, labelled as such). It SHALL NOT
contain a line written by a model, a reference transcript, or an answer key, and `spec.expectedLines` SHALL come
from the page inventory read before the run.

R1.5 THE SYSTEM SHALL start every cycle as `kiro-cli chat --v3 --no-interactive --trust-workspace --model <model>
--trust-tools=<list> --output-format stream-json --agent resurrector [--resume-id <session>] <prompt>`, with the
working directory set to the workspace and the environment of the runner plus `RUN_DIR=<absolute path>`. The
default `<model>` is `claude-sonnet-5.5`.

R1.6 THE SYSTEM SHALL pass an exact `--trust-tools` list: by default `@c64/c64_reload`, `@c64/c64_run`,
`@c64/c64_read_screen`, `@c64/c64_press`, `@c64/checksum_line`, `@c64/apply_patch` and the built-in read tool.
Every entry of an overriding list SHALL be one of those seven. IF the list contains `*`, a bare `@c64`, or any text
matching `trust-all`, THEN the runner SHALL exit as in R1.1. THE SYSTEM SHALL NEVER pass `--trust-all-tools`.

R1.7 THE SYSTEM SHALL write `credits.json` (`{metered, credits, iterations, startedAt}`) at start and after every
change of its fields. The runner is its only writer.

R1.8 THE SYSTEM SHALL emit, as the first record line, `{k:"start", model, mode:"live", listing, runDir, runner:
{kiroCli, agent, trustTools, caps}, input}` with `caps` equal to the values in R4.1.

R1.9 THE SYSTEM SHALL build the first prompt only from the prompt file, which names the listing id and tells the
agent to run the program first. THE SYSTEM SHALL NOT put listing text, a reference transcript, or an expected
verdict into any prompt it sends.

## R2 — The cycle loop

**User story**: as the product, I need the run to continue until the stop rule allows a stop, although headless
V3 lets an Agent Stop hook block only once per prompt.

R2.1 WHEN a cycle's process ends, THE SYSTEM SHALL, in this order: emit the `cycle` event (`n`, `exit`, `killed`,
`sessionId`); append the new lines of `$RUN_DIR/events.jsonl` to the record (R8.2); evaluate the caps (R4); and, if
no cap ended the run, run the stop check from the same files.

R2.2 IF the stop check says `stop: false`, THEN THE SYSTEM SHALL start the next cycle with `--resume-id` set to the
session id of the first cycle and the prompt set to the stop check's `reason` verbatim (at most 2000 characters).
THE SYSTEM SHALL NOT include the agent's own text, a diff, or any file content other than that `reason` in the
prompt.

R2.3 THE SYSTEM SHALL resume the SAME session in every later cycle. IF no session id was seen in the stream after the
first cycle, THEN THE SYSTEM SHALL emit `{k:"error", why:"no session id in stream; cannot resume"}` and end the run
(R7.5, `cap: null`).

R2.4 THE SYSTEM SHALL NOT depend on the Agent Stop hook's block to continue the run. A block inside a cycle is
treated as one bonus turn (measured, spike K2: one forced extra turn per prompt in headless V3). Continuation
always comes from the runner's stop check after the process ends.

R2.5 WHEN the stop check says `stop: true`, THE SYSTEM SHALL emit one `hook` event `{hook:"until-title", via:
"runner-cycle", decision:"allow"}` and end the run. WHEN it says `stop: false`, THE SYSTEM SHALL emit the same event
with `decision:"block"` and `stderr` set to the reason.

R2.6 THE SYSTEM SHALL count a turn end that ends a cycle with no further process activity as nothing: it SHALL NOT
treat an agent's "I'm done" as a stop, an agent's silence as progress, or an agent's text as input to any decision.

## R3 — The stop rule: one predicate

**User story**: as a judge reading a certificate, I need the point at which the run ended to be decided by code that
reads files, the same code wherever it runs, never by the model.

R3.1 THE SYSTEM SHALL implement the stop rule once, as `decide(RUN_DIR)`, and expose it through exactly two entry
points: the Agent Stop hook (stdin = hook event; stdout `{"decision":"block","reason":…}` to continue, nothing to
allow) and `--check` (stdout `{stop, reason, result, cap?}`). For the same `RUN_DIR` content and the same clock the
two entry points SHALL give the same decision, and both SHALL exit 0.

R3.2 THE SYSTEM SHALL compute `decide` only from `RUN_DIR` files (`listing.json`, `state.json`, `credits.json`,
`refusals.json`, `events.jsonl`), the cap constants of `runner/budget.ts`, and the clock. It SHALL NOT read the
agent's text, call an MCP tool, or open the emulator.

R3.3 THE SYSTEM SHALL evaluate `decide` in this fixed order and return at the first match:
(1) no readable `listing.json`; (2) the server's run-over state (R3.9); (3) a cap (R4); (4) no `emu run` event yet;
(5) a gated change newer than the last `emu run`; (6) `listing.json.contract.state` is `RESURRECTED`;
(7) no actionable failure remains; (8) otherwise continue.

R3.4 IF `listing.json` is absent or unreadable, THEN THE SYSTEM SHALL return `stop: true, result:
"NOT-RESURRECTED"` with a reason that says the `c64` server never wrote it, and the runner SHALL record `end.error:
"no-listing"`. `result` SHALL be one of the three terminal states in every answer.

R3.5 IF no `emu run` event exists, THEN THE SYSTEM SHALL return `stop: false` with a reason telling the agent the program
has not been run and to call `c64_run`. IF the last `gate` event with verdict `accepted` or `forced` comes after the
last `emu run` event, THEN it SHALL return `stop: false` with a reason telling the agent its last accepted patch has
not been run. (A patch resets `contract` to a listing-only placeholder, c64-mcp-server R3.5, so an unrun listing has
no measured verdict.)

R3.6 WHEN `listing.json.contract.state` is `RESURRECTED` and R3.5 does not apply, THE SYSTEM SHALL return `stop: true,
result: "RESURRECTED"`. The title alone SHALL NEVER stop the run while an actionable failure remains: its reason
SHALL say the title alone is BOOTED — PARTIAL and list the failing lines.

R3.7 THE SYSTEM SHALL find the actionable failures in the final listing as follows, and SHALL return `stop: true` with
the contract's own state only when there are none:
(a) every expected line with status `unverified` and a non-null `printed`, status `forced`, or listed in
`untypeable`, is actionable;
(b) a line whose printed checksum is unparseable (`printed` null), an expected line that is absent (lost by OCR,
recovery-only), and a `provisional` line are NOT actionable;
(c) IF no line is actionable under (a) and the contract's failed clauses include clause 1 or clause 2 (no title or no
post-title pass), THEN the machine failure is actionable: every printed checksum is consistent, so a swap of
characters that keeps the sum is possible, and the stop rule SHALL continue (R4 bounds it);
(d) a failed clause 6 (resident bytes differ from the gated listing) with no untypeable line is not actionable.

R3.8 THE SYSTEM SHALL build every `continue` reason from files: the last screen error as the C64 printed it
(`state.json`), the failing lines with their printed checksum (at most 12, then a count), and, per R3.5 or R3.6,
the instruction the agent needs. THE SYSTEM SHALL NOT put a program line's body, a candidate fix, or any claim about
what the correct text is into a reason.

R3.9 IF `events.jsonl` contains `{k:"error", why:"3 malformed calls"}` or `{k:"error", why:"emulator crashed
twice"}`, THEN THE SYSTEM SHALL return `stop: true, cap: "run-over"` with the contract's state as last computed. The
server answers every later call with a tool error (c64-mcp-server R11.5), so a continuation could only spend credits.

R3.10 THE SYSTEM SHALL append one `hook` event per Agent Stop firing (`hook:"until-title"`, `via:"kiro-stop"`,
`decision:"allow"|"block"`, `reason`, `result`) to `events.jsonl`, and SHALL NOT write any other file.

## R4 — Caps and the final judgement

**User story**: as the builder with a daily credit allowance, I need three hard limits that always end the run, and
a verdict that still describes what the C64 would do with the last listing.

R4.1 THE SYSTEM SHALL define the caps once, in `runner/budget.ts`: 15 fix attempts, 8 credits, 600 000 ms wall. The
runner, the stop rule and the `start` event SHALL read the same constants.

R4.2 THE SYSTEM SHALL count `iterations` as fix attempts per the vocabulary: the runner counts each `apply_patch`
tool call from the stream when it is issued, and writes the count to `credits.json`. WHEN the stop rule needs the
count and `credits.json` is missing or lower, it SHALL use `listing.json.iteration` plus the number of `hook` events
of `checksum-gate` with `decision:"refused"` in `events.jsonl`. It SHALL NOT use the sum of `refusals.json`, which
counts refused LINES, not refused calls (a refused 4-line patch adds up to 4).

R4.3 THE SYSTEM SHALL enforce `credits` only when the stream reported usage (`metered: true`). Usage arrives once
per process (measured, spike K3), so the cap is checked between cycles, and a cycle MAY exceed it by its own spend;
the overshoot SHALL be recorded in the `credits` event. IF no usage was ever reported, THEN the `credits` event SHALL say
`metered: false` and `total: null`, and the run ends only by the other caps.

R4.4 THE SYSTEM SHALL measure `wall` from the runner's start to now, across all cycles. IF a cycle is still running when
the remaining wall time ends, THEN THE SYSTEM SHALL send it `SIGTERM`, then `SIGKILL` after 5 s, and record `cap:
"wall"`. The run's elapsed time SHALL be at most 600 s + 6 s + the time of R4.7.

R4.5 WHEN two consecutive cycles end without progress, THE SYSTEM SHALL end the run with `cap: "stalled"`. A resumed
agent that only talks, or an agent that never received its `c64` tools, would otherwise spend credits until the wall
cap.

R4.6 WHEN a cycle's `apply_patch` count reaches 15, THE SYSTEM SHALL let that call's result arrive and be recorded
before it ends the process, so the 15th attempt's verdict is in the record. THE SYSTEM SHALL NOT allow a 16th
attempt in the record: a 16th call issued before the process ends SHALL NOT be counted as an attempt and SHALL appear as a
`kiro` tool_call event with `afterCap: true`.

R4.7 WHEN a cap ends the run and the last accepted or forced patch is newer than the last `emu run` event, THE SYSTEM
SHALL judge the final listing itself: boot one C64 core (`bootNodeCore`), run `runListing` on the `lines` of
`listing.json` with `spec` from `input.json`, and compute `judge(...)`. The `end` event SHALL carry this contract
and `finalJudge: "runner"`. THE SYSTEM SHALL NOT rewrite `listing.json`. WHEN the last run is newer than the last
change, the `end` event SHALL carry `listing.json`'s contract and `finalJudge: "server"`.

R4.8 IF a cap and a contract state `RESURRECTED` hold at the same moment, THEN THE SYSTEM SHALL record both: `result:
"RESURRECTED"` and `cap` set. A cap SHALL NOT downgrade a measured verdict.

## R5 — The `resurrector` agent

**User story**: as the person who must trust the result, I need an agent that can look and propose and nothing else.

R5.1 THE SYSTEM SHALL keep the agent in `.kiro/agents/resurrector.json` as a CLI V3 profile with the fields `name`,
`description`, `model: "claude-sonnet-5.5"`, `prompt`, `tools`, `includeMcpJson`, `resources`, `permissions` and
`hooks`, and without the CLI 2.x fields `allowedTools`, `toolsSettings`, `toolAliases` or camelCase hook triggers.

R5.2 THE SYSTEM SHALL give the agent `tools: ["@c64", "read"]` and nothing else: no shell, no write, no web, no
sub-agent, no knowledge tool. `includeMcpJson: true` SHALL load only the workspace `c64` server for it.

R5.3 THE SYSTEM SHALL declare in `permissions.rules`, as `{capability, match?, effect}`: allow `mcp` for `c64/*`;
allow `fs_read`; deny `fs_read` on the directories that can hold a reference listing (`work/**`, `runs/**`,
`evidence/**`, `bench/**`, `docs/**`, `tests/**`); deny `shell`; deny `fs_write`; deny `web`. A matching deny SHALL
win over an allow.

R5.4 THE SYSTEM SHALL declare exactly three inline hooks with PascalCase triggers and `action.type: "command"`:
`SessionStart` → `node scripts/hooks/listing-context.mjs`; `PreToolUse` with matcher `@c64/apply_patch` → `node
scripts/hooks/checksum-gate.mjs`; `Stop` → `node scripts/hooks/until-title.mjs`.

R5.5 THE SYSTEM SHALL load as the agent's resources exactly `file://.kiro/steering/commodore-basic-v2.md`,
`file://.kiro/steering/gazette-notation.md`, `file://.kiro/steering/resurrector.md` and
`skill://petscii-notation`. `resurrector.md` SHALL carry `inclusion: manual` so no other agent or chat loads it.

R5.6 THE SYSTEM SHALL keep the profile's `prompt` to at most 6 sentences, containing no listing text, and SHALL keep
the method in the steering resource.

R5.7 THE SYSTEM SHALL keep the agent unable to: insert or delete a line (the tool and the gate have no such op,
checksum-oracle R4.4, R4.6), press the post-title key (c64-mcp-server R6.3, R8.2), write a file, run a command,
declare a verdict (c64-mcp-server R3.9), or read another run's state or any reference listing (R5.3, R5.8).

R5.8 WHEN a run ends, THE SYSTEM SHALL scan the recorded `kiro` tool_call events for built-in read calls whose path is
under a directory denied in R5.3 or is not inside the workspace, and SHALL write the count and the paths to the `end`
event as `readAudit`. A run with a non-empty `readAudit` SHALL be labelled `tainted` and SHALL NOT be listed as
a recorded demonstration run.

R5.9 THE `SessionStart` hook SHALL print, from `input.json` and `listing.json` only: the scope, the expected line
numbers, the lines lost by OCR and not recovered, the title predicate and the keys `c64_press` accepts, the statement
that success is computed, and every canonical line with its printed `:rem` checksum and its status. IT SHALL NOT print
a reference transcript or the post-title key's expected result beyond what `spec` carries.

## R6 — The Pre Tool Use hook and its refusal accounting

**User story**: as the gate's owner, I need a refused proposal to cost the agent an attempt and teach it why, and I
need `force_unverified` to be possible only after the gate refused that line twice.

R6.1 WHEN the Pre Tool Use hook fires for a tool whose name ends in `apply_patch`, THE SYSTEM SHALL judge the
proposed ops with `applyPatch` from `src/gate/checksum-gate.ts`, the same function the server calls, against the
listing in `$RUN_DIR/listing.json` (or `input.json` before the server's first write), the page's `expectedLines`,
`force_unverified` from the tool input and the counts of `refusals.json`. For any other tool it SHALL exit 0 without
reading any file.

R6.2 IF the gate's verdict is `refused`, THEN THE SYSTEM SHALL write the gate's reason to stderr verbatim, byte for byte,
and exit 2, so the call never reaches the server and the agent reads printed vs computed. IF the verdict is
`accepted` or `forced`, THEN it SHALL exit 0. It SHALL exit with no other code.

R6.3 THE SYSTEM SHALL make the hook the only writer of `refusals.json` (`{ "<lineno>": count }`). On a refusal it
SHALL add 1 to the count of every line `refusedLines(verdict, patch)` returns (`src/replay/replay.ts`): the lines of the
gate's per-op results, or, when there are none, the line of every op. It SHALL write the file before it exits.

R6.4 THE SYSTEM SHALL use `refusedLines` in the hook and in REPLAY. One rule SHALL charge refusals in both.

R6.5 THE SYSTEM SHALL allow `force_unverified` only through the gate's own rule: for a checksum mismatch on a line
whose count is at least 2 (checksum-oracle R4.17). In every other case the gate refuses it. The hook SHALL NOT
add a rule of its own and SHALL NOT override a verdict.

R6.6 WHEN a patch is forced, THE SYSTEM SHALL mark the line `forced`. A forced line SHALL appear as FORCED in the
listing context, SHALL count as an actionable failure (R3.7a) and, by contract clause 5, SHALL make RESURRECTED impossible
for the run.

R6.7 THE SYSTEM SHALL append one event per firing to `events.jsonl`: `{k:"hook", hook:"checksum-gate", via:
"kiro-pre-tool-use", sessionId, ops, force_unverified, exit, decision, ...}` with `stderr` and `refusals` on a refusal.

R6.8 IF the hook crashes, times out, or cannot read a file, THEN THE SYSTEM SHALL fail towards the server: the call
reaches the server, whose gate judges it again (c64-mcp-server R10.4), and `refusals.json` is not changed. A damaged or
absent `refusals.json` SHALL count as `{}` (never unlocks a force, c64-mcp-server R10.3).

R6.9 THE SYSTEM SHALL give the same verdict for the same listing, patch and counts in the hook, in the server and in
REPLAY. The agent SHALL be told not to issue `apply_patch` calls in parallel (resurrector.md), because the hook
reads `listing.json` before the server has persisted the previous patch; the server's verdict then stays the
authority and a refusal at the server is not counted in `refusals.json` (the server never writes it).

R6.10 THE SYSTEM SHALL charge a hook-refused call to the iteration cap exactly as an accepted one (R4.2).

## R7 — Terminal states and the `end` event

**User story**: as a judge, I need every run to end in one of three computed states with the numbers behind it.

R7.1 THE SYSTEM SHALL end every run with exactly one `end` event whose `result` is one of `RESURRECTED`,
`BOOTED-PARTIAL`, `NOT-RESURRECTED`. The displayed labels SHALL be `RESURRECTED`, `BOOTED — PARTIAL` and `NOT
RESURRECTED`, with the em dash only in the label.

R7.2 THE SYSTEM SHALL derive `result` only from a contract computed by `evaluate()` (`src/gate/contract.ts`): the
server's after `c64_run` or the runner's final judge (R4.7). It SHALL NOT derive it from the agent's text, the `finished`
event, a tool-result text, or the exit code of a process.

R7.3 THE SYSTEM SHALL give the verdict `BOOTED-PARTIAL` whenever the title was seen and any contract clause 2 to 6 failed, and
`NOT-RESURRECTED` whenever the title was not seen. THE SYSTEM SHALL treat a title alone as `BOOTED-PARTIAL` at best, in
every message it writes.

R7.4 THE SYSTEM SHALL write in the `end` event: `result`, `iterations`, `wallMs`, `cap`, `cycles`, `finalJudge`, `scope`,
`postTitle`, `counts`, `lines`, `readAudit`, and `error` when the run ended for a reason other than the stop rule or a
cap.

R7.5 IF the run ends because of an error (no session id, no listing, a stop-check failure, a denied `@c64` tool),
THEN `result` SHALL be the contract state if any `listing.json` exists and `NOT-RESURRECTED` if not, and `error` SHALL
name the cause. `result` SHALL NOT be `"error"`.

R7.6 THE SYSTEM SHALL emit one `credits` event before `end`: `{metered, delta: null, total, lowerBound}` where `lowerBound`
is true when a killed cycle's usage never arrived (spike K3).

R7.7 THE SYSTEM SHALL give the same `result` for a run whatever the agent said last: for any `finished.finalText`, the
`end` event SHALL be unchanged.

## R8 — The recorded run and REPLAY

**User story**: as a judge, I need to watch the gate and the machine decide again on the exact input the real run
saw, and to see where the replay and the record disagree.

R8.1 THE SYSTEM SHALL write each run to `runs/<listing>/<iso>.jsonl`, one JSON object per line `{t, k, ...}`, holding:
the `start` event with `input`; one `cycle` event per cycle; the `kiro` stream events (tool loads, tool calls with input,
tool results, `finished`); the `hook` events; the server's `emu`, `proposal`, `gate`, `malformed` and `error`
events; one `credits` event per usage report and the final one; and the `end` event.

R8.2 THE SYSTEM SHALL append `events.jsonl` lines to the record after each cycle, in file order. For replay, the
order of `hook`, `proposal`, `gate` and `emu` events is the order of `events.jsonl`, not the order of the `t` field
(stream events are written live, file events at the end of each cycle).

R8.3 THE SYSTEM SHALL keep exactly one replay-relevant record of each hook-refused call: the hook's own event
(`via: "kiro-pre-tool-use"`). The stream-derived copy (`via: "kiro-stream"`) is for display only; REPLAY and the
iteration count SHALL ignore it.

R8.4 WHEN REPLAY runs a record, THE SYSTEM SHALL start from `start.input.lines` (never from the judge's own OCR) and
re-judge every attempt, in order, with `applyPatch`: hook refusals, and each `proposal` with its refusal counts.
It SHALL compare each recomputed verdict with the recorded one and list every disagreement in `mismatches`, never
smoothing one over.

R8.5 WHEN a core is available, REPLAY SHALL re-run the program after each accepted or forced patch and recompute the contract
with `judge`; the final contract SHALL be compared with the recorded `end.result`. WHEN no core is available (the
public site holds no ROM), REPLAY SHALL re-execute only the gate, show the recorded screens, and label the mode
`RECORDED PLAYBACK`.

R8.6 THE SYSTEM SHALL report, per line changed in a replay, the edit ratio of the final body against the OCR body in
`start.input` (`editRatio` of `src/gate/checksum-gate.ts`), and flag a line above 0.4. The gate caps each patch against
the line's current body, so a chain of patches can pass 0.4 in total; the flag makes that visible. It is a report,
never a block.

R8.7 THE SYSTEM SHALL record no credential, token, or the content of `kiro-stderr.log` in the record file.

R8.8 THE SYSTEM SHALL make a run with `result: "RESURRECTED"` replay to `RESURRECTED` and with zero mismatches when a core
is available. A recorded run that does not SHALL be labelled `unreproducible` and SHALL NOT be shown as a result.

## R9 — Failure handling

**User story**: as the runner's owner, I need every way the loop can break to end the run with a recorded cause and
no more spend than the caps.

R9.1 IF a `@c64` tool result carries `permissionDenied`, THEN THE SYSTEM SHALL end the run after that cycle with
`error: "tool-not-trusted"` and the tool name. The trust list is configuration, and a headless run cannot ask.

R9.2 IF `kiro-cli` exits non-zero with no progress (R4.5's definition) in its cycle, THEN THE SYSTEM SHALL record the
exit code in the `cycle` event, and the next evaluation SHALL follow R4.5.

R9.3 IF the stop check's output is not valid JSON, THEN THE SYSTEM SHALL end the run (fail closed) with `error:
"stop-check"` and its stderr text, and R7.5 SHALL give `result`.

R9.4 IF the Agent Stop hook crashes, THEN THE SYSTEM SHALL treat it as an allow inside the CLI (non-0, non-block
codes never block); the runner's own stop check after the process SHALL still decide the run.

R9.5 IF the `c64` server fails to start (`RUN_DIR` unset, bad `input.json`), THEN THE SYSTEM SHALL surface its stderr line
in the record and end the run through R4.5 within two cycles.

R9.6 IF the `c64` emulator crashes, THEN THE SYSTEM SHALL follow c64-mcp-server R12; a second crash ends the run through R3.9.

R9.7 IF the wall cap kills a cycle while a tool call is in flight, THEN `listing.json` and `state.json` SHALL still parse (they are
written atomically, c64-mcp-server R3.3) and the stop rule SHALL read them.

R9.8 THE SYSTEM SHALL write `listing.json`-derived facts into the `end` event even when `listing.json` was last written by the
server before a kill. It SHALL NOT start a new cycle after any cap.

---

## Analysis notes

An analysis pass over the first draft of this document, each item with what was found and what changed. Items marked
(open) need a decision from the owner.

A1 **40% edit cap vs a misread line number.** The gate's cap (checksum-oracle R4.7) measures a `replace` of a body.
A misread line number is not a body edit, so a patch that "fixes `26` back to `20`" would look like a rewrite
if modelled as `replace`. Resolved: a number is repaired only with `renumber`, which has no ratio cap but must itself
produce a checksum-valid line under the new number (R4.9) and target an inventory number (R4.8). When body and number
are both wrong, one patch holds a `replace` and a `renumber` of the same line (two of the four ops). Written into the steering
(`resurrector.md`, "Line numbers") instead of a new requirement. New gap found: the cap compares each patch with the
line's current body, so successive patches can exceed 40% in total. R8.6 reports it per line; it does not block (open:
a cumulative cap would be a change to checksum-oracle R4.7).

A2 **"The agent stops" vs "only the hook decides".** The draft used both. Resolved: an agent's turn end is not a stop
(vocabulary, R2.6); a stop exists only as the stop rule's `stop: true`; and in headless V3 the in-CLI Stop hook cannot
hold the session open more than one extra turn, so the runner's identical check continues the run (R2.4, R3.1).

A3 **"15 iterations" vs "a hook refusal never reaches the server".** The server counts only calls it receives;
the hook-refused ones were counted by `until-title.mjs` as the sum of `refusals.json`, which counts refused lines, so
a refused 4-line patch counted up to 4 and the cap could fire early. Resolved: an iteration is a fix attempt counted by
the runner from the stream (R4.2); the stop rule's fallback counts refused hook events, not line counts. Task T2.

A4 **A cap before the last patch was ever run.** The stop rule checks caps before "has the last patch been run".
If the 15th attempt is the accepted fix, the run ends with the listing-only placeholder contract (`NOT RESURRECTED`,
clause 1), which is not what the C64 would say. Resolved: the runner judges the final listing itself (R4.7) and the `end`
event says who judged. Task T3.

A5 **"Or only unfixable lines left" stops too early.** When every line is checksum-consistent but the program does not boot
(the sum cannot see swapped characters), the draft stop rule found no failing line and stopped. Resolved: R3.7(c) makes the
machine failure actionable while all checksums match, and R4 bounds it.

A6 **The server's run-over state was invisible to the stop rule.** After 3 malformed calls or two emulator crashes every tool
errors, and the loop could only burn credits until `wall`. Resolved: R3.9, R3.3 step 2.

A7 **No bound on cycles that do nothing (open).** Credits can be unmetered and the wall cap is 600 s, so a stalled agent
could cost a full run. Added the `stalled` cap (R4.5, two consecutive cycles without progress). This is a fourth cap
beyond the three you listed; remove R4.5 and R9.2/R9.5's reference to it to go back to three.

A8 **"Never sees a reference transcript" vs the `read` tool.** The agent can read the workspace; a statement about what
it "never sees" cannot be tested as written. Resolved: deny `fs_read` on directories that can hold a reference
(R5.3, added to your permission list), and a post-run audit of read calls (R5.8) that labels a run `tainted`. A
reference stored elsewhere in the workspace is not covered (open: run the recorder in a workspace that holds no references).

A9 **Refusals charge lines, not rules.** `refusedLines` charges only the failing line for a checksum refusal but every
op's line for any other refusal (edit size, inventory, duplicate number, deletion). Two refusals of a batch for an
unrelated reason can therefore unlock `force_unverified` for a line that never failed its own checksum. Kept as is,
because the hook and REPLAY share it (R6.4) and `src/**` is out of scope here; the steering tells the agent to split a
batch after a non-checksum refusal. Open: a rule that charges only checksum refusals belongs in checksum-oracle R4.17.

A10 **Parallel `apply_patch` calls.** The hook reads `listing.json` before the server persists the first of two parallel
calls, so the second is judged on a stale listing. Resolved: the server's gate stays the authority (R6.8, R6.9) and
the steering forbids parallel calls. A server-side refusal is not charged to `refusals.json` (the server never writes it), so
this can only delay a force, never unlock one.

A11 **A run's state directory could be reused.** The runner used `mkdir -p` on `RUN_DIR`, so a repeated `--run-dir` would make the
server resume from an old `listing.json` (c64-mcp-server R2.3). Resolved: R1.2.

A12 **`result: "error"` is not a terminal state.** The stop check and the runner returned `error` on a missing
`listing.json`. Resolved: R3.4, R7.5. The two spellings `BOOTED-PARTIAL` (server verdict) and `BOOTED — PARTIAL` (label) are
now defined as id and display text (R7.1).

A13 **Duplicate refusal records.** A hook-refused call appears twice in the record (the hook's event and the runner's
stream-derived event). Resolved: R8.3 says which one REPLAY and the counter use.

A14 **Record order is not time order.** Stream events are written live, `events.jsonl` events at the end of each cycle, so `t`
interleaves. Resolved: R8.2 defines replay order as file order.

A15 **Trust-list name for the read tool.** The runner's default lists `read_file`, the agent's tool selector is `read`. A
mismatch makes every read a denied tool call in a headless run. Resolved by R1.6 (the list names the seven tools) and R9.1 (a denied `@c64`
tool ends the run); the exact built-in name is to be measured in task T6, not assumed.

A16 **Unmeasured behaviours.** `${RUN_DIR}` expansion in `mcp.json`'s `env`, and whether the `SessionStart` hook fires again on a
resumed session, have not been measured. R3.8 and R2.2 do not depend on the second: the resume prompt carries the failing lines.
Task T6 measures both.

A17 **Budget arithmetic.** 15 attempts times 4 ops allows 60 line edits at most, and a forced line costs two refused attempts
first, so at most 5 lines can be forced in one run. Not a requirement; R4.2 and R6.10 make refusals count so the arithmetic
holds.

A18 **Wall cap precision.** The per-cycle timer waits at least 1 s and the kill grace is 5 s, so "600 s" is 600 s plus
the grace and the final judge. R4.4 states the bound.

A19 **Untestable wording replaced.** "A short prompt" became at most 6 sentences (R5.6); "the agent never declares success" became
"`result` is independent of the agent's last text" (R7.7); "never sees a reference" became R5.3 and R5.8.
