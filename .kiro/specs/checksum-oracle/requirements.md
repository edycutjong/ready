# Requirements — checksum-oracle

## Purpose

`src/basic/notation.ts`, `src/basic/checksum.ts`, `src/basic/tokenizer.ts`, `src/gate/checksum-gate.ts` and
`src/gate/contract.ts` are the deterministic core of SYNTAX ERROR IN 20: the part of the system a Kiro agent
never gets to talk its way around. The model proposes; these five modules compute what is actually true —
what a 1984 keyboard would have typed, what the magazine's own checksum says, what the real C64 KERNAL stores
in memory, whether a proposed patch is even legal, and whether the listing counts as resurrected. All five are
pure, isomorphic TypeScript: no `node:` imports, no DOM, no ambient state, so the same code runs in the
browser, inside the MCP server, and inside a Kiro hook.

Shared vocabulary used throughout this document:

- **Canonical listing**: `{ n: number, body: string, printed: number | null, status: LineStatus, source: string }[]`,
  one entry per line currently believed to exist. `printed` is the parsed `:rem NNN` value or `null` when
  unparseable. `LineStatus` is exactly one of `"verified" | "digit-misread" | "eye-verified" | "forced" |
  "unverified"` — never any other string. `eye-verified` is set only by a human reviewer action outside these
  five modules (never by the gate); the other four are set only by `checksum-gate.ts`.
- **expectedLines**: the full inventory of line numbers the listing is supposed to contain (from the magazine's
  printed length), independent of which are currently present.
- **Group**: the set of lines touched (directly or as a renumber target) by one patch, evaluated after every op
  in that patch has been applied.

---

## R1 — `src/basic/notation.ts`: Gazette notation → typed PETSCII

**User story**: as the repair pipeline, I need every OCR'd line body turned into the exact PETSCII key codes a
1984 reader would have typed, so the real C64 can be fed the listing mechanically, with no interpretation left
to chance.

R1.1 WHEN `parseBody` encounters a token matching, case-insensitively, one of `{CLR} {HOME} {DOWN} {UP}
{RIGHT} {LEFT} {RVS} {OFF} {F1} {F3} {F5} {F7} {BLK} {WHT} {RED} {CYN} {PUR} {GRN} {BLU} {YEL} {SPACE}`, THE
SYSTEM SHALL append that token's fixed PETSCII code (147, 19, 17, 145, 29, 157, 18, 146, 133, 134, 135, 136,
144, 5, 28, 159, 156, 30, 31, 158, 32, respectively) to `codes` exactly once.

R1.2 WHEN a token has the form `{n NAME}` or `{n NAMES}`, where `NAME`/`NAMES` case-insensitively matches one
of R1.1's names and `n` is a run of decimal digits (leading zeros allowed) immediately followed by one space,
THE SYSTEM SHALL parse `n` as a non-negative integer and append that name's PETSCII code `n` times (zero times
when `n` is `0`). THE SYSTEM SHALL NOT validate whether the `NAME`/`NAMES` plural form agrees with `n` — both
spellings are accepted regardless of `n`'s value. WHEN a `{…}` group has no leading digit run (bare `{NAME}`),
THE SYSTEM SHALL treat it as R1.1 with an implicit `n` of 1.

R1.3 WHEN `parseBody` encounters a space character that is outside a quoted string, THE SYSTEM SHALL NOT
append a code for it.

R1.4 WHEN `parseBody` encounters a space character that is inside a quoted string (between an opening `"` and
its matching closing `"`, or between an opening `"` and end of body when no closing `"` appears), THE SYSTEM
SHALL append PETSCII code 32 for it.

R1.5 WHEN `parseBody` encounters a letter `a`–`z` or `A`–`Z` outside a recognized token, THE SYSTEM SHALL fold
it to upper case and append its PETSCII code (65–90).

R1.6 IF a character — after any case folding required by R1.5 — has a PETSCII code outside the inclusive range
32–95, THEN THE SYSTEM SHALL append `{ index, char }` to `dropped` (`index` is that character's index in the
original `body` string, `char` is the original, un-folded character) and SHALL NOT append any code for it to
`codes`. A dropped character is reported, never silently discarded, and never substituted with a guess.

