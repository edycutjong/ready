# Design — c64-mcp-server

The server is a thin, serial command processor over three deterministic pieces that already exist:
`src/emu/session.ts` (type, run, judge), `src/gate/checksum-gate.ts` (the only way a listing changes) and
`src/gate/contract.ts` (the only verdict). It adds a file contract (`RUN_DIR`), argument validation, and crash
handling. It adds no rule about what is correct. Requirement ids are in square brackets.

## Module layout

```
mcp/c64-server/
  server.ts    wiring only: RUN_DIR check, console redirect, bootNodeCore(), SDK Server, stdio, signals   [R1]
  tools.ts     createTools(core, runDir) -> { list(), call() }; the C64Tools class; every tool body       [R1.8, R5-R12]
  schemas.ts   zod 4 schemas for the six tools, input.json, listing.json, refusals.json; descriptors     [R1.2, R2.1, R3.1]
  rundir.ts    the only module that touches files: read/validate, atomic write, append event, hash        [R3.2, R3.3, R13.1]
  render.ts    ToolResult text builders (headings, screens verbatim, untypeable report)                   [R5.3, R6.5]
```

Dependency order (no cycles): `schemas.ts` ← `rundir.ts` ← `render.ts` ← `tools.ts` ← `server.ts`.
`tools.ts` imports `src/emu/core.ts`, `src/emu/session.ts`, `src/basic/*`, `src/gate/*` and nothing else from the
repo; it never imports `src/emu/node.ts` or `c64-ready` [R1.4]. `server.ts` is the only file that imports
`node.ts` and the SDK. `rundir.ts` is the only file that imports `node:fs`, `node:path` and `node:crypto`.

Only erasable TypeScript is used [R1.7]: classes declare fields explicitly and assign them in the constructor
body; no `enum`, `namespace` or `constructor(private x)`. Relative imports end in `.ts`; type-only imports use
`import type` (`verbatimModuleSyntax`). `tsconfig.json` gains `"mcp"` in `include`.

## Data shapes

```ts
// schemas.ts (types inferred from zod; shown here as TS for readability)
type Spec = ListingSpec;                                  // src/emu/session.ts
type InputFile = { listingId: string; scope: string; spec: Spec; lines: CanonicalLine[]; provisional: number[] };

type ListingLine = CanonicalLine & { provisional: boolean };
type ContractFile = {
  state: Verdict; scope: string; heading: string;
  counts: ContractResult["counts"]; failed: ContractResult["failed"];
  lines: { n: number; status: LineStatus; source: string; provisional: boolean }[];
};
type ListingFile = {
  listingId: string; scope: string; expectedLines: number[]; lines: ListingLine[]; hash: string;
  untypeable: Untypeable[]; iteration: number; postTitle: "pass" | "fail" | "not-reached"; contract: ContractFile;
};
type StateFile = { iteration: number; screen: string; error: C64Error | null; titleSeen: boolean;
                   postTitle: ListingFile["postTitle"]; at: string };
type RefusalCounts = Record<number, number>;               // parsed refusals.json

type ToolResult = { isError: boolean; text: string; data: Record<string, unknown> };

type ServerEvent =                                          // events.jsonl, each with t: string
  | { k: "emu"; op: "load"; hash: string; untypeable: Untypeable[] }
  | { k: "emu"; op: "run"; error: C64Error | null; titleSeen: boolean; frames: number; stoppedOn: string; postTitle: string; hash: string }
  | { k: "emu"; op: "press"; keys: string[]; checkpoint: "title" | "postTitle"; pass?: boolean }
  | { k: "emu"; op: "restart"; cause: "crash" }
  | { k: "proposal"; ops: PatchOpInput[]; reason: string; force_unverified: boolean }
  | { k: "gate"; verdict: GateVerdict["verdict"]; reason: string; perOp: GatePerOp[]; refusalCounts: RefusalCounts; hash?: string }
  | { k: "malformed"; tool: string; why: string }
  | { k: "error"; why: string; tool?: string; message?: string };
```

