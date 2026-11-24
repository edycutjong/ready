# Design — checksum-oracle

All five modules are pure functions over plain data. No class holds state across calls; every function's
output depends only on its arguments. This document gives the exported surface, the shared types, the
algorithm for each module, error handling, and the correctness properties that `tests/prop/` must encode.

## Module dependency order

```
tokenizer.ts  (no dependency on the others; exports KEYWORDS)
     ^
     |
notation.ts   (imports KEYWORDS from tokenizer.ts for abbreviation; owns TOKENS table)
     ^
     |
checksum.ts   (imports TOKENS from notation.ts)
     ^
     |
checksum-gate.ts  (imports computeChecksum/parsePrinted from checksum.ts, parseBody from notation.ts)
     ^
     |
contract.ts   (imports tokenizeProgram from tokenizer.ts; takes gate's listing shape as input)
```

`tokenizer.ts` is deliberately the one module with no dependency on `notation.ts`/`checksum.ts`, so that
`notation.ts` can depend on it for the keyword table without a cycle.

## Shared types (`src/basic/types.ts` — new, pure, no I/O)

```ts
export type LineStatus = "verified" | "digit-misread" | "eye-verified" | "forced" | "unverified";

export interface CanonicalLine {
  n: number;            // line number, 0-63999
  body: string;         // Gazette-notation text, as OCR'd/edited, excluding the trailing ":rem NNN"
  printed: number | null; // parsePrinted's result, 0-255 or null
  status: LineStatus;
  source: string;       // free-form provenance tag, e.g. "ocr" | "gate" | "human"
}

export type CanonicalListing = CanonicalLine[];

export interface Dropped { index: number; char: string; }

export interface ParseBodyResult { codes: number[]; dropped: Dropped[]; }

export interface TypedLineResult { codes: number[]; dropped: Dropped[]; tooLong: boolean; }
```

`checksum-gate.ts` and `contract.ts` both import `CanonicalListing`/`CanonicalLine`/`LineStatus` from here, so
the status vocabulary is defined exactly once (Analysis finding 5/6).

## `src/basic/tokenizer.ts`

```ts
export const KEYWORDS: readonly string[]; // 76 entries, $80.."END" .. $CB."GO", in ROM order (R3.1)

export interface TokenizedLine { startAddr: number; bytes: Uint8Array; } // bytes = link+num+tokens+0

export function crunchLine(lineNo: number, body: string, startAddr: number): TokenizedLine;
export function tokenizeProgram(lines: readonly { n: number; body: string }[]): Uint8Array;
```

**`crunchLine` algorithm** (single pass, left to right over `body`):

1. State: `pos = 0`, `out: number[] = []`, `inQuote = false`, `remMode = false`, `dataMode = false`.
2. While `pos < body.length`:
   - If `remMode`: push `body.charCodeAt(pos)` (or the character's PETSCII equivalent — body is already typed
     PETSCII-range text by this point, see "Input to the tokenizer" below), `pos += 1`, continue.
   - If `body[pos] === '"'`: toggle `inQuote`, push its code, `pos += 1`, continue.
   - If `inQuote`: push the character's code unchanged, `pos += 1`, continue.
   - If `dataMode` and `body[pos] !== ':'`: push unchanged, `pos += 1`, continue.
   - If `dataMode` and `body[pos] === ':'`: `dataMode = false`, push `:`'s code, `pos += 1`, continue (R3.6
     resumes crunching from here, so the loop falls through to the next iteration's normal matching).
   - If `body[pos] === '?'`: push `PRINT`'s byte (`0x80 + KEYWORDS.indexOf("PRINT")`), `pos += 1`, continue.
   - Try abbreviation first for determinism against R3.7, since an abbreviation is a strict subsequence
     pattern of a full match and must be tried before assuming "no keyword here": for the shortest keyword
     prefix length `1`, scan `KEYWORDS` in order; a keyword `K` abbreviates at `pos` when `body.slice(pos, pos +
     1) === K[0]` (case-insensitive, body is already upper-cased by the time it reaches here) and
     `body.charCodeAt(pos + 1) >= 0x80`. (Only a 1-char-prefix + 1 shifted-byte shape is produced by
     `notation.ts`'s R1.11, so this is the only abbreviation shape `crunchLine` needs to recognize; see
     "Input to the tokenizer" below for why a longer stored prefix never reaches this function.) On a match,
     push the keyword's token byte, `pos += 2`, continue.
   - Else scan `KEYWORDS` in table order; the first entry whose text matches `body` at `pos` (case-insensitive,
     exact character match) wins. On a match: push its token byte; if the matched keyword is `REM`, set
     `remMode = true`; if `DATA`, set `dataMode = true`; `pos += matched.length`, continue.
   - Else: push the character's own code unchanged, `pos += 1`.
