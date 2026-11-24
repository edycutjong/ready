/**
 * The patch gate (.kiro/specs/checksum-oracle R4). The ONLY path from a model's proposed fix to a changed listing.
 * Isomorphic and pure: it runs in the browser (Cheat, REPLAY), in the MCP server's apply_patch, and in the Kiro
 * Pre Tool Use hook, whose exit-2 STDERR is `reason` verbatim. The model chooses where to look; this decides.
 *
 * claude-direct (P1a, Kiro credit cap for this spec line reached — see docs/DX-REPORT.md), written to the Kiro
 * spec's requirement ids, evaluated in R4.11's fixed order.
 */
import { computeChecksum } from "../basic/checksum.ts";
import { parseBody } from "../basic/notation.ts";
import type { CanonicalLine, CanonicalListing, LineStatus } from "../basic/types.ts";

export type PatchOp =
  | { type: "replace"; lineno: number; new_body: string }
  | { type: "renumber"; lineno: number; new_lineno: number };

export interface GatePerOp { line: number; printed: number | null; computed: number | null; ok: boolean; why: string }

export type GateVerdict =
  | { verdict: "accepted"; perOp: GatePerOp[]; listing: CanonicalListing; reason: string }
  | { verdict: "forced"; perOp: GatePerOp[]; listing: CanonicalListing; reason: string }
  | { verdict: "refused"; perOp: GatePerOp[]; reason: string };

export interface GateOptions {
  force_unverified?: boolean;
  refusalCounts?: Readonly<Record<number, number>>; // lineno -> caller-tracked refusal count (the hook owns it)
}

/** R4.7: the cap on how much of a line one `replace` may change (decision: OCR typos, not rewrites; M1 max true fix 21%). */
export const MAX_EDIT_RATIO = 0.4;

/** R4.14: frozen confusable readings of a printed checksum digit (measured, kill test REPORT row 2; spike O added none). */
export const DIGIT_CONFUSABLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "0": ["8", "9", "6"], "8": ["0"], "9": ["0"], "6": ["0"],
});

const refuse = (reason: string, perOp: GatePerOp[] = []): GateVerdict => ({ verdict: "refused", perOp, reason });

/** Levenshtein distance (iterative, two rows). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** R4.7: edit ratio with every space removed, over the longer spaces-removed length. */
export function editRatio(before: string, after: string): number {
  const a = before.replace(/ /g, ""), b = after.replace(/ /g, "");
  const m = Math.max(a.length, b.length);
  return m === 0 ? 0 : levenshtein(a, b) / m;
}

/**
 * R4.14: every reading of `printed` obtained by substituting zero or more digits with their frozen confusables
 * (≤ 3 positions × ≤ 4 values = ≤ 64), kept only if 0–255. Returns readings other than `printed` itself.
 */