`PatchOpInput` is `{ op: "replace"; lineno; new_body } | { op: "renumber"; lineno; new_lineno }`. The gate's
`PatchOp` uses `type` instead of `op`; the mapping is one small pure function in `tools.ts`.

The canonical hash is `sha256(lines sorted by n, each `${n} ${body}`, joined "\n")` in `rundir.ts#canonicalHash`
[R3.2]. It deliberately ignores `status` and `provisional`, so it identifies the text the C64 was given.

## Zod schemas and descriptors [R1.2, R11.2]

```ts
const lineno = z.number().int().min(0).max(63999);
export const tools = {
  c64_reload:       z.strictObject({}),
  c64_run:          z.strictObject({ frames: z.number().int().min(1).max(20000).default(3000) }),
  c64_read_screen:  z.strictObject({}),
  c64_press:        z.strictObject({ keys: z.array(KeyName).min(1).max(16) }),   // KeyName: refine(keyToPetscii != null)
  checksum_line:    z.strictObject({ lineno, body: z.string().max(1000) }),
  apply_patch:      z.strictObject({
    ops: z.array(z.discriminatedUnion("op", [
      z.strictObject({ op: z.literal("replace"),  lineno, new_body: z.string().max(1000) }),
      z.strictObject({ op: z.literal("renumber"), lineno, new_lineno: lineno }),
    ])).min(1).max(4),
    reason: z.string().trim().min(1).max(500),
    force_unverified: z.boolean().default(false),
  }),
} as const;
```

`list()` maps each entry to `{ name, description, inputSchema: z.toJSONSchema(schema, { io: "input" }) }` with
`$schema` removed, so the advertised and enforced schemas are one object [R1.2]. Descriptions are hand-written,
at most 600 characters, and say what the tool cannot do [R1.9].

`keyToPetscii(key)`: `"RETURN"`→13, `"SPACE"`→32, otherwise a one-code-point string whose upper-cased char code is
in 32–95; else `null` [R8.1]. `keyName(code)` is the inverse used in the refusal message (13→`RETURN`, 32→`SPACE`,
33–95→the character, else `code <n>`) [R8.2].

## `createTools(core, runDir)` and the dispatcher [R1.6, R1.8, R11]

```ts
export async function createTools(core: C64Core, runDir: string): Promise<C64Tools>;
class C64Tools {
  // fields: core, dir, input (listingId/scope/spec), listing: ListingLine[], iteration, postTitle,
  //         contract: ContractFile, malformedRun, crashes, over: string | null, chain: Promise<unknown>
  list(): ToolDescriptor[];
  call(name: string, args: unknown): Promise<ToolResult>;
}
```

`call` appends the work to `this.chain` (`chain = chain.then(run, run)`) so calls execute strictly one after the
other, in arrival order, even if the SDK delivers them concurrently [R1.6]. The body of `run` is:

```
if over:                       return error("run is over: " + over)                         [R11.5]  (no writes)
schema = tools[name]; if !schema or !parse(args ?? {}).success:
    malformedRun++; append {k:"malformed"}                                                  [R11.1]
    if malformedRun == 3: append {k:"error", why:"3 malformed calls"}; over = "3 malformed calls"   [R11.4]
    return error(issues text [+ " run is over"])
malformedRun = 0                                                                            [R11.3]
try:    result = await handlers[name](parsedArgs)
catch (e): result = e is CrashFatal ? error(e.message)                                      [R12.3]
                    : (append {k:"error", why:"internal", ...}; error("internal error: " + msg))   [R11.6]
return result
```

Every handler that touches the emulator wraps its emulator section in `withEmu(section)`:

