/**
 * Task 6.5, P1 (R2.1, R2.2): the checksum ignores every literal space.
 * A body and a variant that differ only in literal spaces outside `{...}` tokens have the same checksum.
 */
import fc from "fast-check";
import { describe, it } from "vitest";
import { computeChecksum } from "../../src/basic/checksum.ts";
import { TOKENS } from "../../src/basic/notation.ts";

const names = Object.keys(TOKENS);

// One atomic part of a body: a single character other than `{` (spaces included, quotes included, lower case,
// punctuation, non-typeable ASCII), or a whole token whose own inner space must never be touched.
const charPart = fc.integer({ min: 32, max: 126 }).filter((c) => c !== 123).map((c) => String.fromCharCode(c));
const tokenPart = fc
  .tuple(fc.constantFrom(...names), fc.integer({ min: 0, max: 9 }), fc.constantFrom("", "S"))
  .map(([name, n, plural]) => (plural ? `{${n} ${name}S}` : `{${name}}`));
const parts = fc.array(fc.oneof({ weight: 8, arbitrary: charPart }, { weight: 2, arbitrary: tokenPart }), { maxLength: 30 });

describe("P1: checksum ignores every space", () => {
  it("inserting or removing literal spaces outside token braces never changes the sum", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 63999 }),
        parts,
        fc.array(fc.nat(3), { maxLength: 31 }), // extra spaces to insert before each part
        (lineNo, ps, extra) => {
          const original = ps.join("");
          const stripped = ps.filter((p) => p !== " ").join("");
          const padded = ps.map((p, i) => " ".repeat(extra[i] ?? 0) + p).join("") + " ".repeat(extra[ps.length] ?? 0);
          const sum = computeChecksum(lineNo, original);
          return computeChecksum(lineNo, stripped) === sum && computeChecksum(lineNo, padded) === sum;
        },
      ),
      { numRuns: 100 },
    );
  });
});
