/**
 * BASIC V2 tokenizer: what the KERNAL stores at $0801 for a typed line (R3). Pure and isomorphic.
 * The keyword table and the crunch scan live in `keywords.ts` (see the note there on why); this file
 * adds the line record (link, number, terminator) and the whole-program image.
 */
import { crunch, KEYWORDS } from "./keywords.ts";
import { parseBody } from "./notation.ts";

/** R3.1: re-exported so `tokenizer.ts` remains the public home of the table. */
export { KEYWORDS };

/** R3.11: where BASIC text starts (matches `BASIC_START` in src/emu/core.ts). */
export const BASIC_START = 0x0801;

export interface TokenizedLine {
  /** Address the line was assembled at. The next line starts at `startAddr + bytes.length`. */
  startAddr: number;
  /** link (2, LE) + line number (2, LE) + crunched tokens + 0x00 (R3.10). */
  bytes: Uint8Array;
}

/**
 * R3.2-R3.8, R3.10: crunch one line. `body` is typed text (char code = byte), the form
 * `notation.ts#parseBody` produces; `tokenizeProgram` does that conversion for Gazette notation
 * (design.md, "Input to the tokenizer").
 * The link already points at the next line (`startAddr + total length`), so no placeholder pass is needed.
 */
export function crunchLine(lineNo: number, body: string, startAddr: number): TokenizedLine {
  const tokens = crunch(body).bytes;
  const total = 2 + 2 + tokens.length + 1;
  const link = (startAddr + total) & 0xffff;
  const out = new Uint8Array(total);
  out[0] = link & 0xff;
  out[1] = link >> 8;
  out[2] = lineNo & 0xff;
  out[3] = (lineNo >> 8) & 0xff;
  out.set(tokens, 4);
  out[total - 1] = 0; // R3.10 terminator (already 0; stated for the reader)
  return { startAddr, bytes: out };
}

/** R3.9: keep the LAST occurrence of each line number (screen-editor replace), ascending by number. */
function dedupAndSort(lines: readonly { n: number; body: string }[]): { n: number; body: string }[] {
  const byNumber = new Map<number, string>();
  for (const l of lines) byNumber.set(l.n, l.body);
  return [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([n, body]) => ({ n, body }));
}

/** Gazette notation -> typed text (char code = byte): what the keyboard buffer would have delivered. */
function typedText(body: string): string {
  return parseBody(body).codes.map((c) => String.fromCharCode(c)).join("");
}

/**
 * R3.9-R3.12: the whole program image: sorted, de-duplicated lines threaded by link addresses from
 * $0801, closed by the 2-byte `0,0` end link. Empty input yields exactly `[0, 0]`.
 * Each `body` is Gazette notation. It is typed through `parseBody` first (design.md), so the bytes
 * compared by contract clause 6 are what a keyboard would have put in memory, not raw OCR text.
 */
export function tokenizeProgram(lines: readonly { n: number; body: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let addr = BASIC_START;
  for (const { n, body } of dedupAndSort(lines)) {
    const line = crunchLine(n, typedText(body), addr);
    parts.push(line.bytes);
    addr += line.bytes.length; // R3.11
  }
  parts.push(new Uint8Array(2)); // R3.12
  const image = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) { image.set(p, at); at += p.length; }
  return image;
}
