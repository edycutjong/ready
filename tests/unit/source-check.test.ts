import { describe, expect, it } from "vitest";
import { parseReference, sourceCheck } from "../../runner/source-check.ts";

describe("source check (evaluation only)", () => {
  const ref = parseReference('10 PRINT"A  B"  :rem 1\n20 GOTO 10 :rem 2\n');
  it("exact means spaces and notation too — a checksum-consistent space change is NOT source-exact", () => {
    const r = sourceCheck([{ n: 10, body: 'PRINT"A B"' }, { n: 20, body: "GOTO 10" }], ref, [10, 20], "two machine reads");
    expect(r).toMatchObject({ sourceExact: 1, total: 2, origin: "two machine reads" });
    expect(r.lines[0]).toMatchObject({ n: 10, exact: false });
  });
  it("a scope line missing from the final listing is not exact; total is the scope size", () => {
    const r = sourceCheck([{ n: 10, body: 'PRINT"A  B"' }], ref, [10, 20, 30], "person-read");
    expect(r.sourceExact).toBe(1);
    expect(r.total).toBe(3);
  });
});
