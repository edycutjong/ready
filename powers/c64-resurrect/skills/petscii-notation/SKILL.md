---
name: petscii-notation
description: COMPUTE!'s Gazette listing notation ({CLR}, {DOWN}, {RVS}, colour names, {n NAME} repeats, {SPACE}), what the C64 types for each, how the per-line checksum counts them, and the 80-character editor limit. Use when reading, comparing or repairing a magazine listing line.
---
# Gazette notation and what the C64 types

This is documentation. You have no shell: to compute a checksum, call the `checksum_line` tool.

## Tokens
A `{…}` group is ONE key press, written by the magazine because the key has no printable form. Names are not
case-sensitive.

| Token | Code | Key | Token | Code | Key |
|---|---|---|---|---|---|
| `{CLR}` | 147 | SHIFT + CLR/HOME (clear screen) | `{HOME}` | 19 | CLR/HOME |
| `{DOWN}` | 17 | cursor down | `{UP}` | 145 | cursor up |
| `{RIGHT}` | 29 | cursor right | `{LEFT}` | 157 | cursor left |
| `{RVS}` | 18 | CTRL + 9 (reverse on) | `{OFF}` | 146 | CTRL + 0 (reverse off) |
| `{F1}` `{F3}` `{F5}` `{F7}` | 133 134 135 136 | function keys | `{SPACE}` | 32 | space bar |
| `{BLK}` | 144 | CTRL + 1 | `{WHT}` | 5 | CTRL + 2 |
| `{RED}` | 28 | CTRL + 3 | `{CYN}` | 159 | CTRL + 4 |
| `{PUR}` | 156 | CTRL + 5 | `{GRN}` | 30 | CTRL + 6 |
| `{BLU}` | 31 | CTRL + 7 | `{YEL}` | 158 | CTRL + 8 |

- Repeat: `{3 DOWN}` is three DOWN presses. `{5 SPACES}` is five spaces. The number is followed by one space; the
  plural spelling is accepted whatever the number.
- Anything else in braces (a misread `{CLR)`, `{CLR`, `{CLEAR}`) is not a token: it is typed letter by letter and
  `{` / `}` cannot be typed at all. A broken token is an OCR misread to fix.
- A control key is stored in the program only INSIDE quotes. Outside quotes the screen editor executes it (for
  example `{CLR}` would clear the screen while typing). A control token outside quotes means a quote was lost or
  invented by OCR.
- Spaces outside quotes are not needed and are not typed. Spaces inside quotes are typed and shown on screen.
- Letters are typed as upper case.

## The checksum
The `:rem NNN` at the end of a printed line is the magazine's checksum for that line. The rule, measured on a real
June 1984 page:

- Add the character codes of the line number's digits and of the whole body (the part before `:rem`).
- Every literal space counts 0, inside quotes too. `{SPACE}` and `{n SPACES}` count 0.
- Any other token counts its PETSCII code, times n for `{n NAME}`.
- Everything else counts its own character code, with no case folding (`o` and `O` differ).
- The result is the sum mod 256.

Consequences: a wrong space never changes it; a wrong space-count inside a string cannot be found by checksum; two
swapped characters keep the sum; a mod-256 match is evidence, not proof. Never compute it by hand: call
`checksum_line` with `lineno` and `body`.

## Editor limit
The C64 screen editor holds 80 characters per logical line (two screen rows). A longer line can only be typed with
keyword abbreviations (first letter + the SHIFTED second letter, for example `P` + SHIFT-`O` = `POKE`; `?` = `PRINT`).
A line that cannot be typed is reported as `untypeable` (`too-long`, `control-outside-quotes`, `digit-leading-body`,
`nothing-typeable`) and the C64 never receives it; repair its text with `apply_patch`.
