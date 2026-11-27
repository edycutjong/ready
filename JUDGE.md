# SYNTAX ERROR IN 20, for judges

Written for a judge with three minutes. No setup: no account, no install, no key. Every claim below points at the page
or the file that shows it.

## The 30-second test

**What:** a Kiro agent repairs the lines OCR misread in 1984 magazine type-in programs, but it can change a line only
through a gate that checks it against the checksum the magazine printed beside it, and a real C64 core then runs the
program and decides the verdict (the hosted site plays back recorded runs; a clone runs the C64). **Who:** anyone typing a listing back in from a scan;
[`/scan`](https://ready.edycu.dev/scan) checks a page's lines against their printed checksums in your browser today.
**Why:** an LLM asked to fix a listing can write a line that runs and is wrong, and a plain fix loop has nothing that
checks it; here the model only proposes, and two checks it cannot argue with, the 1984 printout and the machine, decide.

**Video:** [2 min 46 s on YouTube](https://youtu.be/Jv69K3jQ6QI). Kiro is on screen at
[1:05](https://youtu.be/Jv69K3jQ6QI?t=65) (the specs, and what Kiro caught) and
[1:22](https://youtu.be/Jv69K3jQ6QI?t=82) (the agent, its tools and its hooks).

## Where each judging criterion is answered

| Criterion | Open | What you will find |
|---|---|---|
| Potential Impact | [`/scan`](https://ready.edycu.dev/scan) | A real June 1984 COMPUTE!'s Gazette page (archive.org's scan, fetched on demand) or your own scan, read by tesseract.js in your tab. A line gets ✓ if its recomputed sum equals the printed `:rem` (or ✓ digits misread if it fits only a misread printed digit); you fix the flagged lines by hand and export a `.bas` and an errata sheet. MIT licensed, nothing to install |
| Technological Implementation | [Kiro, impossible to miss](#kiro-impossible-to-miss), [`/kiro`](https://ready.edycu.dev/kiro), [`docs/EXPERIMENTS.md`](docs/EXPERIMENTS.md) | 4 Kiro specs, a custom agent limited to 6 MCP tools, 4 hooks (one refuses a patch with exit 2), steering, a skill, a workflow and a Power; 18 experiment runs, each arm changing one thing (model, loop control, context, steering) |
| Design | [`/`](https://ready.edycu.dev) | A candle-lit galley proof: the failing line is struck in blood-red proof ink and re-inks blue when the gate accepts the patch; each listing is a headstone with its cause of death; the run ends in a certificate of resurrection and an **IT LIVES** stamp (the README's GIFs show the re-ink, certificate and stamp; the headstone picker is on `/`). Lighthouse CI gates all five routes on every push ([`lighthouserc.json`](lighthouserc.json)) |
| Innovation | [`docs/EXPERIMENTS.md`](docs/EXPERIMENTS.md) (E0) | The judge is the checksum printed in 1984 plus the machine's own screen and memory: the model chooses where to look, code decides what is true. On the real 1984 page, search without a model fixed 3 of 18 failing lines; the agent made all 18 checksum-consistent (N=2) |
| Presentation | [video](https://youtu.be/Jv69K3jQ6QI), [README](README.md), [landing](https://ready.edycu.dev/landing/), [deck](https://ready.edycu.dev/deck/) | The README's three GIFs are captures of the live site at 1× speed |

## In the browser (about 60 s)

Open **https://ready.edycu.dev**, laptop or phone. The page says **RECORDED PLAYBACK**: these are real Kiro runs,
recorded, and no C64 runs in your browser (see [Honest limits](#honest-limits)).

1. **Watch.** The Last Seance plays itself once. Line 20 of our typeset 1984-format page is struck in red
   (`PRIMT™`: `PRIMT` is our planted misprint, `™` is how OCR read the quote) and the C64 pane says
   `?SYNTAX  ERROR IN 20`. The agent's patch appears under the struck line and re-inks blue when the gate accepts it
   (`20: checksum 159 = printed 159`); then the program's own screen, the certificate and the **IT LIVES** stamp,
   captioned "as recorded". **Resurrect** replays it.
2. **Cheat.** Press **Cheat: delete the error line**: `REFUSED (R4.4)`, deletion is a hard refusal. It is the
   same gate code the Kiro Pre Tool Use hook runs, here in your tab.
3. **Beat the gate.** The **fix it yourself** box holds line 20 as OCR read it. **Judge my line** as it is:
   REFUSED, no C64 key types `™`. Change `™` to `"`: REFUSED, printed `:rem 159`, computed 158. Change `PRIMT` to
   `PRINT`: ACCEPTED, 159 = 159. `THE LOST SEANCE` is refused by the checksum, `20 PRINT"IT LIVES"` by the 40% edit cap.
4. **The checksum knows where to look.** Pick **The Ossuary**: the C64 blames line 19, but the red checksum
   cross is on DATA line 890 (we printed a period for a comma). Judge line 19 as read: "already matches its printed
   checksum (135 = 135): the misprint is not in this line". **The Ninth Knock** has a DATA misprint that runs with no
   error and prints `IT NIVES`: the C64 never complains, the printed checksum flags it.
5. **Kiro's own log.** Open **/KIRO HOOKS** ([`/kiro`](https://ready.edycu.dev/kiro)): every hook firing of the three
   runs in time order, written by the hook processes, not the model, with the tool calls and credits from Kiro's own
   stream between them. Look for
   `checksum-gate (kiro-pre-tool-use) exit 0 · accepted` and, in The Ossuary,
   `until-title (kiro-stop) exit 0 · block`: Kiro's Agent Stop hook refusing to let the agent stop before it had run
   the program.

**Then, the part you could use tomorrow:** open **CHECK A PAGE (ASSISTED)**
([`/scan`](https://ready.edycu.dev/scan)) and press **Read the real 1984 page** (or **Read our authored page**, or
upload your own scan). tesseract.js reads it in your tab; each line gets ✓ or ✗ against its printed `:rem`; edit a ✗
line and its checksum is rechecked on every keystroke; download the `.bas` and the errata. No Kiro call, 0 credits.

Step-by-step detail and the commands behind every number: [`DEMO.md`](DEMO.md).

## Kiro, impossible to miss

`.kiro/` sits at the repo root and is committed. Kiro wrote the specs, `src/basic/`, the MCP tools (tasks 1–5), the
first agent profile, `resurrector.md` and the skill. The gate, the contract, the hook scripts, `server.ts` and REPLAY
were written claude-direct (Claude Code) and are labelled so; who wrote what, session by session with credits, is in
[`docs/DX-REPORT.md`](docs/DX-REPORT.md). Every prompt sent to Kiro through P1c is in [`prompts/`](prompts/), in order.

| Kiro feature | In this repo | What it did here | Evidence |
|---|---|---|---|
| Feature specs | [`.kiro/specs/checksum-oracle/`](.kiro/specs/checksum-oracle/), [`c64-mcp-server/`](.kiro/specs/c64-mcp-server/), [`resurrect-loop/`](.kiro/specs/resurrect-loop/) | Kiro wrote all three (requirements, design with correctness properties, tasks), then built the tokenizer and checksum (`src/basic/`, tasks 1–6) and the MCP tool layer (tasks 1–5). Before writing the tokenizer it probed the real C64 core and found three places where our spec was wrong about the machine | [`docs/DX-REPORT.md`](docs/DX-REPORT.md) (day 1, P1b), [`tests/unit/tokenizer-rom.test.ts`](tests/unit/tokenizer-rom.test.ts), [`prompts/README.md`](prompts/README.md) |
| Bugfix spec | [`.kiro/specs/bugfix-boot-detect/`](.kiro/specs/bugfix-boot-detect/) | Current / Expected / Unchanged for two boot-detection bugs we measured; Kiro wrote the spec and the fix (tasks 1, 4, 5). Our re-judge then caught a stale-screen bug in that fix, fixed claude-direct | [`tests/unit/boot-detect.test.ts`](tests/unit/boot-detect.test.ts), [`evidence/boot-detect/`](evidence/boot-detect/) |
| Custom agent | [`.kiro/agents/resurrector.json`](.kiro/agents/resurrector.json) | The runtime agent (claude-sonnet-5.5): its only tools are `@c64`; file read, shell, file write and web are denied; three hooks are declared inline | [`tests/unit/resurrector-profile.test.ts`](tests/unit/resurrector-profile.test.ts), [`evidence/spikes/spike-G.json`](evidence/spikes/spike-G.json) |
| MCP server | [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) → [`mcp/c64-server/`](mcp/c64-server/) | Six tools over a headless C64: `c64_reload`, `c64_run`, `c64_read_screen`, `c64_press`, `checksum_line`, `apply_patch` | [`tests/unit/mcp-tools.test.ts`](tests/unit/mcp-tools.test.ts), [`tests/unit/mcp-stdio.test.ts`](tests/unit/mcp-stdio.test.ts); the tool calls on [`/kiro`](https://ready.edycu.dev/kiro) |
| Pre Tool Use hook `checksum-gate` | [`scripts/hooks/checksum-gate.mjs`](scripts/hooks/checksum-gate.mjs) → [`src/gate/checksum-gate.ts`](src/gate/checksum-gate.ts) | Runs the same gate as the server and the browser on every `apply_patch` before it reaches the server: exit 2, with the gate's reason on STDERR, refuses it and the server never sees the call | [`tests/unit/hooks.test.ts`](tests/unit/hooks.test.ts) (exit 2 on a deletion and on a checksum mismatch), [`evidence/spikes/spike-K1.md`](evidence/spikes/spike-K1.md) (real `kiro-cli`: the refused call is absent from the server's log) |
| Agent Stop hook `until-title` | [`scripts/hooks/until-title.mjs`](scripts/hooks/until-title.mjs) | The model cannot declare success: the hook blocks the stop until the server's contract says RESURRECTED, only unfixable lines remain, or a cap hits (15 attempts, 8 credits, 600 s) | [`evidence/spikes/spike-K2.md`](evidence/spikes/spike-K2.md); [`docs/EXPERIMENTS.md`](docs/EXPERIMENTS.md) E2: it blocked a premature stop in 13 of the 17 runs outside E3 |
| Session Start hook `listing-context` | [`scripts/hooks/listing-context.mjs`](scripts/hooks/listing-context.mjs) | Hands the agent the listing with each line's printed checksum and status; never a reference transcript | the `listing-context` rows in [`public/runs/`](public/runs/) and on [`/kiro`](https://ready.edycu.dev/kiro) |
| File Save hook `prop-tests-on-save` | [`.kiro/hooks/prop-tests-on-save.json`](.kiro/hooks/prop-tests-on-save.json) | After a save under `src/basic` or `src/gate`, runs the property tests | [`evidence/hooks/file-save.jsonl`](evidence/hooks/file-save.jsonl): 4 firings: the first 3 exited 1 (the property-test include was not configured yet), the 4th passed 11 property tests |
| Steering | [`.kiro/steering/`](.kiro/steering/) (7 files) | Commodore BASIC V2, Gazette notation and the resurrector's rules; three files are resources of the agent. Six were written claude-direct, `resurrector.md` by Kiro | [`docs/EXPERIMENTS.md`](docs/EXPERIMENTS.md) E4: removing `commodore-basic-v2.md` showed no measurable difference at N=2 |
| Skill | [`.kiro/skills/petscii-notation/`](.kiro/skills/petscii-notation/) | PETSCII control-code notation; the agent loads it at run time | `Load skill: petscii-notation` in two of the three recorded runs on [`/kiro`](https://ready.edycu.dev/kiro) (The Last Seance, The Ninth Knock) |
| Workflow | [`.kiro/workflows/resurrect-ab.workflow.yaml`](.kiro/workflows/resurrect-ab.workflow.yaml) | Two experiment arms in parallel plus an aggregator (recipe written claude-direct); ran once headless through `run_workflow` | [`evidence/experiments/workflow-run-2026-11-26.md`](evidence/experiments/workflow-run-2026-11-26.md) |
| Power | [`powers/c64-resurrect/`](powers/c64-resurrect/) | Packages the skills and the MCP server. Installed, both skills appear; its MCP server does not connect | [`evidence/power/activation-2026-11-26.md`](evidence/power/activation-2026-11-26.md) |

The receipts: 9 of 9 eval cases pass, and 12 of 12 model runs with the shipped profile ended RESURRECTED
([`docs/EVALS.md`](docs/EVALS.md)); every recording re-judges with 0 mismatches (README, Engineering Rigor).

## Verify it yourself (from a clone)

Node ≥ 22.18. No Kiro account, no key, no credits.

```bash
git clone https://github.com/edycutjong/ready && cd ready && npm ci
npm test                                      # Test Files 45 passed (45) · Tests 520 passed | 1 expected fail (521), about a minute
node scripts/eval-agents.mjs --deterministic  # last line: {"summary":{"deterministic":"7/7","model":"0/0"}}
node scripts/rejudge-runs.mjs                 # {"runs":20,"ok":20,"mismatches":0,...}: every public recording re-run on the real C64 core
npm run dev                                   # http://localhost:5173 now says REPLAY: your browser's C64 re-runs every accepted patch
```

Captured on a fresh clone of `7c9ec3c`: [`evidence/tests/fresh-clone-2026-11-27.txt`](evidence/tests/fresh-clone-2026-11-27.txt).
On Node 22, `npm ci` prints an engine warning for `c64-ready` (it asks for ≥ 24.14); CI runs the suite on Node 22 and
24. The 1 expected fail is a known title-detection limit kept as a test (README, Honest limits 7). A clone re-judges 20
recordings; the README's 35 include 15 Gazette-derived ones that stay on the builder's machine (rights).

## Honest limits

1. **The live site is recorded playback.** No Commodore ROM is hosted (rights), so nothing runs on a C64 in your
   browser there; the page says RECORDED PLAYBACK and the stamp says "as recorded". A clone does run the C64
   (`npm run dev`, `rejudge-runs.mjs`).
2. **The three runs on `/` are pages we typeset** in the 1984 format with planted misprints, read by real OCR. The one
   real 1984 page the agent repaired (eval case 1, 3 of 3 TITLE-PATH RESURRECTED) is not in this repository, nor are its
   OCR output and run files (rights), so it cannot be reproduced from a clone. On it, 19 of 28 lines are source-exact
   against a vision-read reference; the rest are checksum-consistent, not proven identical.
3. **`/scan` withholds the agent's repair** and leaves the fixing to you. It fetches the 1984 page from archive.org on
   request through [`api/page.js`](api/page.js), which writes nothing to disk; its CDN keeps a copy for up to a day (and may serve a stale one for up to a week while it refreshes). On that page tesseract.js misreads most lines: at 1600 px, 16 of the 83 lines it read
   matched their printed checksum ([`evidence/spikes/spike-P-ocr-live.json`](evidence/spikes/spike-P-ocr-live.json)).
4. **No recorded run of the shipped agent contains a hook refusal.** The agent is told to test each candidate with
   `checksum_line` before sending it, and every gate event in [`public/runs/`](public/runs/) and
   [`evidence/evals/runs/`](evidence/evals/runs/) is `accepted`. The exit-2 path is shown by the tests and by the day-1
   probe sessions ([`spike-K1.md`](evidence/spikes/spike-K1.md), [`record-run-probe.jsonl`](evidence/spikes/record-run-probe.jsonl));
   the refusal you see on screen is Cheat.
5. **Headless, Kiro's Agent Stop hook forces one more turn per prompt, not a loop**, so `scripts/record-run.mjs`
   resumes the session between cycles. In the 17 runs outside E3 it never had to.
6. **The video is older than this repo.** It was cut on 2026-11-25 at evals release 1, so its receipts read 492 tests
   and 6 of 6 model runs; the figures here (520 tests + 1 expected fail, 12 of 12 model runs) are from the later code.
   Its description names three specs: the bugfix spec was written the next day.
7. **Small N:** N=3 per eval case and N=2–3 per experiment arm, on one machine: directions, not rates.
8. **Kiro coverage:** every Kiro session ran in `kiro-cli`; the Kiro IDE was not used. Two spec lines reached or neared
   their credit caps (51.26 of 50, 68.71 of 70), and the tasks after that were written claude-direct and labelled.
   `resurrect-loop` tasks T2–T6 and `c64-mcp-server` task 8 are still open in their `tasks.md`.

## Links

- Live: https://ready.edycu.dev · [`/scan`](https://ready.edycu.dev/scan) · [`/kiro`](https://ready.edycu.dev/kiro) · [landing](https://ready.edycu.dev/landing/) · [deck](https://ready.edycu.dev/deck/)
- Video: https://youtu.be/Jv69K3jQ6QI
- Write-up: [I gave a Kiro agent a Commodore 64 and a checksum it can't argue with](https://dev.to/edycutjong/i-gave-a-kiro-agent-a-commodore-64-and-a-checksum-it-cant-argue-with-5hbn) (dev.to)
- Repository (MIT): https://github.com/edycutjong/ready · [`README.md`](README.md) · [`DEMO.md`](DEMO.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md)
