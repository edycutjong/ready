import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { createC64ReadyCore, type C64Core } from "../emu/core.ts";
import { cheat, replay, type ReplayResult, type RunEvent } from "../replay/replay.ts";
import { certificateHeading } from "../replay/certificate.ts";
import type { CanonicalLine } from "../basic/types.ts";
import "./desk.css";

/**
 * The judge path (Day-3 functional cut; design lands in P1c): pick a RECORDED real Kiro run → the gate re-judges
 * every attempt, the in-browser C64 re-runs every accepted patch (REPLAY), the contract is recomputed. Without the
 * ROM-bearing WASM (public URL, rights not cleared) it is RECORDED PLAYBACK: captured screens, gate re-judged, no
 * C64 — and the page says so. Nothing on this page calls Kiro; recordings are labelled as recordings.
 */
type RunRef = { id: string; file: string; label?: string; local?: boolean };
type Mode = "loading" | "booting" | "replay" | "recorded" | "error";

declare global { interface Window { __ready?: Record<string, unknown> } }

async function bootCore(): Promise<C64Core | null> {
  try {
    const head = await fetch("/c64.wasm", { method: "HEAD" });
    if (!head.ok || !/wasm/.test(head.headers.get("content-type") ?? "")) return null;
    const core = createC64ReadyCore("/c64.wasm");
    await core.boot();
    return core;
  } catch { return null; }
}

const parseJsonl = (text: string): RunEvent[] => text.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as RunEvent]; } catch { return []; } });

function recordedScreens(events: RunEvent[]): string[] {
  return events.filter((e) => e.k === "kiro" && e.op === "tool_result" && /c64_run/.test(String(e.title ?? ""))).map((e) => String(e.text ?? ""));
}

function mark(l: CanonicalLine): { sym: string; cls: string } {
  if (l.status === "verified") return { sym: "✓", cls: "ok" };
  if (l.status === "digit-misread") return { sym: "✓ digits misread", cls: "ok" };
  if (l.status === "eye-verified") return { sym: "✓ eye-verified", cls: "ok" };
  if (l.status === "forced") return { sym: "✗ FORCED", cls: "forced" };
  return l.printed == null ? { sym: "? unverified", cls: "unv" } : { sym: "✗", cls: "bad" };
}

