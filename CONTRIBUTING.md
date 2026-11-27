# Contributing

1. `npm ci` (Node ≥ 22.18).
2. `npm run typecheck && npm test` must be green before a pull request. The suite keeps one known limitation as an
   expected failure (`it.fails` in `tests/unit/boot-detect.test.ts`, README Honest limits 7); vitest fails the run if
   that test ever starts passing.
3. Keep changes small and say what was measured; numbers in docs must trace to `evidence/`.
4. Do not edit a file pinned in `evidence/freeze/` (the agent profile, steering, hooks, gate, MCP server, REPLAY) without
   recording a new freeze: the recorded runs are re-judged against those exact hashes.

## What CI runs on a pull request

| Workflow | Checks |
|---|---|
| `CI` | `node --check` on every script, JSON parse, actionlint; `tsc --noEmit`; the test suite on Node 22 and 24; the production build and the ROM check |
| `E2E` | `scripts/verify_offline.mjs`: the recorded run replays to RESURRECTED on a real in-browser C64 and `/scan` OCRs a page, with every non-local request blocked |
| `CodeQL` | JavaScript/TypeScript and GitHub Actions, `security-extended` queries |
| `Security` | gitleaks over the full history, `npm audit`, dependency review |
| `Quality` | Lighthouse CI on `/`, `/kiro`, `/scan`, `/landing/`, `/deck/` (budgets in `lighthouserc.json`) and the gzip bundle budget (`scripts/bundle-budget.mjs`) |

`Deploy` runs only on `main`, after `CI` passes, and is followed by the live judge path (`E2E`).

## Releases

Versions are cut by `.github/workflows/release.yml`, only after `CI` is green on `main`, and always on the commit that CI run
judged. The bump comes from the commit subjects since the last tag, in the Angular convention (the rules live in
`.github/scripts/next-version.sh`, which also runs locally as a dry run: `bash .github/scripts/next-version.sh`):

| Commit subject | Bump |
|---|---|
| `fix: ...`, `perf: ...` | patch (`0.1.0` to `0.1.1`) |
| `feat: ...` | minor (`0.1.1` to `0.2.0`) |
| any type with `!` (`feat!: ...`), or a `BREAKING CHANGE:` footer | major; while the version is `0.x`, minor |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:`, `style:`, `build:`, `revert:`, or no type at all | no release |

Authorship prefixes are allowed in front of the type and are ignored when the bump is computed: `[kiro] `,
`[claude-direct] `, `kiro: ` and `claude-direct: ` (`[kiro] feat(shelf): ...` is a minor bump, `[claude-direct] docs: ...` is none). A prefix with no type after it cuts nothing.

Automatic cuts happen only while the repository variable `AUTO_RELEASE` is `true`; otherwise the run reports what it would
cut, and the owner can cut by hand (Actions > Release > Run workflow, with an optional dry run). After every run the workflow
keeps the README's release badge (`docs/badges/release.svg`) on the latest release, committing it as
`chore(release): badge vX.Y.Z`.
