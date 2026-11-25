import { expect, it } from "vitest";
import { certificateHeading } from "../../src/replay/certificate.ts";
const counts = { verified: 28, digitMisread: 0, eyeVerified: 0, forced: 0, unverified: 0, present: 28, typed: 0, missing: 0, orphansExcluded: 1 };
it("names the scope, adds source-exact and the listing note; a whole-listing scope has no TITLE-PATH prefix", () => {
  expect(certificateHeading({ verdict: "RESURRECTED", counts }, "title-path", 28, { sourceExact: 19, note: "DATA not executed" })).toBe("TITLE-PATH RESURRECTED · 28/28 checksum-consistent · 19/28 source-exact · DATA not executed");
  expect(certificateHeading({ verdict: "BOOTED-PARTIAL", counts: { ...counts, verified: 11 } }, "whole listing", 12)).toBe("BOOTED — PARTIAL · 11/12 checksum-consistent");
});
it("uses the contract's recomputed checksum-consistent count, not the stored-status sum (arch review 02)", () => {
  const c = { verdict: "BOOTED-PARTIAL" as const, counts, heading: "BOOTED — PARTIAL · 27/28 checksum-consistent" };
  expect(certificateHeading(c, "whole listing", 28)).toBe("BOOTED — PARTIAL · 27/28 checksum-consistent");
});
