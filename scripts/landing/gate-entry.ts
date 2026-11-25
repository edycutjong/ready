// Bundled by scripts/landing/build-site.mjs into public/landing/gate.js: the same pure gate the Kiro Pre Tool Use hook
// and the MCP server's apply_patch run, exposed to the landing page's "try to fool the gate" panel. No model, no network.
import { applyPatch, checkLine } from "../../src/gate/checksum-gate.ts";
import { computeChecksum } from "../../src/basic/checksum.ts";

(globalThis as unknown as { READY_GATE: unknown }).READY_GATE = { applyPatch, checkLine, computeChecksum };
