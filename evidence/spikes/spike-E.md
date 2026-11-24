# Spike E — a ROM-free C64 core (FAIL → kill rule applies)

**Question:** can a core without Commodore's ROMs pass the 5/5 type/RUN/read round trip, so the public site could
run live emulation without a ROM rights line?
**Tried (≈ 15 min of the 2 h box):** MEGA65 **Open ROMs** (LGPL-3.0, `basic_generic.rom` + `kernal_generic.rom`,
build `DEV.210823.FC.1`) written over the Commodore ROM images inside c64-ready's linear memory (found at offsets
6992 / 19280), then reset. Scripts: `specs/spikes/spike-e-openroms.mts`, `spike-e-compare.mts` (kitchen).

| Check | Commodore ROMs | Open ROMs |
|---|---|---|
| boots, types, runs | yes | yes |
| `n PRINT )(` → `?SYNTAX ERROR IN n`, n = 20/30/40/60/70 | 5/5 | **0/5** (`?NOT IMPLEMENTED ERROR IN n`, right line) |
| 8 typical OCR faults → same error as the real ROM | — | **3/8** |
| tokenized program of the 28-line title path | 749 bytes | **739 bytes** (differs) |
| randnum title path reaches the title | yes | **no** |

**Verdict: FAIL.** Open ROMs is not behaviourally equivalent: the product's whole premise is the *real* C64 error.
A VICE GPL core was **not tried** (the box was closed after the Open ROMs result); whether a ROM-free VICE web build
exists was not checked. **Kill rule (pre-decided):** c64-ready stays behind `C64Core`, is installed from npm at build
time and is never committed; the ROM-bearing WASM is not served by the public site until the human signs the rights
line (`deploy.yml` blocks the WASM by content hash); the URL shows RECORDED PLAYBACK until then.
