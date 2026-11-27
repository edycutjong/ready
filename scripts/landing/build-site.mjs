#!/usr/bin/env node
// Builds the judge-facing pages from the run log and the evidence files, then asserts every figure:
//   scripts/landing/landing.html  ->  public/landing/index.html   (+ public/landing/gate.js, the real gate)
//   scripts/landing/deck.html     ->  public/deck/index.html      (when present)
//   scripts/landing/judge.html    ->  public/judge/index.html     (/judge: the judge guide; every GitHub link must be a tracked file)
// Nothing on either page is typed by hand if it can be read from a file: the C64 screens are the recorded screens
// (drawn with our own 8x8 alphabet, not the ROM), the terminal rows are the run's own events, the numbers are read
// from the jsonl, bench JSON, README and the test-run note. Run: node scripts/landing/build-site.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const pf = require("./pixelfont.cjs");
const ROOT = new URL("../../", import.meta.url).pathname;
const rd = (p) => readFileSync(ROOT + p, "utf8");
const fail = (m) => { console.error("build-site: ASSERT FAILED — " + m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- the recorded run ----------
const RUN_FILE = "public/runs/line20-2026-11-24T19-56-44Z.jsonl";
const ev = rd(RUN_FILE).trim().split("\n").map((l) => JSON.parse(l));
const start = ev.find((e) => e.k === "start"), end = ev.find((e) => e.k === "end");
const t0 = Date.parse(start.t);
const sorted = [...ev].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
const runs = ev.filter((e) => e.k === "kiro" && e.op === "tool_result" && e.title === "@c64/c64_run");
ok(runs.length === 2, "two c64_run results");
const gateRow = ev.find((e) => e.k === "gate");
const creditsTotal = ev.filter((e) => e.k === "credits").at(-1).total;
const hms = (t) => new Date(t).toISOString().slice(11, 19);
const off = (t) => Date.parse(t) - t0;

function block(text, name) {
  const L = text.split("\n"); const i = L.indexOf(`--- ${name} ---`); ok(i >= 0, `screen block ${name}`);
  const out = []; for (let j = i + 1; j < L.length && !L[j].startsWith("--- "); j++) out.push(L[j]);
  while (out.length < 25) out.push(""); return out.slice(0, 25);
}
const SCREENS = { error: block(runs[0].text, "AFTER RUN"), title: block(runs[1].text, "TITLE"), post: block(runs[1].text, "POST-TITLE") };
ok(SCREENS.error.some((r) => r.trim() === "?SYNTAX  ERROR IN 20"), "error screen prints ?SYNTAX  ERROR IN 20 (two spaces, ROM string)");
ok(SCREENS.title.some((r) => r.includes("** THE LAST SEANCE **")), "title screen");
ok(SCREENS.post.some((r) => r.includes("IT LIVES")) && SCREENS.post.some((r) => r.includes("READY TO RISE.")), "post-title screen");
// row pitch 10: the C64 cell is 8 rows; two extra units of leading keep adjacent rows apart at small display sizes
// (the post-title screen's last row, the cursor on row 11, still ends inside the 200-unit face)
const ROW = 10;
const screenPath = (rows) => rows.map((r, i) => (r.trim() ? pf.path(r.replace(/\s+$/, ""), 0, i * ROW, 1) : "")).join("");
// the blinking cursor sits on the row after the last READY. (a screen waiting in GET has none)
const cursorRow = (rows) => { const i = rows.map((r) => r.trim()).lastIndexOf("READY."); return i < 0 ? "" : `<rect class="cur" x="0" y="${(i + 1) * ROW}" width="8" height="8"/>`; };
const screenText = (rows) => rows.map((r) => r.trim()).filter(Boolean).join(" / ");

const firstLine = (t) => t.split("\n")[0];
const before = firstLine(runs[0].text), after = firstLine(runs[1].text);
const mB = before.match(/(\d+)\/(\d+) checksum-consistent/), mA = after.match(/(\d+)\/(\d+) checksum-consistent/);
ok(mB && mA && after.startsWith("RESURRECTED") && end.result === "RESURRECTED", "run result RESURRECTED with n/n counts");
const lines = start.input.lines.map((l) => ({ n: l.n, body: l.body.replace(/\s+$/, ""), printed: l.printed, status: l.status, source: l.source }));
const L20 = lines.find((l) => l.n === 20);
const patch = ev.find((e) => e.k === "proposal").ops[0];
ok(patch.lineno === 20, "patch targets line 20");

// ---------- the real gate, bundled ----------
mkdirSync(ROOT + "public/landing", { recursive: true });
execFileSync(ROOT + "node_modules/.bin/esbuild", ["scripts/landing/gate-entry.ts", "--bundle", "--format=iife", "--minify",
  "--target=es2020", "--legal-comments=none", "--outfile=public/landing/gate.js", "--log-level=warning"], { cwd: ROOT, stdio: "inherit" });
const ctx = { globalThis: {} }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(rd("public/landing/gate.js"), ctx);
const G = ctx.READY_GATE; ok(G && G.applyPatch && G.checkLine && G.computeChecksum, "gate.js exposes READY_GATE");
const expected = start.input.spec.expectedLines;
const judge = (body) => G.applyPatch(lines, [{ type: "replace", lineno: 20, new_body: body }], expected);
const vAgent = judge(patch.new_body);
ok(vAgent.verdict === "accepted" && vAgent.reason === gateRow.reason, `bundle reproduces the recorded verdict: "${vAgent.reason}" vs "${gateRow.reason}"`);
const vOcr = judge(L20.body); ok(vOcr.verdict === "refused" && /R4\.15/.test(vOcr.reason), "OCR reading refused (untypeable)");
const TM_ONLY = 'PRINT™   ** THE LAST SEANCE **"';
const naive = G.computeChecksum(20, TM_ONLY), vTm = judge(TM_ONLY);
ok(naive === L20.printed && vTm.verdict === "refused", `the ™ trap: naive sum ${naive} = printed ${L20.printed}, gate refuses`);
ok(judge("").verdict === "refused" && /R4\.4/.test(judge("").reason), "cheat (empty line) refused R4.4");
ok(judge('PRINT"   ** IT LIVES **"').verdict === "refused" && /R4\.7/.test(judge('PRINT"   ** IT LIVES **"').reason), "rewrite refused R4.7");
const ocrSum = G.checkLine(20, L20.body, L20.printed).computed;
const gateKb = (statSync(ROOT + "public/landing/gate.js").size / 1024).toFixed(1);

// ---------- evidence numbers ----------
const BENCH_FILE = "evidence/bench/" + readdirSync(ROOT + "evidence/bench").filter((f) => /^bench-\d{4}-\d\d-\d\d(-[a-z0-9]+)?\.json$/.test(f)).sort().at(-1);
const bench = JSON.parse(rd(BENCH_FILE));
const bRow = (re) => { const r = bench.rows.find((x) => re.test(x.name)); ok(r, `bench row ${re}`); return r; };
const gateB = bRow(/^gate: applyPatch/), bootB = bRow(/^emulator boot/), ocrB = bRow(/^OCR: tesseract/), repB = bRow(/^REPLAY/);
const TEST_NOTE = "evidence/tests/" + readdirSync(ROOT + "evidence/tests").filter((f) => /^npm-test-\d{4}-\d\d-\d\d[a-z]?\.txt$/.test(f)).sort().at(-1);
const testNote = rd(TEST_NOTE);
const tests = +testNote.match(/Tests\s+(\d+) passed/)[1], testFiles = +testNote.match(/Test Files\s+(\d+) passed/)[1];
const testsCommit = testNote.match(/on HEAD ([0-9a-f]{7})/)[1], noteDate = testNote.match(/(\d{4}-\d\d-\d\d)/)[1];
const evals = rd("docs/EVALS.md"), c1 = evals.match(/^\| 1 \| Random Number Test[^\n]*\*\*(\d+)\/(\d+)\*\* TITLE-PATH RESURRECTED/m);
ok(c1, "EVALS.md case 1 tally");
const README = rd("README.md");
for (const s of ["12 of 12 `RESURRECTED`", "19/28", "search fixed 3 of 18 failing lines", "made all 18 checksum-consistent",
  "51.26 of 50", "68.71 of 70", `${tests} passing, ${testFiles} files`])
  ok(README.includes(s), `README carries "${s}"`); // consistency with the README (which cites its evidence), not evidence
// the test count and the commit it was measured on are read from the test-run note, and README + DEMO must name both
ok(README.includes(`\`npm test\` on ${testsCommit}`), `README names the test commit ${testsCommit}`);
ok(rd("DEMO.md").includes(`${tests} tests + 1 expected fail, ${testFiles} files`) && rd("DEMO.md").includes(`\`npm test\` on ${testsCommit}`), `DEMO names ${tests} tests on ${testsCommit}`);
ok(/28\/28/.test(rd("evidence/spikes/spike-G0.md")), "spike-G0 carries 28/28");
const steering = readdirSync(ROOT + ".kiro/steering").filter((f) => f.endsWith(".md")).length;
ok(steering === 7, "7 steering files");
const trust = start.runner.trustTools; ok(trust.length === 6, "agent trusts 6 @c64 tools");
for (const t of trust) ok(rd("scripts/landing/landing.html").includes(`<code>${t.replace("@c64/", "")}</code>`), `landing lists tool ${t}`);
const gates = ev.filter((e) => e.k === "gate"), nv = (v) => gates.filter((g) => g.verdict === v).length;
const spikeG = JSON.parse(rd("evidence/spikes/spike-G.json"));
ok(/^PASS .*TITLE-PATH RESURRECTED in both attempts/.test(spikeG.verdict) && spikeG.attempts.length === 2, "spike G: title path raised in both attempts");
ok(/Measured 43\/43 on a real June 1984 page/.test(rd("src/basic/checksum.ts")), "checksum.ts carries the 43/43 measurement");
// reproducible version stamp: a hash of every input the pages are built from (not git HEAD, which moves on each commit)
const siteVer = createHash("sha256").update(["scripts/landing/landing.html", "scripts/landing/deck.html", "scripts/landing/judge.html", "scripts/landing/build-site.mjs", RUN_FILE, BENCH_FILE,
  TEST_NOTE, "README.md", "docs/EVALS.md"].filter((f) => existsSync(ROOT + f)).map((f) => rd(f)).join("\u0000")).digest("hex").slice(0, 7);
const head = siteVer;

const V = {
  wall_s: (end.wallMs / 1000).toFixed(1), wall_ms: String(end.wallMs), credits: creditsTotal.toFixed(2),
  ok_after: mA[1], n_lines: mA[2], ok_before: mB[1], printed20: String(L20.printed), ocr_sum: String(ocrSum),
  iterations: String(end.iterations), tests: String(tests), test_files: String(testFiles),
  gate_p50: String(+gateB.p50.toFixed(2)), gate_p95: String(+gateB.p95.toFixed(2)), gate_n: String(gateB.n), boot_p50: String(Math.round(bootB.p50)),
  boot_n: String(bootB.n), ocr_p50: String(Math.round(ocrB.p50)), ocr_n: String(ocrB.n), replay_p50: (repB.p50 / 1000).toFixed(1),
  gate_kb: gateKb, steering: String(steering), tools: String(trust.length), tm_naive: String(naive),
  run_date: start.t.slice(0, 10), run_hm: start.t.slice(11, 16), run_start: hms(start.t), run_end: hms(end.t),
  revival: hms(gateRow.t), alive_at: hms(runs[1].t), kiro_cli: start.runner.kiroCli, model: start.model,
  emulator: start.emulator.id, agent: start.runner.agent, run_file: RUN_FILE.replace(/^public/, ""), head,
  err_screen: esc(screenText(SCREENS.error)), title_screen: esc(screenText(SCREENS.title)), post_screen: esc(screenText(SCREENS.post)),
  ocr_body: esc(L20.body), fix_body: esc(patch.new_body), tm_only: esc(TM_ONLY), reason_ocr: esc(vOcr.reason),
  reason_ocr_s: esc(vOcr.reason.split(". ")[0] + "."),
  reason_agent: esc(vAgent.reason), reason_agent_s: esc(vAgent.reason.replace(/^ACCEPTED: /, "")), cap_iter: String(start.runner.caps.iterations), cap_credits: String(start.runner.caps.credits),
  n_acc: String(nv("accepted")), n_ref: String(nv("refused")), n_forced: String(nv("forced")), g_attempts: String(spikeG.attempts.length),
  build_date: noteDate, site_ver: siteVer, tests_commit: testsCommit, bench_date: bench.date.slice(0, 10), bench_file: BENCH_FILE,
  case1: `${c1[1]} of ${c1[2]}`, err_at: "+" + (off(runs[0].t) / 1000).toFixed(1), res_at: "+" + (off(runs[1].t) / 1000).toFixed(1),
  stop_row: esc((() => { const h = ev.find((e) => e.k === "hook" && e.via === "kiro-stop"); return `${hms(h.t)} until-title (kiro-stop) exit ${h.exit} · ${h.decision} · ${h.reason}`; })()),
  gate_p95_ms: String(+gateB.p95.toFixed(2)),
  cap_s: String(start.runner.caps.wallMs / 1000), patch_reason: esc(patch.reason ?? ev.find((e) => e.k === "proposal").reason),
};

// ---------- the judge page (/judge): every figure read from its evidence file or checked against the prose ----------
const jsonOf = (p) => JSON.parse(rd(p));
const FC_FILE = "evidence/tests/fresh-clone-2026-11-27.txt", fc = rd(FC_FILE);
const fcT = fc.match(/Tests\s+(\d+) passed \| (\d+) expected fail \((\d+)\)/), fcF = fc.match(/Test Files\s+(\d+) passed \((\d+)\)/);
const fcC = fc.match(/at ([0-9a-f]{7}),/);
ok(fcT && fcF && fcC && +fcT[1] + +fcT[2] === +fcT[3], "fresh-clone note: tests, expected fail, files, commit");
ok(/"deterministic":"7\/7"/.test(fc) && /\{"runs":20,"ok":20,"mismatches":0/.test(fc), "fresh-clone note: evals 7/7 and 20 public re-judges");
const evM = evals.match(/\*\*Pass count: (\d+) of (\d+) cases run and passing\.\*\* Model cases at N=3: (\d+) of (\d+) runs RESURRECTED/);
ok(evM && evM[1] === evM[2] && evM[3] === evM[4], "EVALS.md pass count");
const RJ_FILE = "evidence/boot-detect/rejudge-p6d.json", rj = jsonOf(RJ_FILE).summary;
ok(rj.runs === rj.ok && rj.mismatches === 0 && rj.byTier.public === 20, "re-judge: all ok, 20 public");
ok(README.includes(`(${rj.runs}: ${rj.byTier.public} public, ${rj.byTier.tierC} local tier-C) re-judges with 0 mismatches`), "README carries the re-judge split");
const offJ = jsonOf("evidence/offline/verify-offline.json"), ljJ = jsonOf("evidence/e2e/live-judge-path.json");
ok(offJ.ok && offJ.checks.every((c) => c.pass) && ljJ.ok && ljJ.checks.every((c) => c.pass), "verify_offline + live judge path all pass");
const B7_FILE = "evidence/bench/bench-2026-11-26-p7.json", b7 = jsonOf(B7_FILE);
const b7r = (re) => { const r = b7.rows.find((x) => re.test(x.name)); ok(r, `bench p7 row ${re}`); return r; };
const jg = b7r(/^gate: applyPatch/), jb = b7r(/^emulator boot/), jr = b7r(/^REPLAY/), jo = b7r(/^OCR: tesseract/);
const J_gate50 = jg.p50.toFixed(2), J_gate95 = jg.p95.toFixed(2);
ok(README.includes(`p50 ${J_gate50} ms, p95 ${J_gate95} ms (N=${jg.n}, node) | \`${B7_FILE}\``), "README cites the same p7 gate bench");
const EXP = rd("docs/EXPERIMENTS.md");
const e2 = EXP.match(/blocked a premature stop in (\d+) of the\s+(\d+) runs outside E3/); ok(e2, "EXPERIMENTS.md E2 tally");
const e0 = README.match(/search fixed (\d+) of (\d+) failing lines; the agent made all (\d+) checksum-consistent \(N=2\)/);
ok(e0 && e0[2] === e0[3], "README E0 tally");
ok(/\| June 1984 Gazette title path[^\n]*\| 18 \| 3 \| 15 \|/.test(EXP), "EXPERIMENTS.md E0 row 18 / 3 / 15");
const eRuns = README.match(/\| Experiments E1–E4 \| (\d+) new real runs/); ok(eRuns, "README E1–E4 run count");
const fsRows = rd("evidence/hooks/file-save.jsonl").trim().split("\n").map((l) => JSON.parse(l));
ok(fsRows.slice(0, -1).every((r) => r.exit === 1) && fsRows.at(-1).exit === 0, "file-save: earlier firings exit 1, last exit 0");
const specsN = readdirSync(ROOT + ".kiro/specs").filter((d) => statSync(ROOT + ".kiro/specs/" + d).isDirectory()).length;
const profile = jsonOf(".kiro/agents/resurrector.json");
const hooksN = profile.hooks.length + readdirSync(ROOT + ".kiro/hooks").filter((f) => f.endsWith(".json")).length;
ok(specsN === 4 && hooksN === 4 && profile.model === start.model, "4 specs, 4 hooks, the profile's model is the recorded run's");
const spP = jsonOf("evidence/spikes/spike-P-ocr-live.json").results.find((r) => r.width === 1600); ok(spP, "spike P 1600 px row");
const JUDGE_MD = rd("JUDGE.md");
const CHAPTERS = [...JUDGE_MD.matchAll(/\[(\d):(\d\d) ([^\]]+)\]\(https:\/\/youtu\.be\/Jv69K3jQ6QI\?t=(\d+)\)/g)].map((m) => ({ t: +m[4], at: `${m[1]}:${m[2]}`, label: m[3] }));
ok(CHAPTERS.length === 8 && CHAPTERS.every((c) => c.t === +c.at.split(":")[0] * 60 + +c.at.slice(-2)), "JUDGE.md lists 8 video chapters whose ?t= matches the label");
ok(CHAPTERS.some((c) => c.at === "1:05") && CHAPTERS.some((c) => c.at === "1:22"), "Kiro chapters at 1:05 and 1:22");
const vl = JUDGE_MD.match(/\[(\d) min (\d+) s on YouTube\]/); ok(vl, "JUDGE.md video length");
const TM_FIXED = L20.body.replace("™", '"'), vTmFixed = judge(TM_FIXED);
ok(vTmFixed.verdict === "refused", "™ → quote still refused (checksum)");
const tmFixedSum = G.checkLine(20, TM_FIXED, L20.printed).computed;
ok(tmFixedSum !== L20.printed, "™ → quote sum differs from printed");
for (const s of ["51.26 of 50", "68.71 of 70"]) ok(README.includes(s), `README carries ${s}`);
Object.assign(V, {
  video_len: `${vl[1]}:${vl[2].padStart(2, "0")}`, tm_fixed_sum: String(tmFixedSum), n_specs: String(specsN), n_hooks: String(hooksN),
  e_runs: eRuns[1], tools_word: ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven"][trust.length] ?? String(trust.length),
  e0_search: e0[1], e0_failing: e0[2], e2_blocked: e2[1], e2_runs: e2[2],
  fs_n: String(fsRows.length), fs_fail: String(fsRows.length - 1), fs_passed: String(fsRows.at(-1).passed),
  cap_line1: "51.26 of 50", cap_line2: "68.71 of 70",
  fc_tests: fcT[1], fc_xfail: fcT[2], fc_total: fcT[3], fc_files: fcF[1], fc_commit: fcC[1],
  ev_cases: `${evM[1]} of ${evM[2]}`, ev_model: `${evM[3]} of ${evM[4]}`,
  rj_ok: String(rj.ok), rj_runs: String(rj.runs), rj_mis: String(rj.mismatches), rj_pub: String(rj.byTier.public), rj_local: String(rj.byTier.tierC),
  off_ok: String(offJ.checks.filter((c) => c.pass).length), off_n: String(offJ.checks.length),
  lj_ok: String(ljJ.checks.filter((c) => c.pass).length), lj_n: String(ljJ.checks.length), lj_date: ljJ.date.slice(0, 10),
  b_gate_p50: J_gate50, b_gate_p95: J_gate95, b_gate_n: String(jg.n), b_boot: String(Math.round(jb.p50)), b_boot_n: String(jb.n),
  b_replay: String(Math.round(jr.p50)), b_replay_n: String(jr.n), b_ocr: String(Math.round(jo.p50)), b_ocr_n: String(jo.n),
  scan_ok: String(spP.ok), scan_lines: String(spP.lines),
});
const chapters = CHAPTERS.map((c) => `          <li${/Kiro|agent/.test(c.label) ? ' class="kiro"' : ""}><a href="https://youtu.be/Jv69K3jQ6QI?t=${c.t}" data-t="${c.t}"><time datetime="PT${Math.floor(c.t / 60)}M${c.t % 60}S">${c.at}</time><span>${esc(c.label)}</span></a></li>`).join("\n");

// ---------- fragments ----------
const TICK = '<svg class="g" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 5 9.5 10 2.5"/></svg>';
const CROSS = '<svg class="g" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5"/></svg>';
const listing = lines.map((l) => {
  if (l.n !== 20) return `<div class="ln${l.n > 60 ? " more" : ""}"><span class="no">${l.n}</span><span class="bd">${esc(l.body)}</span><span class="rem">:rem ${l.printed}</span><span class="st ok" role="img" aria-label="checksum verified">${TICK}</span></div>`;
  const bad = l.body.slice(0, 6), rest = l.body.slice(6);
  return `<div class="ln l20"><span class="no">20</span><span class="bd"><span class="mis">${esc(bad)}<svg class="ring" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M8 22C6 9 32 3 54 4s42 5 40 18-30 15-52 14S10 34 8 22Z"/></svg><span class="fix" aria-hidden="true">${esc(patch.new_body.slice(0, 6))}</span></span>${esc(rest)}</span><span class="rem">:rem ${l.printed}</span><span class="st" role="img" aria-label="line 20: checksum gate verdict"><span class="x">${CROSS}</span><span class="v">${TICK}</span></span></div>`;
}).join("\n");

// the judge page's proof slip: the recorded listing's lines around 20, as handed to the agent
const slipLines = lines.filter((l) => l.n >= 10 && l.n <= 40);
ok(slipLines.some((l) => l.n === 20) && slipLines.length >= 3, "slip has line 20 and neighbours");
const slip = slipLines.map((l) => l.n !== 20
  ? `      <div class="ln"><span class="no">${l.n}</span><span class="bd">${esc(l.body)}</span><span class="rem">:rem ${l.printed}</span><span class="st" role="img" aria-label="checksum verified">${TICK}</span></div>`
  : `      <div class="ln l20"><span class="no">20</span><span class="bd"><span class="mis"><span class="sr">as OCR read it: </span>${esc(l.body.slice(0, 6))}<span class="fix"><span class="sr">, the agent's fix: </span>${esc(patch.new_body.slice(0, 6))}</span></span>${esc(l.body.slice(6))}</span><span class="rem">:rem ${l.printed}</span><span class="st v" role="img" aria-label="line 20: accepted by the checksum gate">${TICK}</span></div>`).join("\n");

const T = []; // terminal rows, from the run's own events
for (const e of sorted) {
  const at = hms(e.t);
  if (e.k === "hook") T.push([at, "hook", `${e.hook} (${e.via}) exit ${e.exit}${e.decision ? " · " + e.decision : ""}`, e.hook === "checksum-gate" ? (e.exit === 0 ? "acc" : "bad") : ""]);
  else if (e.k === "kiro" && e.op === "tool_call") T.push([at, "call", `${e.title}${e.input && e.input.lineno ? " line " + e.input.lineno : ""}`, ""]);
  else if (e.k === "kiro" && e.op === "tool_result" && e.title === "Load skill: petscii-notation") T.push([at, "result", "skill load failed (the permission request failed before it was answered)", "dim"]);
  else if (e.k === "kiro" && e.op === "tool_result" && e.title === "@c64/c64_run") { const f = firstLine(e.text), er = e.text.split("\n")[1]; T.push([at, "c64", `${f} · ${er}`, f.startsWith("RESURRECTED") ? "acc" : "bad"]); }
  else if (e.k === "kiro" && e.op === "tool_result" && e.title === "@c64/checksum_line") T.push([at, "result", e.text.replace(/\n/g, " · "), ""]);
  else if (e.k === "kiro" && e.op === "tool_result" && e.title === "@c64/apply_patch") T.push([at, "result", firstLine(e.text), "acc"]);
  else if (e.k === "credits" && e.delta) T.push([at, "credits", `+${e.delta.toFixed(2)} (total ${e.total.toFixed(2)}, metered)`, ""]);
  else if (e.k === "end") T.push([at, "end", `${e.result} · ${e.iterations} iteration · ${(e.wallMs / 1000).toFixed(1)} s wall`, "acc"]);
}
ok(T.length >= 12, "terminal rows");
const terminal = T.map(([t, k, x, c]) => `<p class="tr ${c}"><time>${t}</time><b>${k}</b><span>${esc(x)}</span></p>`).join("\n");

// replay timeline for the hero (ms offsets from the run start, the run's own clock)
const at = (pred) => off(sorted.find(pred).t);
// every phase row below is read from the recorded events (arch review 02), and the build fails if an event disagrees
const hStart = ev.find((e) => e.k === "hook" && e.via === "kiro-session-start");
const hGate = ev.find((e) => e.k === "hook" && e.hook === "checksum-gate");
const hStop = ev.find((e) => e.k === "hook" && e.via === "kiro-stop");
const ckRes = ev.find((e) => e.k === "kiro" && e.title === "@c64/checksum_line" && e.op === "tool_result");
const ck = ckRes.text.match(/^line (\d+): computed (\d+)\nprinted (\d+)/);
ok(ck && ck[1] === "20" && ck[3] === V.printed20, "checksum_line result is line 20 with the printed sum");
const r0 = runs[0].text.split("\n"), r1 = runs[1].text.split("\n");
ok(/^error: \?SYNTAX {2}ERROR IN 20$/.test(r0[1]), "first c64_run: ?SYNTAX  ERROR IN 20");
ok(r1[0].startsWith("RESURRECTED") && r1.includes("titleSeen: true") && r1.includes("postTitle: pass"), "second c64_run: RESURRECTED, title seen, post-title pass");
ok(String(end.result).toUpperCase() === "RESURRECTED", "end: RESURRECTED");
const TL = [
  { ms: 0, ph: 0, text: `${V.run_start} start · ${V.agent} · ${V.model} · ${V.kiro_cli}` },
  { ms: at((e) => e.k === "hook" && e.via === "kiro-session-start"), ph: 0, text: `hook listing-context (session start) · ${hStart.lines} lines handed to the agent` },
  { ms: off(runs[0].t), ph: 1, text: `@c64/c64_run → ${r0[1].replace(/^error: /, "")} · ${V.ok_before}/${V.n_lines} checksum-consistent` },
  { ms: at((e) => e.k === "kiro" && e.title === "@c64/checksum_line" && e.op === "tool_result"), ph: 2, text: `@c64/checksum_line ${ck[1]} → computed ${ck[2]} · printed ${ck[3]}` },
  { ms: off(gateRow.t), ph: 3, text: `hook checksum-gate (Pre Tool Use) exit ${hGate.exit} → ${vAgent.reason}` },
  { ms: off(runs[1].t), ph: 4, text: `@c64/c64_run → RESURRECTED · ${V.ok_after}/${V.n_lines} · title seen · post-title pass` },
  { ms: at((e) => e.k === "hook" && e.via === "kiro-stop"), ph: 5, text: `hook until-title (Agent Stop) exit ${hStop.exit} → ${hStop.decision} · ${String(hStop.result).toUpperCase()}` },
  { ms: off(end.t), ph: 6, text: `end · ${String(end.result).toUpperCase()} · ${V.iterations} iteration · ${V.wall_s} s wall · ${V.credits} Kiro credits` },
];
const rundata = JSON.stringify({ speed: 3, total: off(end.t), tl: TL, listing: lines, expected, l20: { printed: L20.printed, ocr: L20.body, agent: patch.new_body, tm: TM_ONLY } }).replace(/</g, "\\u003c");
const ticks = TL.map((x, i) => `<button class="tick" type="button" data-i="${i}" style="--x:${(x.ms / off(end.t) * 100).toFixed(2)}%" aria-label="+${(x.ms / 1000).toFixed(1)} s: ${esc(x.text)}"><span>+${(x.ms / 1000).toFixed(1)} s</span></button>`).join("");

function fill(tpl, name) {
  let h = tpl;
  for (const k of ["error", "title", "post"]) h = h.split(`<!--@screen:${k}-->`).join(`<path d="${screenPath(SCREENS[k])}"/>${cursorRow(SCREENS[k])}`);
  h = h.split("<!--@listing60-->").join(listing.split("\n").filter((r) => !r.includes('class="ln more"')).join("\n"))
  h = h.split("<!--@listing-->").join(listing).split("<!--@terminal-->").join(terminal).split("<!--@ticks-->").join(ticks)
       .split("<!--@rundata-->").join(rundata).split("<!--@slip-->").join(slip).split("<!--@chapters-->").join(chapters);
  // {{gh:path}} -> the file or folder on GitHub; the build fails if the path is not in the repo (no dead links for judges)
  h = h.replace(/\{\{gh:([^}]+)\}\}/g, (m, p) => {
    ok(existsSync(ROOT + p), `${name}: linked path ${p} is not in the repo`);
    ok(spawnGitTracked(p), `${name}: linked path ${p} is not tracked by git`);
    return `https://github.com/edycutjong/ready/${statSync(ROOT + p).isDirectory() ? "tree" : "blob"}/main/${p}`;
  });
  h = h.replace(/\{\{(\w+)\}\}/g, (m, k) => { ok(k in V, `${name}: unknown placeholder ${m}`); return V[k]; });
  ok(!/\{\{|<!--@/.test(h), `${name}: unfilled marker`);
  // private working paths never appear on a public page (.kiro/specs/ is a required public Kiro artefact, so it is allowed)
  // (the private-only words are assembled from parts so that a leak scan of this file does not match the guard itself)
  const priv = [["kit", "chen"], ["progress", "md"], ["kiro", "prompts"], ["auto", "pilot"]].map(([x, y]) => new RegExp(x + (y === "md" ? "\\." : y === "prompts" ? "-" : "") + y));
  for (const bad of [/(?<!\.kiro\/)\bspecs\//, /\bassets\//, /_ideas/, /_specs/, ...priv]) ok(!bad.test(h), `${name}: private string ${bad}`);
  return h;
}
const tracked = new Set(execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean));
function spawnGitTracked(p) { return tracked.has(p) || [...tracked].some((f) => f.startsWith(p.replace(/\/$/, "") + "/")); }
const outs = [["scripts/landing/landing.html", "public/landing/index.html"], ["scripts/landing/deck.html", "public/deck/index.html"],
  ["scripts/landing/judge.html", "public/judge/index.html"]];
for (const [src, dst] of outs) {
  if (!existsSync(ROOT + src)) { console.log(`build-site: ${src} absent, skipped`); continue; }
  mkdirSync(ROOT + dst.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(ROOT + dst, fill(rd(src), dst));
  console.log(`build-site: ${dst} (${(statSync(ROOT + dst).size / 1024).toFixed(1)} KB)`);
}
console.log(`build-site: asserted — verdict "${vAgent.reason}", OCR ${V.ocr_sum}≠${V.printed20} refused, ™ naive ${naive}=${L20.printed} refused, ` +
  `${V.ok_before}→${V.ok_after}/${V.n_lines}, ${V.wall_s} s, ${V.credits} credits, tests ${V.tests}/${V.test_files} files, gate p95 ${V.gate_p95} ms, gate.js ${gateKb} KB`);