```
async withEmu<T>(section: () => T): Promise<T> {
  for (;;) {                                           // runs at most twice: the second crash is always fatal
    try { return section(); }
    catch {                                            // any throw from core/session code is "a crash"   [R12.1]
      this.crashes++
      if (this.crashes >= 2) this.fatal("emulator crashed twice")                                       // [R12.3]
      try { await this.core.boot(); loadCanonical(this.core, this.plainListing()) }
      catch { this.crashes++; this.fatal("emulator crashed twice") }       // a crash during recovery is the 2nd
      append {k:"emu", op:"restart", cause:"crash"}; append {k:"emu", op:"load", hash, untypeable}
    }                                                  // loop: re-run the section once from its start
  }
}
fatal(why) { append {k:"error", why}; this.over = why; throw new CrashFatal(why + "; the run ends") }
```

A `section` is only the emulator calls of a tool (typing, `runListing`, `pressKeys`, `readScreenText`). Events and
files written before a section (for `apply_patch`: `proposal`, `gate`, `listing.json`) are never inside it, and
the events and files written after it are never written twice. A first-attempt result is discarded in full [R12.1].

## Start-up and the restart rule [R2]

```
createTools(core, runDir):
 1. head  = InputHead.parse(read input.json)                         // listingId, scope, spec only        [R2.3]
 2. if exists(listing.json):
        f = ListingFile.parse(read listing.json); require f.listingId == head.listingId            [R2.4]
        lines = f.lines; iteration = f.iteration; postTitle = f.postTitle; contract = f.contract    [R2.3]
    else:
        full = InputFull.parse(...); reject duplicate n, provisional ∉ lines                      [R2.4]
        lines = sort(full.lines).map(l => ({...l, provisional: full.provisional.includes(l.n)}))
        iteration = 0; postTitle = "not-reached"; contract = beforeRunContract()                   [R2.2, R3.5]
 3. scan events.jsonl (bad lines skipped): over = last fatal error why | null; crashes = #restart(crash) [R2.6]
 4. if over: return tools (every call answers "run is over: ..."); type nothing, write nothing      [R2.5]
 5. untypeable = loadCanonical(core, plain(lines))   // throws -> createTools rejects, nothing written [R2.5]
 6. append {k:"emu", op:"load", hash, untypeable}; writeListing()                                     [R2.5, R3.4]
```

Any throw in steps 1–3 rejects before step 5, so a rejected start has written nothing [R1.1, R2.4].
`beforeRunContract()` is `evaluate({ listing: plain(lines), expectedLines, titleSeen: false, postTitle:
"not-reached", residentBytes: new Uint8Array(0), provisional })` mapped to `ContractFile`; it needs no emulator
[R3.5]. On a restart (step 2, second branch) `contract` and `postTitle` are carried, never recomputed, so a
RESURRECTED verdict survives a restart [R2.5]; `hash` and `untypeable` are recomputed (they are pure functions
of `lines`).

## Tool algorithms

**`c64_reload`** [R5]: `untypeable = await withEmu(() => loadCanonical(core, plain))`; append `emu load`;
result text = `hash <h>` + untypeable report. No file is written [R3.4].

**`c64_run({frames})`** [R6]:

```
{ facts, screen } = await withEmu(() => {                               // ONE section: a crash retry re-runs all of it
  const facts = runListing(core, plain, spec, frames)                   // re-types NEW + listing, RUNs, presses the
  return { facts, screen: readScreenText(core) }                        //   title / post-title keys itself [R6.2, R6.3]
})
if facts.postTitle == "pass": for l in lines: l.provisional = false                                     [R3.8, R6.4]
res    = judge(plain, spec, facts, provisionalSet)                                                       [R3.5]
postTitle = facts.postTitle; contract = toContractFile(res)
append {k:"emu", op:"run", ...}; writeListing(); writeState({screen, error: facts.run.error, titleSeen: facts.titleSeen, postTitle})
return render.run(...)
```

**`c64_read_screen`** [R7]: `screen = withEmu(() => readScreenText(core))`, `error = parseError(screen)`;
`writeState` with `titleSeen = !error && afterLastRun(screen).includes(spec.titlePredicate.screenContains)`
[R4.2]; no event, no `listing.json`.

