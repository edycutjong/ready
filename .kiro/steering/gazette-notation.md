---
inclusion: auto
name: gazette-notation
description: COMPUTE!'s Gazette listing notation, PETSCII control codes and the OCR confusables measured on real scans. Use when converting, typing, checksumming or repairing a magazine listing line.
---
# Gazette notation and OCR confusables

| Notation | PETSCII | Notation | PETSCII |
|---|---|---|---|
| `{CLR}` | 147 | `{HOME}` | 19 |
| `{DOWN}` | 17 | `{UP}` | 145 |
| `{RIGHT}` | 29 | `{LEFT}` | 157 |
| `{RVS}` | 18 | `{OFF}` | 146 |
| `{F1}` `{F3}` `{F5}` `{F7}` | 133 134 135 136 | `{SPACE}` | 32 |
| `{BLK}` `{WHT}` `{RED}` `{CYN}` | 144 5 28 159 | `{PUR}` `{GRN}` `{BLU}` `{YEL}` | 156 30 31 158 |

`{3 DOWN}` means three DOWN keys. Spaces outside quotes are not typed (the tokenizer ignores them) and are not
counted by the checksum.

Measured OCR confusions on 1984 scans (kill test, REPORT row 2): slashed zero `Ø` → `0` / `8` / `9` / `@` / `G`;
`$` → `S`; `1` → `l` / `I`; brackets `{` `(` `[` mixed; stray characters; dropped quotes; **line numbers misread**
(`20` → `26` / `208`, `30` → `38`). Printed checksum digits are misread too: only `0↔8`, `0↔9`, `0↔6` are accepted as
a "checksum digits misread" reading — a frozen set, extended only by a measured spike.
