#!/usr/bin/env node
// Refuse a deploy that contains c64-ready's ROM-bearing c64.wasm (matched by content hash, whatever its name).
// The public site serves it only after the human signs the ROM rights line (submission rights matrix).
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const ROM_WASM_SHA256 = "dad5965346c0e72e82611e87ecf8358d11fa068977958ef854f74289f87e0f46"; // c64-ready@3.4.0 public/c64.wasm
const root = process.argv[2] ?? "dist";
const hits = [];
// stat and read through one file descriptor (follows symlinks, no check-then-read race)
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f), fd = openSync(p, "r");
    let dir = false;
    try {
      const s = fstatSync(fd);
      if (s.isDirectory()) dir = true;
      else if (s.size > 100_000 && createHash("sha256").update(readFileSync(fd)).digest("hex") === ROM_WASM_SHA256) hits.push(p);
    } finally { closeSync(fd); }
    if (dir) walk(p);
  }
};
walk(root);
if (hits.length) { console.error(`ROM-bearing c64.wasm found in ${root}: ${hits.join(", ")}`); process.exit(1); }
console.log(`check-no-rom: ${root} is clean`);
