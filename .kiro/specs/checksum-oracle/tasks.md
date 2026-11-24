# Tasks — checksum-oracle

Each task is one focused edit plus its own tests. Work top to bottom; a later task may assume every earlier
task's exports exist and are tested. `npm test` (Vitest) must pass after every numbered task.

- [x] 1. Shared types
  - [x] 1.1 Create `src/basic/types.ts` exporting `LineStatus`, `CanonicalLine`, `CanonicalListing`,
    `Dropped`, `ParseBodyResult`, `TypedLineResult` exactly as in `design.md`'s "Shared types" section.
  - [x] 1.2 Add `tests/unit/types.test.ts` asserting (via `satisfies`/type-only checks compiled by `tsc
    --noEmit`, plus one runtime smoke object per type) that a `LineStatus` value outside the five allowed
    strings is a compile error, not just a runtime possibility.
  - _Requirements: R1 (preamble), R4 (preamble), R5 (preamble)_

- [x] 2. `src/basic/tokenizer.ts` — keyword table and single-line crunch
  - [x] 2.1 Export `KEYWORDS` as the 76-entry ROM-order array from R3.1.
  - [x] 2.2 Implement `crunchLine(lineNo, body, startAddr)` per R3.2–R3.8 (quotes, REM, DATA, `?`,
    abbreviation, table-order first match, pass-through for ≥0x80 bytes not consumed by abbreviation).
  - [x] 2.3 Unit tests in `tests/unit/tokenizer.test.ts`: a plain keyword line, `?` as PRINT, a quoted string
    containing a keyword-looking substring (not crunched), REM swallowing the rest of the line including a
    `:`, DATA swallowing until the next unquoted `:` then resuming, an abbreviation (`P` + shifted `R` for
    PRINT), a byte already ≥0x80 that is not part of a valid abbreviation (copied through unchanged), and
    table-order precedence when two keywords share a prefix (e.g. `GO` vs `GOTO` vs `GOSUB`).
  - _Requirements: R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R3.8_

- [x] 3. `src/basic/tokenizer.ts` — whole-program image
  - [x] 3.1 Implement `tokenizeProgram(lines)` per R3.9–R3.12 (last-wins dedup by number, ascending sort,
    link-address threading from `$0801`, final `0,0` terminator).
  - [x] 3.2 Unit tests: two lines in descending input order sort correctly in output; a duplicate line number
    keeps only the later input occurrence; link addresses match a hand-computed example; an empty program
    yields exactly `[0,0]`.
  - [x] 3.3 Property test `tests/prop/tokenizer-determinism.prop.ts`: P7-style — `tokenizeProgram` called
    twice on line sets that are identical after last-wins dedup returns byte-identical `Uint8Array`s
    (`numRuns: 100`).
  - _Requirements: R3.9, R3.10, R3.11, R3.12, R3.13_

- [x] 4. `src/basic/notation.ts` — `parseBody`
  - [x] 4.1 Export `TOKENS` (the 21-entry name→PETSCII-code table from R1.1).
  - [x] 4.2 Implement `parseBody(body)` per the algorithm in `design.md` (quotes, `{NAME}`/`{n NAME(S)}`
    recognition, unknown/unterminated-group literal fallback, space in/out of quotes, upper-case fold,
    32–95 range check into `dropped`).
  - [x] 4.3 Unit tests in `tests/unit/notation.test.ts`: every fixed token from R1.1 individually; `{3 DOWN}`
    and `{1 DOWNS}` both produce the expected repeat; `{0 DOWN}` produces zero codes; a space outside quotes
    produces no code, a space inside quotes produces code 32; a lower-case letter folds to upper; a character
    outside 32–95 (e.g. a literal `~` or a stray `£`) lands in `dropped` with its original (non-folded)
    character and correct index; an unknown token `{FOOBAR}` types its literal characters (braces land in
    `dropped`, letters land in `codes`); an unterminated `{DOWN` (no closing brace) types from the `{` to end
    of string literally.
  - _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R1.7, R1.8_

