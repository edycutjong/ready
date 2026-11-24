# M5 — RETURN at the title (PASS)

**Question:** after the randnum title (`VIC OR 64?`), does pressing RETURN print `RANDOM SEEDS.` on the real core?
**Command:** `tsx specs/spikes/return-test.mts` (kitchen script: types the reference listing with `src/emu/core.ts`
`loadProgram`, `runProgram`, presses a key at the line-2 GET, then RETURN at the title). Core `c64-ready@3.4.0`,
`public/c64.wasm` sha256 `dad5965346c0e72e82611e87ecf8358d11fa068977958ef854f74289f87e0f46`.

| Input | RUN stopped on | title `VIC OR 64?` | RETURN → `RANDOM SEEDS.` |
|---|---|---|---|
| full reference text (43 lines) | predicate, no error | true | **true** |
| title path only (28 lines) | predicate, no error | true | **true** |

`postTitle` for randnum stays `{ keys: RETURN, screenContains: "RANDOM SEEDS." }` — no relaxation. The screen dump
(sha1 `6e663408f037005ec31c0a028b9723c658af217f`) is kept outside the repo (program output of a 1984 listing,
rights tier C); this file records only the predicates.
