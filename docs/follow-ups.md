# bkstr.tmrwgroup.ai — Follow-ups

Tracked items deferred from Phase 1 scaffolding. Numbered globally; mark resolved entries with strikethrough + a one-line resolution note rather than renumbering.

---

## From Phase 1 first-deploy debug (2026-05-08)

### 1. `scripts/before-install.sh` invokes Prisma CLI via literal package path

`scripts/before-install.sh:22` currently runs `node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma` instead of `node_modules/.bin/prisma migrate deploy ...`.

**Why:** CodeBuild's zip artifact dereferences `node_modules/.bin/` symlinks, copying `prisma`'s `index.js` into `.bin/` as a regular file. At runtime `__dirname` resolves to `.bin/`, where Prisma's bundled CLI expects to find a sibling `prisma_schema_build_bg.wasm` — which does not exist there (only at `prisma/build/`). Result: `ENOENT: no such file or directory, open '.../node_modules/.bin/prisma_schema_build_bg.wasm'`. Invoking `prisma/build/index.js` directly puts `__dirname` at `prisma/build/`, where the wasm sibling lives.

The literal path is brittle to Prisma reorganizing its `build/` layout in a future minor version. Replace with a more resilient form during the hardening pass:

- `npm exec --prefix . -- prisma migrate deploy --schema prisma/schema.prisma`, or
- `node "$(node -p "require.resolve('prisma/package.json')")/../build/index.js" migrate deploy --schema prisma/schema.prisma`

The `npm exec` form is preferred (delegates path resolution to npm/Node's package resolver).

**Severity:** low (working today, only matters when Prisma reorganizes internals — likely never on a Phase 1 timescale). **Suggested resolution:** swap during the hardening pass that also reviews the `EnvironmentFile` path, the systemd unit user (`ubuntu` is fine for Phase 1), and the nginx config hardening (HSTS, security headers).

### 2. Local hook-chain validation precedes every hook-touching change

New discipline emerging from the four-failure deploy chain (commits `3ad853a` → `e006b5b` → `59b923a` → `8f5c111` → next). Each failure was a single-layer bug — cwd, missing-file, missing-file, version-syntax — that local validation against the actual EC2 environment would have caught in seconds. The cost of skipping local validation: four pipeline cycles plus a degraded production state.

**Rule:** any change to `scripts/*.sh`, `scripts/*.service`, `scripts/nginx-*.conf`, or `appspec.yml` must pass three pre-push checks:

- **Check A:** the proposed nginx config validates via `nginx -t` against the EC2's actual nginx version, dry-symlinked then unlinked
- **Check B:** every hook script runs end-to-end against the deployment archive in `/tmp/bkstr-local-repro/` with destructive operations replaced by echo+test
- **Check C:** any systemd unit changes pass `systemd-analyze verify`

Validation output goes into the commit message or PR description before push. **Severity:** process. **Resolution:** documented now; enforcement is per-commit discipline.

### 3. Migration/deploy decoupling for Phase 2

`scripts/before-install.sh` runs `prisma migrate deploy` during the BeforeInstall hook. Acceptable for Phase 1 (single instance, no users, only the idempotent init migration), problematic before Phase 2 because:

- A forward-incompatible schema migration (column drop, type change, NOT NULL addition) gets applied to the DB before the new app code rolls to instances. During the brief window between schema-apply and app-start, any reader running on the old code hits a query against a schema it doesn't understand.
- A failed migration leaves the DB schema partially applied while app code rolls back. Prisma's `_prisma_migrations` table marks failed migrations as failed — but the DDL changes already committed are not rolled back.

**Severity:** medium for Phase 2. **Suggested resolution before Phase 2:** decouple via either (a) explicit pre-deploy migration step run as a separate SSM command with manual gating, or (b) blue/green schema migration patterns (additive-only forward, drops only after the old code is fully retired). Decision needed before any non-additive migration ships.

### 4. `prisma.config.ts` runtime requirement — document in README

Prisma 7's `migrate deploy` reads `datasource.url` exclusively from `prisma.config.ts` at the project root. The schema-vs-config split means the file isn't optional — it's a hard runtime dependency. Easy to omit from a build artifact (we did, in commit `3ad853a`'s buildspec) because it's at the repo root, not under `prisma/`.

**Severity:** low (now fixed in `8f5c111`). **Suggested resolution:** add a one-paragraph note to `README.md` calling out: "`prisma.config.ts` is required at runtime; if you adjust the build artifact allow-list, ensure it stays included." Ten minutes of README work that could prevent a Phase 2 contributor from re-introducing this exact failure.

### 5. nginx version pinning question

Ubuntu 24.04 ships nginx 1.24.0 in its package repo. nginx 1.25+ adds HTTP/3 (QUIC), the standalone `http2 on;` directive form, and other features we don't need for Phase 1 but might want later. PPA-based 1.25+ installs add maintenance risk (PPA staleness, security update lag, dist-upgrade conflicts).

**Severity:** none today (1.24 works, HTTPS + HTTP/2 enabled via listen-line parameter). **Suggested resolution:** decision deferred until Phase 2 has a concrete need (e.g., HTTP/3 for mobile clients, or a feature only in 1.26+). Default until then: stay on Ubuntu's repo nginx, accept the 1.24 syntax constraints. If pinning is needed: nginx's official repo (`nginx.org/packages/ubuntu`) is preferred over random PPAs.

---

*Last updated: 2026-05-08. Add new entries with the next available number; do not renumber existing entries even if older ones are resolved (mark resolved entries with a strikethrough and a one-line resolution note instead).*
