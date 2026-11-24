import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builder-only routes for `vite dev` (never in the production bundle):
 *  - /c64.wasm: c64-ready's ROM-bearing WASM straight from node_modules, so the local desk runs REPLAY on a real
 *    in-browser C64. Production has no such route (and scripts/check-no-rom.mjs blocks the file by hash) until the
 *    ROM rights line is signed; the player then falls back to RECORDED PLAYBACK and says so.
 *  - /runs/index.json merges the committed public runs with local tier-C runs (runs/gazette/, gitignored) served
 *    under /runs/local/ — Gazette-derived runs never reach the deployed URL while rights are not cleared.
 */
function builderRoutes(): Plugin {
  const wasm = fileURLToPath(import.meta.resolve("c64-ready/emulator")).replace(/dist-ts[\\/]emulator[\\/]c64-emulator\.js$/, "public/c64.wasm");
  const local = resolve("runs/gazette");
  return {
    name: "ready-builder-routes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url === "/c64.wasm" && existsSync(wasm)) { res.setHeader("content-type", "application/wasm"); createReadStream(wasm).pipe(res); return; }
        if (url === "/runs/index.json") {
          const pub = existsSync("public/runs/index.json") ? JSON.parse(readFileSync("public/runs/index.json", "utf8")) : { runs: [] };
          const loc = existsSync(local) ? readdirSync(local).filter((f) => f.endsWith(".jsonl")).sort().reverse().map((f) => ({ id: `local-${f.replace(/\.jsonl$/, "")}`, file: `/runs/local/${f}`, local: true, label: `local tier-C run ${f}` })) : [];
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ runs: [...loc, ...pub.runs] }));
          return;
        }
        const m = url.match(/^\/runs\/local\/([\w.-]+\.jsonl)$/);
        if (m && existsSync(join(local, m[1]))) { res.setHeader("content-type", "application/x-ndjson"); createReadStream(join(local, m[1])).pipe(res); return; }
        next();
      });
    },
  };
}

export default defineConfig({ plugins: [preact(), builderRoutes()], build: { target: "es2022" } });
