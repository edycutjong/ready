/**
 * In-browser OCR (F2): self-hosted tesseract.js worker, WASM core and traineddata under /ocr/ — no third-party CDN.
 * ScanQuality: the page image is scaled to a stop width (800 / 1600 / 2376 px source width; never called "dpi")
 * before recognition. Rows with boxes → logical lines (src/ocr/recover.ts) → checksum flags (src/ocr/flag.ts).
 */
import { createWorker } from "tesseract.js";
import { logicalFromRows, type Logical, type Row } from "./recover.ts";

export type ScanStop = 800 | 1600 | 2376;
export const STOPS: readonly ScanStop[] = [800, 1600, 2376];
export type OcrResult = { logical: Logical[]; rows: number; ms: number; width: number; engine: string };

async function scaled(src: Blob, width: ScanStop): Promise<{ canvas: HTMLCanvasElement; width: number }> {
  const bmp = await createImageBitmap(src);
  const w = Math.min(width, bmp.width); // never upscale: an 800 px photo stays 800 px
  const h = Math.round((bmp.height * w) / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { canvas, width: w };
}

export async function ocrImage(src: Blob, stop: ScanStop, onProgress: (p: number, status: string) => void = () => {}): Promise<OcrResult> {
  const t0 = performance.now();
  const { canvas, width } = await scaled(src, stop);
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr",
    gzip: true,
    logger: (m: { progress: number; status: string }) => onProgress(m.progress, m.status),
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "6" as never, preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
    const rows: Row[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) rows.push({ text: l.text.replace(/\n$/, ""), bbox: l.bbox });
    return { logical: logicalFromRows(rows), rows: rows.length, ms: Math.round(performance.now() - t0), width, engine: "tesseract.js 7.0.0 (self-hosted)" };
  } finally { await worker.terminate(); }
}
