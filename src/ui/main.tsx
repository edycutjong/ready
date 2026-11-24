import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { createC64ReadyCore, type C64Core } from "../emu/core.ts";
import { cheat, replay, type ReplayResult, type RunEvent } from "../replay/replay.ts";
import { certificateHeading, errata, errataText, prgBytes, provenance, type RecoveryEvent } from "../replay/certificate.ts";
import type { CanonicalLine } from "../basic/types.ts";
import { screenOf } from "../replay/screens.ts";
import { Nav } from "./nav.tsx";
import { ScanView } from "./scan.tsx";
import { Stamp, stampFor } from "./stamp.tsx";
import "./desk.css";

/**
 * The judge path (Day-3 functional cut; design lands in P1c): pick a RECORDED real Kiro run → the gate re-judges
 * every attempt, the in-browser C64 re-runs every accepted patch (REPLAY), the contract is recomputed. Without the
 * ROM-bearing WASM (public URL, rights not cleared) it is RECORDED PLAYBACK: captured screens, gate re-judged, no
 * C64 — and the page says so. Nothing on this page calls Kiro; recordings are labelled as recordings.
 */
type RunRef = { id: string; file: string; label?: string; local?: boolean; title?: string; meta?: string; cod?: string };
type Mode = "loading" | "booting" | "replay" | "recorded" | "error";

declare global { interface Window { __ready?: Record<string, unknown> } }

type Booted = { core: C64Core | null; wasmSha256?: string };
async function bootCore(): Promise<Booted> {
  try {
    const head = await fetch("/c64.wasm", { method: "HEAD" });
    if (!head.ok || !/wasm/.test(head.headers.get("content-type") ?? "")) return { core: null };
    const bytes = new Uint8Array(await (await fetch("/c64.wasm")).arrayBuffer());
    // REPLAY refuses a different emulator build (spec F9): hash the exact bytes this browser boots
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const wasmSha256 = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    const core = createC64ReadyCore(bytes);
    await core.boot();
    return { core, wasmSha256 };
  } catch { return { core: null }; }
}

function download(name: string, data: Uint8Array | string, type: string) {
  const url = URL.createObjectURL(new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const parseJsonl = (text: string): RunEvent[] => text.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as RunEvent]; } catch { return []; } });

