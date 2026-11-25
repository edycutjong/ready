/**
 * Source check (agent contract §4, review r04 — EVALUATION ONLY). The contract proves checksum-consistency, completeness and
 * that the C64 holds the gated text; it cannot prove that text equals the magazine (mod-256 collisions; the checksum
 * ignores spaces). This compares the final canonical listing with a reference transcript that is never given to the
 * agent, the MCP server, the hooks or the gate. Exact = same body, spaces and notation included.
 */
import { splitLine } from "../src/basic/checksum.ts";

export type SourceCheck = { sourceExact: number; total: number; origin: string; lines: { n: number; exact: boolean; final: string | null; reference: string }[] };

export function parseReference(text: string): { n: number; body: string }[] {
  return text.split("\n").map(splitLine).filter((l) => l.n !== null).map((l) => ({ n: l.n!, body: l.body.trimEnd() }));
}

export function sourceCheck(final: readonly { n: number; body: string }[], reference: readonly { n: number; body: string }[], scope: readonly number[], origin: string): SourceCheck {
  const fin = new Map(final.map((l) => [l.n, l.body.trimEnd()]));
  const ref = new Map(reference.map((l) => [l.n, l.body]));
  const lines = scope.filter((n) => ref.has(n)).map((n) => ({ n, exact: fin.get(n) === ref.get(n), final: fin.get(n) ?? null, reference: ref.get(n)! }));
  return { sourceExact: lines.filter((l) => l.exact).length, total: scope.length, origin, lines };
}
