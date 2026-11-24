# Requirements — c64-mcp-server

## Purpose

`mcp/c64-server/server.ts` is a stdio MCP server named `c64`. It is the Kiro `resurrector` agent's only way to
touch a real Commodore 64 (the headless c64-ready core, booted by `src/emu/node.ts#bootNodeCore`). The agent
chooses where to look; the server types, runs and judges with the deterministic modules that already exist
(`src/emu/session.ts`, `src/gate/checksum-gate.ts`, `src/gate/contract.ts`). The agent can never supply program
text to the machine: the only text that is ever typed is the **canonical listing**, and the only way to change it
is `apply_patch`, which passes through `applyPatch()` (the gate) even though the Pre Tool Use hook ran the same
gate first (defence in depth).

All tool logic lives in `mcp/c64-server/tools.ts` (a factory over a `C64Core` and a run-directory path) so tests
drive every tool without stdio. `server.ts` only wires the SDK, the stdio transport and process lifecycle.

Shared vocabulary (the `CanonicalLine`, `LineStatus`, `expectedLines` and `Group` terms are those of
`.kiro/specs/checksum-oracle/requirements.md`):

- **RUN_DIR**: the directory named by the `RUN_DIR` environment variable. Every file the server reads or writes
  lives directly in it. Files: `input.json` (runner), `listing.json`, `state.json`, `events.jsonl` (server;
  hooks may also append to `events.jsonl`), `refusals.json` (the Pre Tool Use hook only).
- **Canonical listing**: the server's in-memory `CanonicalLine[]`, kept sorted ascending by `n`, unique by `n`.
  It is the gated state: every byte typed into the C64 comes from it.
- **Provisional set**: line numbers restored by recovery code and not yet proven by a run whose `postTitle` is
  `"pass"`. Held as a boolean carried with each line; it is never part of any typed text.
- **Well-formed call**: a `tools/call` whose tool name is one of the six tool names and whose arguments pass that
  tool's zod schema. Anything else is a **malformed call**.
- **Tool result**: `{ isError: boolean, text: string, data: object }`. `server.ts` maps it to an MCP
  `CallToolResult` with `content: [{ type: "text", text }]`, `isError`, and `structuredContent: data`. A "tool
  error" always means `isError: true`; it is never a JSON-RPC error and never an exception out of the process.
- **Run over**: the terminal state entered after 3 malformed calls in a row (R11.4) or a second emulator crash
  (R12.3). In it every tool returns a tool error and nothing else changes.
- **Allowed press keys**: the PETSCII codes in `spec.titlePredicate.keys` (empty when absent).
- **Gated hash**: `sha256` hex of the canonical text (R3.2).

---

## R1 — Process, transport and lifecycle

**User story**: as the runner that spawns this server under `kiro-cli`, I need a process that starts only when it
can honour the run-directory contract and that never corrupts the MCP byte stream.

R1.1 WHEN `server.ts` starts, THE SYSTEM SHALL read `RUN_DIR` and resolve it to an absolute path once. IF `RUN_DIR`
is unset, empty, or not an existing directory, THEN THE SYSTEM SHALL write one line naming `RUN_DIR` to stderr and
exit with a non-zero code before booting the emulator, before connecting the transport, and without creating or
modifying any file.

R1.2 THE SYSTEM SHALL identify itself as MCP server `c64` and SHALL list exactly six tools, in this order:
`c64_reload`, `c64_run`, `c64_read_screen`, `c64_press`, `checksum_line`, `apply_patch`. The `tools/list`
`inputSchema` of each SHALL be a JSON Schema of `type: "object"` generated from the same zod schema that
validates the call, so the advertised and the enforced arguments cannot differ.

R1.3 WHILE the process runs, THE SYSTEM SHALL write nothing to stdout except MCP protocol frames. Diagnostics go
to stderr, and `console.log`, `console.info` and `console.debug` SHALL be redirected to stderr before the
emulator, `tools.ts` or any `src/` module is loaded.

R1.4 THE SYSTEM SHALL boot exactly one headless core with `bootNodeCore()` in `server.ts` and pass it to
`createTools(core, runDir)`. `tools.ts` SHALL receive a `C64Core` and SHALL NOT import `c64-ready` or `node.ts`.

R1.5 WHEN stdin closes or the process receives `SIGTERM` or `SIGINT`, THE SYSTEM SHALL exit with code 0. Every
file write the server makes is synchronous, so none is pending at exit.

R1.6 THE SYSTEM SHALL execute tool calls strictly one at a time in arrival order, so two overlapping calls never
interleave emulator steps or file writes.

R1.7 THE SYSTEM SHALL run as `node mcp/c64-server/server.ts` on Node ≥ 22.18 with no build step: ESM, `.ts`
import suffixes, and only erasable TypeScript syntax (no enums, namespaces or constructor parameter properties).
`tsconfig.json` SHALL include `mcp` so `npm run typecheck` covers it.

R1.8 THE SYSTEM SHALL expose `async createTools(core, runDir)` returning `{ list(), call(name: string, args:
unknown) }` where `call` is the only entry `server.ts` uses for `tools/call`, and where `list()` returns the
descriptors of R1.2. Every behaviour in R5–R12 SHALL be reachable through `call` without stdio. `createTools`
SHALL reject with an `Error` whose message names the cause for every start-up failure of R2.4, having written no
file; `server.ts` turns that rejection into the stderr line and non-zero exit of R2.4.