function recordedScreens(events: RunEvent[]): string[] {
  return events.filter((e) => e.k === "kiro" && e.op === "tool_result" && /c64_run/.test(String(e.title ?? ""))).map((e) => screenOf(String(e.text ?? "")));
}
const recordedErr = (e: unknown): string => { const x = e as { kind?: string; line?: number | null } | null; return x && x.kind ? `?${x.kind}  ERROR${x.line != null ? ` IN ${x.line}` : ""}` : JSON.stringify(e); };

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
  const [booted, setBooted] = useState<Booted | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("loading");
  const [result, setResult] = useState<(ReplayResult & { refused: string | null }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [cheatOut, setCheatOut] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const play = () => {
    if (!result || playing) return;
    setPlaying(true); setStep(0); setCheatOut(null);
    let i = 0;
    const tick = setInterval(() => { i += 1; setStep(i); if (i >= result.steps.length) { clearInterval(tick); setPlaying(false); setTimeout(() => document.querySelector("[data-testid=certificate]")?.scrollIntoView({ behavior: "smooth", block: "center" }), 500); } }, 1100);
  };

  useEffect(() => { fetch("/runs/index.json").then((r) => r.json()).then((j) => { setRuns(j.runs ?? []); if (!sel && j.runs?.[0]) setSel(j.runs[0].id); }).catch(() => setErr("no recorded runs index")); }, []);
  useEffect(() => { setMode("booting"); bootCore().then(setBooted); }, []);
  useEffect(() => {
    const ref = runs.find((r) => r.id === sel);
    if (!ref) return;
    fetch(ref.file).then((r) => r.text()).then((t) => setEvents(parseJsonl(t))).catch(() => setErr(`run ${ref.id} unavailable`));
  }, [sel, runs]);
  useEffect(() => {
    if (!events || booted === undefined) return;
    try {
      const r = replay(events, booted.core, { wasmSha256: booted.wasmSha256 });
      setResult(r); setStep(0); setMode(booted.core && !r.refused ? "replay" : "recorded");
    } catch (e) { setErr(String((e as Error).message)); setMode("error"); }
  }, [events, booted]);

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
    window.__ready = { mode, refused: result?.refused ?? null, final: result?.final ?? null, mismatches: result?.mismatches ?? null, contract: result?.contract ?? null, recordedEnd: result?.recordedEnd ?? null, screen: view?.screen ?? null, steps: result?.steps.length ?? 0, step };
  }, [mode, result, view, step]);

  const ocr = new Map((result?.input.lines ?? []).map((l) => [l.n, l.body]));
  const start = events?.find((e) => e.k === "start");
  const credits = [...(events ?? [])].reverse().find((e) => e.k === "credits" && e.total !== undefined);
  const firstErr = result?.steps.find((s) => s.kind === "run" && (s.facts?.run.error ?? s.recorded.error));
  const errObj = firstErr && firstErr.kind === "run" ? ((firstErr.facts?.run.error ?? firstErr.recorded.error) as { kind: string; line: number | null }) : null;
  const errText = errObj ? `?${errObj.kind}  ERROR${errObj.line != null ? ` IN ${errObj.line}` : ""}` : "";
  const creditText = !credits ? "credits: unknown" : credits.metered === false || credits.total === null ? "credits: unmetered" : `${credits.lowerBound ? "≥ " : ""}${Number(credits.total).toFixed(2)} credits`;
  const runLabel = start ? `recorded ${String(start.t ?? "").slice(0, 16).replace("T", " ")} UTC · ${String(start.model ?? "")} · ${creditText}` : "";
  const capIter = Number((start?.runner as { caps?: { iterations?: number } } | undefined)?.caps?.iterations ?? 15);
  const attemptNo = new Map<number, number>();
  (result?.steps ?? []).forEach((s, i) => { if (s.kind === "attempt") attemptNo.set(i, attemptNo.size + 1); });
  const inputFull = result?.input as (ReplayResult["input"] & { recovery?: RecoveryEvent[]; origin?: { recovered?: string; note?: string } }) | undefined;
  const prov = result && inputFull ? provenance(inputFull, result.final) : null;
  const reasons = new Map<number, string>();
  for (const s of result?.steps ?? []) if (s.kind === "attempt" && s.recomputed.verdict !== "refused" && s.reason) for (const o of s.ops) reasons.set(Number(o.lineno), s.reason);
  const stamp = stampFor(result?.contract?.verdict ?? (result?.recordedEnd?.result as string | undefined));
  const accAttempts = (result?.steps ?? []).filter((x) => x.kind === "attempt");
  const nRef = accAttempts.filter((x) => x.kind === "attempt" && x.recomputed.verdict === "refused").length;
  const nForced = accAttempts.filter((x) => x.kind === "attempt" && x.recomputed.verdict === "forced").length;
  const nAcc = accAttempts.length - nRef - nForced;
  const errataRows = result ? errata(result.input.lines, result.final, reasons) : [];
  const endCounts = (result?.recordedEnd?.counts ?? {}) as { sourceExact?: number; sourceTotal?: number };
  const note = (result?.input as { certificateNote?: string } | undefined)?.certificateNote ?? undefined;
  return (
    <main class={`desk${step >= (result?.steps.length ?? 1) && step > 0 && stamp === "lives" ? " alive" : ""}`}>
      <Nav here="raise" />
      <header>
        <p class="kicker">Kiroween 2026 · Resurrection</p>
        {errText && <p class="err" data-testid="first-error">{errText}</p>}
        <h1>Syntax error in 20</h1>
        <p class="note" style="font-size:1.05rem;color:var(--ink);max-width:62ch">A 1984 type-in listing refuses to run. The magazine printed a checksum on every line; a Kiro agent proposes the fix, a deterministic gate decides, and a real Commodore 64 gets the last word.</p>
        <p class="mode" data-testid="mode">
          {mode === "replay" && <><b>REPLAY</b> — a recorded real Kiro run, re-executed now: the gate re-judges every patch and this browser's C64 re-runs the program (replaying recorded OCR input).</>}
          {mode === "recorded" && <><b>RECORDED PLAYBACK</b> — captured screens of a recorded real Kiro run. The gate re-judges every patch in your browser; nothing runs on a C64 here (Commodore ROM rights not cleared).</>}
          {mode === "booting" && "booting the C64…"}
          {mode === "loading" && "loading…"}
          {mode === "error" && `error: ${err}`}
        </p>
        {runLabel && <p class="note" data-testid="run-label">{runLabel}</p>}
      </header>
      <ul class="stones" aria-label="recorded listings">
        {runs.map((r) => (
          <li>
            <button class="stone" aria-pressed={r.id === sel} onClick={() => { setSel(r.id); setPlaying(false); }}>
              <span class="t">{r.title ?? r.label ?? r.id}</span>
              <span class="m">{r.meta ?? "recorded real Kiro run"}</span>
              {r.cod && <span class="cod">cause of death · {r.cod}</span>}
            </button>
          </li>
        ))}
        <li><a class="stone" style="display:block;text-decoration:none" href="/scan"><span class="t">Random Number Test</span><span class="m">COMPUTE!'s Gazette, June 1984 · the real scan</span><span class="cod">checksum-flagged live · repair withheld (rights)</span></a></li>
        <li><a class="stone" style="display:block;text-decoration:none" href="/scan"><span class="t">Your own page</span><span class="m">ASSISTED: OCR + the magazine's checksum, in your tab, 0 credits</span></a></li>
      </ul>
      {result && <p><button data-testid="resurrect" disabled={playing} onClick={play}>{playing ? "raising…" : step >= result.steps.length ? "Resurrect again (replay the run)" : "Resurrect"}</button> <span class="note">replays the recorded run step by step; or drag the slider.</span></p>}
      {result && view && (
        <>
          <div class="panes">
            <section class="galley" aria-label="galley">
              <p class="paper-note">The printed page, as read. Blood-red = the line the C64 rejects or the checksum disagrees with; it re-inks C64 blue when the gate accepts the patch and the C64 re-runs.</p>
              <table>
                <tbody>
                  {view.listing.slice().sort((a, b) => a.n - b.n).map((l) => {
                    const m = mark(l);
                    const was = ocr.get(l.n);
                    return (
                      <tr class={m.cls}>
                        <td class="n">{l.n}</td>
                        <td class="body">{was !== undefined && was !== l.body ? <><del>{was}</del><br /><ins class="accepted">{l.body}</ins></> : l.body}</td>
                        <td class="rem">:rem {l.printed ?? "??"}</td>
                        <td class="mk">{m.sym}</td>
                        <td class="src">{(() => { const v = prov?.perLine.get(l.n) ?? ""; return was !== undefined && was === l.body && /patched/i.test(v) ? "OCR" : v; })()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
            <section class="c64" aria-label="C64 screen">
              <pre data-testid="screen">{view.screen}</pre>
              <p class="note" data-testid="screen-caption">{mode === "replay" ? "A real C64 (c64-ready) re-ran the program in this tab." : step === 0 ? "No C64 is running here. Press Resurrect to play the recorded run." : `Recorded screen from ${String(start?.t ?? "").slice(0, 10)}'s run, shown as text. No C64 is running in this tab (ROM rights not cleared).`}</p>
              <button class="danger" data-testid="cheat" onClick={() => { const c = cheat(view.listing, result.input.spec.expectedLines, view.errLine); setCheatOut(`Cheat: empty line ${c.line} → ${c.verdict.verdict.toUpperCase()} — ${c.verdict.reason}`); }}>Cheat: delete the error line</button>
              <p class="note">Cheat runs the same gate code as the Kiro Pre Tool Use hook, in your browser. It does not call Kiro.</p>
              {cheatOut && <p data-testid="cheat-out" class="refused">{cheatOut}</p>}
            </section>
          </div>
          <section class="strip" aria-label="run strip">
            <input type="range" min={0} max={result.steps.length} value={step} onInput={(e) => setStep(Number((e.target as HTMLInputElement).value))} aria-label="step" />
            <span>step {step}/{result.steps.length}</span>
            <ol>
              {result.steps.map((s, i) => (
                <li class={`${i < step ? "done" : ""} ${s.kind === "attempt" ? s.recomputed.verdict : "run"}`} onClick={() => setStep(i + 1)}>
                  {s.kind === "attempt" && <span class="iter">attempt {attemptNo.get(i)}/{capIter} · </span>}
                  {s.kind === "attempt" && s.reason && s.source === "server" && <span class="why">agent: “{s.reason}” → </span>}
                  {s.kind === "attempt" && i < step && <Stamp kind={s.recomputed.verdict === "refused" ? "refusal" : "accepted"} small />}{" "}{s.kind === "attempt" ? `${s.source === "hook" ? "by the Kiro Pre Tool Use hook: " : ""}${s.recomputed.reason.replace(/^((ACCEPTED|REFUSED|FORCED)\b:?\s*)+/i, "")}` : `RUN → ${s.facts ? (s.facts.run.error ? `?${s.facts.run.error.kind} ERROR${s.facts.run.error.line != null ? ` IN ${s.facts.run.error.line}` : ""}` : s.facts.titleSeen ? `title · post-title ${s.facts.postTitle}` : "no title") : `(recorded) ${s.recorded.error ? recordedErr(s.recorded.error) : s.recorded.titleSeen ? "title" : "no title"}`}${s.match === false ? " ≠ RECORD" : ""}`}
                </li>
              ))}
            </ol>
          </section>
          <section class="cert" data-testid="certificate" aria-label="death certificate, reversed">
            <div class="cert-head">
              <div>
                <p class="kicker">Certificate of resurrection</p>
                {result.contract
                  ? <h2>{certificateHeading(result.contract, result.input.scope, result.input.spec.expectedLines.length, { sourceExact: endCounts.sourceExact, sourceTotal: endCounts.sourceTotal, note })}</h2>
                  : <h2>{String(result.recordedEnd?.result ?? "no end event").toUpperCase()} (recorded)</h2>}
              </div>
              {step >= result.steps.length && stamp && <div><Stamp kind={stamp} />{!result.contract && <p class="note" data-testid="stamp-caption">as recorded — not re-run on a C64 here</p>}</div>}
            </div>
            <dl data-testid="cert-fields">
              <dt>cause of death</dt><dd>{errText || "no C64 error recorded"} <span class="note">(the run's own first error, verbatim)</span></dd>
              <dt>treatment</dt><dd>{nAcc} patch{nAcc === 1 ? "" : "es"} accepted · {nRef} refused · {nForced} forced</dd>
              <dt>run ended</dt><dd>{String(result.recordedEnd?.t ?? "") ? `${String(result.recordedEnd?.t).slice(0, 19).replace("T", " ")} UTC` : "unrecorded"} <span class="note">(the run's own end event, not a clock we invent)</span></dd>
              <dt>examined by</dt><dd>the checksum gate: Pre Tool Use hook + MCP, re-judged in this tab</dd>
              <dt>pronounced alive by</dt><dd>{mode === "replay" ? "the C64 re-RUN in this tab" : "the recorded C64 screens (not re-run here)"}</dd>
            </dl>
            {result.contract
              ? <>{result.recordedEnd?.sourceReference ? <p class="note" data-testid="source-ref">source-exact is measured against a reference transcript ({String(result.recordedEnd.sourceReference)}); it is never given to the agent, and "source-exact" means "matches that reference", not "matches the magazine".</p> : null}<p class="counts">recomputed now from the final listing and this browser's C64 · verified {result.contract.counts.verified} · digit-misread {result.contract.counts.digitMisread} · forced {result.contract.counts.forced} · unverified {result.contract.counts.unverified} · missing {result.contract.counts.missing} · typed {result.contract.counts.typed}</p></>
              : <p class="note">the recorded certificate; the contract is recomputed only where a C64 can run</p>}
            {prov && (
              <div data-testid="provenance">
                <p>where every final line came from · page OCR {prov.counts.ocr} · re-OCR of a gap {prov.counts.reOcr} · TYPED by a person {prov.counts.typed} · changed by a gate-accepted Kiro patch {prov.counts.patched}</p>
                <p>{prov.addedDuringRun.length === 0
                  ? "No line was added during the run: the gate refuses inserts, so every missing line can only be re-OCR'd or TYPED before the run, never written by the model."
                  : `Lines added during the run: ${prov.addedDuringRun.join(", ")}`}</p>
                {prov.recovery.length > 0 && <p>lost-line recovery before the run: {prov.recovery.map((r) => `${r.line ?? r.ocrNumber ?? "?"} ${r.op} → ${r.outcome}`).join(" · ")}{prov.orphansExcluded ? ` (${prov.orphansExcluded} orphan line${prov.orphansExcluded > 1 ? "s" : ""} excluded, never typed)` : ""}</p>}
                {prov.origin && <p class="note">line inventory: {prov.origin}</p>}
              </div>
            )}
            <p class="downloads">
              <button data-testid="dl-prg" onClick={() => download(`${result.input.listingId}-${(result.contract?.verdict ?? "recorded").toLowerCase()}.prg`, prgBytes(result.final), "application/octet-stream")}>download .PRG (loads at $0801)</button>
              <button data-testid="dl-errata" disabled={errataRows.length === 0} onClick={() => download(`${result.input.listingId}-errata.txt`, errataText(result.input.listingId, result.contract?.heading ?? String(result.recordedEnd?.result ?? "recorded"), errataRows), "text/plain")}>download errata ({errataRows.length} line{errataRows.length === 1 ? "" : "s"})</button>
            </p>
            {result.refused && <p class="refused" data-testid="replay-refused">{result.refused} — showing recorded screens; the gate still re-judges every patch.</p>}
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
      all.sort((x, y) => String(x.e.t ?? "").localeCompare(String(y.e.t ?? "")));
      setRows(all);
    });
  }, []);
  return (
    <main class="desk kiro">
      <Nav here="kiro" />
      <h1>/kiro — what Kiro's hooks did in recorded runs</h1>
      <p class="note">A static view over recorded run logs (each row names its run). Hook rows come from the hook processes themselves, not from the model's words.</p>
      <div class="tablewrap"><table data-testid="kiro-rows">
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
      </table></div>
    </main>
  );
}

const path = location.pathname;
render(path.startsWith("/kiro") ? <KiroView /> : path.startsWith("/scan") ? <ScanView /> : <Desk />, document.getElementById("app")!);
