# Developer-experience report — building with Kiro

A running log of what Kiro did on this project, what it cost and what we learned. Credits come from kiro-cli streams
(`credits.usage`). Numbers measured on the 1984 magazine page (OCR rates, checksum matches, byte counts) come from
local runs whose raw output contains magazine text and therefore stays out of this repository (rights); they are
reported here and in `evidence/spikes/` as counts only.

## Build day 1 — Wed 25 Nov 2026 (WIB)

### Kiro sessions
Every Kiro session in this report ran in kiro-cli. The Kiro IDE, Kiro Web and Kiro Crew were not used.

| # | Surface | What | Model | Credits | Wall |
|---|---|---|---|---|---|
| 1 | `kiro-cli chat --no-interactive` (engine v3) | Feature spec `checksum-oracle`: EARS requirements, an analyze-requirements pass (contradictions resolved in the text), design with 7 correctness properties, 12 tasks | claude-sonnet-5.5 | 22.35 | 1162 s |
| 2 | `--v3 --no-interactive --agent probe` | Spikes K1 + K2: MCP tool loading, Pre Tool Use gate (exit 2), permission deny, Agent Stop hook | claude-sonnet-5.5 | 0.73 | 25 s |
| 3 | same, Stop hook asked to block 3× | Spike K2b | claude-haiku-5.5 | 0.06 | — |
| 4–5 | `--v3` without profile; plain `--no-interactive` | Spike K3 metering | claude-haiku-5.5 | 0.03 + 0.01 | — |
| 6 | `scripts/record-run.mjs` on the probe | Recorder test: 2 cycles, session resumed | claude-haiku-5.5 | 0.13 | 30 s |
| 7 | `--v3 --no-interactive --effort medium` | Tasks 1–6 of `checksum-oracle`: types, keyword table, tokenizer, notation, checksum + 223 tests | claude-sonnet-5.5 | 28.91 | 1171 s |
| 8 | `--v3 --no-interactive --effort low` | One doc-comment edit to `checksum.ts`, to show the File Save hook passing | claude-haiku-5.5 | 0.07 | — |
| | | **Day-1 total** (rows rounded) | | **52.28** | |

### What Kiro did that we would not have
- **It checked the spec against the machine.** Before writing the tokenizer, Kiro wrote probe scripts that typed
  lines into the real C64 core and read memory back. It found three places where our own spec was wrong
  (abbreviation shape: `P`+shift-R is `PRINT#`, not `PRINT`; stray bytes ≥ `$80` are dropped, not copied; which
  keywords are safe to abbreviate) and locked each one in `tests/unit/tokenizer-rom.test.ts`.
- **The result is exact on what we can check.** Checked outside the repo against machine-read transcripts of the
  June 1984 page (vision OCR, not a hand read): the checksum oracle matches 111/111 printed `:rem` values (43 + 68
  lines), and the tokenizer's image of the 28-line title path is byte-equal to what the C64 holds after typing it
  (749 bytes). The rule itself was hand-checked on 10/10 lines in the kill test (before the build) and on 3 lines of
  our own test listing.

### Kiro mechanisms, measured headless (kiro-cli 3.5.0) — `evidence/spikes/`
- **Pre Tool Use hook** on `@c64/apply_patch`: exit 2 blocks the call and returns STDERR to the model; the MCP
  server never sees it. **PASS.**
- **Permissions:** a denied MCP tool returns "Blocked by a permission rule"; an exact `--trust-tools` list works
  without `--trust-all-tools`; V3's on-demand `tool_load` is not blocked by the exact list. **PASS.**
- **Agent Stop hook:** `{decision:"block"}` forces **one** extra turn per prompt and does not fire again at the end
  of that turn (K2b asked it to block 3 times: it fired once). **PARTIAL.** So our recorder resumes the same
  session with the stop predicate's reason between cycles; the Stop hook still forces the first continue.
