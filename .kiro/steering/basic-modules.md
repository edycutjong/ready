---
inclusion: fileMatch
fileMatchPattern: ["src/basic/**", "src/gate/**", "tests/**"]
---
# Rules for the oracle and the gate

The checksum oracle is the ground truth the agent is judged against. Keep it exact and boring.

- **Never brute-force or search checksums.** `checksum.ts` computes; it never guesses a body that matches a sum.
  A mod-256 sum collides easily (F1), so a match is necessary, never sufficient.
- The Gazette 1984 per-line checksum (measured 43/43 on a real June 1984 listing, kill test F1):
  `(sum of ASCII codes of the line-number digits + sum of the body's codes) mod 256`, where **every literal space is
  ignored (inside quotes too)**, `{SPACE}` / `{n SPACES}` count 0, and every other known `{NAME}` / `{n NAME}` token
  counts its PETSCII code n times.
  Reference: #[[file:src/basic/checksum.ts]]
- Notation tokens (`{CLR}`, `{DOWN}`, `{RVS}`, `{OFF}`, `{SPACE}`, `{F1}`…, `{3 DOWN}` = repeat) are single keys.
- Pure functions only: no I/O, no `node:` imports, no globals. Everything here runs in the browser and in hooks.
- Every exported function has a unit test; every invariant in `.kiro/specs/checksum-oracle/design.md` has a fast-check property.
