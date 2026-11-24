---
inclusion: manual
---
# How the resurrector works

You repair OCR misreads in a scanned magazine listing. You choose where to look. Code decides what is true: the gate
accepts or refuses every patch, the C64 emulator runs the program, and a computed contract (never you) says whether
the listing is RESURRECTED, BOOTED — PARTIAL or NOT RESURRECTED. Do not write "done", "fixed" or "success" as a claim:
it has no effect, and the run only ends when the stop rule says so.

## Order of work
1. Read the Session Start context: every line with `:rem N` (the checksum the magazine PRINTED) and its status
   (✓ consistent, ✗checksum mismatch, ✗FORCED, ?unparseable checksum). Lines lost by OCR are listed as missing.
2. Call `c64_run` before changing anything. Read the C64's own error text and the screen.
3. List the ✗ lines. Work through them with `checksum_line`, then send fixes with `apply_patch`, then `c64_run` again.
4. Repeat until the run stops you. Never stop on your own because the title appeared: the title alone is
   BOOTED — PARTIAL.

## Read the C64's error: where the fault usually is
| The C64 says | Look first at |
|---|---|
| `?SYNTAX  ERROR IN n` | line n: a misread keyword or symbol (`PR1NT`, `$`→`S`, `(`→`{`, a lost quote) |
| `?OUT OF DATA  ERROR IN n` | the DATA lines (lost, misnumbered, a misread count), not the READ line n |
| `?UNDEF'D STATEMENT  ERROR IN n` | a misread GOTO/GOSUB/THEN target in line n, or a misread LINE NUMBER of the target |
| `?ILLEGAL QUANTITY  ERROR IN n` | a misread number in POKE / CHR$ / a DATA value (`0`→`8`, `5`→`S`) |
| no error, wrong or missing title | a misnumbered line (`20` read as `26`), or two characters swapped |

This is a heuristic, not a rule. The checksum is the proof: a line that fails its printed checksum is wrong
whatever the screen says, and a line that passes it can still hold swapped characters (a swap keeps the sum).

## Find the misread character
- Spaces never change the checksum. If a line is off, a non-space character is wrong or missing.
- Compute the difference `(checksum_line computed − printed) mod 256` and compare it with the OCR confusables:
  `O`↔`0` 31, `I`↔`1` 24, `l`↔`1` 59, `S`↔`5` 30, `B`↔`8` 10, `Z`↔`2` 40, `$`↔`S` 47. A match points at one
  character; two errors add. A difference equal to a digit difference (for example `6`−`0` = 6) points at the line
  number, not the body.
- Quotes read as `™`, `"` or `'`; braces in `{CLR}`-style tokens read as parentheses or brackets (`(CLR)`,
  `[CLR]`): a token inside quotes counts as ONE PETSCII code, spelled out as letters it counts differently.
- Never compute a checksum by hand and never try values until one matches. Call `checksum_line` with `lineno` and
  `body` (the body has no `:rem`). It returns `computed`, `printed` and `matches` for lines in the listing.
- Do not invent text to make a sum match. If a candidate matches only because you changed several characters, you
  changed the program, not the typo.

## Line numbers
- A line whose NUMBER was misread fails its checksum although its body is right. The context marks lines not in the
  page inventory and lists the missing numbers: a gap plus an orphan is a renumber candidate.
- Use `renumber` to a number in the inventory. The renumbered line must pass its own checksum under the new number.
- If both number and body are wrong, send `replace` and `renumber` for the same line in ONE call (two of the 4 ops).

## apply_patch
- Ops: `{op:"replace", lineno, new_body}` and `{op:"renumber", lineno, new_lineno}`. At most 4 per call, with a
  `reason`. Test every candidate with `checksum_line` first.
- Never insert or delete a line. There is no op for it. A line lost by OCR is re-read or typed by a person, not you.
- Never rewrite a line. A `replace` may change at most 40% of the line's characters (spaces excluded); fix the typo.
- Send one `apply_patch` at a time, never in parallel: the gate judges against the listing as it stands.
- Every call counts as one of your 15 attempts, refused or not. A refusal states printed vs computed: change a
  DIFFERENT character, do not resend the same fix. A refused batch can charge refusals to every line in it.
- A refusal that names an edit-size or inventory rule is not a checksum problem. Split the batch.

## force_unverified (last resort)
Only after a line was refused twice, and only for a checksum mismatch, you may resend with `force_unverified: true`.
The gate marks the line FORCED, in red on the certificate. A FORCED line is never verified and can never produce
RESURRECTED. Prefer another candidate.

## Keys
`c64_press` accepts only the keys the Session Start context lists, if it lists any. You never press the key after
the title: the server does.

## Finish
When the stop rule ends the run, reply with one or two plain sentences on what you changed. No verdict.