R1.7 WHEN `parseBody` encounters a `{` whose contents, up to the next `}`, do not case-insensitively match the
`{NAME}` / `{n NAME(S)}` grammar of R1.1/R1.2 against any name in R1.1 (an unknown token), OR encounters a `{`
with no following `}` anywhere in the rest of `body` (an unterminated token), THE SYSTEM SHALL type that
literal text character by character under rules R1.3–R1.6 — starting at the `{` itself and continuing through
the matching `}` inclusive (unknown case) or through the end of `body` (unterminated case) — instead of
discarding it or treating it as a valid token. (`{` is PETSCII 123 and `}` is PETSCII 125, both outside
32–95, so an unknown/unterminated group's own brace characters are reported via R1.6 while any letters or
digits inside it are typed normally; no separate brace-handling rule is needed.)

R1.8 WHEN `parseBody` finishes scanning `body`, THE SYSTEM SHALL return `codes` in left-to-right order of
appearance in `body`, and `dropped` sorted by ascending `index`.

R1.9 WHEN `typedLine(lineNo, body)` is called, THE SYSTEM SHALL prepend to `parseBody(body).codes` the PETSCII
digit codes (48–57) of `lineNo`'s decimal representation, with no leading zeros and no sign (`lineNo` is always
a non-negative integer in range 0–63999).

R1.10 WHEN the combined length of `typedLine`'s digit-prefix plus `codes` is less than or equal to 80, THE
SYSTEM SHALL return that sequence unchanged with `tooLong: false`.

R1.11 WHILE the combined length exceeds 80 AND at least one unabbreviated, case-insensitive, whole-token
occurrence of an entry from the BASIC V2 keyword table (R3.1, imported from `tokenizer.ts` — notation.ts SHALL
NOT maintain its own copy of this table) remains in `body` outside any quoted string, THE SYSTEM SHALL
repeatedly select the rightmost such occurrence and replace it with exactly two typed codes: the occurrence's
first character's PETSCII code, followed by its second character's PETSCII code with bit 7 set (`code |
0x80`), continuing until the combined length is ≤ 80 or no abbreviatable occurrence remains. (This two-code
shape is exactly what `tokenizer.ts`'s R3.7 recognizes as an abbreviation, so a line typed this way crunches to
the identical token byte as if the keyword had been typed in full.)

R1.12 IF, after R1.11 has abbreviated every eligible occurrence, the combined length still exceeds 80, THEN
THE SYSTEM SHALL return `tooLong: true` together with the most-abbreviated `codes`/digit-prefix computed (the
caller is responsible for routing a too-long line to re-OCR or a human; `notation.ts` never truncates or drops
characters to force a fit).

R1.13 IF the combined length never exceeded 80, or was brought to ≤ 80 by R1.11, THEN THE SYSTEM SHALL return
`tooLong: false`.

R1.14 WHEN `parseBody` or `typedLine` is called twice with identical arguments, THE SYSTEM SHALL return
deep-equal results (determinism; no clock, no RNG, no module-level mutable state).

---

## R2 — `src/basic/checksum.ts`: the Gazette 1984 per-line checksum oracle

**User story**: as the judge of every OCR read and every proposed patch, I need the magazine's own checksum
formula computed exactly, from the line as printed, so a line's correctness is never a matter of model opinion.

R2.1 WHEN `computeChecksum(lineNo, body)` is called, THE SYSTEM SHALL return `(sum of ASCII codes of lineNo's
decimal digits + sum of body's counted codes) mod 256`, where the digit sum uses `lineNo`'s decimal
representation with no leading zeros and no sign (same digits as R1.9).

R2.2 WHEN counting `body`'s codes, THE SYSTEM SHALL ignore every literal space character with a count of 0,
whether that space is outside or inside a quoted string (unlike `notation.ts`'s R1.3/R1.4, the checksum never
types a quoted space).

R2.3 WHEN counting `body`'s codes, THE SYSTEM SHALL recognize the same `{…}` token grammar as `notation.ts`
(R1.1, R1.2, R1.7 — `checksum.ts` SHALL import and reuse `notation.ts`'s token-name-to-PETSCII-code table
rather than duplicating it) and SHALL count `{SPACE}` and `{n SPACES}` as 0 regardless of `n`.

R2.4 WHEN counting `body`'s codes, THE SYSTEM SHALL count every other known `{NAME}` or `{n NAME(S)}` token
(R1.1/R1.2, excluding `{SPACE}`/`{n SPACES}`) by its PETSCII code, counted `n` times.

R2.5 WHEN counting `body`'s codes, THE SYSTEM SHALL count every other character — including an unknown or
unterminated token's literal fallback characters (R1.7) and any letter, regardless of case — by its raw ASCII
code exactly as it appears in `body`, with no case folding. (This is a deliberate asymmetry with
`notation.ts`: the checksum sums the line exactly as printed/OCR'd, not as it would be typed after upper-case
folding.)

