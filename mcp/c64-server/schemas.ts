/**
 * Zod 4 schemas of the c64 MCP server: the six tool arguments, `input.json`, `listing.json`, `state.json` and
 * `refusals.json`, plus the key-name mapping of `c64_press` and the advertised tool descriptors.
 * No node: imports, no I/O. The advertised JSON Schema is generated from the very schema that validates the call.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------
// Keys (c64_press). R8.1, R8.2
// ---------------------------------------------------------------------------------------------------------------

/**
 * `"RETURN"` → 13, `"SPACE"` → 32, otherwise a single printable ASCII character whose upper-cased code is in
 * 32–95. Anything else (other scripts, control characters, lower-case names, longer strings) → `null`.
 */
export function keyToPetscii(key: string): number | null {
  if (key === "RETURN") return 13;
  if (key === "SPACE") return 32;
  if (key.length !== 1) return null;
  const raw = key.charCodeAt(0);
  if (raw < 32 || raw > 126) return null; // ASCII only: "ſ".toUpperCase() is "S", which must not slip through
  const code = key.toUpperCase().charCodeAt(0);
  return code >= 32 && code <= 95 ? code : null;
}

/** Inverse of `keyToPetscii` for messages: 13 → RETURN, 32 → SPACE, 33–95 → the character, else `code <n>`. */
export function keyName(code: number): string {
  if (code === 13) return "RETURN";
  if (code === 32) return "SPACE";
  if (code >= 33 && code <= 95) return String.fromCharCode(code);
  return `code ${code}`;
}

const KeyName = z.string().min(1).max(6).refine((k) => keyToPetscii(k) !== null, { message: 'must be "RETURN", "SPACE" or one printable ASCII character' });

// ---------------------------------------------------------------------------------------------------------------
// Tool arguments. R1.2, R5.1, R6.1, R7.1, R8.1, R9.1, R10.1
// ---------------------------------------------------------------------------------------------------------------

const lineno = z.number().int().min(0).max(63999);

export const tools = {
  c64_reload: z.strictObject({}),
  c64_run: z.strictObject({ frames: z.number().int().min(1).max(20000).default(3000) }),
  c64_read_screen: z.strictObject({}),
  c64_press: z.strictObject({ keys: z.array(KeyName).min(1).max(16) }),
  checksum_line: z.strictObject({ lineno, body: z.string().max(1000) }),
  apply_patch: z.strictObject({
    ops: z
      .array(
        z.discriminatedUnion("op", [
          z.strictObject({ op: z.literal("replace"), lineno, new_body: z.string().max(1000) }),
          z.strictObject({ op: z.literal("renumber"), lineno, new_lineno: lineno }),
        ]),
      )
      .min(1)
      .max(4),
    reason: z.string().trim().min(1).max(500),
    force_unverified: z.boolean().default(false),
  }),
} as const;

export type ToolName = keyof typeof tools;
export const TOOL_NAMES = ["c64_reload", "c64_run", "c64_read_screen", "c64_press", "checksum_line", "apply_patch"] as const satisfies readonly ToolName[];

export type RunArgs = z.output<typeof tools.c64_run>;
export type PressArgs = z.output<typeof tools.c64_press>;
export type ChecksumArgs = z.output<typeof tools.checksum_line>;
export type PatchArgs = z.output<typeof tools.apply_patch>;
export type PatchOpInput = PatchArgs["ops"][number];