R1.9 THE SYSTEM SHALL give each tool descriptor a non-empty `description` of at most 600 characters that states
what the tool does and what it cannot do (for example that `c64_reload` takes no text, that `c64_run` presses the
post-title keys itself, and which keys `c64_press` may send).

---

## R2 — Start-up, `input.json` and the restart rule

**User story**: as the runner that resumes the same Kiro session in a new process, I need a restarted server to
continue from the gated listing, never from the original OCR input.

R2.1 THE SYSTEM SHALL validate `input.json` with zod as `{ listingId: string (non-empty), scope: string,
spec: ListingSpec, lines: CanonicalLine[], provisional: number[] }`. `ListingSpec` is the type exported by
`src/emu/session.ts`. Constraints: `spec.expectedLines` non-empty integers in 0–63999 without duplicates;
`spec.titlePredicate.screenContains` and `spec.postTitle.screenContains` non-empty; `spec.titlePredicate.keys` is
optional; every key code an integer in 0–255; every line `n` an integer in 0–63999; `printed` null or an integer in
0–255; `status` one of the five `LineStatus` strings.

R2.2 IF `listing.json` does not exist at start, THEN THE SYSTEM SHALL build the canonical listing from
`input.json`'s `lines` (sorted ascending by `n`) and its provisional set from `input.json`'s `provisional`, and
SHALL set `iteration` to 0, `postTitle` to `"not-reached"`, and the contract to the before-any-run value (R3.5).

R2.3 IF `listing.json` exists at start, THEN THE SYSTEM SHALL load the canonical lines, each line's `provisional`
flag, `iteration`, `postTitle` and `contract` from it. It SHALL still read `listingId`, `scope` and `spec` from
`input.json` (`listing.json` carries no `spec`) and SHALL ignore `input.json`'s `lines` and `provisional`: they
are neither validated nor used.

R2.4 IF `input.json` is missing or fails the part of R2.1 that applies (all of it when `listing.json` is absent;
only `listingId`, `scope` and `spec` when it exists), OR `listing.json` exists but is unreadable, invalid JSON, or
fails the zod schema of R3.1, OR `listing.json.listingId` differs from `input.json.listingId`, OR (first start
only) `input.json` contains two lines with the same `n` or a `provisional` number that is not the `n` of one of
its lines, THEN THE SYSTEM SHALL write the reason to stderr and exit non-zero without writing any file. The
server SHALL NOT fall back from a bad `listing.json` to `input.json`'s lines (that would silently discard gated
fixes).

R2.5 WHEN the canonical listing is loaded in either case and the run is not already over (R2.6), THE SYSTEM SHALL
type it into the C64 with `loadCanonical()`, append an `emu load` event (R4.4), and write `listing.json` (R3.4).
IF the run is already over at start, THEN THE SYSTEM SHALL type nothing and write nothing. A restart SHALL NOT run
the program: it preserves `iteration`, `postTitle` and `contract` from the existing `listing.json`, recomputes
`hash` and `untypeable`, and leaves `state.json` untouched. IF the emulator throws during this start-up typing,
THEN THE SYSTEM SHALL exit non-zero with the message on stderr (no tool is running, so R12 does not apply).

R2.6 WHEN the server starts and `events.jsonl` exists, THE SYSTEM SHALL scan it once, skipping any line that is
not valid JSON. IF it contains a `{k:"error"}` event whose `why` is `"3 malformed calls"` or `"emulator crashed
twice"`, THEN THE SYSTEM SHALL start already in the run-over state. THE SYSTEM SHALL initialise its crash count to
the number of `emu restart` events with `cause:"crash"` in the file, so "a second crash" counts across process
restarts.

R2.7 THE SYSTEM SHALL treat `spec.expectedLines` from `input.json` as the only authority for the inventory and
SHALL copy it into `listing.json.expectedLines` on every write.

## R3 — `listing.json`: the gated state

**User story**: as the runner, the stop-check and the Pre Tool Use hook, I need one file that always holds the
current gated listing and the contract computed for it, written so a reader never sees half of it.

R3.1 THE SYSTEM SHALL write `listing.json` as `{ listingId, scope, expectedLines, lines, hash, untypeable,
iteration, postTitle, contract }` where `lines` is the canonical listing sorted ascending by `n`, each entry
`CanonicalLine & { provisional: boolean }`; `untypeable` is `untypeableLines(listing)` (`{n, why}[]`);
`iteration` is the apply_patch counter (R10.2); `postTitle` is `"pass" | "fail" | "not-reached"` from the last
run; and `contract` is `{ state, scope, heading, counts, failed, lines }`.

R3.2 THE SYSTEM SHALL compute `hash` as the lower-case hex SHA-256 of the UTF-8 text made by sorting the lines
ascending by `n`, mapping each to `n + " " + body`, and joining with `"\n"` (no trailing newline). The hash does
not cover `status`, `printed`, `source` or `provisional`.

R3.3 THE SYSTEM SHALL write `listing.json` and `state.json` atomically: write the full text to `<target>.tmp` inside
`RUN_DIR` (`listing.json.tmp`, `state.json.tmp`), then rename it over the target. No other process SHALL ever
observe a partial file, and no temporary file SHALL remain after a successful write.