R2.6 THE SYSTEM SHALL implement `computeChecksum` as a pure forward computation of the formula in R2.1–R2.5
only. THE SYSTEM SHALL NOT search, enumerate, or guess a `body` (or any part of one) that produces a target
checksum; a checksum match is evidence a line is probably correct, never proof, and this module never
manufactures matches.

R2.7 WHEN `parsePrinted(remText)` is given text containing a trailing `:rem` (case-insensitive, optionally
preceded by other characters) followed by 1–3 decimal digits forming a number in the inclusive range 0–255,
with nothing other than optional trailing whitespace after the digits, THE SYSTEM SHALL return that number.

R2.8 IF `remText` has no `:rem`, or the text after `:rem` is missing, is cut off before at least one digit, is
non-numeric, has more than 3 digits, has trailing non-whitespace content after the digits, or forms a number
outside 0–255, THEN THE SYSTEM SHALL return `null` from `parsePrinted`. An unparseable checksum is reported as
`null`; `parsePrinted` never guesses a value for garbled trailing text.

R2.9 WHEN `splitLine(raw)` is given a raw OCR'd line, THE SYSTEM SHALL return `{ n, body, printed }` where `n`
is the parsed leading line-number, `body` is the text between the line number and the trailing `:rem NNN` (or
the entire remainder when no trailing `:rem NNN` is present), and `printed` is `parsePrinted` applied to
whatever trailing text follows `body`.

R2.10 WHEN `computeChecksum`, `parsePrinted`, or `splitLine` is called twice with identical arguments, THE
SYSTEM SHALL return deep-equal results (determinism).

---

## R3 — `src/basic/tokenizer.ts`: exact BASIC V2 CRUNCH

**User story**: as the ground truth for what the real C64 holds in memory, I need the KERNAL's own tokenizing
(crunching) behavior reproduced byte for byte, so `contract.ts` can tell a listing that merely *displays*
correctly apart from one that is *actually* the program the magazine printed.

R3.1 THE SYSTEM SHALL expose the BASIC V2 keyword table at ROM addresses $80–$CB, in exactly this order (index
0 = $80): `END FOR NEXT DATA INPUT# INPUT DIM READ LET GOTO RUN IF RESTORE GOSUB RETURN REM STOP ON WAIT LOAD
SAVE VERIFY DEF POKE PRINT# PRINT CONT LIST CLR CMD SYS OPEN CLOSE GET NEW TAB( TO FN SPC( THEN NOT STEP + - *
/ ^ AND OR > = < SGN INT ABS USR FRE POS SQR RND LOG EXP COS SIN TAN ATN PEEK LEN STR$ VAL ASC CHR$ LEFT$
RIGHT$ MID$ GO`. THE SYSTEM SHALL export this table so `notation.ts` (R1.11) can reuse it without duplication.

R3.2 WHEN tokenizing a line's text at a position that is outside a quoted string, outside REM text (R3.5), and
outside DATA text (R3.6), THE SYSTEM SHALL scan the R3.1 table in table order and crunch the first keyword
whose text matches at that position into its single corresponding byte (`0x80 + its table index`).

R3.3 WHEN a `?` character appears at a position where crunching is active (not inside a quoted string, REM
text, or DATA text), THE SYSTEM SHALL crunch it as the `PRINT` token byte.

R3.4 WHILE scanning is inside a quoted string (from an opening `"` to its matching closing `"`, or to end of
line when no closing `"` appears), THE SYSTEM SHALL copy every character unchanged — no crunching, including
no abbreviation (R3.7) and no `?` substitution (R3.3).

R3.5 WHEN a `REM` token has been crunched on a line, THE SYSTEM SHALL copy every remaining character on that
line unchanged, with no further crunching of any kind for the rest of that line.

R3.6 WHEN a `DATA` token has been crunched on a line, THE SYSTEM SHALL copy every character unchanged until
the next `:` that is itself outside a quoted string, at which point normal crunching (R3.2–R3.4, R3.7) resumes
from that `:` onward.

R3.7 WHEN, at a crunchable position, the text matches a keyword's prefix (one or more characters) followed
immediately by a single byte with bit 7 set (value ≥ 0x80), THE SYSTEM SHALL crunch that prefix-plus-byte as
the full keyword's single token byte (keyword abbreviation), consuming exactly the prefix and that one byte.
Among keywords whose prefix matches, THE SYSTEM SHALL apply R3.2's table-order-first-match rule.