/** One `<path>: <message>` line per zod issue (R11.1). An issue on the object itself reads `arguments: ...`. */
export function issuesText(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "arguments"}: ${i.message}`).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Descriptors. R1.2, R1.9
// ---------------------------------------------------------------------------------------------------------------

export type ToolDescriptor = { name: ToolName; description: string; inputSchema: Record<string, unknown> };

const DESCRIPTIONS: Record<ToolName, string> = {
  c64_reload:
    "Types the current gated (canonical) listing into the real C64 again, after NEW, and reports the listing hash and every line the C64 cannot store (untypeable). Takes no arguments: it cannot type text you supply, runs nothing and gives no verdict.",
  c64_run:
    "Types the gated listing fresh, RUNs it on the real C64 for up to `frames` frames (default 3000, max 20000), and returns the contract heading, the C64's own error text (for example ?SYNTAX  ERROR IN 20), whether the title appeared, and the screens verbatim. The server presses the post-title keys itself; you cannot. The verdict comes only from this call, never from you.",
  c64_read_screen:
    "Returns the current 40x25 screen of the C64 and the parsed BASIC error, if any. Takes no arguments. It does not run, type or press anything, and it changes no listing and no verdict.",
  c64_press:
    "Presses keys on the C64 while a program waits for input, for example the key the title screen asks for. Only the keys the listing's title screen allows are accepted; any other key refuses the whole call and nothing is pressed. It cannot type program text and is never evidence for a verdict. Entries: one printable ASCII character, RETURN or SPACE (1 to 16).",
  checksum_line:
    "Computes the magazine's checksum (:rem NNN) of a line number and body, and compares it with the printed checksum of that line in the current listing when it exists. Read-only: it changes nothing, touches no emulator and never edits a line.",
  apply_patch:
    "Proposes a fix to the listing: 1 to 4 ops, each {op:'replace', lineno, new_body} or {op:'renumber', lineno, new_lineno}, and a reason. The checksum gate judges it and may refuse it; its refusal text names the printed and the computed checksum. It cannot insert or delete a line. An accepted patch is typed into the C64 but not run: call c64_run next. force_unverified works only after two refusals of that line.",
};

/** The six descriptors, in tool order. `$schema` is dropped: MCP clients take a bare `type: "object"` schema. */
export function descriptors(): ToolDescriptor[] {
  return TOOL_NAMES.map((name) => {
    const json = z.toJSONSchema(tools[name], { io: "input" }) as Record<string, unknown>;
    delete json.$schema;
    return { name, description: DESCRIPTIONS[name], inputSchema: json };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// input.json. R2.1
// ---------------------------------------------------------------------------------------------------------------

const LineStatusSchema = z.enum(["verified", "digit-misread", "eye-verified", "forced", "unverified"]);
const lineNumber = z.number().int().min(0).max(63999);
const keyCode = z.number().int().min(0).max(255);

const CanonicalLineSchema = z.object({
  n: lineNumber,
  body: z.string(),
  printed: z.number().int().min(0).max(255).nullable(),
  status: LineStatusSchema,
  source: z.string(),
});

const SpecSchema = z.object({
  expectedLines: z
    .array(lineNumber)
    .min(1)
    .refine((a) => new Set(a).size === a.length, { message: "must not contain duplicates" }),
  titlePredicate: z.object({ screenContains: z.string().min(1), keys: z.array(keyCode).optional() }),
  postTitle: z.object({ keys: z.array(keyCode), screenContains: z.string().min(1) }),
});

/** Only the parts of input.json that apply when listing.json exists (R2.3, R2.4). Extra keys are ignored. */
export const InputHead = z.object({ listingId: z.string().min(1), scope: z.string(), spec: SpecSchema });
export const InputFull = InputHead.extend({ lines: z.array(CanonicalLineSchema), provisional: z.array(lineNumber) });

export type InputHeadT = z.output<typeof InputHead>;
export type InputFullT = z.output<typeof InputFull>;
/** The validated spec is structurally the `ListingSpec` of `src/emu/session.ts` (checked where `tools.ts` uses it). */
export type SpecT = z.output<typeof SpecSchema>;

// ---------------------------------------------------------------------------------------------------------------
// listing.json, state.json. R3.1, R3.6, R4.1
// ---------------------------------------------------------------------------------------------------------------

export const PostTitle = z.enum(["pass", "fail", "not-reached"]);
const UntypeableSchema = z.object({ n: lineNumber, why: z.enum(["control-outside-quotes", "digit-leading-body", "nothing-typeable", "too-long"]) });
const count = z.number().int().min(0);

export const ListingLineSchema = CanonicalLineSchema.extend({ provisional: z.boolean() });

export const ContractFileSchema = z.object({
  state: z.enum(["RESURRECTED", "BOOTED-PARTIAL", "NOT-RESURRECTED"]),
  scope: z.string(),
  heading: z.string(),
  counts: z.object({
    verified: count, digitMisread: count, eyeVerified: count, forced: count, unverified: count,
    present: count, typed: count, missing: count, orphansExcluded: count,
  }),
  failed: z.array(z.object({ clause: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), lines: z.array(lineNumber) })),
  lines: z.array(z.object({ n: lineNumber, status: LineStatusSchema, source: z.string(), provisional: z.boolean() })),
});

export const ListingFile = z.object({
  listingId: z.string().min(1),
  scope: z.string(),
  expectedLines: z.array(lineNumber),
  lines: z.array(ListingLineSchema),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  untypeable: z.array(UntypeableSchema),
  iteration: count,
  postTitle: PostTitle,
  contract: ContractFileSchema,
});

export const StateFile = z.object({
  iteration: count,
  screen: z.string(),
  error: z.object({ kind: z.string(), line: z.number().int().nullable() }).nullable(),
  titleSeen: z.boolean(),
  postTitle: PostTitle,
  at: z.string(),
});

export type ListingLine = z.output<typeof ListingLineSchema>;
export type ContractFile = z.output<typeof ContractFileSchema>;
export type ListingFileT = z.output<typeof ListingFile>;
export type StateFileT = z.output<typeof StateFile>;

// ---------------------------------------------------------------------------------------------------------------
// refusals.json. R10.3: { "<lineno>": count }, keys non-negative decimal integers, values non-negative integers
// ---------------------------------------------------------------------------------------------------------------

export const RefusalCounts = z.record(z.string().regex(/^[0-9]+$/), z.number().int().min(0));
export type RefusalCountsT = Record<number, number>;
