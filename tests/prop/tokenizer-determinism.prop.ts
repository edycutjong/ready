/**
 * Task 3.3, P7-style (R3.13): `tokenizeProgram` returns byte-identical output for line sets that are
 * identical after R3.9's last-wins dedup, however the input is ordered or padded with stale duplicates.
 */
import fc from "fast-check";
import { describe, it } from "vitest";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";

type Line = { n: number; body: string };

// Bytes 32..255: letters, digits, quotes, `?`, `:`, plus shifted bytes the crunch must drop or keep by mode.
const body = fc.array(fc.integer({ min: 32, max: 255 }), { maxLength: 24 }).map((cs) => String.fromCharCode(...cs));
const line = fc.record({ n: fc.integer({ min: 0, max: 40 }), body }); // small range: many duplicates

/** Reference for R3.9, written independently of the implementation: scan from the end, keep first seen. */
function lastWins(lines: readonly Line[]): { final: Line[]; stale: Line[] } {
  const seen = new Set<number>();
  const final: Line[] = [];
  const stale: Line[] = [];
  const flags = new Array<boolean>(lines.length).fill(false);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (!seen.has(l.n)) { seen.add(l.n); final.push(l); flags[i] = true; }
  }
  lines.forEach((l, i) => { if (!flags[i]) stale.push(l); });
  return { final, stale };
}

describe("P7 (tokenizer slice): determinism after last-wins dedup", () => {
  it("is byte-identical for line sets equal after dedup", () => {
    fc.assert(
      fc.property(fc.array(line, { maxLength: 12 }), (lines) => {
        const { final, stale } = lastWins(lines);
        const a = tokenizeProgram(lines);
        const again = tokenizeProgram(lines);
        // Same final set, different order, with the stale duplicates placed BEFORE their winners.
        const b = tokenizeProgram([...stale, ...final]);
        // Final set alone, already sorted.
        const c = tokenizeProgram([...final].sort((x, y) => x.n - y.n));
        return same(a, again) && same(a, b) && same(a, c);
      }),
      { numRuns: 100 },
    );
  });
});

function same(x: Uint8Array, y: Uint8Array): boolean {
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