- **Metering:** `credits.usage` is present on all three invocation styles we use. **PASS.**
- **File Save hook** (`prop-tests-on-save`): it fired once each for `types.ts`, `keywords.ts` and `tokenizer.ts`
  when Kiro saved them with its file tool; those three runs exited 1 because the property-test include was not
  configured yet (Kiro fixed the config later in the same session). `notation.ts` and `checksum.ts` were written
  through Kiro's shell tool and logged no firing. A later one-line Kiro edit of `checksum.ts` fired it cleanly:
  exit 0, 11 property tests passed, 36 s. Log: `evidence/hooks/file-save.jsonl`.

### Where we stopped using Kiro, and why
Credits per session were far above our per-call estimate (0.25–2.1 per call; a spec or task session cost 22–29).
The `checksum-oracle` line was capped at 50 credits; after tasks 1–6 it stood at 51.26. Tasks 7–12 (the patch
gate, the contract, the cross-module and KERNAL property tests) were therefore written **claude-direct**, against
Kiro's spec and requirement ids, and are labelled so in their commits and in `tasks.md`.

### What the property tests found on the real C64 (claude-direct tasks 11–12)
The P3 property (tokenizer bytes = the C64's memory after typing) found four real-machine edges in damaged OCR
lines: a body starting with a digit merges into the line number; a control code outside quotes is executed by the
screen editor (`{CLR}` wiped the line being typed); trailing blanks are dropped by the editor; and a body with
nothing typeable is a bare line number, which **deletes** the line. The last one was a hole in the gate (a body of
only untypeable characters passed the deletion check) and is now refused. All four are pinned in
`tests/unit/core-typing-edges.test.ts`.

### Who wrote what (so nothing claude-direct reads as Kiro's)
Kiro (kiro-cli sessions, prompts kept with the build log): the `checksum-oracle` spec, `src/basic/{types,keywords,
tokenizer,notation,checksum}.ts` and their tests. **claude-direct** (Claude Code, not Kiro): the steering files and
hook definitions (commit `fbfac9f`, titled "Kiro steering …", means steering files *for* Kiro: they were written
claude-direct; four of the seven files existed before Kiro's first session, whose prompt tells it to read `.kiro/steering/*.md` first, and `product.md` and `commodore-basic-v2.md` were committed in `832e72d`, after its first two sessions),
`src/emu/*`, the recorder (`runner/`, `scripts/record-run.mjs`), the day-1 probe MCP server, the
gate and contract (`src/gate/*`, tasks 7–12), the property tests for tasks 9–12, the trailing-blank and
`controlOutsideQuotes` additions to `src/basic`, CI/deploy config and this report. Commit `18aaa84` says "production
deploy of main via GitHub Actions": the workflow exists, but Actions cannot run on this account yet (billing), so
day-1 production deploys were made with `npm run deploy:prod` (`vercel build`, `scripts/check-no-rom.mjs`,
`vercel deploy --prebuilt --prod`).

## Build day 1, continued — P1b core flow (Wed 25 Nov 2026, WIB)

### Kiro sessions
| # | Surface | What | Model | Credits |
|---|---|---|---|---|
| 9 | `kiro-cli chat --v3 --no-interactive --effort medium` | Feature spec `c64-mcp-server`: EARS requirements + analyze-requirements pass, design with 11 correctness properties, 8 tasks | claude-sonnet-5.5 | 42.95 |
| 10 | same, `--effort low` | Tasks 1–5 of `c64-mcp-server`: zod schemas, RUN_DIR file contract, `createTools` with the 6 tools, `apply_patch` behind the gate; 138 tests | claude-sonnet-5.5 | 25.76 |
| 11 | same, `--effort medium` | Feature spec `resurrect-loop` (EARS + analyze pass, design, 6 tasks) + the `resurrector` V3 profile, steering `resurrector.md`, skill `petscii-notation` | claude-sonnet-5.5 | 12.69 |
| G1 | `scripts/record-run.mjs` → `--v3 --no-interactive --agent resurrector` | Spike G attempt 1 on the June 1984 title path: TITLE-PATH RESURRECTED; the recorder (ours) crashed after the cycle | claude-sonnet-5.5 | 2.48 |
| G2 | same | Spike G attempt 2 = the K3 cost session: TITLE-PATH RESURRECTED, 5 `apply_patch` calls, 67.6 s, 1 cycle | claude-sonnet-5.5 | 2.20 |

### Measured headless (kiro-cli 3.6.0 — the K1–K3 probes ran on 3.5.0; `evidence/spikes/spike-G.json`)
- The custom agent loads MCP tools on demand and works only through them: attempt 2 made 20 `checksum_line`, 5
  `apply_patch` and 3 `c64_run` calls; every patch was accepted by the gate (no refusal happened, so the on-screen
  refusal stays Cheat).
- **All three inline hooks fire headless:** Session Start (`listing-context`) 1× per session (a second logged firing
  was the recorder's own `--context` spawn of the same script; it is now labelled `runner-context`), Pre Tool Use on
  `@c64/apply_patch` (`checksum-gate`) 5× exit 0, Agent Stop (`until-title`) 1× — it allowed the stop because the contract computed by
  the MCP server was RESURRECTED.
- Kiro's own scope rule denied its write to `.kiro/settings/mcp.json`; Kiro reported it and gave the exact content,
  which we wrote (claude-direct).
- One Sonnet spec session cost 12.69–42.95 credits; reading less (a named file list, no exploring) cost less.

### What the build found
- tesseract.js 7 (psm 6) read a printed `PR1NT` as `PRINT`: its dictionary "fixed" the planted misprint, so it never
  reached the C64. The authored page plants `PRIMT` instead; OCR also read its quote as `™` (`fixtures/authored/`).
- Search without a model (E0) made 3 of the 18 failing title-path lines checksum-consistent; the agent made all 18
  checksum-consistent and the title path RESURRECTED (`evidence/experiments/e0.json`, `docs/EXPERIMENTS.md`).
- Checksum-consistent is not source-exact: 19/28 of the resurrected title path equal the reference transcript.
- Both G recordings ran with the first profile (built-in `read` trusted, 0 read calls made); the shipped profile is the
  tightened one, re-smoked before the hero recording.

### Who wrote what (P1b)
Kiro: the `c64-mcp-server` and `resurrect-loop` specs, `mcp/c64-server/{schemas,rundir,render,tools}.ts` and their
tests (tasks 1–5), `.kiro/agents/resurrector.json` as first written (QA r1 tightened it claude-direct: no `read` tool, `fs_read` denied), `.kiro/steering/resurrector.md`, `.kiro/skills/petscii-notation/`.
**claude-direct:** the `c64-mcp-server` credit line hit 68.71 of 70 after task 5, so tasks 6–7 (crash recovery,
`server.ts`, stdio + crash tests) are claude-direct and labelled in `tasks.md` and the commits; `.kiro/settings/mcp.json`;
the hook commands `scripts/hooks/{checksum-gate,until-title,listing-context}.mjs`; the REPLAY engine (`src/replay/{replay,certificate}.ts`) and desk UI; OCR + lost-line recovery (`src/ocr/recover.ts`, `scripts/recover-listing.mjs`);
the recorder fixes; `scripts/{make-run-input,typeset-authored,e0-search,source-check,e2e-replay}.mjs`.

### Tightened after QA round 1 (P1b)
- The agent profile no longer grants the built-in `read` tool and denies `fs_read` outright (it had been a blocklist;
  the G runs made 0 read calls). The listing reaches the agent only through the Session Start hook and the MCP tools.
- Only CHECKSUM refusals are charged to a line (a refused deletion can never unlock `force_unverified`), and the
  iteration cap counts refused calls, not lines.
- The stop rule keeps the agent working when every line is checksum-consistent but the C64 still fails.
- A run that ends with an accepted patch never RUN gets a final judge by the runner on a fresh headless C64.

### Tightened after QA round 3 (P1b, claude-direct)
- The contract heading names the listing's scope: `TITLE-PATH …` only on a title-path listing; a whole-listing scope
  (the authored line-20 page) gets no prefix.
- REPLAY refuses re-execution on a different emulator — another c64-ready version, or WASM bytes whose sha256 differs
  from the one the recorder logged — and falls back to recorded playback with the refusal shown (spec F9).
- The certificate says where every final line came from (page OCR / re-OCR of a gap / TYPED / gate-accepted Kiro
  patch), lists the lost-line recovery events and excluded orphans, names the line inventory's origin, and states —
  computed, not assumed — that no line was added during the run.
- The desk offers the errata sheet (every line changed from the OCR read, with the agent's reason) and a `.PRG`
  (load address $0801 + the same tokenized image contract clause 6 compares with C64 memory); the browser E2E checks
  the downloaded bytes.
- The run strip shows each attempt's number against the iteration cap and the agent's own reason; the run label says
  "credits: unknown" or "≥ n" instead of a silent 0.00.

### Open (spec tasks not done yet, stated so nothing reads as finished)
P1c shipped the listing picker (a recorded run plus `/scan` for the 1984 page or your own), the in-tab tesseract.js worker with
the live checksum-flag rate and the design pass; there is still no `powerbasic` page. No recorded agent run contains a gate
refusal: every gate event in all recorded runs is `accepted`. The refusal on screen is Cheat (and eval case 9 / the K1 probe).
Nothing sets `eye-verified` yet
(the gate and contract accept it; the "a person marks it against the crop" step is P3).

`c64-mcp-server` task 8 (property tests P4/P5/P7/P8/P9 + timing measurements). `resurrect-loop` T2–T6 are partly
covered by the P1b fixes above and the harness tests; the `suspect` flag (a checksum-matching patch that makes the run
worse) and `apply_patch` returning a re-run screen are not implemented — the agent calls `c64_run` after each patch, and
the stop rule refuses to stop on an unrun patch.


## P1c (2026-11-25): what Kiro did in this phase
| # | Where | What | Model | Credits |
|---|---|---|---|---|
| L20 | `scripts/record-run.mjs` → `--agent resurrector` | The shipped agent fixed the authored line-20 typo through the gated `apply_patch` (1 accepted patch, 27 s); that recording is the hero on the live URL | claude-sonnet-5.5 | 0.85 |
| EV1 | `scripts/eval-agents.mjs --model` | Evals release 1: case 3 N=3 (2.61) + case 1 N=3 (8.34), all 6 RESURRECTED | claude-sonnet-5.5 | 10.95 |
Everything else in P1c (the `/api/page` function, the design pass, the ASSISTED OCR view, the harness scripts) was written claude-direct; no Kiro IDE or spec session ran this phase. Friction: `vercel build` fails on a TypeScript function when the project uses TypeScript 7 (`@vercel/node` reads sources via `ts.sys`), so the function is plain JS.

## P1d (2026-11-25): architecture review fixes — 0 Kiro credits
No Kiro session ran in this phase. Every change below is claude-direct, made after an outside architecture review of the
shipped code and checked against the repo, the real C64 core and the live URL. The changes touch the parts the Kiro agent
runs on, so they are listed here:
- **Clause 2 (post-title)** counts only text the server's own key press produced, below the last RUN. Before, the whole
  screen counted, including the typed listing that holds the very `PRINT`.
- **Clause 4** recomputes every checksum from body + printed sum instead of trusting a stored status. A character that no
  C64 key types (an OCR glyph such as `™`, whose code is ≡ 34 mod 256, a quote) can no longer make a line "verified". The
  gate, the `checksum_line` tool and `/scan` all name it.
- **Clause 6 / the loader** never types a line outside the page inventory. It also never types into a still-running
  program: it resets to READY. first. That second fix came from re-judging every recorded run, and it made REPLAY
  independent of session history (eval case 1 run 3, see `docs/EVALS.md`).
- **REPLAY** re-runs each `c64_run` with the frame budget the run event records (`maxFrames`).
- **Certificate.** Provenance and errata follow line identity through renumbers, and say what each change rests on
  (verified / digit-misread / unverified / FORCED).
- **Freeze #2.** `evidence/freeze/freeze-2026-11-25-2.txt` pins the gate/agent files for every later
  recording. All 9 earlier recordings re-judge with 0 mismatches under it.
Tests: 492 at HEAD.

## P2 (2026-11-25): README, DEMO, ARCHITECTURE — 0 Kiro credits

No Kiro session ran in this phase; the README, `DEMO.md` and `ARCHITECTURE.md` were written `claude-direct` from the code and the
evidence files, then fact-checked against them. Takeaway for the report: the `.kiro/` artefact table in the README is the
quickest way to see what Kiro did, because every row points at a file that exists.

## P6b (2026-11-26): the post-video Kiro backlog — 84.90 credits (a lower bound: the workflow's step-agent sessions and one Haiku run were not metered), kiro-cli 3.6.0
| Kiro piece | What happened | Credits | Evidence |
|---|---|---|---|
| **Bugfix spec** `bugfix-boot-detect` | Kiro wrote `bugfix.md` (Current C1–C3 / Expected E1–E4 / Unchanged U1–U10 + a known limitation) from probes we measured on the real core: a title shown for under 50 frames was never sampled; error-shaped program output counted as a C64 error. Then Kiro did tasks 1, 4, 5 (exploration tests, the `realError` gate, a per-frame title latch). Its one shell attempt in the spec turn failed on the permission check (`--trust-tools=fs_read,fs_write`; `evidence/boot-detect/turn-12-shell-denied.json`). | 3.41 + 3.43 | `.kiro/specs/bugfix-boot-detect/`, `tests/unit/boot-detect.test.ts` |
| Review of Kiro's fix (claude-direct) | Our probe and re-judge found what Kiro's tests missed: on a reused core the latch caught the *previous* run's title (the re-judge flagged 4 per-run fact differences in one local recording; console output, not saved). Fixed by typing CLR/HOME before RUN; a second latent case (a budget spent before RUN is typed) fixed too. Then every recording re-judged with 0 mismatches (`rejudge-after.json`); latch overhead 1.01× at HEAD (static screen, N=5). | 0 | `evidence/boot-detect/`, bugfix.md "Review findings" |
| Eval cases 5 and 6 | Two original 2026 pages printed with planted misprints, typeset, read by real OCR; 3/3 each, the agent patched exactly the faulted lines and never took the line-10 dodge | 5.71 | `docs/EVALS.md` |
| Experiments E1–E4 | 18 runs, N=2 per arm: error-line-only context left the 1984 page BOOTED-PARTIAL in 2 of 2 (E3); Haiku resurrected that page in 1 of 2, at about a tenth of the credits on its metered run (E1); Kiro's Agent Stop hook forced one extra turn in 13 of 17 runs outside E3 and the runner never had to resume (E2); no steering effect shown (E4) | 68.89 | `docs/EXPERIMENTS.md` |
| `/goal` | headless: ends the turn in ~4 s, no tools, no credits reported (2 tries) | 0 reported | `evidence/experiments/goal-try-knock*.jsonl` |
| Declarative workflow (recipe written claude-direct) | `validate_workflow` is not offered headless; `run_workflow` ran the recipe end to end (parallel arms + aggregate) | 1.28 + 0.98 in arm runs | `evidence/experiments/workflow-run-2026-11-26.md` |
| Power `c64-resurrect` | installs from a folder; installed, both skills appear in the session catalogue headless; its MCP server fails to connect (suspected causes, not tested: the relative server path, and `RUN_DIR`, without which the server exits) | 1.21 | `evidence/power/activation-2026-11-26.md` |

Not done: the LIVE stretch (a Vercel Sandbox running `kiro-cli`) needs a Kiro API key, which was not confirmed
available to the builder, so LIVE stays off and the site says recorded playback. The full-listing (beyond the title
path) Gazette run is not attempted.