R3.8 WHEN a character already has a value ≥ 0x80 and is not consumed by R3.7's abbreviation rule, THE SYSTEM
SHALL copy it unchanged.

R3.9 WHEN `tokenizeProgram(lines)` is called, THE SYSTEM SHALL sort lines by ascending line number before
emitting any bytes, and WHEN two or more input lines share the same line number, THE SYSTEM SHALL keep only
the one that appears last in `lines`' input order and discard the others (screen editor replace semantics).

R3.10 WHEN `tokenizeProgram` emits each surviving line, THE SYSTEM SHALL emit, in order: a 2-byte
little-endian link to the next line's start address, the line's 2-byte little-endian line number, the line's
crunched token bytes (per R3.2–R3.8), and a single `0x00` terminator byte.

R3.11 WHEN computing each line's start address and link value, THE SYSTEM SHALL treat the program as starting
at `$0801` (`BASIC_START`), with each line's start address equal to the immediately preceding line's start
address plus that preceding line's total emitted byte length (link + line-number + tokens + terminator), and
the first surviving line starting at `$0801` itself.

R3.12 WHEN `tokenizeProgram` finishes emitting every surviving line, THE SYSTEM SHALL append a final 2-byte
`0x00, 0x00` end-of-program link.

R3.13 WHEN `tokenizeProgram` is called twice with line sets that are identical after R3.9's dedup-by-last-wins
rule, THE SYSTEM SHALL return byte-identical output (determinism).

---

## R4 — `src/gate/checksum-gate.ts`: the patch gate

**User story**: as the only path from a model's proposed fix to a changed listing, I need every patch judged
by fixed, non-negotiable rules, so the model can never talk, retry, or flag its way past a line it cannot
prove is correct.

A patch is 1–4 operations, each `{ type: "replace", lineno, new_body }` or `{ type: "renumber", lineno,
new_lineno }`, applied against a canonical listing and an `expectedLines` inventory. `lineno` always identifies
a line by its number *before* this patch is applied.

R4.1 WHEN a patch is submitted, THE SYSTEM SHALL evaluate and apply all of its operations atomically: every
operation succeeds together, or the whole patch is refused and the listing is returned unchanged.

R4.2 IF a patch contains fewer than 1 or more than 4 operations, THEN THE SYSTEM SHALL refuse it
(`verdict: "refused"`), independent of every other rule in this section.

R4.3 WHEN computing the result of a patch that passes R4.2, THE SYSTEM SHALL first compute the complete set of
resulting `(lineno, body)` pairs by applying every operation to the *original* listing simultaneously — never
by mutating the listing one operation at a time — so that a patch renumbering two lines to swap their numbers,
or a patch that both replaces and renumbers the same original line, is evaluated against one coherent final
state rather than a sequence of intermediate, possibly colliding, states. WHEN one operation in a patch is a
`replace` on `lineno = L` and another is a `renumber` on `lineno = L` (the same original line), THE SYSTEM
SHALL compose them into a single final line carrying the replace's `new_body` at the renumber's `new_lineno`.

R4.4 IF any operation's `replace.new_body` is empty — the empty string, or a string whose
`notation.ts#parseBody` result has zero `codes` and zero `dropped` entries (nothing left to type at all) —
THEN THE SYSTEM SHALL refuse the entire patch, with a reason identifying it as a deletion attempt. THE SYSTEM
SHALL NOT allow `force_unverified`, any other flag, or any other operation in the same patch to override this
refusal; `replace { lineno, new_body: "" }` is always refused, with no exception.

R4.5 IF any operation's `lineno` does not identify a line present in the current canonical listing, THEN THE
SYSTEM SHALL refuse the entire patch.

R4.6 IF any operation's `type` is anything other than exactly `"replace"` or `"renumber"` — including `"insert"`
— THEN THE SYSTEM SHALL refuse the entire patch, with a reason identifying `insert` as recovery-only (a lost
line is never written by the model; R4.4's product non-negotiable) and never an agent-issued op.

R4.7 IF a `replace` operation's Levenshtein edit distance between its line's current `body` and `new_body`,
each with every space character removed before measuring, divided by the larger of the two spaces-removed
lengths, exceeds 0.40, THEN THE SYSTEM SHALL refuse the entire patch. This rule applies only to `replace`
operations' body text; it SHALL NOT be applied to the line-number change made by a `renumber` operation, and
it SHALL be evaluated once per `replace` op against that single patch's edit alone (not cumulatively across
separate patches applied over time to the same line).

R4.8 IF a `renumber` operation's `new_lineno` is not a member of `expectedLines`, THEN THE SYSTEM SHALL refuse
the entire patch.

