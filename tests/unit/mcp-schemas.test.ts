/** mcp/c64-server/schemas.ts: strict tool arguments, the key mapping, input.json validation, descriptors (R1.2, R1.9, R2.1). */
import { describe, expect, it } from "vitest";
import { InputFull, InputHead, ListingFile, RefusalCounts, descriptors, keyName, keyToPetscii, tools } from "../../mcp/c64-server/schemas.ts";
import { nightjarLines, spec } from "../fixtures/mcp-fixture.ts";

const ok = (name: keyof typeof tools, v: unknown) => tools[name].safeParse(v).success;
const goodOp = { op: "replace", lineno: 20, new_body: "END" };
const goodPatch = { ops: [goodOp], reason: "fix" };

describe("tool schemas are strict", () => {
  const good: Record<keyof typeof tools, unknown> = {
    c64_reload: {},
    c64_run: { frames: 100 },
    c64_read_screen: {},
    c64_press: { keys: ["SPACE"] },
    checksum_line: { lineno: 10, body: "END" },
    apply_patch: goodPatch,
  };
  for (const name of Object.keys(tools) as (keyof typeof tools)[]) {
    it(`${name} accepts its good call and rejects an unknown key`, () => {
      expect(ok(name, good[name])).toBe(true);
      expect(ok(name, { ...(good[name] as object), extra: 1 })).toBe(false);
    });
  }
  it("rejects a wrong type for every field", () => {
    expect(ok("c64_run", { frames: "100" })).toBe(false);
    expect(ok("c64_press", { keys: "SPACE" })).toBe(false);
    expect(ok("c64_press", { keys: [32] })).toBe(false);
    expect(ok("checksum_line", { lineno: "10", body: "END" })).toBe(false);
    expect(ok("checksum_line", { lineno: 10, body: 5 })).toBe(false);
    expect(ok("apply_patch", { ...goodPatch, reason: 5 })).toBe(false);
    expect(ok("apply_patch", { ...goodPatch, force_unverified: "yes" })).toBe(false);
    expect(ok("apply_patch", { ...goodPatch, ops: goodOp })).toBe(false);
  });
  it("c64_reload and c64_read_screen take no argument at all, text included", () => {
    expect(ok("c64_reload", { lines: ["10 END"] })).toBe(false);
    expect(ok("c64_reload", { text: "10 END" })).toBe(false);
    expect(ok("c64_read_screen", { body: "x" })).toBe(false);
  });
  it("checksum_line bounds", () => {
    expect(ok("checksum_line", { lineno: -1, body: "" })).toBe(false);
    expect(ok("checksum_line", { lineno: 64000, body: "" })).toBe(false);
    expect(ok("checksum_line", { lineno: 63999, body: "x".repeat(1000) })).toBe(true);
    expect(ok("checksum_line", { lineno: 1, body: "x".repeat(1001) })).toBe(false);
  });
});

describe("frames (R6.1)", () => {
  it("rejects 0, 20001 and 1.5, never clamps; omitted gives 3000", () => {
    for (const frames of [0, 20001, 1.5, -1, Number.NaN]) expect(ok("c64_run", { frames })).toBe(false);
    expect(tools.c64_run.parse({}).frames).toBe(3000);
    expect(tools.c64_run.parse({ frames: 1 }).frames).toBe(1);
    expect(tools.c64_run.parse({ frames: 20000 }).frames).toBe(20000);
  });
});

