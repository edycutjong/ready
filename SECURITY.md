# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's **Report a vulnerability** button on the
[Security tab](https://github.com/edycutjong/ready/security/advisories/new), not in a public issue. Expect an
acknowledgement within a few days.

## Supported versions

Only `main`, which is what https://ready.edycu.dev serves, receives fixes.

## Scope

- The public site never ships Commodore ROMs: `scripts/check-no-rom.mjs` refuses the ROM-bearing emulator WASM by its
  sha256 in every production deploy (`.github/workflows/deploy.yml`).
- `/api/page` (`api/page.js`) only fetches allow-listed archive.org items (`data/pages.json`), over https, checks every
  redirect hop and caps the streamed response size. It is the only server-side code.
- The Kiro agent (`.kiro/agents/resurrector.json`) runs only on the builder's machine, with file read, shell, write and
  web access denied; it is never deployed.

## Automated checks

Every push and pull request runs CodeQL (JavaScript/TypeScript and the workflow files), gitleaks over the whole git
history, `npm audit` and, on pull requests, dependency review (`.github/workflows/codeql.yml`, `security.yml`).
Dependabot alerts, security updates, secret scanning and push protection are enabled for this repository.
