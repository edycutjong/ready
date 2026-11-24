/** P6 (R5.3): RESURRECTED implies zero forced and zero unverified in-scope lines (and the resident image matches). */
import fc from "fast-check";
import { it } from "vitest";
import { evaluate } from "../../src/gate/contract.ts";
import { tokenizeProgram } from "../../src/basic/tokenizer.ts";
import type { LineStatus } from "../../src/basic/types.ts";
import { body } from "./arbs.ts";

const status = fc.constantFrom<LineStatus>("verified", "digit-misread", "eye-verified", "forced", "unverified");
it("P6: RESURRECTED ⇒ no forced, no unverified, no provisional, image equal", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.integer({ min: 1, max: 999 }), { minLength: 1, maxLength: 6 }).chain((ns) => fc.tuple(fc.constant(ns), fc.array(fc.tuple(body, status), { minLength: ns.length, maxLength: ns.length }), fc.boolean(), fc.constantFrom("pass", "fail", "not-reached"), fc.boolean(), fc.subarray(ns))),
    ([ns, rows, title, post, sameImage, prov]) => {
      const listing = ns.map((n, i) => ({ n, body: rows[i][0], printed: null, status: rows[i][1], source: "ocr" }));
      const resident = sameImage ? tokenizeProgram(listing) : tokenizeProgram(listing.slice(1));
      const r = evaluate({ listing, expectedLines: ns, titleSeen: title, postTitle: post as "pass", residentBytes: resident, provisional: new Set(prov) });
      if (r.verdict !== "RESURRECTED") return true;
      return listing.every((l) => l.status !== "forced" && l.status !== "unverified" && !prov.includes(l.n)) && sameImage && post === "pass" && title;
    }), { numRuns: 100 });
});
