# Tasks — c64-mcp-server

Work top to bottom; a later task may assume every earlier task's exports exist and are tested. `npm test` and
`npm run typecheck` must pass after every numbered task (R14.6). Tests drive `createTools` on the real headless
core unless a task says "stub core". Fixtures are original 2026 BASIC only (R14.4). No source is written by the
spec itself; these tasks are the implementation plan.

- [x] 1. Schemas, key mapping and the shared test fixture
  - [x] 1.1 Add `"mcp"` to `tsconfig.json` `include`. Create `mcp/c64-server/schemas.ts`: the zod 4 schemas of
    `design.md` (six tool argument schemas, `InputHead`/`InputFull`, `ListingFile`, `RefusalCounts`), `keyToPetscii`,
    `keyName`, and `descriptors()` that builds `{ name, description, inputSchema }` with `z.toJSONSchema`
    (`$schema` removed), descriptions ≤ 600 characters.
  - [x] 1.2 Create `tests/fixtures/mcp-fixture.ts`: the four-line NIGHTJAR program, spec, `makeRun()` (temp
    `RUN_DIR` with `input.json`), `StubCore`, `throwingCore()`, and the broken, untypeable, provisional and
    bad-checksum variants listed in `design.md` "Test design".
  - [x] 1.3 Tests in `tests/unit/mcp-schemas.test.ts`: every strict schema rejects an unknown key and a wrong type;
    `frames` 0, 20001 and 1.5 are rejected and omitted gives 3000; `keys` entries `"a"`, `"RETURN"`, `"SPACE"`
    accepted and `"é"`, `""`, `"return"`, `"AB"` rejected; `ops` of 0 and 5 rejected, `new_body: ""` accepted,
    `op: "insert"` rejected; `InputFull` accepts the fixture and rejects each R2.1 violation; descriptors have
    object `inputSchema`s and non-empty descriptions of at most 600 characters; `keyName` round trip.
  - _Requirements: R1.2, R1.7, R1.9, R2.1, R5.1, R6.1, R7.1, R8.1, R9.1, R10.1, R14.4_

- [x] 2. File contract and result text
  - [x] 2.1 Create `mcp/c64-server/rundir.ts` (the only module that imports `node:fs`, `node:path`, `node:crypto`):
    `canonicalHash`, atomic `writeJsonAtomic` (`<target>.tmp` then rename), `appendEvent` (synchronous, adds `t`),
    `scanEvents` (skips bad lines; returns fatal `why` and the crash-restart count), `readRefusalCounts` (R10.3
    fail-closed rules), `readInput`, `readListing`. It never writes `input.json` or `refusals.json`.
  - [x] 2.2 Create `mcp/c64-server/render.ts`: `ToolResult` builders for the untypeable report
    (`untypeable: line <n>: <why>` / `untypeable: none`), run, patch, press and screen text with screens verbatim.
  - [x] 2.3 Tests in `tests/unit/mcp-rundir.test.ts`: hash of a hand-built listing equals a precomputed SHA-256
    and ignores `status`/`provisional`; an atomic write leaves no `.tmp` and a reader during a write sees the old or
    the new file whole; `appendEvent` never rewrites earlier lines; `scanEvents` over a file with a torn last line,
    a `3 malformed calls` error and two `restart` events; `readRefusalCounts` for absent, valid, non-object,
    negative, non-integer and bad-key files; `render` keeps the double space of `?SYNTAX  ERROR IN 20`.
  - _Requirements: R2.6, R3.1, R3.2, R3.3, R4.3, R5.3, R6.5, R6.6, R10.3, R13.1, R13.4_