3. Return the accumulated `out` bytes.

**Input to the tokenizer**: `tokenizeProgram`/`crunchLine` take the same typed-PETSCII-range text
`notation.ts#typedLine` would produce, rendered back to a comparable string/byte form — i.e., the contract
between `notation.ts` and `tokenizer.ts` is that both operate on the *typed* representation of a line (upper
case already folded, control-code tokens already resolved to single bytes), not on raw Gazette notation. In
practice `contract.ts` calls `tokenizeProgram` on the canonical listing's bodies, so `tokenizeProgram` internally
runs each line's `body` through `notation.ts#parseBody` to get its typed codes before crunching, guaranteeing
clause 6 compares like with like (what was actually typed vs. what the KERNAL actually stored).

**`tokenizeProgram` algorithm**:

1. Build a map from line number to body, keeping only the last occurrence per number (R3.9) — iterate `lines`
   in order, `map.set(n, body)` overwrites any earlier entry for the same `n`.
2. Sort the map's entries by ascending `n`.
3. Fold left to right: `addr = 0x0801`; for each `(n, body)`, compute `tokens = crunchLine(n, body, addr).bytes`
   minus its own link placeholder (crunchLine returns the token bytes only; the caller fills in the link once
   the next line's address is known), `len = 2 (link) + 2 (number) + tokens.length + 1 (terminator)`,
   `nextAddr = addr + len`; write `[nextAddr & 0xff, nextAddr >> 8, n & 0xff, n >> 8, ...tokens, 0]`;
   `addr = nextAddr`.
4. Append `[0, 0]`.
5. Concatenate into one `Uint8Array` and return it.

**Error handling**: `crunchLine`/`tokenizeProgram` never throw on malformed input; an unrecognized character
is simply copied through (R3.8), and an empty `lines` array yields the 2-byte `[0,0]` terminator alone. There
is no error channel — any judgement about whether the result is *correct* belongs to `contract.ts`, not here.

## `src/basic/notation.ts`

```ts
export const TOKENS: Readonly<Record<string, number>>; // "CLR" -> 147, "SPACE" -> 32, ... (R1.1)

export function parseBody(body: string): ParseBodyResult;
export function typedLine(lineNo: number, body: string): TypedLineResult;
export function render(codes: readonly number[]): string; // inverse used by property P2 (best-effort; a
  // control code renders back to its {NAME} form, a letter to itself, a dropped-range byte never appears
  // here since render only ever receives parseBody's own `codes` output)
```

**`parseBody` algorithm** (single pass, left to right, tracking `inQuote`):

1. `pos = 0`, `codes: number[] = []`, `dropped: Dropped[] = []`.
2. While `pos < body.length`:
   - If `body[pos] === '"'`: toggle `inQuote`; `"` itself is PETSCII 34, within 32-95, append its code;
     `pos += 1`; continue.
   - If `body[pos] === '{'`: let `close = body.indexOf('}', pos)`.
     - If `close === -1` (unterminated, R1.7): consume the rest of `body` from `pos` to the end one character
       at a time via step 2's letter/space/other branches below (treat `{` itself as an "other" character
       under R1.6, since 123 is outside 32-95), then `pos = body.length`.
     - Else: let `inner = body.slice(pos + 1, close)`. Try to match `^(\d+)\s+([A-Za-z]+)$` or `^([A-Za-z]+)$`
       against `inner`. If the name group, upper-cased, matches a key in `TOKENS` (stripping a trailing `S` only
       when the un-stripped form is not itself a key, to accept both `NAME` and `NAMES`), push that token's code
       `n` times (`n` defaults to 1 when no digit group matched); `pos = close + 1`; continue.
     - Else (unknown name, R1.7): consume characters from `pos` to `close` inclusive, one at a time via the
       letter/space/other branches below; `pos = close + 1`.
   - If `body[pos] === ' '`: if `inQuote`, append 32 (R1.4); else append nothing (R1.3); `pos += 1`; continue.
   - Else: let `ch = body[pos].toUpperCase()`, `code = ch.charCodeAt(0)`. If `32 <= code <= 95`, append `code`;
     else append nothing and push `{ index: pos, char: body[pos] }` to `dropped` (R1.6, using the *original*,
     un-upper-cased character). `pos += 1`.
