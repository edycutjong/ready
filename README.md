# SYNTAX ERROR IN 20

Resurrecting 1984 magazine type-in programs. OCR reads a scanned COMPUTE!'s Gazette listing, the magazine's own
per-line checksum flags every misread line, a real Commodore 64 runs the program and reports the real error, and a
Kiro agent repairs lines **only through a deterministic gate**: the model chooses where to look, code decides what is true.

> Work in progress (Kiroween 2026, Resurrection). Build log and measured spike results: `evidence/spikes/`.

## Run the tests
```bash
npm ci
npm test          # unit + property tests
npm run typecheck
```

## Licence
MIT for the code in this repository — see `LICENSE` for what it does not cover (emulator ROMs, magazine text).
