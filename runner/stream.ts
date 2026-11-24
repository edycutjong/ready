/**
 * Parser for `kiro-cli chat --output-format stream-json` (engine v3, ACP payloads), measured on kiro-cli 3.5.0
 * (spikes K1–K3, evidence/spikes/). Pure: one line in, zero or more run events out.
 */
export type KiroEvent =
  | { k: "session"; sessionId: string; engine?: string }
  | { k: "tool_load"; id: string; toolCallId: string }
  | { k: "tool_call"; toolCallId: string; title: string; server?: string; input: unknown }
  | { k: "tool_result"; toolCallId: string; status: "completed" | "failed"; text: string; hookRefusal: boolean; permissionDenied: boolean }
  | { k: "credits"; usage: number }
  | { k: "finished"; status: string; stopReason?: string; finalText: string };

type Obj = Record<string, unknown>;
const get = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((a, p) => (a && typeof a === "object" ? (a as Obj)[p] : undefined), o);

export function parseLine(line: string): KiroEvent[] {
  let o: Obj;
  try { o = JSON.parse(line) as Obj; } catch { return []; }
  const out: KiroEvent[] = [];
  const type = o.type;
  if (type === "runStarted") return [];
  // credits.usage appears on a final event; search generically so a schema shuffle does not silently drop metering
  const credits = findCredits(o);
  if (credits !== null) out.push({ k: "credits", usage: credits });
  if (type === "runFinished") {
    out.push({ k: "finished", status: String(get(o, "data", "status") ?? ""), stopReason: get(o, "data", "stopReason") as string | undefined, finalText: String(get(o, "data", "finalText") ?? "") });
    return out;
  }
  if (type !== "sessionUpdate") return out;
  const sessionId = get(o, "data", "sessionId") as string | undefined;
  const u = get(o, "data", "update") as Obj | undefined;
  if (!u) return out;
  const su = u.sessionUpdate;
  if (su === "tool_call") {
    const title = String(u.title ?? "");
    if (title === "Tool Load") out.push({ k: "tool_load", id: String(get(u, "rawInput", "id") ?? ""), toolCallId: String(u.toolCallId) });
    else out.push({ k: "tool_call", toolCallId: String(u.toolCallId), title, server: get(u, "_meta", "kiro", "serverName") as string | undefined, input: u.rawInput });
  } else if (su === "tool_call_update" && (u.status === "completed" || u.status === "failed")) {
    const text = ((u.content as Obj[] | undefined) ?? []).map((c) => String(get(c, "content", "text") ?? "")).join("\n");
    out.push({ k: "tool_result", toolCallId: String(u.toolCallId), status: u.status, text, hookRefusal: /intercepted by PreToolUse hooks/i.test(text), permissionDenied: /Blocked by a permission rule/i.test(text) });
  }
  if (sessionId && out.length === 0 && su === "session_info_update") return [];
  return out;
}

function findCredits(o: unknown): number | null {
  const c = get(o, "data", "credits") ?? get(o, "credits") ?? get(o, "data", "update", "_meta", "kiro", "credits");
  if (Array.isArray(c) && c.length && typeof (c[0] as Obj).usage === "number") return (c as Obj[]).reduce((s, x) => s + Number(x.usage ?? 0), 0);
  // fallback: textual scan, the shape observed in K1: "credits":[{"usage":0.73,...}]
  const s = JSON.stringify(o);
  const m = s.match(/"credits":\[\{"usage":([0-9.eE+-]+)/);
  return m ? Number(m[1]) : null;
}

export function sessionIdOf(line: string): string | null {
  const m = line.match(/"sessionId":\s*"(sess_[^"]+)"/);
  return m ? m[1] : null;
}