describe("keys (R8.1)", () => {
  it("accepts a character, RETURN and SPACE", () => {
    for (const k of ["a", "RETURN", "SPACE", "A", "0", " ", "?", "_", "@"]) expect(ok("c64_press", { keys: [k] })).toBe(true);
  });
  it("rejects non-keys", () => {
    for (const k of ["é", "", "return", "AB", "space", "`", "{", "\n", "ſ", "\u0001"]) expect(ok("c64_press", { keys: [k] }), JSON.stringify(k)).toBe(false);
  });
  it("needs 1 to 16 keys", () => {
    expect(ok("c64_press", { keys: [] })).toBe(false);
    expect(ok("c64_press", { keys: Array(16).fill("A") })).toBe(true);
    expect(ok("c64_press", { keys: Array(17).fill("A") })).toBe(false);
  });
  it("maps to PETSCII upper case and back", () => {
    expect(keyToPetscii("a")).toBe(65);
    expect(keyToPetscii("RETURN")).toBe(13);
    expect(keyToPetscii("SPACE")).toBe(32);
    expect(keyToPetscii("_")).toBe(95);
    expect(keyToPetscii("é")).toBeNull();
    for (let c = 32; c <= 95; c++) expect(keyToPetscii(keyName(c))).toBe(c);
    expect(keyToPetscii(keyName(13))).toBe(13);
    expect(keyName(13)).toBe("RETURN");
    expect(keyName(32)).toBe("SPACE");
    expect(keyName(65)).toBe("A");
    expect(keyName(0)).toBe("code 0");
    expect(keyName(200)).toBe("code 200");
  });
});

describe("apply_patch ops (R10.1)", () => {
  it("1 to 4 ops only", () => {
    expect(ok("apply_patch", { ...goodPatch, ops: [] })).toBe(false);
    expect(ok("apply_patch", { ...goodPatch, ops: Array(4).fill(goodOp) })).toBe(true);
    expect(ok("apply_patch", { ...goodPatch, ops: Array(5).fill(goodOp) })).toBe(false);
  });
  it("accepts an empty new_body so the gate's deletion refusal reaches the agent", () => {
    expect(ok("apply_patch", { ...goodPatch, ops: [{ op: "replace", lineno: 20, new_body: "" }] })).toBe(true);
  });
  it("rejects insert, a mixed-up op and extra keys inside an op", () => {
    expect(ok("apply_patch", { ...goodPatch, ops: [{ op: "insert", lineno: 25, new_body: "END" }] })).toBe(false);
    expect(ok("apply_patch", { ...goodPatch, ops: [{ op: "renumber", lineno: 20, new_body: "END" }] })).toBe(false);
    expect(ok("apply_patch", { ...goodPatch, ops: [{ ...goodOp, new_lineno: 30 }] })).toBe(false);
    expect(ok("apply_patch", { ...goodPatch, ops: [{ op: "renumber", lineno: 20, new_lineno: 30 }] })).toBe(true);
    expect(ok("apply_patch", { ...goodPatch, ops: [{ op: "renumber", lineno: 20, new_lineno: 64000 }] })).toBe(false);
  });
  it("reason is 1 to 500 characters after trimming; force_unverified defaults to false", () => {
    expect(ok("apply_patch", { ...goodPatch, reason: "   " })).toBe(false);
    expect(ok("apply_patch", { ...goodPatch, reason: "x".repeat(501) })).toBe(false);
    expect(ok("apply_patch", { ...goodPatch, reason: "x".repeat(500) })).toBe(true);
    expect(tools.apply_patch.parse({ ...goodPatch, reason: "  fix  " }).reason).toBe("fix");
    expect(tools.apply_patch.parse(goodPatch).force_unverified).toBe(false);
    expect(ok("apply_patch", { ops: [goodOp] })).toBe(false);
  });
});

