/**
 * Task 5.4, P2 (R1.1-R1.5, R1.8): notation round trip.
 * For bodies built only from recognised tokens and typeable characters,
 * `parseBody(render(parseBody(body).codes)).codes` equals `parseBody(body).codes`.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TOKENS, parseBody, render } from "../../src/basic/notation.ts";

const names = Object.keys(TOKENS);
const mixCase = (s: string, flips: boolean[]): string => [...s].map((c, i) => (flips[i % flips.length] ? c.toLowerCase() : c)).join("");

const bareToken = fc
  .tuple(fc.constantFrom(...names), fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }))
  .map(([name, flips]) => `{${mixCase(name, flips)}}`);

const countedToken = fc
  .tuple(fc.constantFrom(...names), fc.integer({ min: 0, max: 12 }), fc.boolean(), fc.nat(3))
  .map(([name, n, plural, zeros]) => `{${"0".repeat(zeros)}${n} ${name}${plural ? "S" : ""}}`);

// Every typeable character: space..underscore, plus lower-case letters (folded by R1.5). `{` is excluded:
// it is not typeable (123) and would start a group.
const typeable = fc
  .oneof(fc.integer({ min: 32, max: 95 }), fc.integer({ min: 97, max: 122 }))
  .map((c) => String.fromCharCode(c));

const part = fc.oneof({ weight: 6, arbitrary: typeable }, { weight: 2, arbitrary: bareToken }, { weight: 2, arbitrary: countedToken });
const typeableBody = fc.array(part, { maxLength: 30 }).map((parts) => parts.join(""));

describe("P2: notation round trip", () => {
  it("parseBody(render(codes)).codes deep-equals codes", () => {
    fc.assert(
      fc.property(typeableBody, (body) => {
        const { codes, dropped } = parseBody(body);
        expect(dropped).toEqual([]); // the generator only draws typeable text
        expect(parseBody(render(codes)).codes).toEqual(codes);
        expect(parseBody(render(codes)).dropped).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