**`c64_press({keys})`** [R8]:

```
codes = keys.map(keyToPetscii)
allowed = new Set(spec.titlePredicate.keys ?? [])
if codes.some(c => !allowed.has(c)): return error(refusal text naming allowed keys)   // nothing queued, no event [R8.2]
screen = withEmu(() => pressKeys(core, codes, 100))
checkpoint = postTitle == "not-reached" ? "title" : "postTitle"
pass = checkpoint == "postTitle" ? screen.includes(spec.postTitle.screenContains) : undefined
append {k:"emu", op:"press", keys, checkpoint, pass?}; writeState(...)                                  [R8.4, R8.5]
```

**`checksum_line({lineno, body})`** [R9]: `computed = computeChecksum(lineno, body)`; `line = lines.find(n == lineno)`;
if found, `c = checkLine(lineno, body, line.printed)`, `matches = c.status is verified | digit-misread`. No I/O.

**`apply_patch({ops, reason, force_unverified})`** [R10]:

```
iteration++; append {k:"proposal", ops, reason, force_unverified}                                        [R10.2]
counts  = readRefusalCounts(dir)                                  // {} on absent or any damage          [R10.3]
verdict = applyPatch(plain, ops.map(toGateOp), spec.expectedLines, { force_unverified, refusalCounts: counts })  [R10.4]
if verdict.verdict == "refused":
    append {k:"gate", verdict, reason, perOp, refusalCounts: counts restricted to named lines}
    writeListing()                                                // iteration only                      [R10.5]
    return error(verdict.reason)                                  // verbatim
// accepted | forced
assert verdict.listing.length == plain.length                     // index alignment, see below
next = verdict.listing.map((l, i) => ({ ...l, provisional: lines[i].provisional })).sort(byN)             [R3.8]
hash = canonicalHash(next)
append {k:"gate", ..., hash}
lines = next; postTitle = "not-reached"; contract = beforeRunContract()                                  [R3.7]
writeListing()                                                    // persisted BEFORE typing              [R10.6]
untypeable = await withEmu(() => loadCanonical(core, plain)); append {k:"emu", op:"load", hash, untypeable}
return render.patch(...)                                          // reason, hash, untypeable, "Call c64_run next."
```

Provisional follows the line through a renumber because `applyPatch` maps over the input listing and returns the
entries in the same positions (`listing.map(...)` in `checksum-gate.ts`); the server pairs entry `i` of the
result with entry `i` of the input, then sorts. The assertion and property P6 pin that dependency; if the gate's
output order ever changed, the length check or P6 would fail rather than mis-assign a flag.

## Sequences

```
Restart mid-run (runner resumes the same Kiro session in a new process)
  runner ──spawn──▶ server.ts: RUN_DIR ok ─▶ bootNodeCore ─▶ createTools
                                   listing.json exists ─▶ lines/iteration/postTitle/contract from it
                                   input.json ─▶ spec only ─▶ loadCanonical ─▶ events: emu load ─▶ listing.json
  agent ──c64_run──▶ runListing(canonical) ... (the run is the only thing that changes `contract`)

apply_patch accepted
  agent ─▶ [Pre Tool Use hook: gate, exit 2 on refusal; never reaches the server]
        ─▶ call("apply_patch") ─▶ zod ─▶ iteration++ ─▶ events: proposal ─▶ refusals.json read
        ─▶ applyPatch ─▶ events: gate ─▶ listing.json (new lines, postTitle not-reached, before-run contract)
        ─▶ loadCanonical ─▶ events: emu load ─▶ result "ACCEPTED ... hash ... Call c64_run next."
  agent ─▶ c64_run ─▶ runListing ─▶ judge ─▶ events: emu run ─▶ listing.json (contract) ─▶ state.json
```

## Error handling

