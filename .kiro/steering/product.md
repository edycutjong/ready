---
inclusion: always
---
# Product — SYNTAX ERROR IN 20

Resurrects 1984 magazine type-in programs (COMPUTE!'s Gazette, Commodore 64 BASIC V2) from scanned pages.
OCR reads the page, the magazine's own per-line `:rem NNN` checksum flags every misread line, a real C64
emulator runs the listing and reports the real error, and a Kiro agent repairs lines **only through a
deterministic gate**: the model chooses where to look, code decides what is true.

Non-negotiables:
- Nothing on the demo path is mocked. The C64 is real; the checksum is the magazine's own algorithm.
- The model never declares success. `src/gate/contract.ts` computes RESURRECTED / BOOTED — PARTIAL / NOT RESURRECTED.
- A lost line (dropped by OCR) is never written by the model: it is re-OCR'd or typed by a person, labelled.
- Every number shown anywhere comes from a measured run in `evidence/`, `docs/` or `bench/`.
