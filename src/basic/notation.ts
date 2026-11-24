/**
 * Gazette notation -> the PETSCII key codes a 1984 reader would have typed (R1). Pure and isomorphic.
 *
 * The `{...}` grammar (R1.1, R1.2, R1.7) is recognised in ONE place, `scanBody`. `parseBody` here and
 * `computeChecksum` in checksum.ts both consume its segments, so the two can never disagree about what a
 * token is (R2.3); they differ only in what they count (R1.3-R1.6 typing vs R2.2-R2.5 summing).
 */
import { KEYWORDS, crunch, matchKeywordAt } from "./keywords.ts";
import type { Dropped, ParseBodyResult, TypedLineResult } from "./types.ts";

/** R1.1: token name -> PETSCII code. Same table as .kiro/steering/gazette-notation.md. */
export const TOKENS: Readonly<Record<string, number>> = Object.freeze({
  CLR: 147, HOME: 19, DOWN: 17, UP: 145, RIGHT: 29, LEFT: 157, RVS: 18, OFF: 146,
  F1: 133, F3: 134, F5: 135, F7: 136,
  BLK: 144, WHT: 5, RED: 28, CYN: 159, PUR: 156, GRN: 30, BLU: 31, YEL: 158,
  SPACE: 32,
});

/**
 * Largest `n` accepted in `{n NAME}`. The spec sets no limit; without one, OCR garbage such as
 * `{99999999999 DOWN}` would ask for billions of codes. A group above the limit is treated as an unknown
 * token (R1.7): its characters are typed literally and its braces are reported in `dropped`, never silent.
 * A line holds at most 80 typed codes, so no genuine repeat comes near this.
 */
export const MAX_REPEAT = 999;

/** A recognised `{NAME}` / `{n NAME}` / `{n NAMES}` group. `count` is `n` (1 for a bare `{NAME}`). */
export interface TokenGroup {
  kind: "group";
  name: string;
  count: number;
  /** Index of `{` in the body, and index just past the closing `}`. */
  start: number;
  end: number;
}

/** One literal character (a full code point) at `index`, to be typed/summed under the plain rules. */
export interface LiteralChar {
  kind: "char";
  index: number;
  char: string;
}

export type BodySegment = TokenGroup | LiteralChar;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** R1.1/R1.2 for the text between the braces. Null means "not a known token" (R1.7). */
function parseGroupInner(inner: string): { name: string; count: number } | null {
  // Names may contain digits (F1, F3, F5, F7), so the name pattern is a letter then letters/digits.
  const counted = /^([0-9]+) ([A-Za-z][A-Za-z0-9]*)$/.exec(inner); // R1.2: digit run, then exactly one space
  const bare = /^([A-Za-z][A-Za-z0-9]*)$/.exec(inner); // R1.2: bare {NAME}, implicit n = 1; R1.1: exact names only
  if (!counted && !bare) return null;
  const word = (counted ? counted[2]! : bare![1]!).toUpperCase();
  if (hasOwn(TOKENS, word)) {
    return finish(word, counted ? counted[1]! : "1");
  }
  // R1.2: the plural NAMES is accepted regardless of n, but only in the counted form.
  if (counted && word.endsWith("S") && hasOwn(TOKENS, word.slice(0, -1))) {
    return finish(word.slice(0, -1), counted[1]!);
  }
  return null;
}

function finish(name: string, digits: string): { name: string; count: number } | null {
  const count = Number(digits); // leading zeros allowed (R1.2); 0 is valid and types nothing
  return count <= MAX_REPEAT ? { name, count } : null;
}

/** Push each code point of `body[from, to)` as a LiteralChar segment. */
function pushLiterals(body: string, from: number, to: number, out: BodySegment[]): void {
  let i = from;
  while (i < to) {
    const cp = body.codePointAt(i)!;
    const char = String.fromCodePoint(cp);
    out.push({ kind: "char", index: i, char });
    i += char.length;
  }
}

