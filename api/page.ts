/**
 * GET /api/page?id=<archive item>&n=<page index>&w=<800|1600>   (w omitted = the full 2376 px page)
 *
 * One Vercel function on the same origin as the SPA: archive.org page images send no Access-Control-Allow-Origin
 * (spike probe A4), so in-browser OCR needs same-origin pixels. Allow-listed item ids only (data/pages.json), so this
 * is not an open proxy. Nothing is written to disk; the CDN caches the response via Cache-Control (spike P measures it).
 * The scan pane and the replay never wait on this: on any failure the SPA shows a labelled "scan unavailable" state.
 */
import pages from "../data/pages.json" with { type: "json" };

const MAX_BYTES = 4_500_000; // Vercel function response limit is 4.5 MB; the full page image measured 1.16 MB

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const id = q.get("id") ?? "";
  const n = Number(q.get("n"));
  const wRaw = q.get("w");
  const item = (pages.items as Record<string, { maxPage: number; widths: number[] }>)[id];
  if (!item) return json(400, { error: "item not allow-listed" });
  if (!Number.isInteger(n) || n < 0 || n > item.maxPage) return json(400, { error: "page out of range" });
  let w: number | null = null;
  if (wRaw !== null) {
    w = Number(wRaw);
    if (!item.widths.includes(w)) return json(400, { error: `w must be one of ${item.widths.join(", ")} or omitted` });
  }
  const url = `https://archive.org/download/${id}/page/n${n}${w ? `_w${w}` : ""}.jpg`;
  const t0 = Date.now();
  let up: Response;
  try {
    up = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "ready-page-proxy/0.1 (hackathon demo; allow-listed)" } });
  } catch { return json(504, { error: "archive.org unreachable or slow" }); }
  if (!up.ok) return json(up.status === 404 ? 404 : 502, { error: `archive.org answered ${up.status}` });
  const type = up.headers.get("content-type") ?? "";
  if (!/^image\/jpeg/.test(type)) return json(502, { error: "unexpected content type" });
  const buf = new Uint8Array(await up.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) return json(502, { error: "image larger than the function limit" });
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      // 24 h at the CDN, a week stale-while-revalidate; page scans never change
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "x-upstream-ms": String(Date.now() - t0),
      "x-upstream-bytes": String(buf.byteLength),
    },
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
