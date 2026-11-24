/** runner/budget.ts — run caps (15 iterations / 8 credits / 600 s) and the local ledger. */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPS, addToLedger, capHit } from "../../runner/budget.ts";

describe("run caps", () => {
  const t0 = 1_000_000;
  it("are the decided values", () => expect(CAPS).toEqual({ iterations: 15, credits: 8, wallMs: 600_000 }));
  it("hit on iterations, credits or wall time, in that order", () => {
    expect(capHit({ iterations: 14, credits: 7.9, startedAt: t0 }, t0 + 599_999)).toBeNull();
    expect(capHit({ iterations: 15, credits: 0, startedAt: t0 }, t0)).toBe("iterations");
    expect(capHit({ iterations: 0, credits: 8, startedAt: t0 }, t0)).toBe("credits");
    expect(capHit({ iterations: 0, credits: 0, startedAt: t0 }, t0 + 600_000)).toBe("wall");
  });
  it("an unmetered run (credits null) still has iteration and wall caps", () => {
    expect(capHit({ iterations: 3, credits: null, startedAt: t0 }, t0 + 10)).toBeNull();
    expect(capHit({ iterations: 15, credits: null, startedAt: t0 }, t0)).toBe("iterations");
  });
});

describe("ledger", () => {
  it("accumulates runs and credits per day, null credits count as 0", () => {
    const d = mkdtempSync(join(tmpdir(), "ledger-"));
    addToLedger(d, 1.5, "2026-11-25");
    const l = addToLedger(d, null, "2026-11-25");
    expect(l).toEqual({ runs: 2, credits: 1.5, totalCredits: 1.5 });
    expect(JSON.parse(readFileSync(join(d, "2026-11-25.json"), "utf8")).runs).toBe(2);
  });
});
