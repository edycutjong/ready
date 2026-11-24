/** scripts/type-lost-lines.mjs smoke test with piped STDIN (QA P1a r2): a person's typed line is checksum-judged and labelled TYPED. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { computeChecksum } from "../../src/basic/checksum.ts";

it("labels a typed line TYPED with its checksum verdict; an empty answer leaves the line lost", () => {
  const d = mkdtempSync(join(tmpdir(), "ready-typed-"));
  const job = { lost: [{ n: 26, printed: computeChecksum(26, 'PRINT"RAISED"'), crop: "crop-26.png" }, { n: 100, printed: 7, crop: "crop-100.png" }], out: join(d, "typed.json") };
  writeFileSync(join(d, "job.json"), JSON.stringify(job));
  const r = spawnSync(process.execPath, ["scripts/type-lost-lines.mjs", join(d, "job.json")], { input: 'PRINT"RAISED"\n\n', encoding: "utf8", timeout: 20_000 });
  expect(r.status).toBe(0);
  const typed = JSON.parse(readFileSync(job.out, "utf8"));
  expect(typed[0]).toMatchObject({ n: 26, source: "typed", checksumOk: true });
  expect(typed[1]).toEqual({ n: 100, source: "lost" });
});