function Desk() {
  const [runs, setRuns] = useState<RunRef[]>([]);
  const [sel, setSel] = useState<string | null>(new URLSearchParams(location.search).get("run"));
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  const [core, setCore] = useState<C64Core | null | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("loading");
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [cheatOut, setCheatOut] = useState<string | null>(null);

  useEffect(() => { fetch("/runs/index.json").then((r) => r.json()).then((j) => { setRuns(j.runs ?? []); if (!sel && j.runs?.[0]) setSel(j.runs[0].id); }).catch(() => setErr("no recorded runs index")); }, []);
  useEffect(() => { setMode("booting"); bootCore().then(setCore); }, []);
  useEffect(() => {
    const ref = runs.find((r) => r.id === sel);
    if (!ref) return;
    fetch(ref.file).then((r) => r.text()).then((t) => setEvents(parseJsonl(t))).catch(() => setErr(`run ${ref.id} unavailable`));
  }, [sel, runs]);
  useEffect(() => {
    if (!events || core === undefined) return;
    try {
      const r = replay(events, core);
      setResult(r); setStep(r.steps.length); setMode(core ? "replay" : "recorded");
    } catch (e) { setErr(String((e as Error).message)); setMode("error"); }
  }, [events, core]);

  const screens = useMemo(() => (events ? recordedScreens(events) : []), [events]);
  const view = useMemo(() => {
    if (!result) return null;
    const upto = result.steps.slice(0, step);
    const lastAttempt = [...upto].reverse().find((s) => s.kind === "attempt");
    const listing = lastAttempt && lastAttempt.kind === "attempt" ? lastAttempt.listingAfter : result.input.lines;
    const runSteps = upto.filter((s) => s.kind === "run");
    const lastRun = runSteps.at(-1);
    const screen = lastRun && lastRun.kind === "run" ? (lastRun.facts ? (lastRun.facts.screens.postTitle ?? lastRun.facts.screens.title ?? lastRun.facts.screens.afterRun) : screens[runSteps.length - 1] ?? "(no recorded screen)") : "READY.";
    const errLine = lastRun && lastRun.kind === "run" ? ((lastRun.facts?.run.error?.line ?? (lastRun.recorded.error as { line?: number } | null)?.line) ?? null) : null;
    return { listing, screen, errLine };
  }, [result, step, screens]);

  useEffect(() => {
    window.__ready = { mode, mismatches: result?.mismatches ?? null, contract: result?.contract ?? null, recordedEnd: result?.recordedEnd ?? null, screen: view?.screen ?? null, steps: result?.steps.length ?? 0, step };
  }, [mode, result, view, step]);

  const ocr = new Map((result?.input.lines ?? []).map((l) => [l.n, l.body]));
  const start = events?.find((e) => e.k === "start");
  const credits = [...(events ?? [])].reverse().find((e) => e.k === "credits" && e.total !== undefined);
  const firstErr = result?.steps.find((s) => s.kind === "run" && (s.facts?.run.error ?? s.recorded.error));
  const errObj = firstErr && firstErr.kind === "run" ? ((firstErr.facts?.run.error ?? firstErr.recorded.error) as { kind: string; line: number | null }) : null;
  const errText = errObj ? `?${errObj.kind}  ERROR${errObj.line != null ? ` IN ${errObj.line}` : ""}` : "?SYNTAX  ERROR IN 20";
  const runLabel = start ? `recorded ${String(start.t ?? "").slice(0, 16).replace("T", " ")} UTC · ${String(start.model ?? "")} · ${credits?.metered === false || credits?.total === null ? "credits: unmetered" : `${Number(credits?.total ?? 0).toFixed(2)} credits`}` : "";
  const endCounts = (result?.recordedEnd?.counts ?? {}) as { sourceExact?: number; sourceTotal?: number };
  const note = (result?.input as { certificateNote?: string } | undefined)?.certificateNote ?? undefined;
  return (
    <main class="desk">
      <header>
        <p class="err" data-testid="first-error">{errText}</p>
        <h1>Resurrecting 1984 type-in programs</h1>
        <p class="mode" data-testid="mode">
          {mode === "replay" && "REPLAY — a recorded real Kiro run, re-executed now: the gate re-judges every patch and this browser's C64 re-runs the program (replaying recorded OCR input)."}
          {mode === "recorded" && "RECORDED PLAYBACK — captured screens of a recorded real Kiro run. The gate re-judges every patch in your browser; nothing runs on a C64 here (Commodore ROM rights not cleared)."}
          {mode === "booting" && "booting the C64…"}
          {mode === "loading" && "loading…"}
          {mode === "error" && `error: ${err}`}
        </p>
        {runLabel && <p class="note" data-testid="run-label">{runLabel}</p>}
        <label>Run <select value={sel ?? ""} onChange={(e) => setSel((e.target as HTMLSelectElement).value)}>{runs.map((r) => <option value={r.id}>{r.label ?? r.id}</option>)}</select></label>
      </header>
      {result && view && (
        <>
          <section class="strip" aria-label="run strip">
            <input type="range" min={0} max={result.steps.length} value={step} onInput={(e) => setStep(Number((e.target as HTMLInputElement).value))} aria-label="step" />
            <span>step {step}/{result.steps.length}</span>
            <ol>
              {result.steps.map((s, i) => (
                <li class={`${i < step ? "done" : ""} ${s.kind === "attempt" ? s.recomputed.verdict : "run"}`} onClick={() => setStep(i + 1)}>
                  {s.kind === "attempt" ? `${s.recomputed.verdict.toUpperCase()}${s.source === "hook" ? " by the Kiro Pre Tool Use hook" : ""}: ${s.recomputed.reason}` : `RUN → ${s.facts ? (s.facts.run.error ? `?${s.facts.run.error.kind} ERROR${s.facts.run.error.line != null ? ` IN ${s.facts.run.error.line}` : ""}` : s.facts.titleSeen ? `title · post-title ${s.facts.postTitle}` : "no title") : `(recorded) ${s.recorded.error ? JSON.stringify(s.recorded.error) : s.recorded.titleSeen ? "title" : "no title"}`}${s.match === false ? " ≠ RECORD" : ""}`}
                </li>
              ))}
            </ol>
          </section>
          <div class="panes">
            <section class="galley" aria-label="galley">
              <table>
                <tbody>
                  {view.listing.slice().sort((a, b) => a.n - b.n).map((l) => {
                    const m = mark(l);
                    const was = ocr.get(l.n);
                    return (
                      <tr class={m.cls}>
                        <td class="n">{l.n}</td>
                        <td class="body">{was !== undefined && was !== l.body ? <><del>{was}</del><br /><ins>{l.body}</ins></> : l.body}</td>
                        <td class="rem">:rem {l.printed ?? "??"}</td>
                        <td class="mk">{m.sym}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
            <section class="c64" aria-label="C64 screen">
              <pre data-testid="screen">{view.screen}</pre>
              <button data-testid="cheat" onClick={() => { const c = cheat(view.listing, result.input.spec.expectedLines, view.errLine); setCheatOut(`Cheat: empty line ${c.line} → ${c.verdict.verdict.toUpperCase()} — ${c.verdict.reason}`); }}>Cheat: delete the error line</button>
              <p class="note">Cheat runs the same gate code as the Kiro Pre Tool Use hook, in your browser. It does not call Kiro.</p>
              {cheatOut && <p data-testid="cheat-out" class="refused">{cheatOut}</p>}
            </section>
          </div>
          <section class="cert" data-testid="certificate" aria-label="certificate">
            {result.contract
              ? <><h2>{certificateHeading(result.contract, result.input.scope, result.input.spec.expectedLines.length, { sourceExact: endCounts.sourceExact, sourceTotal: endCounts.sourceTotal, note })}</h2><p>recomputed now from the final listing and this browser's C64 · verified {result.contract.counts.verified} · digit-misread {result.contract.counts.digitMisread} · forced {result.contract.counts.forced} · unverified {result.contract.counts.unverified} · missing {result.contract.counts.missing} · typed {result.contract.counts.typed}</p></>
              : <><h2>{String(result.recordedEnd?.result ?? "no end event").toUpperCase()} (recorded)</h2><p>the recorded certificate; the contract is recomputed only where a C64 can run</p></>}
            {result.mismatches.length > 0 && <p class="refused" data-testid="mismatches">Replay disagrees with the record: {result.mismatches.join(" · ")}</p>}
          </section>
        </>
      )}
    </main>
  );
}

function KiroView() {
  const [rows, setRows] = useState<{ run: string; e: RunEvent }[]>([]);
  useEffect(() => {
    fetch("/runs/index.json").then((r) => r.json()).then(async (j) => {
      const all: { run: string; e: RunEvent }[] = [];
      for (const ref of (j.runs ?? []) as RunRef[]) {
        const t = await fetch(ref.file).then((r) => r.text()).catch(() => "");
        // a hook refusal is logged by the hook itself (kiro-pre-tool-use) and seen again in Kiro's stream: show it once
        for (const e of parseJsonl(t)) if ((e.k === "hook" && e.via !== "kiro-stream") || e.k === "credits" || (e.k === "kiro" && e.op === "tool_call")) all.push({ run: ref.label ?? ref.id, e });
      }
      setRows(all);
    });
  }, []);
  return (
    <main class="desk kiro">
      <h1>/kiro — what Kiro's hooks did in recorded runs</h1>
      <p class="note">A static view over recorded run logs (each row names its run). Hook rows come from the hook processes themselves, not from the model's words.</p>
      <table data-testid="kiro-rows">
        <thead><tr><th>run</th><th>time</th><th>what</th><th>detail</th></tr></thead>
        <tbody>
          {rows.map(({ run, e }) => (
            <tr class={e.k === "hook" && e.exit === 2 ? "refused" : ""}>
              <td>{run}</td><td>{String(e.t ?? "").slice(11, 19)}</td>
              <td>{e.k === "hook" ? `hook ${String(e.hook)} (${String(e.via ?? "")}) exit ${String(e.exit ?? "")}${e.decision ? ` · ${String(e.decision)}` : ""}` : e.k === "credits" ? "credits" : `tool call ${String(e.title)}`}</td>
              <td>{e.k === "hook" ? String(e.stderr ?? e.reason ?? "") : e.k === "credits" ? `${e.metered ? `${String(e.delta ?? "")} (total ${String(e.total ?? "")})` : "unmetered"}` : JSON.stringify(e.input ?? "").slice(0, 160)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

render(location.pathname.startsWith("/kiro") ? <KiroView /> : <Desk />, document.getElementById("app")!);