- [x] 3. `createTools`: start-up, dispatcher, and the read-only tools
  - [x] 3.1 Create `mcp/c64-server/tools.ts` with `createTools(core, runDir)` and the `C64Tools` class: start-up and
    the restart rule (first start from `input.json`, restart from `listing.json`, fail-closed start-up errors),
    `beforeRunContract()`, `writeListing()`, `writeState()`, the serial `chain`, the dispatcher (zod parse,
    `malformed` events, counter, run-over after 3, `internal error` wrapper), `withEmu` stubbed to call its
    section once (task 6 completes it), and the handlers `c64_reload`, `c64_read_screen`, `checksum_line`.
  - [x] 3.2 Tests in `tests/unit/mcp-tools.test.ts` (creates the file, with a header for task 8's measurements):
    reload/read round trip and the untypeable report; first start versus restart rule (the second `createTools`
    resumes the gated lines, `iteration`, `postTitle`, `contract`, ignores `input.json` lines, does not run, leaves
    `state.json` alone); every R2.4 start-up failure including a corrupt `listing.json` with no fallback;
    start-up while already over types nothing; three malformed calls, a reset by a refused-but-well-formed call,
    run-over text and survival across a restart; `checksum_line` verified / digit-misread / mismatch / unknown line
    and byte-identical `listing.json` and `events.jsonl`; `list()` names, order and schemas; two overlapping `call`s
    run one after the other.
  - _Requirements: R1.4, R1.6, R1.8, R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R3.4, R3.5, R3.6, R4.1, R4.2, R4.4,
    R5.1, R5.2, R5.4, R7.1, R7.2, R9.2, R9.3, R11.1, R11.3, R11.4, R11.5, R11.6, R11.7, R14.1_

- [x] 4. `c64_run` and `c64_press`: the only verdict path
  - [x] 4.1 Add `c64_run` (`runListing` + `judge`, provisional clearing on `"pass"`, `emu run` event,
    `listing.json` then `state.json`, readable result with the heading and screens) and `c64_press` (allowed-key
    gate, all-or-nothing, `pressKeys(core, codes, 100)`, `checkpoint`/`pass`, `state.json` only) to `tools.ts`.
  - [x] 4.2 Extend `tests/unit/mcp-tools.test.ts`: the full reload → run → read → press round trip on the fixture
    (RESURRECTED heading only after a passing run on all-verified lines); a broken-line fixture shows
    `?SYNTAX  ERROR IN n` with its double space and `titleSeen: false`; provisional lines block RESURRECTED until a
    passing run clears them, and a failing run does not clear them; press of an unlisted key is a tool error naming
    the allowed keys, with `core.pendingKeys()`, the screen and `events.jsonl` unchanged; an empty allowed set;
    `contract` identical before and after a press and a read; `frames` honoured; `RESURRECTED` appears in results only
    inside a heading.
  - _Requirements: R3.5, R3.8, R3.9, R4.1, R4.2, R4.4, R6.2, R6.3, R6.4, R6.5, R6.6, R6.7, R8.2, R8.3, R8.4, R8.5,
    R13.5, R14.1_

- [x] 5. `apply_patch`: the gate behind the server
  - [x] 5.1 Add `apply_patch` to `tools.ts`: iteration and `proposal` event, fresh `refusals.json` read, `applyPatch`
    call (`op`→`type`), refusal path (verbatim reason, `listing.json` iteration only), accept/force path
    (index-aligned `provisional`, re-sort, hash, `gate` event, `listing.json` before typing, `loadCanonical`,
    `emu load` event, result with `Call c64_run next.`).
  - [x] 5.2 Extend `tests/unit/mcp-tools.test.ts`: accepted patch, then `dumpBasic(core)` equals `tokenizeProgram`
    of the canonical listing right after the patch and after the next run; refused patch changes nothing but
    `iteration` and leaves BASIC memory byte-identical; refusal text equals the gate `reason`; `force_unverified`
    with `refusals.json` counts 0, 1, 2 gives refused, refused, forced, and a corrupt `refusals.json` counts as `{}`;
    a renumber and a two-line swap keep `provisional` with the line; `postTitle` and `contract` reset after an
    accepted patch; an accepted patch that makes a line untypeable is reported; `iteration` counts well-formed
    calls only; `proposal` then `gate` events carry `refusalCounts` and `hash`.
  - _Requirements: R3.7, R3.8, R4.4, R4.5, R10.2, R10.3, R10.4, R10.5, R10.6, R10.7, R10.8, R14.1_

- [ ] 6. Crash recovery and isolation
  - [ ] 6.1 Complete `withEmu` in `tools.ts` per `design.md` (reboot, re-type, `restart` + `load` events, one retry,
    fatal `emulator crashed twice`), with the crash count seeded from `events.jsonl` (R2.6).
  - [ ] 6.2 Extend `tests/unit/mcp-tools.test.ts` with `throwingCore`: one crash during `c64_run` recovers and
    returns the retry's result; a second crash ends the run with the exact tool error and `error` event; a crash
    during recovery is fatal; one crash in each of two process lifetimes is fatal; recovery leaves listing,
    `provisional`, `iteration` and `contract` unchanged. Add the file-set test (only the R13.1 files exist, no
    `.tmp`, `input.json` and `refusals.json` byte-identical) and the source-import audit (no forbidden module,
    no `fetch`, `tools.ts` imports neither `c64-ready` nor `node.ts`, only `rundir.ts` imports `node:fs`).
  - _Requirements: R2.6, R4.4, R12.1, R12.2, R12.3, R13.1, R13.2, R13.3, R13.4, R14.1_

- [ ] 7. `server.ts` and the stdio test
  - [ ] 7.1 Create `mcp/c64-server/server.ts` per `design.md` "server.ts wiring": console redirect, `RUN_DIR` check,
    dynamic imports, `bootNodeCore()`, `createTools`, low-level `Server` with `ListToolsRequestSchema` and
    `CallToolRequestSchema` handlers, `StdioServerTransport`, exit 0 on stdin end, `SIGTERM`, `SIGINT`.
  - [ ] 7.2 Tests in `tests/unit/mcp-stdio.test.ts`: spawn `node mcp/c64-server/server.ts` with `RUN_DIR` in `env`,
    connect the SDK client, `listTools` returns the 6 names in order with object schemas, `callTool` `checksum_line`
    equals `computeChecksum`, a malformed call returns `isError`, `client.close()` then exit code 0; a spawn with no
    `RUN_DIR` exits non-zero with `RUN_DIR` on stderr and writes no file; a spawn with a bad `input.json` exits
    non-zero without writing.
  - _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R11.2, R14.2_

- [ ] 8. Property tests, measurements and the final run
  - [ ] 8.1 Create `tests/prop/mcp-server.prop.ts` on the `StubCore` (`numRuns: 100` each): P4 replay from events,
    P5 restart idempotence over generated call sequences, P7 malformed-counter model, P8 gate parity with a direct
    `applyPatch()` call, P9 press all-or-nothing.
  - [ ] 8.2 Fill the header comment of `tests/unit/mcp-tools.test.ts` with measured wall times (boot, default-frame
    `c64_run`, 20000-frame `c64_run`) from one real run; if the 20000-frame time is unusable as a tool call, record
    it and open the `design.md` time-limit point instead of changing the cap silently.
  - [ ] 8.3 Run `npm test` and `npm run typecheck`; fix only what the new files break.
  - _Requirements: R4.5, R2.3, R2.5, R8.2, R10.4, R11.3, R11.4, R11.5, R14.1, R14.3, R14.5, R14.6_