R3.4 THE SYSTEM SHALL write `listing.json` at start, after every `apply_patch` call that reaches the gate
(accepted, forced or refused, because `iteration` changes), and after every `c64_run`. It SHALL NOT write it
after `c64_reload`, `c64_read_screen`, `c64_press` or `checksum_line`.

R3.5 THE SYSTEM SHALL set `contract` from `judge(listing, spec, facts, provisional)` of `src/emu/session.ts` after
each `c64_run`, with `state` = the `ContractResult.verdict`, `scope` = the input `scope`, and `heading`,
`counts`, `failed` copied from the result. Before any run, and after every accepted or forced patch until the
next run, THE SYSTEM SHALL set `contract` from `evaluate()` with `titleSeen: false`, `postTitle: "not-reached"`
and `residentBytes` an empty `Uint8Array`, so `state` is `"NOT-RESURRECTED"`, `heading` starts with `NO-TITLE`,
and the value is a pure function of the listing that needs no emulator (a patch persists it before typing,
R10.6). Its `failed` list is a placeholder (clause 1 is always present) and SHALL NOT be read as a measured fact.

R3.6 THE SYSTEM SHALL set `contract.lines` to one `{ n, status, source, provisional }` per canonical line,
ascending by `n`, orphans (numbers outside `expectedLines`) included.

R3.7 WHEN a patch is accepted or forced, THE SYSTEM SHALL set `listing.json.postTitle` to `"not-reached"`, so a
verdict from the previous listing is never attached to the new one.

R3.8 THE SYSTEM SHALL carry `provisional` with the line: WHEN a patch changes a provisional line's body or
number, THE SYSTEM SHALL keep that line provisional at its new number. A patch SHALL NOT make a non-provisional
line provisional. WHEN a `c64_run` ends with `postTitle` `"pass"`, THE SYSTEM SHALL clear `provisional` on every
line before computing `contract`. A run with any other `postTitle` SHALL leave `provisional` unchanged.

R3.9 THE SYSTEM SHALL store a verdict only as `listing.json.contract.state`. Run results and events carry measured
facts (`titleSeen`, `postTitle`, `error`) and the contract `heading` quoted from that field; no tool argument
SHALL supply a verdict, a success claim or a `status`. The only `status` values the server ever assigns are the
gate's (`verified`, `digit-misread`, `forced`, `unverified`), taken from `applyPatch()`.

---

## R4 — `state.json` and `events.jsonl`

**User story**: as the recorder and REPLAY, I need an append-only record from which every accepted patch can be
rebuilt, and as a human I need a live picture of the machine.

R4.1 THE SYSTEM SHALL write `state.json` as `{ iteration, screen, error, titleSeen, postTitle, at }` after every
`c64_run`, `c64_read_screen` and `c64_press`, where `screen` is `readScreenText(core)` taken after the tool's
last emulator step, `error` is `parseError(screen)` (`{kind, line}` or `null`), `at` is an ISO-8601 time, and
`iteration` is the current counter.

R4.2 WHEN `c64_run` writes `state.json`, THE SYSTEM SHALL set `titleSeen` and `postTitle` from that run's
`MachineFacts` and `error` from `facts.run.error`. WHEN `c64_read_screen` or `c64_press` writes it, THE SYSTEM
SHALL set `titleSeen` to whether `afterLastRun(screen)` contains `spec.titlePredicate.screenContains` and
`error` is `null`, and `postTitle` to the last run's value. `state.json` is observational: no field of it
SHALL feed `contract`, and `contract` SHALL be derived only from `c64_run` facts.

R4.3 THE SYSTEM SHALL append events to `events.jsonl` as one JSON object per line `{ t: <ISO time>, k, ... }`,
synchronously, before the producing tool returns. It SHALL never truncate, rewrite or reorder the file.

R4.4 THE SYSTEM SHALL emit these event shapes, every listed field present:
- `{k:"emu", op:"load", hash, untypeable}` after every typing of the listing performed outside `c64_run`
  (start, `c64_reload`, an accepted or forced `apply_patch`, a crash restart);
- `{k:"emu", op:"run", error, titleSeen, frames, stoppedOn, postTitle, hash}` after every `c64_run`;
- `{k:"emu", op:"press", keys, checkpoint, pass?}` after every `c64_press` that pressed keys (R8.5);
- `{k:"emu", op:"restart", cause:"crash"}` after every crash reboot (R12.1);
- `{k:"proposal", ops, reason, force_unverified}` for every well-formed `apply_patch`, before the gate runs;
- `{k:"gate", verdict, reason, perOp, refusalCounts, hash?}` after the gate runs, `hash` only on accepted or
  forced, and `refusalCounts` the `refusals.json` entries for the lines the patch names;
- `{k:"malformed", tool, why}` for every malformed call;
- `{k:"error", why}` for a fatal condition (R11.4, R12.3) or an unexpected internal exception (R11.6).

