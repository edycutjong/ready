# Developer-experience report — building with Kiro

A running log of what Kiro did on this project, what it cost and what we learned. Credits come from kiro-cli streams
(`credits.usage`). Numbers measured on the 1984 magazine page (OCR rates, checksum matches, byte counts) come from
local runs whose raw output contains magazine text and therefore stays out of this repository (rights); they are
reported here and in `evidence/spikes/` as counts only.

## Build day 1 — Wed 25 Nov 2026 (WIB)

### Kiro sessions
| # | Surface | What | Model | Credits | Wall |
|---|---|---|---|---|---|
| 1 | `kiro-cli chat --no-interactive` (engine v3) | Feature spec `checksum-oracle`: EARS requirements, an analyze-requirements pass (contradictions resolved in the text), design with 7 correctness properties, 12 tasks | claude-sonnet-5.5 | 22.35 | 1162 s |
| 2 | `--v3 --no-interactive --agent probe` | Spikes K1 + K2: MCP tool loading, Pre Tool Use gate (exit 2), permission deny, Agent Stop hook | claude-sonnet-5.5 | 0.73 | 25 s |
| 3 | same, Stop hook asked to block 3× | Spike K2b | claude-haiku-5.5 | 0.06 | — |
| 4–5 | `--v3` without profile; plain `--no-interactive` | Spike K3 metering | claude-haiku-5.5 | 0.03 + 0.01 | — |
| 6 | `scripts/record-run.mjs` on the probe | Recorder test: 2 cycles, session resumed | claude-haiku-5.5 | 0.13 | 30 s |
| 7 | `--v3 --no-interactive --effort medium` | Tasks 1–6 of `checksum-oracle`: types, keyword table, tokenizer, notation, checksum + 223 tests | claude-sonnet-5.5 | 28.91 | 1171 s |
| 8 | `--v3 --no-interactive --effort low` | One doc-comment edit to `checksum.ts`, to show the File Save hook passing | claude-haiku-5.5 | 0.07 | — |
| | | **Day-1 total** | | **52.28** | |

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
hook definitions, `src/emu/*`, the recorder (`runner/`, `scripts/record-run.mjs`), the day-1 probe MCP server, the
gate and contract (`src/gate/*`, tasks 7–12), the property tests for tasks 9–12, the trailing-blank and
`controlOutsideQuotes` additions to `src/basic`, CI/deploy config and this report. Commit `18aaa84` says "production
deploy of main via GitHub Actions": the workflow exists, but Actions cannot run on this account yet (billing), so
day-1 production deploys were made with `npm run deploy:prod` (`vercel build`, `scripts/check-no-rom.mjs`,
`vercel deploy --prebuilt --prod`).