describe("input.json (R2.1)", () => {
  const input = () => structuredClone({ listingId: "nightjar", scope: "title-path", spec, lines: nightjarLines(), provisional: [20] }) as any;
  it("InputFull accepts the fixture and ignores extra keys; InputHead needs no lines", () => {
    expect(InputFull.safeParse(input()).success).toBe(true);
    expect(InputFull.safeParse({ ...input(), origin: { note: "x" } }).success).toBe(true);
    const { lines: _l, provisional: _p, ...head } = input();
    expect(InputHead.safeParse(head).success).toBe(true);
    expect(InputFull.safeParse(head).success).toBe(false);
  });
  const mutate: [string, (i: any) => void][] = [
    ["empty listingId", (i) => { i.listingId = ""; }],
    ["missing scope", (i) => { delete i.scope; }],
    ["empty expectedLines", (i) => { i.spec.expectedLines = []; }],
    ["duplicate expectedLines", (i) => { i.spec.expectedLines = [10, 10]; }],
    ["expectedLines out of range", (i) => { i.spec.expectedLines = [10, 64000]; }],
    ["expectedLines negative", (i) => { i.spec.expectedLines = [-1]; }],
    ["expectedLines not integer", (i) => { i.spec.expectedLines = [10.5]; }],
    ["empty title screenContains", (i) => { i.spec.titlePredicate.screenContains = ""; }],
    ["empty postTitle screenContains", (i) => { i.spec.postTitle.screenContains = ""; }],
    ["title key above 255", (i) => { i.spec.titlePredicate.keys = [256]; }],
    ["title key negative", (i) => { i.spec.titlePredicate.keys = [-1]; }],
    ["title key not integer", (i) => { i.spec.titlePredicate.keys = [1.5]; }],
    ["postTitle key above 255", (i) => { i.spec.postTitle.keys = [300]; }],
    ["line n above 63999", (i) => { i.lines[0].n = 64000; }],
    ["line n not integer", (i) => { i.lines[0].n = 1.5; }],
    ["line n negative", (i) => { i.lines[0].n = -1; }],
    ["printed above 255", (i) => { i.lines[0].printed = 256; }],
    ["printed negative", (i) => { i.lines[0].printed = -1; }],
    ["printed a string", (i) => { i.lines[0].printed = "12"; }],
    ["printed not integer", (i) => { i.lines[0].printed = 1.5; }],
    ["unknown status", (i) => { i.lines[0].status = "great"; }],
    ["body not a string", (i) => { i.lines[0].body = 7; }],
    ["provisional not numbers", (i) => { i.provisional = ["20"]; }],
    ["missing spec", (i) => { delete i.spec; }],
  ];
  for (const [name, f] of mutate) {
    it(`rejects: ${name}`, () => {
      const i = input();
      f(i);
      expect(InputFull.safeParse(i).success).toBe(false);
    });
  }
  it("accepts null printed, an absent title key list and every status", () => {
    const i = input();
    i.lines[0].printed = null;
    delete i.spec.titlePredicate.keys;
    for (const [k, s] of ["verified", "digit-misread", "eye-verified", "forced", "unverified"].entries()) i.lines[k % 4].status = s;
    expect(InputFull.safeParse(i).success).toBe(true);
  });
});

describe("listing.json and refusals.json shapes", () => {
  it("ListingFile rejects a file missing a field", () => {
    expect(ListingFile.safeParse({ listingId: "x" }).success).toBe(false);
    expect(ListingFile.safeParse({}).success).toBe(false);
  });
  it("RefusalCounts takes decimal-integer keys and non-negative integer values only", () => {
    expect(RefusalCounts.safeParse({ "20": 2, "30": 0 }).success).toBe(true);
    expect(RefusalCounts.safeParse({}).success).toBe(true);
    expect(RefusalCounts.safeParse({ x: 1 }).success).toBe(false);
    expect(RefusalCounts.safeParse({ "-1": 1 }).success).toBe(false);
    expect(RefusalCounts.safeParse({ "20": -1 }).success).toBe(false);
    expect(RefusalCounts.safeParse({ "20": 1.5 }).success).toBe(false);
    expect(RefusalCounts.safeParse([1]).success).toBe(false);
  });
});

describe("descriptors (R1.2, R1.9)", () => {
  const list = descriptors();
  it("lists the six tools in order with object schemas and no $schema", () => {
    expect(list.map((d) => d.name)).toEqual(["c64_reload", "c64_run", "c64_read_screen", "c64_press", "checksum_line", "apply_patch"]);
    for (const d of list) {
      expect(d.inputSchema.type).toBe("object");
      expect("$schema" in d.inputSchema).toBe(false);
    }
  });
  it("descriptions are non-empty and at most 600 characters", () => {
    for (const d of list) {
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.description.length).toBeLessThanOrEqual(600);
    }
  });
  it("advertises the enforced arguments (default frames is optional, unknown keys are closed)", () => {
    const run = list[1]!.inputSchema as any;
    expect(run.properties.frames).toMatchObject({ type: "integer", minimum: 1, maximum: 20000 });
    expect(run.required ?? []).not.toContain("frames");
    expect(run.additionalProperties).toBe(false);
    expect((list[0]!.inputSchema as any).additionalProperties).toBe(false);
    expect((list[5]!.inputSchema as any).required).toEqual(expect.arrayContaining(["ops", "reason"]));
  });
});