| Condition | Result | State change | Req |
|---|---|---|---|
| `RUN_DIR` missing / not a directory | stderr + exit 1 before boot | none | R1.1 |
| bad `input.json`, bad or foreign `listing.json`, duplicate lines | `createTools` rejects, stderr + exit 1 | none | R2.4 |
| emulator throws during start-up typing | stderr + exit 1 | none | R2.5 |
| zod failure / unknown tool | tool error with `path: message` lines | `malformed` event, counter+1 | R11.1 |
| 3rd malformed in a row | tool error + `run is over` | `error` event, over | R11.4 |
| any call while over | tool error `run is over: <why>` | none | R11.5 |
| gate refuses | tool error, text = gate `reason` | `iteration`+1, events | R10.5 |
| press key not allowed | tool error naming allowed keys | none | R8.2 |
| `refusals.json` damaged | counts `{}` (fail closed) | none | R10.3 |
| core throws (1st time) | reboot, re-type, `restart`+`load` events, retry once | crash count 1 | R12.1 |
| core throws (2nd time) | `emulator crashed twice; the run ends` | `error` event, over | R12.3 |
| other exception in a tool | `internal error: <message>` | `error` event | R11.6 |
| `listing.json` rename fails (disk) | `internal error` (never a partial file: temp + rename) | none | R3.3 |

## `server.ts` wiring [R1]

```ts
// first statements, before any other import is evaluated (dynamic imports follow):
console.log = console.info = console.debug = (...a) => console.error(...a);                  // R1.3
const runDir = process.env.RUN_DIR;  if (!runDir || !isDirectory(runDir)) die("RUN_DIR ...");  // R1.1
const { bootNodeCore } = await import("../../src/emu/node.ts");
const { createTools } = await import("./tools.ts");
const core = await bootNodeCore();                                                            // R1.4
const tools = await createTools(core, path.resolve(runDir)).catch(die);                      // R2.4
const server = new Server({ name: "c64", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: tools.list() }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const r = await tools.call(req.params.name, req.params.arguments);
  return { content: [{ type: "text", text: r.text }], isError: r.isError, structuredContent: r.data };
});
await server.connect(new StdioServerTransport());
process.stdin.on("end", () => process.exit(0)); process.on("SIGTERM", ...); process.on("SIGINT", ...);  // R1.5
```

The low-level `Server` (marked `@deprecated` in the SDK typings in favour of `McpServer`) is used on purpose.
`McpServer.registerTool` validates arguments before the handler runs and answers a failure itself (checked in
`sdk/dist/esm/server/mcp.js`, `validateToolInput`), so the server could neither count malformed calls (R11.4) nor
write the `malformed` event (R11.1). `tools.call` never throws, so the handler needs no try/catch of its own.
`DEFAULT_INHERITED_ENV_VARS` in the SDK's stdio client does not include `RUN_DIR`: the stdio test and any
launcher must pass it in `env` explicitly.

## Why the keyboard is not a side door [R6.2, R8, R3.5]

Text reaches the machine through exactly three calls: `loadCanonical` (canonical listing only; reached from
`c64_reload`, `c64_run`, `apply_patch` and crash recovery), `runListing` (which begins with `loadCanonical`), and
`pressKeys` (only keys in `spec.titlePredicate.keys`). A press can leave characters at the READY prompt, but every
verdict-bearing path (`c64_run`) starts with `NEW` and a fresh `loadCanonical`, then dumps BASIC memory for
clause 6 after typing. A press therefore cannot change what `contract` judges, and `state.json` (which a press
does write) feeds nothing. The agent never sees or supplies post-title keys, and `runListing` presses them
itself.

## Correctness properties

Each property is linked to the requirements it checks and to the test that carries it. "Real core" tests are
example-based on the headless c64-ready core (property runs would cost a boot-scale wait per case); "stub core"
properties use fast-check with `numRuns ≥ 100` on a `C64Core` that only accepts typed keys (`step` drains the
queue, `peek` returns 0), which is enough for everything except a run.

