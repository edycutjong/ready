/**
 * BASIC V2 keyword table and the KERNAL's crunch scan (R3.1-R3.8). Pure and isomorphic.
 *
 * Why this is its own file: `tokenizer.ts` must call `notation.ts#parseBody` (design.md: tokenizeProgram
 * types each body first) while `notation.ts` needs the keyword table and the crunch scan for abbreviation
 * (R1.11). Holding both here keeps the import graph acyclic. `tokenizer.ts` re-exports `KEYWORDS`, so
 * the table still exists exactly once and is still importable from `tokenizer.ts` (R3.1).
 *
 * TEXT MODEL. Everything here works on "typed text": a JS string whose char codes ARE the bytes the
 * keyboard buffer delivered (PETSCII 0-255). Gazette notation is resolved to this form by `parseBody`.
 *
 * MEASURED ON THE REAL C64 (c64-ready@3.4.0, KERNAL ROM; locked by tests/unit/tokenizer-rom.test.ts).
 * Where the written R3.7/R3.8 differ from the machine, the machine wins, because R3's purpose is
 * "the KERNAL's own tokenizing, byte for byte":
 *   - R3.7 says any byte >= 0x80 after a keyword prefix abbreviates it. The ROM only accepts the
 *     shifted byte when it is `keyword[i] | 0x80` at index 1 <= i <= len-2 (never the last letter:
 *     `I`+shift-F is not IF, `FO`+shift-R is not FOR). Measured: P+shift-A stores just `P`.
 *   - R3.8 says a stray byte >= 0x80 is copied unchanged. The ROM DROPS it everywhere except inside a
 *     quoted string and after REM. Only $FF (pi) is kept. Measured: `DATA A<shift-A>B` stores `A B`.
 */

/** R3.1: BASIC V2 keyword table in ROM order; index 0 = $80 (END), index 75 = $CB (GO). */
export const KEYWORDS: readonly string[] = [
  "END", "FOR", "NEXT", "DATA", "INPUT#", "INPUT", "DIM", "READ", "LET", "GOTO",
  "RUN", "IF", "RESTORE", "GOSUB", "RETURN", "REM", "STOP", "ON", "WAIT", "LOAD",
  "SAVE", "VERIFY", "DEF", "POKE", "PRINT#", "PRINT", "CONT", "LIST", "CLR", "CMD",
  "SYS", "OPEN", "CLOSE", "GET", "NEW", "TAB(", "TO", "FN", "SPC(", "THEN",
  "NOT", "STEP", "+", "-", "*", "/", "^", "AND", "OR", ">",
  "=", "<", "SGN", "INT", "ABS", "USR", "FRE", "POS", "SQR", "RND",
  "LOG", "EXP", "COS", "SIN", "TAN", "ATN", "PEEK", "LEN", "STR$", "VAL",
  "ASC", "CHR$", "LEFT$", "RIGHT$", "MID$", "GO",
];

/** Token byte of keyword index 0. */
export const FIRST_TOKEN = 0x80;

const QUOTE = 0x22;
const COLON = 0x3a;
const QUESTION = 0x3f;
const PI = 0xff;
const SHIFT_BIT = 0x80;

const INDEX_OF = (name: string): number => KEYWORDS.indexOf(name);
const REM_INDEX = INDEX_OF("REM");
const DATA_INDEX = INDEX_OF("DATA");
const PRINT_TOKEN = FIRST_TOKEN + INDEX_OF("PRINT");

export interface KeywordMatch {
  /** Index into `KEYWORDS`; the token byte is `FIRST_TOKEN + index`. */
  index: number;
  /** How many characters of the text the match consumes. */
  length: number;
}

/** Fold ASCII a-z to A-Z (design.md: keyword matching is case-insensitive). Other codes unchanged. */
function fold(code: number): number {
  return code >= 97 && code <= 122 ? code - 32 : code;
}

/** Does `text` at `pos` match keyword `kw`, fully or as an abbreviation? Returns chars consumed, or 0. */
function matchOne(kw: string, text: string, pos: number): number {
  const last = kw.length - 1;
  for (let i = 0; i <= last; i++) {
    const raw = text.charCodeAt(pos + i); // NaN past the end: never equal to anything
    const want = kw.charCodeAt(i);
    if (fold(raw) === want) {
      if (i === last) return kw.length; // full text matched
      continue;
    }
    // R3.7 (as measured): prefix of >= 1 letters, then the NEXT letter with bit 7 set, not the last letter.
    if (i >= 1 && i < last && raw === (want | SHIFT_BIT)) return i + 1;
    return 0;
  }
  return 0;
}

/**
 * R3.2 + R3.7: scan KEYWORDS in table order, the first entry that matches at `pos` wins. This is why
 * `P`+shift-R is PRINT# ($98, listed first), not PRINT ($99), and `GO` loses to `GOTO`/`GOSUB`.
 */
export function matchKeywordAt(text: string, pos: number): KeywordMatch | null {
  for (let index = 0; index < KEYWORDS.length; index++) {
    const length = matchOne(KEYWORDS[index]!, text, pos);
    if (length > 0) return { index, length };
  }
  return null;
}

export interface CrunchedKeyword extends KeywordMatch {
  /** Index in the text where the keyword (or its abbreviation) starts. */
  start: number;
}

export interface CrunchResult {
  /** The crunched bytes of the text (no link, line number or terminator). */
  bytes: number[];
  /** Every keyword the scan crunched, in order: what a typist could abbreviate (R1.11). */
  keywords: CrunchedKeyword[];
}

/**
 * R3.2-R3.8: crunch typed text the way the KERNAL does. One left-to-right pass with three modes:
 * inside quotes (R3.4), after REM (R3.5), after DATA until an unquoted `:` (R3.6).
 * Never throws; the model has no error channel (design.md).
 */
export function crunch(text: string): CrunchResult {
  const bytes: number[] = [];
  const keywords: CrunchedKeyword[] = [];
  let inQuote = false;
  let remMode = false;
  let dataMode = false;
  let pos = 0;
  while (pos < text.length) {
    const c = text.charCodeAt(pos);
    if (c > 0xff) { pos++; continue; } // not a byte: nothing a keyboard could have delivered
    if (remMode) { bytes.push(c); pos++; continue; } // R3.5
    if (c === QUOTE) { inQuote = !inQuote; bytes.push(c); pos++; continue; } // R3.4 (also inside DATA)
    if (inQuote) { bytes.push(c); pos++; continue; } // R3.4: no crunch, no `?`, no abbreviation
    // R3.8 (as measured): outside quotes and REM the ROM drops every byte >= $80 except pi.
    if (c >= SHIFT_BIT && c !== PI) { pos++; continue; }
    if (dataMode) { // R3.6
      if (c === COLON) dataMode = false;
      bytes.push(c);
      pos++;
      continue;
    }
    if (c === QUESTION) { bytes.push(PRINT_TOKEN); pos++; continue; } // R3.3
    const m = matchKeywordAt(text, pos);
    if (!m) { bytes.push(c); pos++; continue; }
    bytes.push(FIRST_TOKEN + m.index);
    keywords.push({ ...m, start: pos });
    if (m.index === REM_INDEX) remMode = true;
    if (m.index === DATA_INDEX) dataMode = true;
    pos += m.length;
  }
  return { bytes, keywords };
}