R4.9 IF a `renumber` operation's resulting line — its (possibly R4.3-composed) final body, evaluated at
`new_lineno` — does not satisfy R4.12–R4.16's checksum rule (i.e., would itself be refused by R4.16 or would
require `force_unverified`), THEN THE SYSTEM SHALL refuse the entire patch; a renumber is accepted only when it
actually produces a checksum-valid line, never merely because the target slot is open.

R4.10 IF applying R4.3's composition to every operation in the patch would produce two or more final lines
sharing the same line number, THEN THE SYSTEM SHALL refuse the entire patch, checked against the complete
final set of line numbers (every line in the listing after the patch, not only the lines the patch touches).

R4.11 WHEN evaluating a patch, THE SYSTEM SHALL check R4.2, then R4.4 (per op, in the patch's op order), then
R4.5 (per op), then R4.6 (per op), then R4.7 (per `replace` op), then R4.8 (per `renumber` op), then R4.9 (per
`renumber` op), then R4.10, stopping at the first rule that refuses the patch and reporting that rule's reason;
only once none of R4.2–R4.10 refuses the patch does THE SYSTEM proceed to the checksum rule (R4.12–R4.17).

R4.12 WHEN none of R4.2–R4.10 refuses the patch, THE SYSTEM SHALL evaluate the checksum rule on every line in
the group (R4.3's final composed state for every line any operation touched, including a renumber's target
line), using each such line's final `body` and final `lineno`.

R4.13 WHEN a group line's `printed` is non-null (parseable, R2.7) AND `computeChecksum(lineno, body)` (R2.1)
equals `printed`, THE SYSTEM SHALL mark that line's status `"verified"`.

R4.14 WHEN a group line's `printed` is non-null AND `computeChecksum(lineno, body)` does not equal `printed`,
but equals the checksum obtained by replacing zero or more of `printed`'s decimal digit characters with a
confusable alternative — where a `0` digit's alternatives are `{8, 9, 6}`, an `8` digit's alternative is `{0}`,
a `9` digit's alternative is `{0}`, a `6` digit's alternative is `{0}`, and every other digit (`1,2,3,4,5,7`)
has no alternative — and then re-parsing the substituted digit string as a number, THE SYSTEM SHALL mark that
line's status `"digit-misread"` and SHALL surface the specific substituted reading that matched. THE SYSTEM
SHALL try only this bounded, frozen enumeration (at most 3 digit positions, each with at most 4 candidate
values, so at most 64 combinations) — never a search over possible `body` texts (R2.6) — and SHALL discard any
substituted reading that is not itself a valid 0–255 number.

R4.15 IF a group line's `printed` is non-null AND neither R4.13 nor R4.14 matches, THEN THE SYSTEM SHALL
refuse the entire patch for that line, UNLESS R4.16 applies.

R4.16 IF a group line would be refused by R4.15, AND the caller supplies `force_unverified: true` together
with a per-line refusal count ≥ 2 for that specific line (a count the caller tracks and supplies; this module
does not persist it), THEN THE SYSTEM SHALL mark that line's status `"forced"` instead of refusing, and SHALL
record that this line's checksum was never verified.

R4.17 IF `force_unverified: true` is supplied for a line whose caller-supplied per-line refusal count is less
than 2, THEN THE SYSTEM SHALL refuse the entire patch and SHALL NOT mark any line `"forced"`.

R4.18 IF a group line's `printed` is `null` (unparseable, R2.8), THEN THE SYSTEM SHALL mark that line's status
`"unverified"`, without attempting any checksum comparison; its correctness depends only on R4.2–R4.10's hard
refusals already having passed, and on the emulator-level facts `contract.ts` checks later. `"unverified"`
status is never, by itself, cause to refuse a patch — but, per R5.3's clause 4, it also never, by itself,
satisfies RESURRECTED; a human must promote it to `"eye-verified"` outside this module before RESURRECTED
becomes reachable.

R4.19 WHEN the gate accepts a patch (no line in the group is `"forced"`), THE SYSTEM SHALL return
`verdict: "accepted"`, a `listing` reflecting every applied operation (per R4.3's composed final state), and a
`perOp` array with one entry per input operation, each `{ line, printed, computed, ok: true, why }`.

R4.20 WHEN the gate accepts a patch via R4.16 (at least one line in the group is `"forced"`), THE SYSTEM SHALL
return `verdict: "forced"`, the same `listing`/`perOp` shape as R4.19, with the forced line's `perOp` entry
carrying `ok: false` and a `why` stating it was forced, never verified.

R4.21 WHEN the gate refuses a patch (`verdict: "refused"`), THE SYSTEM SHALL return no `listing` (the original
listing is unchanged) and a `reason` string that, for a checksum mismatch (R4.15), states both the printed sum
and the computed sum for the specific offending line, and, for any other refusal (R4.2, R4.4–R4.10, R4.17),
names the specific rule that triggered it. `reason` SHALL be human-readable prose suitable to write verbatim to
STDERR when the Kiro PreToolUse hook exits with code 2.

R4.22 THE SYSTEM SHALL evaluate R4.4 (the empty-body hard refusal) ahead of, and independently of, every other
rule, so that no combination of a valid-looking `force_unverified`, a compensating `renumber`, or any other
operation in the same patch ever causes a `replace { new_body: "" }` to be accepted.

R4.23 WHEN `checksum-gate.ts`'s patch-evaluation function is called twice with deep-equal `(listing, patch,
expectedLines, force flags, refusal counts)` arguments, THE SYSTEM SHALL return a deep-equal verdict
(determinism).

---

## R5 — `src/gate/contract.ts`: the three terminal states

**User story**: as the only authority allowed to say a listing is resurrected, I need the verdict computed
purely from the final listing and measured emulator facts, so the model's own claim of success is never part
of the evidence.

Input: `{ listing, expectedLines, titleSeen: boolean, postTitle: "pass" | "fail" | "not-reached", residentBytes:
Uint8Array, provisional: Set<number> }`. `listing`'s lines in scope are those whose number is a member of
`expectedLines`; a listing line whose number is *not* in `expectedLines` is an orphan, excluded from every
scope-based check below and counted separately (R5.5).

R5.1 THE SYSTEM SHALL compute the verdict, counts, `failed`, and heading as a pure function of exactly the
input in this section's preamble. THE SYSTEM SHALL NOT itself query the emulator, re-run anything, or accept
any success claim from the model as input.

R5.2 IF `titleSeen` is `false`, THEN THE SYSTEM SHALL return `verdict: "NOT-RESURRECTED"`, regardless of every
other input.

R5.3 IF `titleSeen` is `true` AND all six of the following clauses hold, THEN THE SYSTEM SHALL return
`verdict: "RESURRECTED"`:
  1. `titleSeen` is `true`.
  2. `postTitle` is exactly `"pass"`.
  3. Every number in `expectedLines` appears exactly once among the in-scope lines of `listing`, and `listing`
     contains no in-scope duplicate (every in-scope number present exactly once, none missing, none doubled).
  4. Every in-scope line's `status` is one of `"verified"`, `"digit-misread"`, or `"eye-verified"`, AND no
     in-scope line's number is a member of `provisional`.
  5. Zero in-scope lines have `status: "forced"`.
  6. `residentBytes` is byte-for-byte equal to `tokenizeProgram(the in-scope lines of listing, sorted by
     number)` (R3.9–R3.12) — the real machine's memory must match what the canonical listing says the program
     is, not merely what its checksums and statuses claim.

R5.4 IF `titleSeen` is `true` AND at least one of R5.3's six clauses does not hold, THEN THE SYSTEM SHALL
return `verdict: "BOOTED-PARTIAL"`. (A title-critical line whose `printed` is unparseable — status
`"unverified"` — fails clause 4 even when the title visibly rendered correctly on screen; `"unverified"` is
never treated as good enough for RESURRECTED, only a human's `"eye-verified"` promotion is.)

R5.5 WHEN the verdict is computed, THE SYSTEM SHALL also return `counts`: `verified`, `digitMisread`,
`eyeVerified`, `forced`, and `unverified` (the number of in-scope lines with each respective `status`); `typed`
(the sum of those five, i.e. the count of in-scope lines present at all); `missing` (the count of `expectedLines`
numbers with no in-scope line present); and `orphansExcluded` (the count of listing lines present with a
number not in `expectedLines`).

R5.6 WHEN the verdict is not `"RESURRECTED"`, THE SYSTEM SHALL return a non-empty `failed` array, one entry
`{ clause, lines }` per failing condition: clause `1` (titleSeen) and clause `2` (postTitle) each with an empty
`lines` array; clause `3` (inventory) with `lines` listing every missing or duplicated number; clause `4`
(status/provisional) and clause `5` (zero-forced) each with `lines` listing the offending line numbers; clause
`6` (byte-equality) with an empty `lines` array (a whole-image mismatch, not attributable to one line).

R5.7 WHEN the verdict is `"RESURRECTED"`, THE SYSTEM SHALL return an empty `failed` array.

R5.8 WHEN `contract.ts` produces its heading string, THE SYSTEM SHALL format it as `"<PATH> <STATE> ·
<k>/<n> checksum-consistent"`, where `PATH` is `"TITLE-PATH"` when `titleSeen` is `true` and `"NO-TITLE"` when
`titleSeen` is `false`; `STATE` is exactly `"RESURRECTED"`, `"BOOTED — PARTIAL"`, or `"NOT RESURRECTED"`
matching the verdict; `k` is the count of in-scope lines whose `status` is `"verified"`, `"digit-misread"`, or
`"eye-verified"`; and `n` is `expectedLines.length`.

R5.9 WHEN `contract.ts`'s verdict function is called twice with deep-equal input, THE SYSTEM SHALL return a
deep-equal result, including the heading string (determinism).

---

## R6 — Non-functional requirements

R6.1 WHILE any exported function in `src/basic/**` or `src/gate/**` executes, THE SYSTEM SHALL perform no I/O
(no filesystem access, no network access, no console output as part of its computed result) and SHALL NOT
import any `node:` builtin module, so every function in these two directories runs unchanged in the browser,
inside the MCP server, and inside a Kiro hook.

R6.2 WHILE any exported function in `src/basic/**` or `src/gate/**` executes, THE SYSTEM SHALL depend on no
ambient or module-level mutable state and SHALL NOT read the system clock, a random source, or any other
non-deterministic input, so that identical arguments always produce identical, deep-equal results.

R6.3 THE SYSTEM SHALL provide at least one unit test in `tests/unit/` for every exported function of
`notation.ts`, `checksum.ts`, `tokenizer.ts`, `checksum-gate.ts`, and `contract.ts`, covering at minimum the
rule's normal case and its stated edge cases (e.g., `n = 0`, an unterminated `{`, a `printed` of `null`, an
empty `new_body`, a renumber-and-replace composed on one original line).

