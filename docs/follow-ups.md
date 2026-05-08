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

---

*Last updated: 2026-05-08. Add new entries with the next available number; do not renumber existing entries even if older ones are resolved (mark resolved entries with a strikethrough and a one-line resolution note instead).*