/**
 * Split a body into token groups and literal characters, left to right.
 *  - a known group becomes one TokenGroup;
 *  - an unknown group (R1.7) becomes literal chars from `{` through its `}` inclusive, so a `{` nested
 *    inside it is NOT re-read as a token start;
 *  - a `{` with no `}` anywhere after it (R1.7, unterminated) makes the rest of the body literal.
 */
export function scanBody(body: string): BodySegment[] {
  const out: BodySegment[] = [];
  let pos = 0;
  while (pos < body.length) {
    if (body[pos] !== "{") {
      const width = body.codePointAt(pos)! > 0xffff ? 2 : 1; // an astral char spans two UTF-16 units
      pushLiterals(body, pos, pos + width, out);
      pos += width;
      continue;
    }
    const close = body.indexOf("}", pos);
    if (close === -1) { // unterminated
      pushLiterals(body, pos, body.length, out);
      break;
    }
    const group = parseGroupInner(body.slice(pos + 1, close));
    if (group) {
      out.push({ kind: "group", ...group, start: pos, end: close + 1 });
    } else { // unknown
      pushLiterals(body, pos, close + 1, out);
    }
    pos = close + 1;
  }
  return out;
}

const QUOTE = 34;

/** R1.5 + R1.6: fold ASCII a-z to upper case, then accept only 32-95. Returns null when untypeable. */
function typeableCode(char: string): number | null {
  const raw = char.length === 1 ? char.charCodeAt(0) : -1; // an astral char is never typeable
  const code = raw >= 97 && raw <= 122 ? raw - 32 : raw;
  return code >= 32 && code <= 95 ? code : null;
}

/**
 * R1.1-R1.8: the PETSCII codes a typist presses for `body`, plus every character that could not be typed.
 * Never throws and never guesses: an untypeable character is reported in `dropped` (R1.6).
 */
export function parseBody(body: string): ParseBodyResult {
  const codes: number[] = [];
  const dropped: Dropped[] = [];
  let inQuote = false;
  for (const seg of scanBody(body)) {
    if (seg.kind === "group") {
      for (let i = 0; i < seg.count; i++) codes.push(TOKENS[seg.name]!); // R1.1, R1.2 (0 times when n = 0)
      continue;
    }
    if (seg.char === " ") {
      if (inQuote) codes.push(32); // R1.4: a quoted space is typed
      continue; // R1.3: an unquoted space is not
    }
    const code = typeableCode(seg.char);
    if (code === null) {
      dropped.push({ index: seg.index, char: seg.char }); // R1.6: original, un-folded char
      continue;
    }
    if (code === QUOTE) inQuote = !inQuote;
    codes.push(code);
  }
  return { codes, dropped }; // R1.8: scan is left to right, so both lists are already in order
}

/** Code -> `{NAME}` for the fixed tokens, built once from TOKENS (a constant table, never mutated). */
const NAME_OF_CODE: ReadonlyMap<number, string> = new Map(Object.entries(TOKENS).map(([name, code]) => [code, name]));

/** What `render` writes for a code that `parseBody` can never have produced. parseBody reports it as dropped. */
const UNRENDERABLE = "\uFFFD";

/**
 * `parseBody`'s inverse, for codes with no `dropped` entries (R1.1-R1.5, design P2).
 * A control code becomes its `{NAME}`; 33-95 is its character. Code 32 is a literal space only inside
 * quotes: outside quotes parseBody would discard it (R1.3), so it is written `{SPACE}` to survive the round trip.
 */
export function render(codes: readonly number[]): string {
  let inQuote = false;
  let out = "";
  for (const code of codes) {
    if (code === QUOTE) inQuote = !inQuote;
    if (code === 32) out += inQuote ? " " : "{SPACE}";
    else if (code > 32 && code <= 95) out += String.fromCharCode(code);
    else out += NAME_OF_CODE.has(code) ? `{${NAME_OF_CODE.get(code)}}` : UNRENDERABLE;
  }
  return out;
}