R6.4 THE SYSTEM SHALL provide one fast-check property test in `tests/prop/` for each property defined in
`design.md`'s "Correctness properties" section, each executed with at least 100 generated cases
(`fc.assert(fc.property(...), { numRuns: 100 })` or stricter).

R6.5 THE SYSTEM SHALL express `notation.ts`, `checksum.ts`, `tokenizer.ts`, `checksum-gate.ts`, and
`contract.ts` as strict-mode TypeScript ESM modules using `.ts`-suffixed relative imports, consistent with the
rest of the repository (`tsconfig` strict, Node ≥ 20 ESM, no CommonJS).

---

## Analysis (analyze-requirements)

Each finding below names the ambiguity or gap, and the requirement id(s) where the text above already resolves
it (this document is the fixed text, not a list of pending fixes).

1. **"≤ 40% edit" vs. a misread line number.** The edit-distance cap (R4.7) is scoped to `replace`'s body text
   only; a misread *line number* is never corrected via `replace` and never counted against the 40% budget — it
   is corrected only via `renumber`, which carries no body change at all. Resolved by R4.7 (scope: body text of
   `replace` only) and R4.9 (a renumber is accepted only when the resulting line is itself checksum-valid, which
   is the actual guard against an incorrect renumber, not an edit-distance threshold).