export function confusableReadings(printed: number): number[] {
  const digits = String(printed).split("");
  let acc = [""];
  for (const d of digits) {
    const opts = [d, ...(DIGIT_CONFUSABLES[d] ?? [])];
    acc = acc.flatMap((p) => opts.map((o) => p + o));
  }
  const out = new Set<number>();
  for (const s of acc) {
    const v = Number(s);
    if (v >= 0 && v <= 255 && v !== printed) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

type CheckResult = { status: Exclude<LineStatus, "eye-verified" | "forced">; computed: number | null; reading?: number } | { status: "mismatch"; computed: number; untypeable?: string };

/** R4.13 / R4.14 / R4.18 for one final line. */
export function checkLine(n: number, body: string, printed: number | null): CheckResult {
  if (printed === null) return { status: "unverified", computed: null };
  const computed = computeChecksum(n, body);
  // The printed checksum is the sum of what the typist TYPED. A character no C64 key produces (an OCR glyph such as
  // U+2122 "™": 8482 mod 256 = 34, the code of a quote) is dropped by the loader, so a matching sum would certify a
  // line the C64 never stores. Such a line is never verified and never digit-misread (a2a arch-01).
  const dropped = parseBody(body).dropped;
  if (dropped.length) return { status: "mismatch", computed, untypeable: dropped.map((d) => d.char).join("") };
  if (computed === printed) return { status: "verified", computed };
  if (confusableReadings(printed).includes(computed)) return { status: "digit-misread", computed, reading: computed };
  return { status: "mismatch", computed };
}

/**
 * R4.4, tightened (P1a): "nothing left to type". A body whose typeable codes are all blanks or empty — even if it
 * contained untypeable characters (`dropped`) — reaches the C64 as a bare line number, which DELETES the line.
 * Found by the P3 KERNAL-equality property on a real core; the spec's "zero codes AND zero dropped" let it through.
 */
const isEmptyBody = (body: string): boolean => parseBody(body).codes.every((c) => c === 32);

/**
 * Judge a patch of 1–4 ops against `listing` and the scope's `expectedLines`. Atomic (R4.1): accepted → a new
 * listing; refused → no listing, `reason` names the rule (and printed vs computed for a checksum refusal).
 */
export function applyPatch(listing: CanonicalListing, patch: readonly PatchOp[], expectedLines: readonly number[], options: GateOptions = {}): GateVerdict {
  // R4.2
  if (!Array.isArray(patch) || patch.length < 1 || patch.length > 4) return refuse(`REFUSED (R4.2): a patch must have 1 to 4 operations; got ${Array.isArray(patch) ? patch.length : 0}.`);
  // R4.4 + R4.22: empty body first, per op, never overridable
  for (const op of patch) {
    if ((op as { type: string }).type === "replace" && isEmptyBody(String((op as { new_body?: unknown }).new_body ?? ""))) {
      return refuse(`REFUSED (R4.4): replacing line ${op.lineno} with an empty body deletes it. Deletion is a hard refusal; no flag or other operation can override it.`);
    }
  }
  // R4.5
  const byNumber = new Map<number, CanonicalLine>();
  for (const l of listing) if (!byNumber.has(l.n)) byNumber.set(l.n, l);
  for (const op of patch) if (!byNumber.has(op.lineno)) return refuse(`REFUSED (R4.5): line ${op.lineno} is not in the listing.`);
  // R4.6
  for (const op of patch) {
    const t = (op as { type: string }).type;
    if (t !== "replace" && t !== "renumber") return refuse(`REFUSED (R4.6): operation "${t}" is not allowed. Only replace and renumber; insert is recovery-only (a lost line is re-OCR'd or typed by a person, never written by the model).`);
  }
  // R4.3: compose every op against the ORIGINAL listing at once
  const finalBody = new Map<number, string>(); // original lineno -> body
  const finalNumber = new Map<number, number>(); // original lineno -> new number
  for (const op of patch) {
    if (op.type === "replace") finalBody.set(op.lineno, op.new_body);
    else finalNumber.set(op.lineno, op.new_lineno);
  }
  // R4.7
  for (const op of patch) {
    if (op.type !== "replace") continue;
    const r = editRatio(byNumber.get(op.lineno)!.body, op.new_body);
    if (r > MAX_EDIT_RATIO) return refuse(`REFUSED (R4.7): the edit to line ${op.lineno} changes ${(r * 100).toFixed(0)}% of its characters (limit ${MAX_EDIT_RATIO * 100}%). Fix OCR typos, do not rewrite lines.`);
  }
  // R4.8
  for (const op of patch) {
    if (op.type === "renumber" && !expectedLines.includes(op.new_lineno)) return refuse(`REFUSED (R4.8): line ${op.new_lineno} is not in the page's line inventory, so line ${op.lineno} cannot be renumbered to it.`);
  }
  // the group: every original line any op touched, at its final number with its final body
  const touched = [...new Set(patch.map((o) => o.lineno))];
  const group = touched.map((orig) => {
    const l = byNumber.get(orig)!;
    return { orig, n: finalNumber.get(orig) ?? orig, body: finalBody.get(orig) ?? l.body, printed: l.printed, line: l };
  });
  // R4.9: a renumber must itself produce a checksum-valid line (verified or digit-misread; never unverified/forced)
  for (const g of group) {
    if (!finalNumber.has(g.orig)) continue;
    const c = checkLine(g.n, g.body, g.printed);
    if (c.status !== "verified" && c.status !== "digit-misread") {
      return refuse(c.status === "mismatch" && c.untypeable
        ? `REFUSED (R4.9): line ${g.orig} contains ${JSON.stringify(c.untypeable)}, which no C64 key types, so it cannot be renumbered to ${g.n} as a checksum-valid line.`
        : `REFUSED (R4.9): renumbering line ${g.orig} to ${g.n} does not produce a checksum-valid line (printed ${g.printed ?? "unreadable"}, computed ${computeChecksum(g.n, g.body)}).`);
    }
  }
  // R4.10: unique numbers across the whole resulting listing
  const resulting = listing.map((l) => (touched.includes(l.n) ? finalNumber.get(l.n) ?? l.n : l.n));
  const seen = new Set<number>();
  for (const n of resulting) {
    if (seen.has(n)) return refuse(`REFUSED (R4.10): the patch would leave two lines numbered ${n}.`);
    seen.add(n);
  }
  // R4.12–R4.18: checksum rule on every group line
  const counts = options.refusalCounts ?? {};
  const status = new Map<number, LineStatus>();
  const perLine = new Map<number, GatePerOp>();
  let forcedAny = false;
  for (const g of group) {
    const c = checkLine(g.n, g.body, g.printed);
    if (c.status === "mismatch") {
      const count = counts[g.orig] ?? counts[g.n] ?? 0;
      if (options.force_unverified && count >= 2) {
        forcedAny = true;
        status.set(g.orig, "forced");
        perLine.set(g.orig, { line: g.n, printed: g.printed, computed: c.computed, ok: false, why: `FORCED after ${count} refusals: printed ${g.printed}, computed ${c.computed}; never verified` });
        continue;
      }
      if (options.force_unverified) return refuse(`REFUSED (R4.17): force_unverified needs at least 2 earlier refusals of line ${g.n}; it has ${count}. Line ${g.n}: printed checksum ${g.printed}, computed ${c.computed}.`, [{ line: g.n, printed: g.printed, computed: c.computed, ok: false, why: "checksum mismatch" }]);
      if (c.untypeable) return refuse(`REFUSED (R4.15): line ${g.n} contains ${JSON.stringify(c.untypeable)}, which no C64 key types. The magazine's checksum is the sum of what the typist typed, so this cannot be the printed line; write the character the page shows (Gazette notation for control keys).`, [{ line: g.n, printed: g.printed, computed: c.computed, ok: false, why: "untypeable characters" }]);
      return refuse(`REFUSED (R4.15): line ${g.n} checksum mismatch — printed :rem ${g.printed}, computed ${c.computed}. The magazine's checksum says this is not the printed line.`, [{ line: g.n, printed: g.printed, computed: c.computed, ok: false, why: "checksum mismatch" }]);
    }
    status.set(g.orig, c.status);
    const why = c.status === "verified" ? `checksum ${c.computed} = printed ${g.printed}` : c.status === "digit-misread" ? `checksum digits misread: printed ${g.printed} read as ${c.reading}` : "printed checksum unreadable: unverified (emulator verdict only)";
    perLine.set(g.orig, { line: g.n, printed: g.printed, computed: c.computed, ok: true, why });
  }
  // compose the new listing (R4.19/R4.20)
  const next: CanonicalListing = listing.map((l) => {
    if (!touched.includes(l.n)) return { ...l };
    return { ...l, n: finalNumber.get(l.n) ?? l.n, body: finalBody.get(l.n) ?? l.body, status: status.get(l.n)!, source: "gate" };
  });
  const perOp = patch.map((op) => perLine.get(op.lineno)!);
  const summary = group.map((g) => `${g.orig === g.n ? g.n : `${g.orig}→${g.n}`}: ${perLine.get(g.orig)!.why}`).join("; ");
  if (forcedAny) return { verdict: "forced", perOp, listing: next, reason: `FORCED: ${summary}` };
  return { verdict: "accepted", perOp, listing: next, reason: `ACCEPTED: ${summary}` };
}
