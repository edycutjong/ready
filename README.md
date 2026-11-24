# SYNTAX ERROR IN 20

Resurrecting 1984 magazine type-in programs. OCR reads a scanned COMPUTE!'s Gazette listing, the magazine's own
per-line checksum flags every misread line, an emulated Commodore 64 (the c64-ready core, run locally during the agent
run) runs the program and reports the real error, and a Kiro agent repairs lines **only through a deterministic gate**:
the model chooses where to look, code decides what is true. The live site plays back a recorded real run and re-judges
every patch in your browser; no C64 ROM is served, so nothing runs on a C64 there.

> Work in progress (Kiroween 2026, Resurrection). Build log and measured spike results: `evidence/spikes/`.

## Run the tests
```bash
npm ci
npm test          # unit + property tests
npm run typecheck
```
The KERNAL-equality property (`tests/prop/kernal-equality.prop.ts`) types generated lines and every committed
fixture into the real C64 core and compares its memory with our tokenizer. The 1984 magazine listings are also run
through it locally (`READY_GAZETTE_FIXTURES=…`), but they are not in this repository (rights), so that run cannot be
reproduced from a clone.

## Licence
MIT for the code in this repository — see `LICENSE` for what it does not cover (emulator ROMs, magazine text).
