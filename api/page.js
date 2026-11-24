/**
 * GET /api/page?id=<archive item>&n=<page index>&w=<800|1600>   (w omitted = the full 2376 px page)
 *
 * (Plain JS on purpose: @vercel/node reads TypeScript via ts.sys, which TypeScript 7 no longer has, so a .ts function fails `vercel build`.)
 * One Vercel function on the same origin as the SPA: archive.org page images send no Access-Control-Allow-Origin
 * (spike probe A4), so in-browser OCR needs same-origin pixels. Allow-listed item ids only (data/pages.json), so this
 * is not an open proxy. Nothing is written to disk; the CDN caches the response via Cache-Control (spike P measures it).
 * The scan pane and the replay never wait on this: on any failure the SPA shows a labelled "scan unavailable" state.
 */
import pages from "../data/pages.json" with { type: "json" };

const MAX_BYTES = 4_500_000; // Vercel function response limit is 4.5 MB; the full page image measured 1.16 MB

/** @param {Request} request @returns {Promise<Response>} */
export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const id = q.get("id") ?? "";
  const n = Number(q.get("n"));
  const wRaw = q.get("w");
  // Own keys only: a plain-object lookup would let `constructor`, `toString` or `__proto__` through (a2a arch-01).
  const items = /** @type {Record<string, { maxPage: number; widths: number[] }>} */ (pages.items);
  if (!Object.hasOwn(items, id)) return json(400, { error: "item not allow-listed" });
  const item = items[id];
  if (!Number.isInteger(n) || n < 0 || n > item.maxPage) return json(400, { error: "page out of range" });
  /** @type {number | null} */ let w = null;
  if (wRaw !== null) {
    w = Number(wRaw);
    if (!item.widths.includes(w)) return json(400, { error: `w must be one of ${item.widths.join(", ")} or omitted` });
  }
  const url = `https://archive.org/download/${id}/page/n${n}${w ? `_w${w}` : ""}.jpg`;
  const t0 = Date.now();
  /** @type {Response} */ let up;
  try {
    up = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "ready-page-proxy/0.1 (hackathon demo; allow-listed)" } });
  } catch { return json(504, { error: "archive.org unreachable or slow" }); }
  if (!up.ok) return json(up.status === 404 ? 404 : 502, { error: `archive.org answered ${up.status}` });
  // archive.org redirects /download/ to its own ia*.us.archive.org hosts; anything else is not the page we allow-listed.
  // (`up.url` is empty only on a Response built in a test, never on a real fetch.)
  if (up.url && !isArchiveHost(up.url)) return json(502, { error: "archive.org redirected off archive.org" });
  if (Number(up.headers.get("content-length") ?? 0) > MAX_BYTES) return json(502, { error: "image larger than the function limit" });
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

/** @param {string} u */
function isArchiveHost(u) {
  const h = new URL(u).hostname;
  return h === "archive.org" || h.endsWith(".archive.org");
}

/** @param {number} status @param {unknown} body */
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
