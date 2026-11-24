/**
 * Tool result text (R6.5, R5.3). Pure string builders: no I/O, no verdict logic. Screens go into `text` verbatim (a
 * model cannot read JSON-escaped 40x25 text), and the same values go into `data` for `structuredContent`.
 * The contract `heading` is quoted from `listing.json.contract`; this module writes no verdict word of its own (R13.5).
 */
import { afterLastRun, type C64Error } from "../../src/emu/core.ts";
import type { Untypeable } from "../../src/emu/session.ts";
import type { ContractFile } from "./schemas.ts";

export type ToolResult = { isError: boolean; text: string; data: Record<string, unknown> };

export const ok = (text: string, data: Record<string, unknown> = {}): ToolResult => ({ isError: false, text, data });
export const fail = (text: string, data: Record<string, unknown> = {}): ToolResult => ({ isError: true, text, data });

/** R5.3: `untypeable: line <n>: <why>` per line, or `untypeable: none`. */
export function untypeableReport(list: readonly Untypeable[]): string {
  return list.length ? list.map((u) => `untypeable: line ${u.n}: ${u.why}`).join("\n") : "untypeable: none";
}

/**
 * `error: <the C64's own text>` (double space of `?SYNTAX  ERROR IN 20` kept, R6.6), or `error: none`.
 * The text is cut from the screen after the last RUN; `error` (from `parseError`) decides whether there is one.
 */
export function errorLine(screen: string, error: C64Error | null): string {
  if (!error) return "error: none";
  const m = [...afterLastRun(screen).matchAll(/\?[A-Z' ]+?\s+ERROR(?: IN \d+)?/g)].at(-1);
  return `error: ${m ? m[0] : `?${error.kind}  ERROR${error.line === null ? "" : ` IN ${error.line}`}`}`;
}

const block = (title: string, screen: string): string => `--- ${title} ---\n${screen}`;

/** R5.2: `c64_reload` result. */
export function reloadResult(hash: string, untypeable: readonly Untypeable[]): ToolResult {
  return ok(`hash ${hash}\n${untypeableReport(untypeable)}`, { hash, untypeable });
}

/** R7.2: `c64_read_screen` result. */
export function screenResult(screen: string, error: C64Error | null): ToolResult {
  return ok(`${errorLine(screen, error)}\n${block("SCREEN", screen)}`, { screen, error });
}

/** R8.3: `c64_press` result. */
export function pressResult(v: { screen: string; error: C64Error | null; keys: string[]; checkpoint: "title" | "postTitle"; pass?: boolean }): ToolResult {
  const data: Record<string, unknown> = { screen: v.screen, error: v.error, keys: v.keys, checkpoint: v.checkpoint };
  if (v.pass !== undefined) data.pass = v.pass;
  const head = `pressed ${v.keys.join(" ")} (checkpoint ${v.checkpoint}${v.pass === undefined ? "" : `, pass: ${v.pass}`})`;
  return ok(`${head}\n${errorLine(v.screen, v.error)}\n${block("SCREEN", v.screen)}`, data);
}

export type RunView = {
  hash: string;
  iteration: number;
  frames: number;
  stoppedOn: string;
  error: C64Error | null;
  titleSeen: boolean;
  postTitle: "pass" | "fail" | "not-reached";
  heading: string;
  counts: ContractFile["counts"];
  failed: ContractFile["failed"];
  untypeable: Untypeable[];
  screens: { afterRun: string; title?: string; postTitle?: string };
};

/** R6.5: heading, error, titleSeen, postTitle, untypeable report, then the screens verbatim. */
export function runResult(v: RunView): ToolResult {
  const parts = [v.heading, errorLine(v.screens.afterRun, v.error), `titleSeen: ${v.titleSeen}`, `postTitle: ${v.postTitle}`, untypeableReport(v.untypeable), block("AFTER RUN", v.screens.afterRun)];
  if (v.screens.title !== undefined) parts.push(block("TITLE", v.screens.title));
  if (v.screens.postTitle !== undefined) parts.push(block("POST-TITLE", v.screens.postTitle));
  return ok(parts.join("\n"), { ...v });
}

/** R10.7: accepted or forced patch. */
export function patchResult(v: { verdict: "accepted" | "forced"; reason: string; perOp: unknown[]; hash: string; iteration: number; untypeable: Untypeable[] }): ToolResult {
  return ok(`${v.reason}\nhash ${v.hash}\n${untypeableReport(v.untypeable)}\nCall c64_run next.`, { ...v });
}

/** R9.2: `checksum_line` result. */
export function checksumResult(v: { lineno: number; computed: number; exists: boolean; printed?: number | null; status?: string; matches?: boolean; reading?: number }): ToolResult {
  const rows = [`line ${v.lineno}: computed ${v.computed}`];
  if (!v.exists) rows.push("exists: false (no such line in the listing)");
  else {
    rows.push(`printed ${v.printed === null ? "unreadable" : v.printed}`, `status: ${v.status}`, `matches: ${v.matches}`);
    if (v.reading !== undefined) rows.push(`reading: ${v.reading}`);
  }
  return ok(rows.join("\n"), { ...v });
}
