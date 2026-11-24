/**
 * Shared vocabulary of the oracle, the gate and the contract (design.md, "Shared types").
 * Pure types only: no runtime code, no I/O. Defined once so the status strings exist in exactly one place.
 */

/**
 * Exactly these five strings, never any other (requirements.md, "Shared vocabulary").
 * `eye-verified` is set only by a human reviewer action outside the oracle modules; the other four
 * are set only by `checksum-gate.ts`.
 */
export type LineStatus = "verified" | "digit-misread" | "eye-verified" | "forced" | "unverified";

export interface CanonicalLine {
  /** Line number, 0-63999. */
  n: number;
  /** Gazette-notation text as OCR'd/edited, excluding the trailing `:rem NNN`. */
  body: string;
  /** `parsePrinted`'s result (0-255), or `null` when the printed checksum is unparseable. */
  printed: number | null;
  status: LineStatus;
  /** Free-form provenance tag, e.g. "ocr" | "gate" | "human". */
  source: string;
}

export type CanonicalListing = CanonicalLine[];

/** A character `parseBody` could not type: reported, never silently discarded (R1.6). */
export interface Dropped {
  /** Index of the character in the original `body` string. */
  index: number;
  /** The original, un-folded character. */
  char: string;
}

export interface ParseBodyResult {
  codes: number[];
  dropped: Dropped[];
}

export interface TypedLineResult {
  codes: number[];
  dropped: Dropped[];
  tooLong: boolean;
}
