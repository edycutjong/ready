import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../api/page.ts";

const req = (qs: string) => new Request(`https://ready.test/api/page?${qs}`);
afterEach(() => vi.unstubAllGlobals());

describe("/api/page proxy", () => {
  it("refuses an item that is not allow-listed (not an open proxy)", async () => {
    const r = await GET(req("id=evil-item&n=1"));
    expect(r.status).toBe(400);
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