- [x] 5. `src/basic/notation.ts` — `render`, `typedLine`, abbreviation
  - [x] 5.1 Implement `render(codes)` as `parseBody`'s inverse for codes with no corresponding `dropped`
    entries (each fixed-token code renders to its `{NAME}`, each 65–90/32–95 code renders to its character).
  - [x] 5.2 Implement `typedLine(lineNo, body)` per R1.9–R1.13, importing `KEYWORDS` from `tokenizer.ts` for
    the abbreviation step (R1.11), splicing codes for the rightmost eligible occurrence first.
  - [x] 5.3 Unit tests: a line at exactly 80 typed codes returns `tooLong: false` unchanged; a line at 81
    abbreviates exactly one rightmost keyword occurrence and returns `tooLong: false`; a line so long that
    every keyword occurrence is abbreviated and it still exceeds 80 returns `tooLong: true` with the fully
    abbreviated codes; an abbreviation inside a quoted string is never touched (quotes are excluded from the
    scan in step 5 of `typedLine`'s algorithm).
  - [x] 5.4 Property test `tests/prop/notation-roundtrip.prop.ts` for **P2**: generate bodies from only
    recognized tokens/typeable characters, assert `parseBody(render(parseBody(body).codes)).codes` deep-equals
    `parseBody(body).codes` (`numRuns: 100`).
  - _Requirements: R1.9, R1.10, R1.11, R1.12, R1.13, R1.14_

- [x] 6. `src/basic/checksum.ts`
  - [x] 6.1 Implement `computeChecksum(lineNo, body)` per R2.1–R2.6, importing `TOKENS` from `notation.ts` and
    applying its own (unfolded, all-spaces-ignored) counting rules rather than `parseBody`'s typing rules.
  - [x] 6.2 Implement `parsePrinted(remText)` per R2.7–R2.8 (anchored regex, 1–3 digits, 0–255, `null` on
    anything else).
  - [x] 6.3 Implement `splitLine(raw)` per R2.9.
  - [x] 6.4 Unit tests in `tests/unit/checksum.test.ts`: the worked example from `steering/gazette-notation.md`
    (or an authored 2026 fixture of equivalent shape — no magazine text committed, per `structure.md`) computes
    the expected sum; a space inside quotes contributes 0 to the sum (differs from `notation.ts`'s typed code
    for the same input); `{SPACE}`/`{3 SPACES}` contribute 0; a lower-case letter in `body` contributes its
    lower-case ASCII code, not its upper-cased one; `parsePrinted` rejects 4 digits, rejects 256, rejects
    missing `:rem`, accepts `":rem 7"`, `":rem 007"`; `splitLine` splits a line with no trailing `:rem` into
    `{ body: entire remainder, printed: null }`.
  - [x] 6.5 Property test `tests/prop/checksum-ignores-spaces.prop.ts` for **P1**: generate a body and a
    variant with extra/removed literal spaces inserted anywhere outside token braces; assert
    `computeChecksum` is unchanged (`numRuns: 100`).
  - _Requirements: R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R2.8, R2.9, R2.10_

- [x] 7. `src/gate/checksum-gate.ts` — hard refusals  _(tasks 7–12: claude-direct, P1a 2026-11-25 — the Kiro credit cap for this spec line was reached after tasks 1–6; see docs/DX-REPORT.md)_
  - [x] 7.1 Implement `applyPatch`'s op-count check (R4.2), empty-body check (R4.4, evaluated first and
    un-overridable per R4.22), unknown-line check (R4.5), bad-op-type check (R4.6), and the fixed
    short-circuit evaluation order (R4.11, steps 1–4 of this task before any later task's checks run).
  - [x] 7.2 Unit tests in `tests/unit/checksum-gate.test.ts`: `patch.length === 0` and `patch.length === 5`
    both refuse; `replace { new_body: "" }` refuses even when combined with a passing `renumber` elsewhere in
    the same patch and `force_unverified: true`; an op on a `lineno` absent from `listing` refuses; an
    `{ type: "insert", ... }` op refuses with an "insert is recovery-only" reason.
  - _Requirements: R4.1, R4.2, R4.4, R4.5, R4.6, R4.11, R4.22_

- [x] 8. `src/gate/checksum-gate.ts` — edit distance, renumber rules, composition
  - [x] 8.1 Implement the spaces-removed Levenshtein ratio check for `replace` ops (R4.7).
  - [x] 8.2 Implement R4.3's single-pass composition (`finalByLine` built once against the original listing,
    never mutated op by op) so a same-patch renumber+replace on one original line, and a same-patch two-line
    renumber swap, both resolve correctly.
  - [x] 8.3 Implement the renumber-target-in-`expectedLines` check (R4.8), the renumber-must-produce-a-valid-
    checksum check (R4.9, calling into task 9's checksum-rule logic for just that one line), and the global
    final-line-number-uniqueness check (R4.10).
  - [x] 8.4 Unit tests: a `replace` changing 41% of a line's spaces-removed characters refuses; a `replace`
    changing exactly 40% accepts (assuming its checksum also validates); a renumber to a number not in
    `expectedLines` refuses; a renumber to a valid slot whose resulting body's checksum does not validate
    refuses; a renumber swapping two lines' numbers in one patch accepts when both resulting lines validate;
    a patch with a `replace` and a `renumber` on the same original `lineno` composes into one final line
    (verified by inspecting the returned `listing`).
  - _Requirements: R4.3, R4.7, R4.8, R4.9, R4.10_

- [x] 9. `src/gate/checksum-gate.ts` — checksum rule, force path, output shapes
  - [x] 9.1 Implement the per-group-line checksum rule (R4.12–R4.15): `verified` on exact match, `digit-
    misread` on a match against one of the ≤64 bounded digit-substitution readings (R4.14's exact alternative
    sets per digit value), `unverified` when `printed` is `null`, refuse otherwise.
  - [x] 9.2 Implement the force path (R4.16–R4.17): `force_unverified: true` with a per-line refusal count
    ≥ 2 marks `forced` instead of refusing; a count < 2 still refuses.
  - [x] 9.3 Implement the three output shapes (R4.19–R4.21): `accepted`, `forced`, `refused`, with `perOp`
    entries and a `reason` string stating printed vs. computed for a checksum-triggered refusal.
  - [x] 9.4 Unit tests: an exact checksum match marks `verified`; a printed `"28"` with actual computed `20`
    marks `digit-misread` (0↔8 pair) with the matching reading surfaced; a printed `"23"` with no computed
    match (3 has no confusable) refuses; `printed: null` marks `unverified` and does not refuse by itself;
    `force_unverified: true` with `refusalCounts: { 20: 2 }` accepts as `forced`; the same with
    `refusalCounts: { 20: 1 }` still refuses; a refused patch's `reason` string contains both the printed and
    computed numbers.
  - [x] 9.5 Property test `tests/prop/gate-no-empty-no-insert.prop.ts` for **P4**: generate listings and
    patches containing at least one empty-body `replace` or non-replace/renumber op, mixed with arbitrary other
    ops, force flags, and refusal counts; assert `verdict` is always `"refused"` (`numRuns: 100`).
  - [x] 9.6 Property test `tests/prop/gate-accepted-checksum-valid.prop.ts` for **P5**: generate listings and
    patches, keep only the cases where `applyPatch(...).verdict === "accepted"`, assert every resulting
    in-scope line with non-null `printed` is `verified` or `digit-misread` per task 9.1's rule (`numRuns: 100`,
    with a generator biased enough toward checksum-consistent bodies that acceptances aren't vanishingly rare).
  - [x] 9.7 Property test `tests/prop/gate-determinism.prop.ts` for **P7** (single-patch slice): calling
    `applyPatch` twice with deep-equal arguments returns a deep-equal verdict (`numRuns: 100`).
  - _Requirements: R4.12, R4.13, R4.14, R4.15, R4.16, R4.17, R4.18, R4.19, R4.20, R4.21, R4.23_

- [x] 10. `src/gate/contract.ts`
  - [x] 10.1 Implement `evaluate(input)` per `design.md`'s algorithm: in-scope/orphan split, missing/duplicate
    detection, the five status counts plus `typed`/`missing`/`orphansExcluded`, clauses 1–6, the three
    verdicts, `failed`, and the heading string (R5.8's exact format, including the em dash in `"BOOTED —
    PARTIAL"`).
  - [x] 10.2 Unit tests in `tests/unit/contract.test.ts`: `titleSeen: false` is always `NOT-RESURRECTED`
    regardless of every other field; a listing satisfying all six clauses is `RESURRECTED` with an empty
    `failed`; one `forced` in-scope line alone flips an otherwise-passing input to `BOOTED-PARTIAL` with a
    clause-5 `failed` entry naming that line; one `unverified` in-scope line (unparseable `printed`) alone
    flips to `BOOTED-PARTIAL` with a clause-4 `failed` entry, even when that line is the one carrying the
    title text and the screen shows the title correctly; a `residentBytes` that differs from
    `tokenizeProgram` by a single byte flips to `BOOTED-PARTIAL` with an empty-`lines` clause-6 entry; the
    heading string matches R5.8's format for all three verdicts; an orphan line (number outside
    `expectedLines`) is excluded from every clause and counted in `orphansExcluded`, never blocking
    RESURRECTED by itself.
  - [x] 10.3 Property test `tests/prop/contract-resurrected-implies-clean.prop.ts` for **P6**: generate
    `ContractInput`s, keep only the cases where `evaluate(input).verdict === "RESURRECTED"`, assert zero
    in-scope lines have status `"forced"` or `"unverified"` (`numRuns: 100`).
  - _Requirements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.7, R5.8, R5.9_

- [x] 11. Cross-module property tests
  - [x] 11.1 Property test `tests/prop/replay-determinism.prop.ts` for **P7** (full sequence): generate a
    listing and a sequence of 1–5 patches, keep only sequences where every patch gate-accepts in order from
    that starting listing; replay the same sequence from the same starting listing a second time; assert the
    final listings are deep-equal and that hashing each final listing's `(n, body, status)` tuples in order
    (e.g. via `JSON.stringify` + a simple string hash — no new dependency) produces identical hashes
    (`numRuns: 100`).
  - _Requirements: R4.23, R6.2_

- [x] 12. KERNAL equality property test (slow; real emulator)
  - [x] 12.1 Property test `tests/prop/kernal-equality.prop.ts` for **P3**: using `bootNodeCore()` from
    `src/emu/node.ts`, boot exactly one `C64Core` and reuse it across every generated case (never re-boot per
    case, since boot is expensive); for each generated small single-line program body (drawn from a generator
    restricted to keyword text, digits, basic operators, and one quoted string, per `design.md`'s P3
    definition): type `NEW` via `loadProgram`, type the generated line via `typedLine`, `step` enough frames to
    settle, `dumpBasic(core)`, and assert the result equals `tokenizeProgram([{ n: lineNo, body }])` byte for
    byte.
  - [x] 12.2 Mark this spec file's test with a longer Vitest timeout (emulator boot + per-case settle time) and
    confirm `numRuns` is tuned (start at 100 per R6.4; lower only if a measured run shows it cannot complete in
    CI time, recorded as a comment with the measured duration — never lowered silently).
  - [x] 12.3 Run `npm test` once with this file included and once excluded, and record both measured durations
    as a comment at the top of the test file, so the cost of the one emulator-touching property is visible and
    never assumed.
  - _Requirements: R3.1–R3.13, R1.9–R1.13, R6.4_
