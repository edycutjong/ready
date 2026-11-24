/** Per-run caps and the local daily credit ledger (recorder only, never deployed). Decisions: kiro-plan.md §4. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CAPS = { iterations: 15, credits: 8, wallMs: 600_000 } as const;

export type CapState = { iterations: number; credits: number | null; startedAt: number };
export type CapHit = null | "iterations" | "credits" | "wall";

/** credits === null means unmetered: the credit cap cannot be enforced, iteration + wall caps still apply. */
export function capHit(s: CapState, now = Date.now(), caps = CAPS): CapHit {
  if (s.iterations >= caps.iterations) return "iterations";
  if (s.credits !== null && s.credits >= caps.credits) return "credits";
  if (now - s.startedAt >= caps.wallMs) return "wall";
  return null;
}

export type Ledger = { runs: number; credits: number; totalCredits: number };

export function addToLedger(dir: string, credits: number | null, day = new Date().toISOString().slice(0, 10)): Ledger {
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${day}.json`);
  const cur: Ledger = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { runs: 0, credits: 0, totalCredits: 0 };
  const next: Ledger = { runs: cur.runs + 1, credits: cur.credits + (credits ?? 0), totalCredits: cur.totalCredits + (credits ?? 0) };
  writeFileSync(f, JSON.stringify(next, null, 1) + "\n");
  return next;
}
