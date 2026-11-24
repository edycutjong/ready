/** Node-only: build a C64Core from the installed c64-ready WASM (never committed, read from node_modules). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createC64ReadyCore, type C64Core } from "./core.ts";

export function c64ReadyWasmPath(): string {
  const entry = fileURLToPath(import.meta.resolve("c64-ready/emulator")); // <pkg>/dist-ts/emulator/c64-emulator.js
  return entry.replace(/dist-ts[\\/]emulator[\\/]c64-emulator\.js$/, "public/c64.wasm");
}

export function c64ReadyWasmSha256(): string {
  return createHash("sha256").update(readFileSync(c64ReadyWasmPath())).digest("hex");
}

export async function bootNodeCore(): Promise<C64Core> {
  const core = createC64ReadyCore(new Uint8Array(readFileSync(c64ReadyWasmPath())));
  await core.boot();
  return core;
}