R4.5 THE SYSTEM SHALL record enough that `input.json` plus `events.jsonl` rebuild every canonical listing,
independent of any process restart: starting from `input.json`'s `lines`, for each `proposal` followed by a `gate`
event whose `verdict` is `accepted` or `forced`, re-running `applyPatch()` on the previous listing with the
proposal's ops (`replace`→`type:"replace"`, `renumber`→`type:"renumber"`), `force_unverified` and the gate
event's `refusalCounts` SHALL give the same verdict and a listing whose R3.2 hash equals the gate event's `hash`.

## R5 — `c64_reload`

**User story**: as the agent, I need to put the canonical listing back on the machine and see which lines the C64
cannot hold, without ever being able to type text myself.

R5.1 THE SYSTEM SHALL accept `c64_reload` with no arguments only. IF the call carries any argument (including
`lines`, `text` or `body`), THEN it is a malformed call (R11.1); THE SYSTEM SHALL NOT forward any argument to the
emulator.

R5.2 WHEN `c64_reload` is called, THE SYSTEM SHALL call `loadCanonical(core, listing)` with the canonical listing
(`NEW`, then every typeable line in ascending order), append an `emu load` event, and return the gated hash and
every untypeable line.

R5.3 THE SYSTEM SHALL report each untypeable line in `text` as one line `untypeable: line <n>: <why>` with `why`
exactly one of `control-outside-quotes`, `digit-leading-body`, `nothing-typeable`, `too-long`, and in `data` as
`untypeable: {n, why}[]`. WHEN there are none, `text` SHALL say `untypeable: none`. This report SHALL appear in the
results of `c64_reload`, `c64_run` and `apply_patch` (every load the agent causes).

