/**
 * The Gazette 1984 per-line checksum oracle (R2). Pure and isomorphic.
 *
 * Measured 43/43 on a real June 1984 page (kill test F1): the sum of the ASCII codes of the line number's
 * digits and of the body, mod 256, where every literal space counts 0 (quoted or not), `{SPACE}` and
 * `{n SPACES}` count 0, other known tokens count their PETSCII code n times, and everything else counts
 * its raw code with NO case folding.
 *
 * R2.6 / steering rule: this module only COMPUTES. It never searches, enumerates or guesses a body that
 * produces a target sum. A match is evidence, never proof (a mod-256 sum collides easily).
 */
import { TOKENS, scanBody } from "./notation.ts";

const SPACE_TOKEN = "SPACE";

/** Sum of the UTF-16 code units of `s`. For ASCII this is exactly the ASCII codes (R2.5). */
function rawSum(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return sum;
}

/**
 * R2.1-R2.5. `lineNo` is a non-negative integer; its decimal digits are summed with no leading zeros (R2.1).
 * The `{...}` grammar comes from `notation.ts#scanBody`, so unknown and unterminated groups (R1.7) fall back
 * to their literal characters here exactly as they do when typed (R2.3, R2.5).
 */
export function computeChecksum(lineNo: number, body: string): number {
  let sum = rawSum(String(lineNo));
  for (const seg of scanBody(body)) {
    if (seg.kind === "group") {
      // R2.3: {SPACE} / {n SPACES} count 0 whatever n is. R2.4: any other known token counts code * n.
      if (seg.name !== SPACE_TOKEN) sum += TOKENS[seg.name]! * seg.count;
    } else if (seg.char !== " ") {
      // R2.2: every literal space, quoted or not, counts 0 (unlike the typist's R1.4).
      // R2.5: anything else counts its raw code, case preserved (unlike the typist's R1.5 fold).
      sum += rawSum(seg.char);
    }
  }
  return sum % 256;
}

/**
 * R2.7, R2.8: the checksum printed at the end of a line. Requires a `:rem`, whitespace, then 1-3 digits
 * forming 0-255, then only optional whitespace. Anything else is `null`: never a guess.
 * (design.md's pattern: whitespace after `rem` is required, so `:rem143` is unparseable, not 143.)
 */
export function parsePrinted(remText: string): number | null {
  const m = /:\s*rem\s+([0-9]{1,3})\s*$/i.exec(remText);
  if (!m) return null;
  const value = Number(m[1]);
  return value <= 255 ? value : null;
}

/** Highest legal BASIC line number. A longer or larger digit run at the start is not a line number. */
const MAX_LINE_NO = 63999;

/**
 * R2.9: split one raw OCR'd line into its line number, its body and its printed checksum.
 * The LAST `:rem` marks where the checksum starts. `body` is everything before it (or the whole remainder
 * when there is none) and `printed` is `parsePrinted` of the text from the marker on, so a garbled or
 * cut-off checksum gives `printed: null` while still being kept out of `body`.
 * A line with no checksum of its own but with a genuine `:REM` statement at its end would have that
 * statement taken as the marker; Gazette listings always end in the checksum REM, so this is accepted.
 */
export function splitLine(raw: string): { n: number | null; body: string; printed: number | null } {
  const head = /^\s*([0-9]+)\s*([\s\S]*)$/.exec(raw);
  const asNumber = head ? Number(head[1]) : NaN;
  const hasNumber = head !== null && asNumber <= MAX_LINE_NO;
  const n = hasNumber ? asNumber : null;
  const remainder = hasNumber ? head![2]! : raw; // no usable number: nothing is cut from the front
  let marker = -1;
  for (const m of remainder.matchAll(/:\s*rem\b/gi)) marker = m.index;
  if (marker === -1) return { n, body: remainder, printed: null };
  return { n, body: remainder.slice(0, marker), printed: parsePrinted(remainder.slice(marker)) };
}
