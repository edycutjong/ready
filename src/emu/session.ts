/**
 * The core slice the recorder, the MCP server (Day 2) and the contract harness share: type a CANONICAL listing
 * into the machine, RUN it, detect the title, press the post-title key (the server's press, never the agent's),
 * dump BASIC memory, and hand the facts to `contract.ts`. Isomorphic (no node: imports).
 */
import { type C64Core, type RunResult, afterLastRun, dumpBasic, loadProgram, pressKeys, readScreenText, runProgram } from "./core.ts";
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

/** NEW + type every typeable canonical line in number order. Returns the lines it refused to type. */
export function loadCanonical(core: C64Core, listing: CanonicalListing): Untypeable[] {
  const skip = untypeableLines(listing);
  const bad = new Set(skip.map((s) => s.n));
  loadProgram(core, [...listing].filter((l) => !bad.has(l.n)).sort((a, b) => a.n - b.n).map((l) => typedLine(l.n, l.body).codes));
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
  const untypeable = loadCanonical(core, listing);
  const resident = dumpBasic(core);
  const title = (s: string) => afterLastRun(s).includes(spec.titlePredicate.screenContains);
  const run = runProgram(core, { maxFrames, until: (s) => title(s) || (spec.titlePredicate.keys ? s.length > 0 : false) });
  let titleScreen: string | undefined;
  let titleSeen = !run.error && title(run.screen);
  if (!titleSeen && !run.error && spec.titlePredicate.keys) {
    titleScreen = pressKeys(core, spec.titlePredicate.keys, 300);
    titleSeen = title(titleScreen);
  }
  let postTitle: MachineFacts["postTitle"] = "not-reached";
  let postScreen: string | undefined;
  if (titleSeen) {
    postScreen = pressKeys(core, spec.postTitle.keys, 300);
    postTitle = postScreen.includes(spec.postTitle.screenContains) ? "pass" : "fail";
  }
  return { resident, untypeable, run, titleSeen, postTitle, screens: { afterRun: run.screen, title: titleScreen ?? (titleSeen ? readScreenText(core) : undefined), postTitle: postScreen } };
}

/** Machine facts → the contract (the model is never consulted). */
export function judge(listing: CanonicalListing, spec: ListingSpec, facts: MachineFacts, provisional: ReadonlySet<number> = new Set()): ContractResult {
  return evaluate({ listing, expectedLines: spec.expectedLines, titleSeen: facts.titleSeen, postTitle: facts.postTitle, residentBytes: facts.resident, provisional });
}
