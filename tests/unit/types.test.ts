/**
 * Task 1.2. The compile-time half of these tests is enforced by `tsc --noEmit` (tests/ is in tsconfig
 * `include`): a `// @ts-expect-error` line that stops being an error makes tsc fail, so the five-string
 * vocabulary cannot be widened without this file turning red. The runtime half is one smoke object per type.
 */
import { describe, expect, it } from "vitest";
import type {
  CanonicalLine,
  CanonicalListing,
  Dropped,
  LineStatus,
  ParseBodyResult,
  TypedLineResult,
} from "../../src/basic/types.ts";

describe("LineStatus (R1 preamble: exactly five strings)", () => {
  it("accepts each of the five allowed strings", () => {
    const all = [
      "verified",
      "digit-misread",
      "eye-verified",
      "forced",
      "unverified",
    ] as const satisfies readonly LineStatus[];
    expect(new Set(all).size).toBe(5);
  });

  it("rejects any other string at compile time", () => {
    // @ts-expect-error "checked" is not a LineStatus
    const a: LineStatus = "checked";
    // @ts-expect-error case matters: "Verified" is not a LineStatus
    const b: LineStatus = "Verified";
    // @ts-expect-error a plain string is not narrowed to the union
    const c: LineStatus = "verified" as string;
    // @ts-expect-error the empty string is not a LineStatus
    const d: LineStatus = "";
    // The values above exist only so the compiler checks each assignment above.
    expect([a, b, c, d]).toHaveLength(4);
  });

  it("is not assignable from a non-string", () => {
    // @ts-expect-error numbers are not statuses
    const n: LineStatus = 1;
    expect(n).toBe(1);
  });
});

describe("shape smoke objects", () => {
  it("CanonicalLine and CanonicalListing", () => {
    const line = {
      n: 10,
      body: 'PRINT"HI"',
      printed: 12,
      status: "verified",
      source: "ocr",
    } satisfies CanonicalLine;
    const unparsed = { ...line, printed: null, status: "unverified" } satisfies CanonicalLine;
    const listing: CanonicalListing = [line, unparsed];
    expect(listing.map((l) => l.status)).toEqual(["verified", "unverified"]);
  });

  it("CanonicalLine rejects a bad status and a missing field", () => {
    const bad = {
      n: 10,
      body: "",
      printed: null,
      // @ts-expect-error status outside the five strings
      status: "ok",
      source: "ocr",
    } satisfies CanonicalLine;
    // @ts-expect-error `source` is required
    const missing: CanonicalLine = { n: 1, body: "", printed: null, status: "forced" };
    expect([bad, missing]).toHaveLength(2);
  });

  it("Dropped, ParseBodyResult, TypedLineResult", () => {
    const d = { index: 3, char: "~" } satisfies Dropped;
    const p = { codes: [80, 82], dropped: [d] } satisfies ParseBodyResult;
    const t = { codes: [49, 48, ...p.codes], dropped: p.dropped, tooLong: false } satisfies TypedLineResult;
    expect(t.tooLong).toBe(false);
    expect(t.dropped[0]).toEqual({ index: 3, char: "~" });
  });
});
