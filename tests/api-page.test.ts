import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../api/page.js";

const req = (qs: string) => new Request(`https://ready.test/api/page?${qs}`);
afterEach(() => vi.unstubAllGlobals());

describe("/api/page proxy", () => {
  it("refuses an item that is not allow-listed (not an open proxy)", async () => {
    const r = await GET(req("id=evil-item&n=1"));
    expect(r.status).toBe(400);
  });
  it("refuses prototype keys: the allow-list is own keys only (arch review 01)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) expect((await GET(req(`id=${id}&n=0`))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("checks every redirect hop before fetching it, and refuses an oversized body before or while reading (arch review 01)", async () => {
    const img = () => new Response(new Uint8Array([0xff, 0xd8]), { status: 200, headers: { "content-type": "image/jpeg" } });
    const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
    const off = vi.fn(async () => redirect("https://evil.example/x.jpg"));
    vi.stubGlobal("fetch", off);
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(502);
    expect(off).toHaveBeenCalledTimes(1); // the off-archive host is never contacted
    const ia = vi.fn().mockResolvedValueOnce(redirect("https://ia800300.us.archive.org/x/page/n1.jpg")).mockResolvedValueOnce(img());
    vi.stubGlobal("fetch", ia);
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(200);
    expect(ia.mock.calls[1]![0]).toBe("https://ia800300.us.archive.org/x/page/n1.jpg");
    expect(ia.mock.calls[1]![1]).toMatchObject({ redirect: "manual" });
    const loop = vi.fn(async () => redirect("https://archive.org/download/again"));
    vi.stubGlobal("fetch", loop);
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(502);
    expect(loop).toHaveBeenCalledTimes(4);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/jpeg", "content-length": "9000000" } })));
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(502);
    const http = vi.fn(async () => redirect("http://ia800300.us.archive.org/x.jpg"));
    vi.stubGlobal("fetch", http);
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(502); // no https → http downgrade
    expect(http).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "image/jpeg" } })));
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(502); // never a zero-byte "image"
    const broken = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xff])); c.error(new Error("aborted")); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(broken, { status: 200, headers: { "content-type": "image/jpeg" } })));
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(504); // a body that dies mid-read is a JSON 504
    const big = new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1_000_000)); c.close(); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(big, { status: 200, headers: { "content-type": "image/jpeg" } })));
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(502);
  });
  it("refuses a width outside the allow-list and a page out of range", async () => {
    expect((await GET(req("id=1984-06-computegazette&n=1&w=3200"))).status).toBe(400);
    expect((await GET(req("id=1984-06-computegazette&n=9999"))).status).toBe(400);
    expect((await GET(req("id=1984-06-computegazette&n=abc"))).status).toBe(400);
  });
  it("proxies the allow-listed page image with CDN cache headers", async () => {
    const fetchMock = vi.fn(async (_u: string) => new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await GET(req("id=1984-06-computegazette&n=177&w=1600"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toMatch(/s-maxage=86400/);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://archive.org/download/1984-06-computegazette/page/n177_w1600.jpg");
    expect((await r.arrayBuffer()).byteLength).toBe(6);
  });
  it("full page when w is omitted", async () => {
    const fetchMock = vi.fn(async (_u: string) => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    await GET(req("id=1984-06-computegazette&n=178"));
    expect(fetchMock.mock.calls[0]![0]).toBe("https://archive.org/download/1984-06-computegazette/page/n178.jpg");
  });
  it("maps upstream failure, a non-image and a timeout to an error, never a body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })));
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    expect((await GET(req("id=1984-06-computegazette&n=1"))).status).toBe(504);
  });
});
