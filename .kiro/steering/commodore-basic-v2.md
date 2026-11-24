---
inclusion: always
---
# Commodore 64 BASIC V2 — what the machine actually does

Measured on the real core (`tests/unit/core-typing-edges.test.ts`, `tests/unit/tokenizer-rom.test.ts`) unless marked.

## Typing a line (the screen editor)
- A logical line holds at most 80 characters; longer lines must use keyword abbreviations (first letter + the
  SHIFTED next letter, e.g. `P` + shift-`O` = POKE). `P` + shift-`R` is `PRINT#`, not PRINT: `?` is PRINT's short form.
- Spaces outside quotes are stored as typed but are not needed; the Gazette checksum ignores every space.
- Trailing blanks of a line are dropped by the editor, even inside an unclosed quote.
- A control key (`{CLR}`, `{HOME}`, cursor keys, colours, `{RVS}`) is only stored **inside quotes**; outside quotes
  the editor executes it. On a Gazette page every control token is inside quotes, so one outside quotes means OCR
  lost or invented a quote.
- A body whose first character is a digit merges into the line number (`10` + `0RINT` becomes line 100).
- A line number with nothing after it deletes that line.

## What an error means and where its fault usually is (heuristic, from the kill test — not a measured rule)
| Error | Usual OCR cause |
|---|---|
| `?SYNTAX  ERROR IN n` (two spaces on a real C64) | a misread keyword or symbol in line n: `PR1NT`, `$`→`S`, `(`→`{`, a lost quote |
| `?UNDEF'D STATEMENT  ERROR IN n` | a GOTO/GOSUB/THEN target misread (`THEN3@`), or a misnumbered target line |
| `?OUT OF DATA  ERROR IN n` | DATA lines lost or misnumbered, or the READ loop bound misread |
| `?ILLEGAL QUANTITY  ERROR IN n` | a misread number in POKE/CHR$/a DATA value (`0`→`8`, `5`→`S`) |
| no error, but the expected title never appears | a misnumbered line (OCR read `20` as `26`), or a lost line on the title path |

## The gate's rules the agent cannot argue with
The Gazette `:rem NNN` checksum is the magazine's own proof of each line. A fix that does not reproduce it is
refused (exit 2 from the Pre Tool Use hook, with printed vs computed). Lines are never deleted or inserted by the
agent; a line lost by OCR is recovered by code or typed by a person.
