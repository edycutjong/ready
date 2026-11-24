import { defineConfig } from "vitest/config";
// Property tests are named `*.prop.ts` by .kiro/specs/checksum-oracle/tasks.md; include them explicitly,
// otherwise `npm test` / `npm run test:prop` would silently skip every one of them.
export default defineConfig({ test: { include: ["tests/**/*.test.ts", "tests/prop/**/*.prop.ts"], testTimeout: 120_000, hookTimeout: 120_000 } });
