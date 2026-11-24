#!/usr/bin/env node
/**
 * verify_offline: OCR + checksum + emulator + REPLAY work with every non-local network request BLOCKED, from a clean
 * browser profile (a fresh context, no cache, no storage). Local vite dev serves the app and the builder-only c64.wasm.
 *   1. /  → REPLAY of the recorded authored run plays to RESURRECTED on the in-browser C64
 *   2. /scan → upload the authored page image → self-hosted tesseract.js reads it → checksum flags appear
 * Evidence: evidence/offline/verify-offline.json (blocked-request count must be 0 attempted-and-needed failures).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const port = 5197;
const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
await new Promise((res, rej) => { vite.stdout.on("data", (d) => /Local:/.test(d.toString()) && res()); setTimeout(() => rej(new Error("vite did not start")), 30_000); });
const browser = await chromium.launch();
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
let blocked = [];
try {
  const ctx = await browser.newContext(); // clean profile
  await ctx.route((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (route) => { blocked.push(route.request().url()); route.abort(); });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?still=1&run=line20-hero`);
  await page.waitForFunction(() => window.__ready?.mode === "replay" && window.__ready.steps > 0, null, { timeout: 120_000 });
  await page.click("[data-testid=resurrect]");
  await page.waitForFunction(() => window.__ready.step === window.__ready.steps, null, { timeout: 120_000 });
  const st = await page.evaluate(() => window.__ready);
  check("REPLAY plays offline on the in-browser C64 and recomputes RESURRECTED", st.mode === "replay" && st.contract?.verdict === "RESURRECTED" && st.mismatches.length === 0, { mode: st.mode, verdict: st.contract?.verdict, mismatches: st.mismatches });
  await page.goto(`http://localhost:${port}/scan`);
  await page.selectOption("[data-testid=columns]", "1");
  await page.setInputFiles("[data-testid=upload]", "fixtures/authored/line20.page.png");
  await page.waitForFunction(() => window.__scan?.done, null, { timeout: 180_000 });
  const sc = await page.evaluate(() => window.__scan);
  check("OCR (self-hosted tesseract.js) + checksum flags work offline on an uploaded page", !sc.error && !sc.unreadable && sc.lines >= 10 && sc.ok >= 8, sc);
  check("no non-local request was even attempted (everything is self-hosted)", blocked.length === 0, { blockedAttempts: blocked.length, urls: blocked.slice(0, 5) });
} finally { await browser.close(); vite.kill(); }
const ok = checks.every((c) => c.pass);
mkdirSync("evidence/offline", { recursive: true });
writeFileSync("evidence/offline/verify-offline.json", JSON.stringify({ date: new Date().toISOString(), ok, checks }, null, 1) + "\n");
console.log(JSON.stringify({ ok, checks }, null, 1));
process.exit(ok ? 0 : 1);
