import { useState } from "preact/hooks";
import { ocrImage, STOPS, type ScanStop } from "../ocr/browser.ts";
import { Nav } from "./nav.tsx";
import { assistedHeading, basExport, errataSheet, flagAll, flagLine, summarize, type FlaggedLine } from "../ocr/flag.ts";

/**
 * ASSISTED mode (no Kiro call, no emulator, 0 credits): a real page from archive.org through /api/page, or the judge's
 * own scan → in-tab tesseract.js → the magazine's own :rem checksum flags each line → inline edit with a per-keystroke
 * recheck → .bas / errata export. Its certificate is never "resurrected" and says the missing lines are unknown.
 */
const ITEM = "1984-06-computegazette";
const PAGES = [{ n: 177, label: "n177 — the right-hand page of the 1984 spread" }, { n: 178, label: "n178" }];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

declare global { interface Window { __scan?: Record<string, unknown> } }

export function ScanView() {
  const [stop, setStop] = useState<ScanStop>(1600);
  const [page, setPage] = useState(177);
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [lines, setLines] = useState<FlaggedLine[] | null>(null);
  const [meta, setMeta] = useState<{ ms: number; width: number; rows: number; engine: string; source: string } | null>(null);

  async function run(blob: Blob, source: string) {
    setBusy("reading the page in this tab…"); setPct(0); setLines(null);
    if (img) URL.revokeObjectURL(img);
    setImg(URL.createObjectURL(blob));
    try {
      const r = await ocrImage(blob, stop, (p, s) => { setPct(p); setBusy(s); });
      const flagged = flagAll(r.logical);
      setLines(flagged); setMeta({ ms: r.ms, width: r.width, rows: r.rows, engine: r.engine, source });
      window.__scan = { done: true, lines: flagged.length, ok: flagged.filter((l) => l.state === "ok").length, ms: r.ms, width: r.width, source };
      setMsg(null);
    } catch (e) { setMsg(`OCR failed: ${(e as Error).message}`); window.__scan = { done: true, error: String((e as Error).message) }; }
    setBusy(null);
  }
  async function fetchPage() {
    setMsg(null); setBusy("fetching the page through /api/page…");
    try {
      const r = await fetch(`/api/page?id=${ITEM}&n=${page}${stop === 2376 ? "" : `&w=${stop}`}`);
      if (!r.ok) throw new Error(`/api/page answered ${r.status}`);
      await run(await r.blob(), `archive.org ${ITEM} n${page} (via /api/page)`);
    } catch (e) { setBusy(null); setMsg(`scan unavailable — ${(e as Error).message}. The recorded run on the first page still plays.`); }
  }
  const edit = (n: number, body: string) => setLines((ls) => ls && ls.map((l) => (l.n === n ? flagLine(l.n, body, l.printed, true) : l)));
  const sum = lines ? summarize(lines) : null;

  return (
    <main class="desk">
      <Nav here="scan" />
      <p class="kicker">ASSISTED · no Kiro call · 0 credits</p>
      <h1>Check a page against its own checksum</h1>
      <p class="mode">Every 1984 Gazette line ends in <b>:rem NNN</b>, a checksum of the characters above it. Read a page in your tab, and each line is marked <b>✓</b> only if its recomputed sum equals the printed one. Nothing is uploaded: the OCR engine, its worker and its language data are served from this site.</p>
      <section class="scan" aria-label="scan source">
        <div class="controls">
          <label>Scan quality <select value={stop} onChange={(e) => setStop(Number((e.target as HTMLSelectElement).value) as ScanStop)} data-testid="stop">{STOPS.map((s) => <option value={s}>{s} px wide</option>)}</select></label>
          <label>Page <select value={page} onChange={(e) => setPage(Number((e.target as HTMLSelectElement).value))}>{PAGES.map((p) => <option value={p.n}>{p.label}</option>)}</select></label>
          <button data-testid="read-archive" disabled={!!busy} onClick={fetchPage}>Read the real 1984 page</button>
          <label>or your own scan <input type="file" accept="image/*" data-testid="upload" disabled={!!busy} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) run(f, `your upload (${f.name})`); }} /></label>
        </div>
        <p class="note">Source width stops are measured in pixels of the source image, not dpi. The page image is archive.org's own public scan, fetched on demand and never stored here.</p>
        {busy && <p data-testid="busy"><progress max={1} value={pct} /> {busy}</p>}
        {msg && <p class="refused" data-testid="scan-msg">{msg}</p>}
        {img && <details><summary>the scan being read</summary><img class="page" src={img} alt="the scanned magazine page being read" /></details>}
      </section>
      {lines && sum && meta && (
        <section class="assisted" data-testid="assisted">
          <h2><span class="badge">ASSISTED</span> {assistedHeading(sum)}</h2>
          <p class="note" data-testid="ocr-meta">{meta.engine} · {meta.rows} rows · source {meta.source} · read at {meta.width} px wide in {(meta.ms / 1000).toFixed(1)} s in this tab. Not automatically resurrected: nothing was run, and the page's full line inventory is unknown, so a missing line cannot be flagged.</p>
          <div class="galley">
            <p class="paper-note">Edit any flagged line; its checksum is rechecked on every keystroke. A line is verified only by a match, never by looking right.</p>
            <table><tbody>
              {lines.map((l) => (
                <tr class={l.state === "ok" || l.state === "digit-misread" ? "ok" : l.state === "mismatch" ? "bad" : "unv"}>
                  <td class="n">{l.n}</td>
                  <td class="body">{l.state === "ok" ? l.body : <input type="text" value={l.body} aria-label={`line ${l.n}`} onInput={(e) => edit(l.n, (e.target as HTMLInputElement).value)} />}</td>
                  <td class="rem">:rem {l.printed ?? "??"}{l.computed !== null && l.computed !== l.printed ? ` (now ${l.computed})` : ""}</td>
                  <td class="mk">{l.state === "ok" ? "✓" : l.state === "digit-misread" ? "✓ digits misread" : l.state === "mismatch" ? "✗ mismatch" : "? no checksum"}{l.edited ? " · edited" : ""}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <p class="downloads"><button class="calm" data-testid="dl-bas" onClick={() => download(`assisted-${page}.bas.txt`, basExport(lines))}>download .bas (unverified lines commented out)</button> <button class="calm" onClick={() => download(`assisted-${page}-errata.txt`, errataSheet(lines))}>download errata</button></p>
        </section>
      )}
    </main>
  );
}