| Id | Property | Req | Test |
|---|---|---|---|
| P1 | Canonical-only typing: after `c64_reload`, an accepted `apply_patch` and `c64_run`, `dumpBasic(core)` equals `tokenizeProgram` of the typeable canonical lines, whatever was pressed or read before. | R5.2, R6.2, R10.6 | `mcp-tools.test.ts` (b), real core |
| P2 | Refused patch is a no-op: lines, hash, provisional, `postTitle`, `contract` and BASIC memory are unchanged; only `iteration` grows by 1. | R10.5, R3.4 | `mcp-tools.test.ts` (c), real core |
| P3 | Verdict provenance: `contract` changes only in `c64_run` (to `judge`) or on an accepted/forced patch (to NOT-RESURRECTED before-run); `c64_read_screen`, `c64_press`, `checksum_line`, a refused patch and a restart leave it unchanged. | R3.5, R3.7, R4.2, R8.4, R2.5 | `mcp-tools.test.ts` (a)(c)(e)(k)(l) |
| P4 | Replay: re-applying every `proposal`/`gate` pair of `events.jsonl` from `input.json`'s lines reproduces every gate `hash` and verdict. | R4.4, R4.5, R10.3 | `mcp-server.prop.ts`, stub core |
| P5 | Restart idempotence: a new `createTools` on the same `RUN_DIR` after any call sequence yields a `listing.json` equal to the one before the restart. | R2.3, R2.5, R3.1 | `mcp-server.prop.ts`, stub core; `mcp-tools.test.ts` (e) |
| P6 | Provisional is monotone and follows the line: no patch makes a line provisional; a renumber or swap moves the flag with the line; only a `postTitle: "pass"` run clears it. | R3.8 | `mcp-tools.test.ts` (f)(j), real core; also checked in P4's stub run |
| P7 | Malformed-counter model: for any sequence of well-formed and malformed calls, the run is over exactly after the first window of 3 consecutive malformed calls, and from then on every call errors and writes nothing. | R11.3, R11.4, R11.5 | `mcp-server.prop.ts`, stub core; `mcp-tools.test.ts` (h) |
| P8 | Gate parity: for any patch and refusal counts, the server's verdict, reason and resulting listing equal a direct `applyPatch()` call with the same inputs; refused text equals `reason` byte for byte. | R10.4, R10.5, R10.8 | `mcp-server.prop.ts`, stub core; `mcp-tools.test.ts` (g) |
| P9 | Press is all-or-nothing and gated: a press with any key outside the allowed set queues nothing (stub `pendingKeys` unchanged), writes no event, and never reaches `core.queueKeys`. | R8.2 | `mcp-server.prop.ts`, stub core; `mcp-tools.test.ts` (d) |
| P10 | Crash budget: across any number of process restarts a run survives exactly one emulator crash; the second ends the run. | R2.6, R12.1, R12.3 | `mcp-tools.test.ts` (i), real core with a throwing wrapper |
| P11 | Isolation: only the files of R13.1 exist in `RUN_DIR` after a session, no `.tmp` remains, and no module of `mcp/c64-server/` imports a forbidden module. | R3.3, R13.1, R13.2 | `mcp-tools.test.ts` (o)(p) |

## Test design

- **Fixture** (`tests/fixtures/mcp-fixture.ts`, original 2026 BASIC, no magazine text): a four-line program,
  `10 PRINT"{CLR}NIGHTJAR"`, `20 GETA$:IFA$=""THEN20`, `30 PRINT"LAUNCHED"`, `40 END`, with `printed` computed in the
  fixture by `computeChecksum`, `status: "verified"`, `source: "ocr"`. Spec: `expectedLines [10,20,30,40]`,
  `titlePredicate { screenContains: "NIGHTJAR", keys: [32] }`, `postTitle { keys: [32], screenContains: "LAUNCHED" }`.
  Variants: a line with a deliberate syntax error (double-space error text, R6.6); a line with `{CLR}` outside quotes
  (untypeable); a provisional line; a line whose printed checksum is wrong (gate refusal and `force_unverified`).
