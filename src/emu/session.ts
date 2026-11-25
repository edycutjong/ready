/**
 * The core slice the recorder, the MCP server (Day 2) and the contract harness share: type a CANONICAL listing
 * into the machine, RUN it, detect the title, press the post-title key (the server's press, never the agent's),
 * dump BASIC memory, and hand the facts to `contract.ts`. Isomorphic (no node: imports).
 */
import { type C64Core, type RunResult, afterLastRun, dumpBasic, loadProgram, pressKeys, readScreenText, realError, runProgram } from "./core.ts";
import { controlOutsideQuotes, parseBody, typedLine } from "../basic/notation.ts";
import type { CanonicalListing } from "../basic/types.ts";
import { evaluate, type ContractResult } from "../gate/contract.ts";

export type ListingSpec = {
  expectedLines: readonly number[];
  /** text that marks the title screen, and keys (PETSCII) pressed while waiting for it, e.g. a GET before the title */
  titlePredicate: { screenContains: string; keys?: readonly number[] };
  /** the server's own press after the title, and the text it must produce (contract clause 2) */
  postTitle: { keys: readonly number[]; screenContains: string };
};

export type Untypeable = { n: number; why: "control-outside-quotes" | "digit-leading-body" | "nothing-typeable" | "too-long" };

/**
 * Lines the C64 cannot store as typed (P3 findings, core-typing-edges.test.ts). The loader never types them: a
 * control code outside quotes is executed by the screen editor ({UP}/{HOME} would make later keys overwrite other
 * lines), a digit-leading body merges into the line number, a body with nothing typeable deletes the line.
 */
export function untypeableLines(listing: CanonicalListing): Untypeable[] {
  const out: Untypeable[] = [];
  for (const l of listing) {
    const t = typedLine(l.n, l.body);
    const body = t.codes.slice(String(l.n).length);
    if (t.tooLong) out.push({ n: l.n, why: "too-long" });
    else if (body.length === 0 || parseBody(l.body).codes.every((c) => c === 32)) out.push({ n: l.n, why: "nothing-typeable" });
    else if (body[0] >= 48 && body[0] <= 57) out.push({ n: l.n, why: "digit-leading-body" });
    else if (controlOutsideQuotes(t.codes).length) out.push({ n: l.n, why: "control-outside-quotes" });
  }
  return out;
}

/**
 * NEW + type every typeable canonical line in number order. Returns the lines it refused to type.
 * With `expectedLines` (every verdict path passes it), a line outside the page's inventory (an orphan) is never typed:
 * clause 6 compares memory with the image of the in-scope lines only, and the agent has no delete op, so a typed
 * orphan would make RESURRECTED unreachable (arch review 01; make-run-input already excludes orphans by the same rule).
 */
export function loadCanonical(core: C64Core, listing: CanonicalListing, expectedLines?: readonly number[]): Untypeable[] {
  const inScope = expectedLines ? listing.filter((l) => expectedLines.includes(l.n)) : listing;
  const skip = untypeableLines(inScope);
  const bad = new Set(skip.map((s) => s.n));
  loadProgram(core, [...inScope].filter((l) => !bad.has(l.n)).sort((a, b) => a.n - b.n).map((l) => typedLine(l.n, l.body).codes));
  return skip;
}

export type MachineFacts = {
  resident: Uint8Array;
  untypeable: Untypeable[];
  run: RunResult;
  titleSeen: boolean;
  postTitle: "pass" | "fail" | "not-reached";
  screens: { afterRun: string; title?: string; postTitle?: string };
};

/** Load, RUN, (press title keys), detect the title, press the post-title keys, collect the facts. */
export function runListing(core: C64Core, listing: CanonicalListing, spec: ListingSpec, maxFrames = 3000): MachineFacts {
  const untypeable = loadCanonical(core, listing, spec.expectedLines);
  const resident = dumpBasic(core);
  const title = (s: string) => afterLastRun(s).includes(spec.titlePredicate.screenContains);
  // Stop when the title shows, or — if the title needs a key first — when the program is waiting for input:
  // the screen has stopped changing for 3 consecutive checks (150 frames) after RUN produced output.
  let last = "", stable = 0;
  const waiting = (s: string) => {
    if (!spec.titlePredicate.keys) return false;
    stable = s === last && afterLastRun(s).trim().length > 0 ? stable + 1 : 0;
    last = s;
    return stable >= 3;
  };
  let run = runProgram(core, { maxFrames, until: (s) => title(s) || waiting(s), latch: title });
  let titleScreen: string | undefined;
  let titleSeen = !run.error && (title(run.screen) || run.latched !== undefined);
  if (!titleSeen && !run.error && spec.titlePredicate.keys) {
    titleScreen = pressKeys(core, spec.titlePredicate.keys, 300);
    const err = realError(core, titleScreen); // an error raised after the key press is still the run's diagnosis
    // A real BASIC error after the title key means the title did not stand (the same rule as `!run.error` above).
    titleSeen = !err && title(titleScreen);
    if (err) run = { ...run, screen: titleScreen, error: err, stoppedOn: "error" };
  }
  let postTitle: MachineFacts["postTitle"] = "not-reached";
  let postScreen: string | undefined;
  if (titleSeen && titleScreen === undefined) titleScreen = run.latched ?? readScreenText(core); // capture the title BEFORE the post-title press (P1b smoke test)
  if (titleSeen) {
    // Clause 2 is evidence the press PRODUCED the text (arch review 01): read only the program's own output (below the last
    // RUN, never the typed listing above it, which usually contains the very PRINT), and fail closed when the text was
    // already on the screen before the press.
    // `titleScreen` may be the LATCHED frame (a title shown for fewer frames than a check): the program kept running after
    // it, so the screen right before the press is read too. Text already there on either screen fails clause 2.
    const want = spec.postTitle.screenContains;
    const prePress = readScreenText(core);
    const before = afterLastRun(titleScreen ?? "").includes(want) || afterLastRun(prePress).includes(want);
    postScreen = pressKeys(core, spec.postTitle.keys, 300);
    postTitle = !before && afterLastRun(postScreen).includes(want) ? "pass" : "fail";
  }
  return { resident, untypeable, run, titleSeen, postTitle, screens: { afterRun: run.screen, title: titleScreen, postTitle: postScreen } };
}

/** Machine facts → the contract (the model is never consulted). */
export function judge(listing: CanonicalListing, spec: ListingSpec, facts: MachineFacts, provisional: ReadonlySet<number> = new Set(), scope?: string): ContractResult {
  return evaluate({ listing, expectedLines: spec.expectedLines, titleSeen: facts.titleSeen, postTitle: facts.postTitle, residentBytes: facts.resident, provisional, scope });
}