3. Return `{ codes, dropped }` (`dropped` is already in ascending-index order since the scan is left to right).

**`typedLine` algorithm**:

1. `digits = String(lineNo).split("").map(d => d.charCodeAt(0))`.
2. `{ codes, dropped } = parseBody(body)`.
3. `full = [...digits, ...codes]`.
4. If `full.length <= 80`, return `{ codes: full, dropped, tooLong: false }`.
5. Else, build the list of abbreviatable keyword occurrences: scan `body` left to right outside quotes for
   each substring that case-insensitively equals a `KEYWORDS` entry at a word-like boundary (not preceded or
   followed by another letter), recording its start/length in `body` together with the **typed-code index
   range** it corresponds to in `full` (its position shifts as earlier occurrences are abbreviated, so indices
   are recomputed after each abbreviation rather than precomputed once).
6. While `full.length > 80` and at least one occurrence remains: take the rightmost remaining occurrence,
   splice its codes out of `full` and splice in exactly two codes — `first-char code`, `second-char code |
   0x80` — then drop that occurrence from the remaining list and recompute positions for earlier occurrences
   that didn't move length (only occurrences to the right of an abbreviation shift the counting, so leftward
   occurrences are unaffected; this is why the rightmost-first order in R1.11 is safe to implement as a simple
   repeated splice).
7. Return `{ codes: full, dropped, tooLong: full.length > 80 }`.

**Error handling**: `parseBody` never throws; every character either becomes a code or a `dropped` entry.
`typedLine` never throws; `tooLong: true` is the error signal, left for the caller (`checksum-gate.ts` or the
UI) to route to re-OCR or a human, per the product non-negotiable that a lost/unresolvable line is never
silently written by the model.

## `src/basic/checksum.ts`

```ts
export function computeChecksum(lineNo: number, body: string): number;
export function parsePrinted(remText: string): number | null;
export function splitLine(raw: string): { n: number | null; body: string; printed: number | null };
```

**`computeChecksum` algorithm**: same single pass shape as `parseBody`, reusing `TOKENS` from `notation.ts`,
but with its own counting rules (R2.2–R2.5) instead of `parseBody`'s typing rules:

1. `digitSum = sum of charCodeAt of each digit in String(lineNo)`.
2. Walk `body` left to right with the same `{…}`/quote recognition as `parseBody`'s step 2, except:
   - A literal space (in or out of quotes) contributes 0.
   - A recognized `{SPACE}`/`{n SPACES}` contributes 0 regardless of `n`.
   - A recognized `{NAME}`/`{n NAME}` (any other token) contributes `TOKENS[NAME] * n`.
   - Any other character (including an unknown/unterminated token's literal fallback characters) contributes
     its raw `charCodeAt` value, with **no** upper-casing.
3. Return `(digitSum + bodySum) % 256`.

**`parsePrinted` algorithm**: match `remText` against `/:\s*rem\s+(\d{1,3})\s*$/i` (case-insensitive,
anchored so nothing but optional whitespace follows the digits). If it matches and the captured digits parse
to an integer in `[0, 255]`, return it; otherwise return `null`. No fallback guessing.

**`splitLine` algorithm**: match `raw` against `/^\s*(\d+)\s*(.*)$/` to split off the leading line number;
within the remainder, find the last occurrence of `/:\s*rem\b/i`; `body` is the remainder up to that point
(trimmed of nothing — internal spacing is preserved, since `parseBody`/`computeChecksum` handle spacing
themselves) and `printed = parsePrinted(remainder.slice(that point))`. If no `:rem` is found, `body` is the
entire remainder and `printed = null`. If the leading number fails to parse, `n = null`.

**Error handling**: none of the three functions throw. `null` is the explicit "could not determine" signal
throughout (R2.8), never a thrown exception, so callers can treat "unparseable" as ordinary data.

## `src/gate/checksum-gate.ts`

```ts
export type PatchOp =
  | { type: "replace"; lineno: number; new_body: string }
  | { type: "renumber"; lineno: number; new_lineno: number };

export interface GatePerOp { line: number; printed: number | null; computed: number | null; ok: boolean; why: string; }

export type GateVerdict =
  | { verdict: "accepted"; perOp: GatePerOp[]; listing: CanonicalListing; reason: string }
  | { verdict: "forced"; perOp: GatePerOp[]; listing: CanonicalListing; reason: string }
  | { verdict: "refused"; perOp: GatePerOp[]; reason: string };

export interface GateOptions {
  force_unverified?: boolean;
  refusalCounts?: Readonly<Record<number, number>>; // lineno -> caller-tracked refusal count
}

export function applyPatch(
  listing: CanonicalListing,
  patch: readonly PatchOp[],
  expectedLines: readonly number[],
  options?: GateOptions,
): GateVerdict;
```

**Algorithm** (mirrors R4.1–R4.23 in order):

1. `if (patch.length < 1 || patch.length > 4) return refuse("patch must have 1-4 operations")`.
2. For each op, in order: if `type === "replace"` and `new_body` is empty or
   `parseBody(new_body).codes.length === 0 && parseBody(new_body).dropped.length === 0`, `return
   refuse("empty body: deletion is never a gate op")` immediately — checked before anything else below, and
   never reachable through any other branch (R4.22).
3. For each op: if no line in `listing` has `.n === op.lineno`, `return refuse("unknown line " + op.lineno)`.
4. For each op: if `op.type` is not `"replace"`/`"renumber"`, `return refuse("insert is recovery-only, never an
   agent op")` (this branch is unreachable given `PatchOp`'s type, but the runtime check stays as a boundary
   guard against malformed/untyped input from the MCP transport).
5. For each `replace` op: compute `levenshtein(old.body.replace(/ /g,""), new_body.replace(/ /g,"")) /
   Math.max(1, old.replace(/ /g,"").length, new_body.replace(/ /g,"").length)`; if `> 0.40`, `return
   refuse(...)`.
6. Build `finalByLine: Map<number, CanonicalLine>` by starting from a copy of `listing` keyed by `n`, then for
   each op: a `replace` updates that entry's `body`; a `renumber` removes the entry at the old key and
   re-inserts it (with its current `body`, possibly already updated by a `replace` on the same `lineno` in
   this same patch — R4.3's composition) at the new key. This single pass over `patch`, applied to one working
   map seeded from the *original* listing, is what makes a same-patch swap or compose coherent, since no
   intermediate `finalByLine` state is ever read by a later rule before the whole map is built.
7. For each `renumber` op: if `op.new_lineno` is not in `expectedLines`, `return refuse(...)`.
8. If `finalByLine.size !== (number of distinct keys expected)` — i.e., two ops produced the same final
   key — `return refuse("line numbers collide after patch")`.
9. For each `renumber` op: evaluate step 10's checksum rule on `finalByLine.get(op.new_lineno)` alone; if that
   single-line evaluation would refuse (step 10's "else" branch) or would require force, `return refuse("renumber
   target still fails its checksum")`.
10. For every line touched by the patch (every key that is an op's `lineno` or `new_lineno`): look up its
    `printed`.
    - `printed === null`: `status = "unverified"`.
    - `computeChecksum(line.n, line.body) === printed`: `status = "verified"`.
    - else, try each of the ≤ 64 digit-substitution readings (R4.14) of `printed`; if one's recomputed value
      equals `computeChecksum(...)`, `status = "digit-misread"`, record the reading in `why`.
    - else: if `options.force_unverified && (options.refusalCounts?.[line.n] ?? 0) >= 2`, `status = "forced"`;
      else `return refuse("printed " + printed + " but computed " + computeChecksum(...) + " for line " +
      line.n)`.
11. Build `perOp` from the patch's own ops (one entry per input op, using each op's resulting line's final
    `printed`/`computed`/status), build `listing` by replacing/renumbering entries in the original listing per
    `finalByLine`, and return `verdict: "forced"` if any touched line is `"forced"`, else `"accepted"`.

**Error handling**: `applyPatch` never throws for any input shape covered by `PatchOp`; a malformed/unexpected
shape at the MCP boundary (e.g. extra properties) is treated as an unknown op type (step 4) and refused.
`reason` is always a plain string, never an exception message.

## `src/gate/contract.ts`

```ts
export interface ContractInput {
  listing: CanonicalListing;
  expectedLines: readonly number[];
  titleSeen: boolean;
  postTitle: "pass" | "fail" | "not-reached";
  residentBytes: Uint8Array;
  provisional: ReadonlySet<number>;
}

export type Verdict = "RESURRECTED" | "BOOTED-PARTIAL" | "NOT-RESURRECTED";

export interface ContractResult {
  verdict: Verdict;
  counts: {
    verified: number; digitMisread: number; eyeVerified: number; forced: number; unverified: number;
    typed: number; missing: number; orphansExcluded: number;
  };
  failed: { clause: 1 | 2 | 3 | 4 | 5 | 6; lines: number[] }[];
  heading: string;
}

export function evaluate(input: ContractInput): ContractResult;
```

**Algorithm**:

1. `inScope = listing.filter(l => input.expectedLines.includes(l.n))`; `orphans = listing.filter(l =>
   !input.expectedLines.includes(l.n))`.
2. `missingNumbers = expectedLines.filter(n => !inScope.some(l => l.n === n))`;
   `dupNumbers = inScope's numbers appearing more than once`.
3. `counts`: tally `inScope` by `status`; `typed = inScope.length`; `missing = missingNumbers.length`;
   `orphansExcluded = orphans.length`.
4. `clause1 = titleSeen`; `clause2 = postTitle === "pass"`; `clause3 = missingNumbers.length === 0 &&
   dupNumbers.length === 0`; `clause4 = inScope.every(l => (l.status === "verified" || l.status ===
   "digit-misread" || l.status === "eye-verified") && !provisional.has(l.n))`; `clause5 = inScope.every(l =>
   l.status !== "forced")`; `clause6 = bytesEqual(residentBytes, tokenizeProgram(inScope.map(l => ({ n: l.n,
   body: l.body }))))`.
5. `if (!clause1) return { verdict: "NOT-RESURRECTED", counts, failed: [], heading: headingFor(...) }`.
6. `if (clause2 && clause3 && clause4 && clause5 && clause6) return { verdict: "RESURRECTED", counts, failed:
   [], heading: headingFor(...) }`.
7. Else `verdict = "BOOTED-PARTIAL"`; `failed` collects one entry per failing clause among 2–6 (clause 1
   cannot fail here, since step 5 already returned), with `lines` populated per R5.6 for clauses 3, 4, 5 and
   empty for clauses 2 and 6.
8. `heading = headingFor(titleSeen, verdict, k = count of inScope with status in {verified, digit-misread,
   eye-verified}, n = expectedLines.length)`, formatted per R5.8.

`bytesEqual` is a straightforward length-then-byte-by-byte `Uint8Array` comparison; no shortcuts that could
mask a length mismatch as equality.

**Error handling**: `evaluate` never throws; a missing/empty `expectedLines` yields `n = 0` in the heading and
vacuously-true inventory/byte clauses, which is intentionally the "nothing expected, nothing to resurrect"
degenerate case, not a special-cased error path.

## Correctness properties

Property tests live in `tests/prop/`, one file per property, `fc.assert(fc.property(...), { numRuns: 100 })`
or stricter. Each links back to the EARS ids it exists to validate.

**P1 — checksum ignores every space.**
For any `lineNo` and any `body`, inserting or removing literal space characters anywhere in `body` (outside a
`{…}` token's own braces) never changes `computeChecksum(lineNo, body)`.
Validates: R2.2, R2.1.

**P2 — notation round-trip.**
For any `codes` produced by `parseBody` on a generated body of only recognized tokens and typeable characters
(no `dropped` entries), `parseBody(render(codes)).codes` deep-equals `codes`. (This property is restricted to
inputs with no `dropped` entries, since a dropped character has no code to round-trip through `render` in the
first place.)
Validates: R1.1, R1.2, R1.3, R1.4, R1.5, R1.8.

**P3 — tokenizer bytes equal the real C64's bytes.**
For any small generated single-line BASIC V2 program body (drawn from a generator restricted to the keyword
table, digits, operators, and quoted strings — characters `crunchLine` is specified to handle), the bytes
`tokenizeProgram([{ n: lineNo, body }])` produces equal `dumpBasic(core)` after `bootNodeCore()`, `NEW`, and
typing that exact line via `typedLine(lineNo, body)` into the real core (`src/emu/core.ts`'s `loadProgram` +
`dumpBasic`). This is the one property that touches the real emulator; it is slow (one booted core reused
across cases) and lives in its own file per `tasks.md`'s last task.
Validates: R3.2–R3.13, and indirectly R1.9–R1.13 (the bytes typed must be what `typedLine` produces).

**P4 — the gate never accepts an empty body or an insert.**
For any listing, any `expectedLines`, and any patch containing at least one `replace` op whose `new_body` is
empty, or at least one op whose `type` is not `"replace"`/`"renumber"`, `applyPatch(...).verdict` is always
`"refused"` — regardless of any other op in the same patch, any `force_unverified` value, or any
`refusalCounts` value.
Validates: R4.4, R4.6, R4.22.

**P5 — any accepted patch leaves every in-scope printed-checksum line valid or digit-misread.**
For any listing and patch where `applyPatch(...).verdict` is `"accepted"`, every line in the resulting listing
whose `printed` is non-null has `computeChecksum(line.n, line.body) === line.printed` OR a digit-misread
reading (R4.14) of `line.printed` equals that computed value.
Validates: R4.13, R4.14, R4.15, R4.19.

**P6 — RESURRECTED implies zero forced and zero unverified.**
For any `ContractInput` where `evaluate(input).verdict === "RESURRECTED"`, every in-scope line's `status` is
`"verified"`, `"digit-misread"`, or `"eye-verified"` — never `"forced"` and never `"unverified"`.
Validates: R5.3 clauses 4–5, R5.4's parenthetical.

**P7 — replaying an accepted patch sequence is deterministic.**
For any listing and any sequence of patches that each independently gate-accept when applied in order starting
from that listing, re-running the same sequence from the same starting listing twice yields deep-equal final
listings (and, hashing each final listing's `(n, body, status)` tuples in order, identical hashes).
Validates: R4.23, R6.2.