/** The longest line the screen editor accepts: two 40-column rows (R1.10). */
const MAX_TYPED = 80;
const SHIFT = 0x80;
/** A typed code in A-Z: keeps a keyword "whole" (R1.11 boundary). */
const isLetter = (c: number | undefined): boolean => c !== undefined && c >= 65 && c <= 90;

/**
 * R1.11: pick the rightmost keyword occurrence that can be abbreviated, as an index range into `body`
 * (the typed codes of the body alone, without the line number). Returns null when none remains.
 *
 * An occurrence qualifies when ALL of these hold:
 *  - the real crunch scan reads it as a keyword in full (so it is outside quotes, REM and DATA,
 *    and is not already an abbreviation): `crunch(...).keywords`;
 *  - it is a whole token: no letter directly before or after it (R1.11);
 *  - it has >= 3 characters, so the two-code form is shorter (a 2-character keyword gains nothing);
 *  - its two-code form (first char, second char | 0x80) crunches back to the SAME keyword. On the real
 *    C64 that fails for PRINT (P+shift-R is PRINT#), INPUT, GOSUB, ...: abbreviating those would silently
 *    store a different program, so they are never abbreviated here.
 */
function rightmostAbbreviable(body: readonly number[]): { start: number; length: number } | null {
  const text = body.map((c) => String.fromCharCode(c)).join(""); // not spread: no argument-count limit
  const candidates = crunch(text).keywords.filter((k) => {
    const word = KEYWORDS[k.index]!;
    if (k.length !== word.length || word.length < 3) return false;
    if (isLetter(body[k.start - 1]) || isLetter(body[k.start + k.length])) return false;
    const short = String.fromCharCode(word.charCodeAt(0), word.charCodeAt(1) | SHIFT);
    const m = matchKeywordAt(short, 0);
    return m !== null && m.index === k.index && m.length === 2;
  });
  const last = candidates.at(-1);
  return last ? { start: last.start, length: last.length } : null;
}

/**
 * R1.9-R1.13: the full key sequence for a program line: the line number's digits, then the body's codes,
 * abbreviating keywords from the right while the line is over 80 codes.
 * `tooLong: true` is the only error signal; nothing is ever truncated or dropped to make a line fit (R1.12).
 */
export function typedLine(lineNo: number, body: string): TypedLineResult {
  const digits = [...String(lineNo)].map((d) => d.charCodeAt(0)); // R1.9
  const { codes, dropped } = parseBody(body);
  // the screen editor ignores trailing blanks, so they are never typed (claude-direct P1a fix, see tokenizer.ts)
  let end = codes.length;
  while (end > 0 && codes[end - 1] === 32) end--;
  const typed = codes.slice(0, end);
  while (digits.length + typed.length > MAX_TYPED) { // R1.11
    const hit = rightmostAbbreviable(typed);
    if (!hit) break;
    const first = typed[hit.start]!;
    const second = typed[hit.start + 1]! | SHIFT;
    typed.splice(hit.start, hit.length, first, second);
  }
  const full = [...digits, ...typed];
  return { codes: full, dropped, tooLong: full.length > MAX_TYPED }; // R1.10, R1.12, R1.13
}

/**
 * Positions of control codes that would be typed OUTSIDE quote mode: the C64 screen editor executes them
 * instead of storing them ({CLR} wipes the line being typed, {UP}/{HOME} move the cursor so later keys overwrite
 * other lines). On a Gazette page every control token sits inside quotes, so a hit means OCR lost or added a quote.
 * Such a line is not faithfully typeable; the loader must not type it (claude-direct P1a, found by the P3 property).
 */
export function controlOutsideQuotes(codes: readonly number[]): number[] {
  const hits: number[] = [];
  let quoted = false;
  codes.forEach((c, i) => {
    if (c === 34) { quoted = !quoted; return; }
    if (!quoted && c !== 13 && (c < 32 || (c >= 128 && c < 160))) hits.push(i);
  });
  return hits;
}