R5.4 THE SYSTEM SHALL NOT type an untypeable line (that is `loadCanonical`'s contract) and SHALL NOT drop it from
the canonical listing, so the agent can repair it with `apply_patch`.

---

## R6 — `c64_run`

**User story**: as the agent, I need to run exactly what the gate accepted and read the machine's real answer,
and as the product I need the verdict to come from that run alone.

R6.1 THE SYSTEM SHALL accept `{ frames?: integer }` with `1 ≤ frames ≤ 20000`, default 3000. A `frames` below 1,
above 20000 or non-integer is a malformed call; it is rejected, never clamped.

R6.2 WHEN `c64_run` is called, THE SYSTEM SHALL call `runListing(core, listing, spec, frames)` with the canonical
listing, which re-types it first (`NEW` + every typeable line), so the program that runs is exactly the gated
state whatever was typed into the machine since. THE SYSTEM SHALL NOT run, press or type anything else before
that call.

R6.3 THE SYSTEM SHALL NOT expose the post-title keys to the agent in any argument or result. WHEN the title
predicate appears, `runListing` presses `spec.postTitle.keys` itself; the server SHALL NOT add presses of its own.

R6.4 WHEN `runListing` returns, THE SYSTEM SHALL (in this order) clear `provisional` on every line if
`facts.postTitle` is `"pass"` (R3.8); compute `judge(listing, spec, facts, provisional)`; append the `emu run`
event; write `listing.json` with the new `postTitle` and `contract`; write `state.json` (R4.2); and only then
return.

R6.5 THE SYSTEM SHALL return in `text`, readable and in this order: the contract `heading`; the parsed error line
(`error: ?SYNTAX  ERROR IN 20` style, taken from the C64's own text, or `error: none`); `titleSeen`;
`postTitle`; the untypeable report (R5.3); then the screens `AFTER RUN`, `TITLE` (when the title was seen) and
`POST-TITLE` (when reached), each verbatim as 40×25 text. THE SYSTEM SHALL return in `data`: `hash`, `iteration`,
`frames`, `stoppedOn`, `error`, `titleSeen`, `postTitle`, `heading`, `counts`, `failed`, `untypeable` and
`screens: { afterRun, title?, postTitle? }`.

R6.6 THE SYSTEM SHALL keep the C64's own error text unmodified, including the double space of
`?SYNTAX  ERROR IN n`, in `text`, `data.screens` and `state.json.screen`.

R6.7 IF `c64_run` is called while the canonical listing has no typeable line, THEN THE SYSTEM SHALL still run it
and report what the machine did; it SHALL NOT invent a diagnosis.

---

## R7 — `c64_read_screen`

R7.1 THE SYSTEM SHALL accept `c64_read_screen` with no arguments only (otherwise malformed, R11.1).

R7.2 WHEN `c64_read_screen` is called, THE SYSTEM SHALL return the current 40×25 screen (`readScreenText(core)`)
and `parseError(screen)` in `text` and `data: { screen, error }`, and write `state.json` (R4.1, R4.2). THE SYSTEM
SHALL NOT step the emulator, change `listing.json`, or append an event.

---

## R8 — `c64_press`

**User story**: as the agent, I may need to press the title screen's own key, and I must not be able to use the
keyboard as a side door past the gate.

R8.1 THE SYSTEM SHALL accept `{ keys: string[] }` with 1 to 16 entries, each exactly one of: a single character
that has a PETSCII code in 32–95 after upper-casing (printable ASCII letters, digits and punctuation, space
included), `"RETURN"` (13) or `"SPACE"` (32). Any other entry is a malformed call (R11.1).

R8.2 IF any key's PETSCII code is not in `spec.titlePredicate.keys`, THEN THE SYSTEM SHALL return a tool error
that names the allowed keys by name (`RETURN`, `SPACE`, the character, or `code <n>` for a code with no key name)
and SHALL queue, press and step nothing (all-or-nothing). IF the allowed set is empty or absent, THEN the error
SHALL say that no key may be pressed for this listing. These refusals are well-formed calls (R11.3).

R8.3 WHEN every key is allowed, THE SYSTEM SHALL call `pressKeys(core, codes, 100)` once with the keys in order
and return the resulting screen and parsed error in `text` and `data: { screen, error, keys, checkpoint, pass? }`.

R8.4 THE SYSTEM SHALL write `state.json` (R4.1, R4.2) and SHALL NOT change `listing.json` or `contract`. A press
SHALL NOT be evidence for any contract clause: the verdict comes only from `c64_run` (R3.5, R3.9).

R8.5 THE SYSTEM SHALL append `{k:"emu", op:"press", keys, checkpoint, pass?}` where `keys` are the entries the
agent sent, `checkpoint` is `"title"` when `listing.json.postTitle` is `"not-reached"` and `"postTitle"`
otherwise, and `pass` is present only for `"postTitle"` and is `true` exactly when the screen after the press
contains `spec.postTitle.screenContains`. A refused press SHALL NOT append an event.

---

## R9 — `checksum_line`

R9.1 THE SYSTEM SHALL accept `{ lineno: integer 0–63999, body: string of at most 1000 characters }`.

R9.2 WHEN `checksum_line` is called, THE SYSTEM SHALL return `computed = computeChecksum(lineno, body)`. WHEN the
canonical listing contains a line numbered `lineno`, THE SYSTEM SHALL also return that line's `printed` and
`status = checkLine(lineno, body, printed).status`, with `matches` true exactly when that status is `"verified"`
or `"digit-misread"`, and `reading` (the checksum value the printed digits were read as) when `"digit-misread"`.
WHEN no such line
exists, THE SYSTEM SHALL return `exists: false` and neither `printed`, `status` nor `matches`.

R9.3 THE SYSTEM SHALL execute `checksum_line` with no file write, no event, no emulator access and no change to
the canonical listing, `iteration`, or `listing.json`; the same arguments on the same listing return the same
result. (It is a well-formed call, so it resets the malformed-call counter of R11.4.)

## R10 — `apply_patch`

**User story**: as the agent, I need to propose a fix and learn at once whether the gate took it, and as the
product I need a refused patch to change nothing and an accepted one to be what the next run executes.

R10.1 THE SYSTEM SHALL accept `{ ops, reason, force_unverified? }` where `ops` is an array of 1 to 4 objects, each
exactly `{ op: "replace", lineno, new_body }` or `{ op: "renumber", lineno, new_lineno }` (`lineno` and
`new_lineno` integers in 0–63999, `new_body` a string of at most 1000 characters that MAY be empty so the gate's
deletion refusal reaches the agent); `reason` a string of 1 to 500 characters after trimming; `force_unverified`
an optional boolean, default `false`. Unknown keys are not allowed.

R10.2 WHEN a well-formed `apply_patch` is received, THE SYSTEM SHALL increment `iteration` by 1 and append the
`proposal` event with `ops` exactly as the agent sent them, before the gate runs. A malformed `apply_patch` SHALL
NOT increment `iteration`.

R10.3 WHEN judging a patch, THE SYSTEM SHALL read `refusals.json` afresh (it is written by the hook between
calls) as `{ "<lineno>": count }` and pass it as `refusalCounts` (keys converted to numbers). IF the file is
absent, THEN the counts are `{}`. IF it is unreadable, is not a JSON object, has a key that is not a non-negative
decimal integer, or has any value that is not a non-negative integer, THEN the whole file SHALL be treated as `{}`
(fail closed: a damaged file can never unlock `force_unverified`). THE SYSTEM SHALL NEVER write `refusals.json`.

R10.4 THE SYSTEM SHALL call `applyPatch(listing, patch, spec.expectedLines, { force_unverified, refusalCounts })`
of `src/gate/checksum-gate.ts` with `listing` the canonical lines (without the `provisional` field) and `patch` the
ops with `op` renamed to `type`. It SHALL run this call even though the Pre Tool Use hook already ran the same gate.
It SHALL add no rule of its own and SHALL NOT override a verdict.

R10.5 IF the gate's verdict is `"refused"`, THEN THE SYSTEM SHALL return a tool error whose `text` is the gate's
`reason` verbatim (byte for byte, no prefix or suffix), append the `gate` event, and write `listing.json` (only
`iteration` differs). The canonical listing, `provisional`, `hash`, `postTitle` and `contract` SHALL be unchanged,
and the emulator SHALL NOT be stepped or typed into.

R10.6 IF the verdict is `"accepted"` or `"forced"`, THEN THE SYSTEM SHALL, in this order: append the `gate` event
with the new `hash`; replace the canonical listing with the gate's listing, carrying `provisional` per R3.8 and
re-sorting ascending by `n`; write `listing.json` with the new lines, `hash`, `untypeable`, `iteration`,
`postTitle: "not-reached"` and the before-any-run `contract` (R3.5); re-type the whole canonical listing into the
C64 with `loadCanonical()` and append the `emu load` event; and only then return. Persisting before typing means
a crash while typing never loses an accepted patch.

R10.7 WHEN a patch is accepted or forced, THE SYSTEM SHALL return `text` = the gate's `reason`, then `hash <new
hash>`, then the untypeable report (R5.3), then `Call c64_run next.`, and `data: { verdict, reason, perOp, hash,
iteration, untypeable }`. IF the new listing contains an untypeable line, THEN the patch is still accepted (the
gate has no such rule) and the line SHALL be reported, not hidden.

R10.8 WHEN `force_unverified` is true, THE SYSTEM SHALL pass it through unchanged so that, for one line, refusal
counts 0 and 1 give the gate's refusal and count 2 gives `"forced"`. A forced line stays `status: "forced"` in
`listing.json` and, by `contract.ts` clause 5, can never produce RESURRECTED.

---

## R11 — Argument validation, malformed calls and the run-over state

**User story**: as the runner, I need a misbehaving model to be stopped by the server itself rather than burn the
credit budget on garbage calls.

R11.1 WHEN a `tools/call` fails its zod schema (wrong type, missing field, unknown key, out-of-range value, or an
argument given to a no-argument tool), OR names a tool that is not one of the six, THEN THE SYSTEM SHALL return a
tool error whose `text` names the tool and lists each issue as `<path>: <message>`, append
`{k:"malformed", tool, why}`, and change neither the canonical listing, `iteration`, the emulator, nor any file
other than `events.jsonl`. It SHALL NOT throw. A call with no `arguments` field is the empty object `{}`.

R11.2 THE SYSTEM SHALL validate arguments inside `createTools(...).call`, with zod 4 schemas, so the same
validation applies under test and under stdio. `server.ts` SHALL use the SDK's low-level `Server` request handlers
for `tools/list` and `tools/call` (not `registerTool`, whose built-in validation would reject a call before this
server could count it).

R11.3 WHEN a well-formed call returns, whether it succeeded or returned a tool error (a gate refusal, a refused
key, an emulator error), THE SYSTEM SHALL reset the consecutive-malformed counter to 0.

R11.4 WHEN a third consecutive malformed call arrives, THE SYSTEM SHALL append its `malformed` event, then
`{k:"error", why:"3 malformed calls"}`, and enter the run-over state. That call SHALL return a tool error that
also says `run is over`.

R11.5 WHILE the run is over, THE SYSTEM SHALL answer every `tools/call`, including `checksum_line` and unknown
names, with a tool error whose `text` begins `run is over:` and gives the cause, SHALL NOT touch the emulator, and
SHALL NOT write any file or event. `tools/list` SHALL still answer.

R11.6 IF a tool throws an exception that is not an emulator crash (R12.1), THEN THE SYSTEM SHALL return a tool
error `internal error: <message>`, append `{k:"error", why:"internal", tool, message}`, keep running, and not
count it as malformed.

R11.7 THE SYSTEM SHALL keep the consecutive-malformed counter in memory only; it starts at 0 on every process
start. (The run-over state itself survives a restart, R2.6.)

---

## R12 — Emulator crash recovery

R12.1 IF a call into the `C64Core` or into `src/emu/session.ts`/`core.ts` helpers running on it throws while a tool
is working, THEN THE SYSTEM SHALL treat it as an emulator crash and add 1 to the crash count (initialised per
R2.6). WHEN the count becomes 1, THE SYSTEM SHALL call `core.boot()`, type the canonical listing with
`loadCanonical()`, append `{k:"emu", op:"restart", cause:"crash"}` and then the `emu load` event, and re-execute
that tool's emulator work once from its start (the half-finished first attempt is discarded).

R12.2 THE SYSTEM SHALL leave the canonical listing, `provisional`, `iteration`, `postTitle` and `contract`
unchanged by the recovery itself. For `apply_patch`, the accepted listing was already persisted (R10.6), so the
retry is only the typing.

R12.3 IF the crash count would become 2 (a crash in the retry, in the reboot or re-typing itself, in a later tool
call, or after a process restart per R2.6), THEN THE SYSTEM SHALL append `{k:"error", why:"emulator crashed
twice"}`, enter the run-over state, and return the tool error `emulator crashed twice; the run ends`.

---

## R13 — Isolation and safety

R13.1 THE SYSTEM SHALL read and write only these paths: `RUN_DIR/input.json` (read), `RUN_DIR/listing.json`,
`RUN_DIR/state.json`, `RUN_DIR/events.jsonl` (append), `RUN_DIR/refusals.json` (read), the temporary file of R3.3
inside `RUN_DIR`, and the c64-ready WASM that `bootNodeCore()` reads. Every path is a constant joined to
`RUN_DIR`; no tool argument SHALL ever become part of a path, a command or a query.

R13.2 THE SYSTEM SHALL NOT open a network connection and SHALL NOT start a child process. No module under
`mcp/c64-server/` SHALL import `node:http`, `node:https`, `node:http2`, `node:net`, `node:tls`, `node:dgram`,
`node:dns`, `node:child_process`, `node:cluster` or `node:worker_threads`, and none SHALL call `fetch`. (The
c64-ready loader's `fetch` of a `data:` URL inside `src/emu/` is local and outside this module.)

R13.3 THE SYSTEM SHALL read no magazine, OCR or reference text other than the `lines` of `input.json` (as carried
in `listing.json` after a restart), and SHALL read only `RUN_DIR` from the environment.

R13.4 THE SYSTEM SHALL NOT modify `input.json` or `refusals.json`.

R13.5 THE SYSTEM SHALL contain no verdict logic of its own: every status comes from `applyPatch`, every verdict
from `judge`/`evaluate`, every checksum from `computeChecksum`/`checkLine`, every typing decision from
`loadCanonical`/`untypeableLines`. The string `RESURRECTED` SHALL appear in a tool result only inside the contract
`heading` quoted from `listing.json.contract`.

## R14 — Tests and measurement

R14.1 THE SYSTEM SHALL provide `tests/unit/mcp-tools.test.ts`, driving `createTools` on the real headless core
(booted once in `beforeAll`, a fresh temporary `RUN_DIR` per test), covering at least: (a) a `c64_reload` →
`c64_run` → `c64_read_screen` → `c64_press` round trip, plus a deliberately broken fixture whose run result shows
the double-space `?SYNTAX  ERROR IN n` (R6.6); (b) an accepted patch, after which `dumpBasic(core)` equals
`tokenizeProgram` of the canonical listing both right after `apply_patch` and after the next `c64_run`; (c) a
refused patch that changes nothing except `iteration` and leaves the machine's memory byte-identical; (d) an
unlisted press key refused with nothing pressed; (e) the restart rule (a second `createTools` on the same `RUN_DIR`
resumes the gated listing, `iteration`, `postTitle` and `contract`, not `input.json`'s lines) and each start-up
failure of R2.4, including a corrupt `listing.json` that does not fall back to `input.json`; (f) a run whose
`postTitle` is `"pass"` clearing `provisional`, and a failing run not clearing it; (g) `force_unverified` with
`refusals.json` counts 0, 1, 2 giving refused, refused, forced, and a corrupt `refusals.json` counting as `{}`;
(h) three consecutive malformed calls entering the run-over state, a well-formed call in between resetting the
count, and the state surviving a restart; (i) crash recovery with a core wrapper that throws on demand: one crash
recovers with `emu restart` + `emu load` events, a second ends the run, also across a restart; (j) `provisional`
following a renumber; (k) `listing.json.postTitle`/`contract` reset after an accepted patch and the before-run
contract equal to the pure `evaluate()` value; (l) `checksum_line` leaving `listing.json` and `events.jsonl`
byte-identical; (m) the untypeable report in `c64_reload`, `c64_run` and `apply_patch`; (n) `list()` returning the
six names in order with object `inputSchema`s and descriptions of at most 600 characters; (o) `RUN_DIR` holding
only the files of R13.1 after a full session; (p) the source-import audit of R13.2; (q) two overlapping `call`s
executing one after the other (R1.6); (r) `RESURRECTED` appearing in results only inside a heading (R13.5).

R14.2 THE SYSTEM SHALL provide `tests/unit/mcp-stdio.test.ts`, which spawns `node mcp/c64-server/server.ts` with
`RUN_DIR` set, connects the SDK client over stdio, lists the 6 tools in order, calls `checksum_line` and compares
its result with `computeChecksum`, and closes the client. It SHALL also check that starting without `RUN_DIR`
exits non-zero with `RUN_DIR` named on stderr, and that the process exits 0 after the client closes.

R14.3 THE SYSTEM SHALL provide `tests/prop/mcp-server.prop.ts`, fast-check properties (`numRuns: 100` or more each)
on a stub `C64Core` that only types (no run), for the properties of `design.md` P4 (events + `input.json` rebuild
every listing hash, R4.5), P5 (a restart between any two calls changes no field of `listing.json`, R2.3, R2.5),
P7 (the malformed-call model, R11.3 to R11.5), P8 (the server's verdict equals a direct `applyPatch()` call on the
same inputs, R10.4) and P9 (a press either queues all its keys or none, R8.2).

R14.4 THE SYSTEM SHALL use only fixtures written for this repository (an original 2026 BASIC listing whose
printed checksums are computed in the test); no magazine text is committed (`structure.md`).

R14.5 THE SYSTEM SHALL record, as a comment at the top of `tests/unit/mcp-tools.test.ts`, the measured wall time
of one boot, one default-frame `c64_run` and one 20000-frame `c64_run`, so no timing claim is ever assumed.

R14.6 `npm test` and `npm run typecheck` SHALL pass with the new files.

---

## Out of scope

- The Pre Tool Use hook, `until-title` stop check, the runner and the `resurrector` agent profile (they exist or
  are separate specs). This server only honours their file contract (R2–R4, R10.3). The stop check and the runner
  SHALL derive the verdict from `listing.json.contract`, never from `state.json`.
- Writing `refusals.json`, recovering lost lines, promoting a line to `eye-verified`.
- Rate limiting `checksum_line`. A model may probe it freely; that cannot change the listing, and the gate is
  the only path that can.

## Analysis notes

The analyze-requirements pass read every requirement for contradictions, gaps and untestable wording. The first
nine findings are in the brief itself; the rest were found in the first draft of this document. Each is resolved
in the text above, and the id of the requirement that carries the resolution is given.

1. **Restart rule vs. `spec`.** The brief says a restarted server "never re-reads `input.json`'s lines", but
   `listing.json` carries no `ListingSpec`, so `input.json` is needed anyway. Resolved: `listingId`, `scope` and
   `spec` are always read from `input.json`; `lines` and `provisional` are read only on a first start (R2.2, R2.3).
2. **A bad `listing.json` could silently roll back gated fixes.** The brief only says "if it exists, load it".
   Resolved: a corrupt `listing.json`, or one whose `listingId` differs, stops the server instead of falling back
   to `input.json` (R2.4).
3. **`iteration` was written only "after every accepted/forced patch".** `iteration` counts every apply_patch call,
   so a refused call would leave `listing.json` stale. Resolved: `listing.json` is rewritten after every call that
   reaches the gate (R3.4, R10.5).
4. **A stale verdict could survive a patch.** After a patch, `postTitle` and `contract` still described the old
   listing, so a patched listing could read RESURRECTED. Resolved: an accepted or forced patch resets `postTitle`
   to `"not-reached"` and `contract` to the before-run value (R3.5, R3.7, R10.6).
5. **A restart could overwrite a RESURRECTED verdict.** "Written at start" would reset `contract` before any run.
   Resolved: a restart preserves `iteration`, `postTitle` and `contract` and does not run anything (R2.5).
6. **`provisional` is a set of line numbers, but a renumber moves a line.** The brief says a patched recovered line
   keeps `provisional: true` and does not cover renumber or swap. Resolved: the flag travels with the line, a
   patch never creates it, a pass clears it (R3.8).
7. **Ambiguous "max 20000" and "3 malformed calls in a row".** Clamp or reject, and what counts as malformed or as
   "in a row". Resolved: out-of-range is rejected (R6.1); malformed means zod failure or unknown tool; any
   well-formed call, including a gate refusal, resets the counter (R11.1, R11.3). The SDK's `registerTool`
   validates before the handler runs, so the server could not count; the low-level `Server` is required (R11.2).
8. **"Press" checkpoints undefined.** The brief names `checkpoint: "title" | "postTitle", pass?` without saying
   what they mean. Resolved: `checkpoint` is `"postTitle"` exactly when the last run reached the title; `pass` is
   present only then (R8.5). A press never feeds the contract (R4.2, R8.4).
9. **Crash counting across a restart.** "A second crash" is undefined when the runner restarts the process.
   Resolved: crashes are counted from `emu restart cause:"crash"` events, and the run-over state is rebuilt from
   `events.jsonl` (R2.6, R12.1, R12.3).
10. **Before-run contract needed emulator memory.** The first draft computed it with `dumpBasic(core)`, which
    contradicts "persist `listing.json` before typing" (R10.6). Resolved: it uses an empty `residentBytes`, so it
    is a pure function of the listing; its `failed` is marked a placeholder (R3.5).
11. **Start-up with an unusable `input.json` when `listing.json` exists.** The first draft validated all of
    `input.json` always, so a recovered run could fail on lines it never uses. Resolved: only the parts that apply
    are validated (R2.3, R2.4). A failing `createTools` rejects before any write (R1.8).
12. **`emu load` after a crash restart** was listed in R4.4 but not produced by R12.1. Resolved: R12.1 appends
    `restart` then `load`.
13. **`refusals.json` robustness.** Missing, malformed or negative values were unspecified, and a damaged file must
    not unlock `force_unverified`. Resolved: any damage means `{}` (R10.3). The gate event records the counts used,
    so REPLAY can reproduce a forced patch (R4.4, R4.5).
14. **Strict tool arguments.** "The agent can never supply program text" needs `c64_reload` to reject arguments,
    and an absent `arguments` field must equal `{}` (R5.1, R11.1). `new_body` may be empty so the gate's deletion
    refusal reaches the agent; `ops` length 1–4 and the two op names are enforced by zod (R10.1).
15. **`iteration` counting.** The brief says "calls the server received". Refined: malformed calls never reach the
    gate and are not counted; every well-formed call is, refused or not (R10.2).
16. **Untestable or inaccurate wording removed:** "provisional never shown to the model" (it is in `contract.lines`
    and clause 4's `failed`); "no verdict stored anywhere except `listing.json`" (run results quote the heading);
    "exactly these event shapes (extra fields…)". Replaced by testable statements (R3.9, R4.4, R13.5).
17. **Concurrency, stdout hygiene, signals, atomic writes.** Not in the brief and needed for a stdio process shared
    with readers: serialised calls (R1.6), stdout reserved for MCP frames (R1.3), clean exit (R1.5), atomic writes
    through `<target>.tmp` (R3.3).
18. **Typecheck coverage.** `tsconfig.json` includes `src`, `tests`, `runner` and `scripts/**/*.ts`, not `mcp`.
    Resolved by R1.7 and a task.
19. **Result format.** JSON-escaped screens are unreadable to a model. Resolved: `text` is readable with screens
    verbatim and `data` carries the structured copy, mapped to `structuredContent` (Vocabulary, R6.5).
20. **Test gaps.** The brief's list lacked tests for malformed calls, crash recovery, provisional renumbering, the
    reset after a patch, start-up failures, atomic files, and the import audit. Added (R14.1, R14.3).

Requirement count: 80 (R1.1 to R14.6).