2. **Renumber + replace in the same patch, targeting the same original line.** Unclear which op "wins" or
   whether the two should compose. Resolved by R4.3: both are composed into one final line (replace's body at
   renumber's new number), and that single composed line is what every later rule (R4.9, R4.10, R4.12 onward)
   sees.

3. **Collisions after a renumber, including a two-line swap.** Applying operations one at a time would make a
   swap (`20→10`, `10→20`) transiently collide. Resolved by R4.3 (every operation is computed against the
   *original* listing simultaneously, never by mutating one op at a time) and R4.10 (uniqueness is checked
   against the complete final set of line numbers, not op by op).

4. **An unparseable checksum on a line the title depends on.** If the title-printing line's `printed` is
   unparseable, it is `"unverified"` and would, read naively, seem to block RESURRECTED even though the title
   rendered. This is intentional, not a bug: resolved explicitly by R5.4's parenthetical and R4.18 — a
   title-critical line with no usable checksum must be promoted to `"eye-verified"` by a human before
   RESURRECTED is reachable, exactly matching the product non-negotiable that the model never declares success
   and every number shown comes from a measured source.

5. **`checksum-gate.ts`'s line statuses vs. `contract.ts`'s clause-4 vocabulary.** The gate (as originally
   described) only ever produces `verified` / `digit-misread` / `forced` / `unverified`, while the contract
   needs an `eye-verified` state that is accepted for RESURRECTED. Resolved by defining one shared `LineStatus`
   enum up front (Purpose section) with exactly five values, stating plainly that `eye-verified` is set only by
   a human action outside these five modules, never by the gate (R4.13–R4.18 only ever set the other four).

6. **What `typed` / `missing` / `orphansExcluded` mean, since they looked like they might be additional line
   statuses rather than aggregate counts.** Resolved by R5.5: they are bookkeeping aggregates over the five
   `LineStatus` values and the `expectedLines` inventory, not additional per-line statuses.

7. **Does `checksum.ts` duplicate `notation.ts`'s `{NAME}` token table, and could the two drift?** Resolved by
   R2.3: `checksum.ts` imports and reuses `notation.ts`'s token table rather than maintaining its own; the two
   modules differ only in their space-handling and case-folding rules (R2.2/R2.5 vs. R1.3/R1.4/R1.5), stated
   explicitly as a deliberate asymmetry, not an oversight.

8. **Does the keyword-abbreviation logic in `notation.ts` (R1.11) duplicate the keyword table in
   `tokenizer.ts` (R3.1), risking the two falling out of sync?** Resolved by R3.1's final sentence and R1.11:
   the table is defined once, in `tokenizer.ts`, and exported for `notation.ts` to import.

9. **Digit-misread enumeration: does it risk becoming the brute-force search `checksum.ts`'s rule forbids?**
   Resolved by making the enumeration explicit and bounded in R4.14: at most 3 digit positions, each drawn only
   from the four frozen OCR-confusable pairs (never a search over `body` text), with an explicit worked
   alternative set per digit value, and explicit discarding of any out-of-range (not 0–255) candidate.

10. **Ordering of refusal checks, so that `reason` (R4.21) is deterministic when multiple hard refusals would
    apply to the same patch.** Resolved by R4.11: a fixed check order with short-circuit on first failure.

11. **Whether the empty-body "cheat" (`replace { new_body: "" }`) could be smuggled past R4.4 via
    `force_unverified` or a compensating `renumber` elsewhere in the same patch.** Resolved by R4.22, restating
    R4.4 as unconditionally first and un-overridable by any other rule or flag in the system.

12. **Whether a 40%-edit-distance refusal on one patch is cumulative across multiple patches needed to fix one
    badly garbled line.** Resolved by R4.7's final clause: the cap applies per patch, not cumulatively: a line
    needing a larger fix is reached over several accepted, independently checksum-validated patches.

13. **`{n NAME}` grammar edge cases: `n = 0`, a non-digit where `n` should be, leading zeros in `n`, and
    NAME/NAMES plural agreement.** Resolved by R1.2: `n` must be a literal decimal digit run (anything else,
    e.g. a letter, falls through to the unknown-token literal-typing path of R1.7); `n = 0` is valid and
    produces zero codes without being treated as unknown; plural agreement is never checked.

14. **Case folding asymmetry between `notation.ts` (folds to type) and `checksum.ts` (counts raw, unfolded).**
    Called out explicitly in R2.5's parenthetical so an implementer does not assume `checksum.ts` can reuse
    `notation.ts`'s folding step.

## Amendments after implementation (P1a, 2026-11-25 — found by tests on the real C64, claude-direct)

- **R4.4 tightened.** "Nothing left to type" now means: the body's typeable codes are empty or all blanks, even if
  it contained untypeable characters (`dropped`). Such a body reaches the C64 as a bare line number, which deletes
  the line. Found by the P3 KERNAL-equality property (Power BASIC fixture); pinned in `core-typing-edges.test.ts`.
- **R5.5 amended.** `counts.typed` counts in-scope lines whose `source` is `"typed"` (typed by a person from the
  page crop), because the certificate and the video captions say "N lines typed". The count of in-scope lines
  present is the new `counts.present`.
- **R5.6 kept over design.md.** NOT-RESURRECTED returns a clause-1 entry in `failed` (design.md step 5 returned `[]`).
- **R1/R3 typing scope.** Three inputs cannot be stored as typed by a real C64 and are outside P3's equality
  claim: a body whose first typed character is a digit (merges into the line number), a control code outside quote
  mode (`controlOutsideQuotes()`: the screen editor executes it), and trailing blanks (the editor drops them; the
  tokenizer and `typedLine` now trim them too). The loader must not type a line flagged by `controlOutsideQuotes()`.