- **`makeRun(dir?)`** writes `input.json` into a fresh `mkdtemp` directory and returns the paths; the test removes the
  directory in `afterEach`. `refusals.json` is written by the test, as the hook would.
- **`StubCore`** implements `C64Core`: `boot` no-op, `queueKeys` records, `step` drains the queue, `pendingKeys`
  returns the queue length, `peek` returns 0. It is only used where no run is needed (P4, P5, P7, P8, P9).
- **`throwingCore(real, { onStep })`** wraps a real core and throws a plain `Error` on the N-th `step`; `boot()` is
  forwarded. It drives P10 and (i).
- **Restart** in a test is a second `createTools(core, dir)` on the same directory, which is exactly what a new
  process does (the only difference, a fresh emulator, is irrelevant because the listing is re-typed).
- **Replay helper** (test-only, in `mcp-server.prop.ts`): folds `events.jsonl` over `input.json` with `applyPatch`
  and compares each recomputed `canonicalHash` with the gate event's `hash`.
- **Stdio test**: `StdioClientTransport({ command: process.execPath, args: ["mcp/c64-server/server.ts"], cwd: repoRoot,
  env: { ...getDefaultEnvironment(), RUN_DIR } })`, then `client.listTools()` (6 names, in order),
  `client.callTool({ name: "checksum_line", arguments })`, `client.close()`, and the exit code. A second spawn with
  no `RUN_DIR` checks R1.1.
- **Measurements** (R14.5): the test file header records the measured wall time of `bootNodeCore()`, one default
  `c64_run` and one 20000-frame `c64_run`. The numbers are written after the first green run, never estimated.

## Traceability (requirement group → module)

| Group | Module(s) |
|---|---|
| R1 process, transport | `server.ts`, `tools.ts` (`createTools`, serial chain) |
| R2 start-up, restart | `tools.ts` (`createTools`), `rundir.ts` (read/validate, events scan), `schemas.ts` |
| R3 `listing.json` | `rundir.ts` (hash, atomic write), `tools.ts` (`writeListing`, `beforeRunContract`) |
| R4 `state.json`, events | `rundir.ts` (`appendEvent`, `writeState`), `tools.ts` |
| R5–R9 tools | `tools.ts` handlers, `render.ts` text, `schemas.ts` arguments |
| R10 `apply_patch` | `tools.ts` (`applyPatchTool`), `rundir.ts` (`readRefusalCounts`) |
| R11 validation, run-over | `tools.ts` (`call`), `schemas.ts` |
| R12 crash recovery | `tools.ts` (`withEmu`) |
| R13 isolation | `rundir.ts` (only `node:` importer), import-audit test |
| R14 tests | `tests/unit/*`, `tests/prop/*`, `tests/fixtures/mcp-fixture.ts` |

## Decisions and open points

- **Strict op schema.** `apply_patch` accepts only `replace` and `renumber`, 1–4 ops, by zod. The gate's R4.6
  ("insert is recovery-only") and R4.2 reasons remain reachable through the hook and through the gate's own
  tests; here those inputs are malformed calls. If the product prefers the agent to read the gate's insert
  explanation, the op schema can be loosened to a string and the gate becomes the only judge, at the price of
  weaker advertised schemas.
- **`iteration` excludes malformed calls.** Chosen so a typo does not spend a fix attempt; the runner's own count
  (which sees hook-refused calls the server never receives) remains the budget authority.
- **Before-run `failed` is a placeholder** (empty resident image). Readers must use `contract.state` and
  `heading`, not `failed`, until a run has happened. Measured `failed` clauses come only from `c64_run`.
- **Time limits.** The server sets none; the 20000-frame cap bounds a run. If the measured max-frame run exceeds
  the client's tool timeout, lower the cap (R6.1) from the measured number.
