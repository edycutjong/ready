#!/usr/bin/env node
// Self-host tesseract.js: copy the worker + the LSTM-only WASM cores from node_modules into public/ocr/ before every
// build (npm "prebuild"), so the judge's browser never reaches a third-party CDN for the OCR engine. The English
// traineddata (public/ocr/eng.traineddata.gz, Apache-2.0, the file spike O measured) is committed.
import { copyFileSync, mkdirSync } from "node:fs";
const out = new URL("../public/ocr/", import.meta.url);
mkdirSync(new URL("core/", out), { recursive: true });
copyFileSync(new URL("../node_modules/tesseract.js/dist/worker.min.js", import.meta.url), new URL("worker.min.js", out));
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"])
  copyFileSync(new URL(`../node_modules/tesseract.js-core/${f}`, import.meta.url), new URL(`core/${f}`, out));
console.log("vendor-ocr: worker + 3 LSTM cores → public/ocr/");
