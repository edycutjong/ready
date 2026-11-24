/**
 * P3 (R3.1–R3.13, R1.9–R1.13): tokenizer.ts bytes == the bytes the REAL C64 stores at $0801 after the same
 * line(s) are typed through the KERNAL keyboard buffer. One booted core is reused for every case.
 * (a) generated single lines (keyword text, digits, operators, one quoted string) — 100 runs;
 * (b) every fixture, 100 OCR-style mutations each — committed authored fixtures always; the 1984 magazine fixtures
 *     only when READY_GAZETTE_FIXTURES points at a local JSON file (they are never committed: rights, tier C).
 * Measured (task 12.3, 2026-11-25, M-series Mac, Node 22): `npm test` 41 s with this file, 8 s without it
 * (committed fixtures only). With READY_GAZETTE_FIXTURES (randnum 28 lines + Power BASIC 68 lines) this file
 * alone takes 296 s. numRuns stays 100 everywhere (R6.4); nothing was lowered.
 * Out of P3's scope, because the real C64 cannot store them as typed (each pinned in core-typing-edges.test.ts):
 * a body starting with a digit, a control code outside quote mode, a body with nothing typeable.
 */
import fc from "fast-check";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { bootNodeCore } from "../../src/emu/node.ts";
import { type C64Core, dumpBasic, loadProgram } from "../../src/emu/core.ts";
import { controlOutsideQuotes, typedLine } from "../../src/basic/notation.ts";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";
import { splitLine } from "../../src/basic/checksum.ts";
import { ATOMS, mutate, ocrChar } from "./arbs.ts";

type Line = { n: number; body: string };
let core: C64Core;
beforeAll(async () => { core = await bootNodeCore(); }, 120_000);

const tally = { compared: 0, skipped: 0 };
const skip = () => { tally.skipped++; return true; };
/** Skips are counted, never silent: every property asserts at least 70% of its cases were really compared. */
function assertMostlyCompared(before: { compared: number; skipped: number }) {
  const c = tally.compared - before.compared, k = tally.skipped - before.skipped;
  expect(c / Math.max(1, c + k)).toBeGreaterThanOrEqual(0.7);
  return { compared: c, skipped: k };
}

function typeAndCompare(lines: Line[]): boolean {
  const typed = lines.map((l) => typedLine(l.n, l.body));
  if (typed.some((t) => t.tooLong)) return skip(); // R1.13: not typeable in one screen-editor line → out of scope
  // A body whose first typed character is a digit merges into the line number when typed (the C64 reads
  // "10" + "0RINT" as line 100): not faithfully typeable, so out of P3's scope. Contract clause 6 catches it on a
  // real run, and tests/unit/core-typing-edges.test.ts pins the real machine's behaviour.
  // A control code outside quote mode is executed by the screen editor, not stored ({CLR} wipes the line):
  // not faithfully typeable either (core-typing-edges.test.ts pins it).
  if (typed.some((t) => controlOutsideQuotes(t.codes).length > 0)) return skip();
  // A body with nothing typeable reaches the machine as a bare line number, which deletes the line (the gate
  // refuses such a body: R4.4 tightened).
  if (typed.some((t, i) => t.codes.length === String(lines[i].n).length)) return skip();
  if (typed.some((t, i) => /^\d/.test(String.fromCharCode(...t.codes.slice(String(lines[i].n).length, String(lines[i].n).length + 1))))) return skip();
  loadProgram(core, [...lines].sort((a, b) => a.n - b.n).map((l) => typedLine(l.n, l.body).codes));
  const resident = dumpBasic(core);
  const image = tokenizeProgram(lines);
  if (resident.length !== image.length || resident.some((b, i) => b !== image[i])) {
    let i = 0; while (i < image.length && resident[i] === image[i]) i++;
    let at = 0, ln = "?"; for (const l of [...lines].sort((a, b) => a.n - b.n)) { const len = 5 + tokenizeProgram([l]).length - 2 - 0; if (i < at + len) { ln = JSON.stringify(l); break; } at += len; }
    tally.compared++;
    throw new Error(`mismatch at byte ${i} in line ${ln}\n C64 …${[...resident.slice(Math.max(0, i - 6), i + 12)].join(",")}\n tok …${[...image.slice(Math.max(0, i - 6), i + 12)].join(",")}`);
  }
  tally.compared++;
  return true;
}

const fixtures: { name: string; lines: Line[] }[] = readdirSync(new URL("../fixtures/", import.meta.url))
  .filter((f) => f.endsWith(".bas"))
  .map((f) => ({ name: f, lines: readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8").split("\n").filter((l) => /^\d/.test(l)).map(splitLine).map((s) => ({ n: s.n!, body: s.body })) }));
const local = process.env.READY_GAZETTE_FIXTURES;
if (local && existsSync(local)) fixtures.push(...(JSON.parse(readFileSync(local, "utf8")) as { name: string; lines: Line[] }[]));

describe("P3: tokenizer = KERNAL-typed $0801 bytes", () => {
  it("(a) generated single lines, 100 runs", () => {
    const gen = fc.record({
      n: fc.integer({ min: 0, max: 63999 }),
      parts: fc.array(fc.constantFrom(...ATOMS, " "), { minLength: 1, maxLength: 10 }),
      quoted: fc.option(fc.stringMatching(/^[A-Z0-9 .,!?]{0,10}$/), { nil: undefined }),
    }).map(({ n, parts, quoted }) => ({ n, body: parts.join("") + (quoted !== undefined ? `"${quoted}"` : "") }));
    const before = { ...tally };
    fc.assert(fc.property(gen, (l) => typeAndCompare([l])), { numRuns: 100 });
    console.log("P3 (a)", assertMostlyCompared(before));
  });
  for (const fx of fixtures) {
    it(`(b) ${fx.name}: ${fx.lines.length} lines, 100 OCR-style mutations`, () => {
      const gen = fc.array(fc.tuple(fc.nat(), fc.nat(), ocrChar), { minLength: 0, maxLength: 3 }).map((muts) => {
        const lines = fx.lines.map((l) => ({ ...l }));
        for (const [li, ci, c] of muts) { const l = lines[li % lines.length]; l.body = mutate(l.body, ci, c); }
        return lines;
      });
      const before = { ...tally };
      fc.assert(fc.property(gen, (lines) => typeAndCompare(lines)), { numRuns: 100 });
      console.log(`P3 (b) ${fx.name}`, assertMostlyCompared(before));
    }, 900_000); // a 68-line fixture types ~1.7 s per case on the real core
  }
  it("covers at least one committed fixture", () => { expect(fixtures.length).toBeGreaterThan(0); });
});
