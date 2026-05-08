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

### 6. `start.sh` rsync excludes need expansion when user-upload directories land

`scripts/start.sh` currently rsyncs the deployment release dir into `/var/www/bkstr/` with `--delete --exclude .env`. This is correct for Phase 1 (only `.env` needs preservation across deploys). When Phase 2 introduces persistent on-instance state — book content uploads, profile images, generated artifacts, or anything else not intended to be wiped on each deploy — `start.sh`'s `--exclude` list needs to grow.

The reference selfandmatchnew chain excludes `public/images/products`, `public/images/blog`, `storage` for this reason. Whatever bkstr's equivalents are, they go in the rsync exclude list at the same time as the feature itself lands.

**Severity:** none today (no user uploads in Phase 1). **Suggested resolution:** every PR adding persistent on-instance directories must update `start.sh` rsync excludes in the same diff. Add a checklist item to whatever PR template/conventions land for Phase 2.

### 7. EBADENGINE warning on `@prisma/streams-local@0.1.2` declaring `node >=22`

Surfaced during Phase C local-repro `npm ci` on the EC2:

```
npm warn EBADENGINE Unsupported engine {
  package: '@prisma/streams-local@0.1.2',
  required: { bun: '>=1.3.6', node: '>=22.0.0' },
  current: { node: 'v20.20.2', npm: '10.8.2' }
}
```

A transitive dep of `prisma@^7.8.0` declares Node 22+ in its `engines` field. We're on Node 20 (matching the EC2's repo nginx-era stack) and `npm ci` treats this as `warn`, not error — install + build + runtime all proceed.

**Severity:** none today (warn, doesn't block). Becomes a hard requirement if a future Prisma version converts the warn to error, OR if `@prisma/streams-local` adds Node 22-only API usage. **Suggested resolution:** monitor Prisma upgrade notes; either upgrade EC2 Node to 22+ when Phase 2 lands, or pin Prisma at the highest 7.x that doesn't bump this requirement.

### 8. Phase C local validation must capture the spawned PID and kill that specific PID at end

The Phase C validation script started `npm start` in the background to verify the unpacked artifact serves `:3000` correctly. At the end of the script, cleanup tried `pkill -f 'next start'` and `pkill -f 'npm start'`. **Both patterns missed the actual runtime process**, which renames itself to `next-server (v15.5.18)` after the npm/next exec chain completes. Result: an orphaned `next-server` process kept listening on `:3000` for ~8 minutes until the actual deploy ran — at which point PM2's `pm2 start npm --name bkstr-web -- run start` hit `EADDRINUSE: :::3000` and retried 16 times until PM2 marked the entry errored. Production was briefly served by the orphan, not the deploy's PM2-managed process.

The deploy itself was correct; the bug is in the validation script's cleanup discipline.

**Fix shape for next time:** capture the PID into a file at spawn-time, kill that specific PID at end. Don't rely on `pkill -f` against a name that the runtime may rename.

```bash
# Right way:
sudo -u ubuntu nohup npm start > /tmp/.../validate-npm-start.log 2>&1 &
NPM_PID=$!
echo "$NPM_PID" > /tmp/.../validate.pid
# ...validation curl checks...
kill "$(cat /tmp/.../validate.pid)" 2>/dev/null || true
sleep 2
# Defensive backup: any next-server that escaped (none expected)
pkill -f 'next-server' 2>/dev/null || true
```

**Severity:** medium (caused a real false-positive green deploy that almost passed undetected). **Suggested resolution:** roll into the local-hook-validation discipline (#2). Update any future validation runbook to use the PID-capture pattern.

### ~~9. First EC2 reboot post-Phase-1 validates the `pm2-ubuntu.service` resurrect path~~ — **RESOLVED 2026-05-08**

Verified end-to-end via controlled `aws ec2 reboot-instances` before Phase 1 close. Boot id changed from `4bd5e610-…` → `88352098-…`, uptime reset, all four key services (postgresql, nginx, codedeploy-agent, pm2-ubuntu) came back active. `journalctl -u pm2-ubuntu` showed the full sequence: `[PM2] Resurrecting → Restoring processes located in /home/ubuntu/.pm2/dump.pm2 → Process /usr/bin/npm restored`. PM2 daemon PID 842 (fresh), next-server PID 946 (fresh), `:3000` re-bound, external `curl https://bkstr.tmrwgroup.ai/` returned 200 with Content-Length 34254 within 3s of post-reboot SSM agent recovery. Cold-boot ordering with postgres+nginx is verified working.

### 10. Delete legacy `bkstr-app.service` systemd unit before Phase 2 kickoff

The pre-structural-reset deploy chain installed `/etc/systemd/system/bkstr-app.service` as the original Next.js process supervisor. After adopting PM2 (commit `f5ca66c`) it was disabled and stopped. The unit file is still on disk; `systemctl status bkstr-app` shows `loaded (disabled / inactive (dead))`.

**Severity:** none today (disabled+inactive, no boot path activates it). **Suggested resolution before Phase 2:**
```bash
sudo systemctl disable bkstr-app   # idempotent; already disabled
sudo rm /etc/systemd/system/bkstr-app.service
sudo systemctl daemon-reload
```

Cleanup task; no functional change.

### 11. Rotate Postgres `bkstr` user password before Phase 2's first real-world traffic

The current password was generated server-side via `openssl rand -base64 24 | tr -d '/+=' | head -c 32` during Phase 1 Step 5. It is mode-protected at rest at `/var/www/bkstr/.env` (mode 600 ubuntu:ubuntu) and `/etc/bkstr/app.env` (mode 600 root:root). However, **the plaintext password appears in chat history of the Phase 1 build session** (it was printed at provisioning time for the operator's records). Before Phase 2 ships any real-world traffic, the password should be rotated so that the chat-history copy is no longer valid.

**Procedure:**
```bash
# 1. Generate new password on EC2:
NEW_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

# 2. ALTER ROLE in postgres:
sudo -u postgres psql -c "ALTER USER bkstr WITH PASSWORD '$NEW_PASS'"

# 3. Update both .env files atomically:
sudo sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://bkstr:${NEW_PASS}@localhost:5432/bkstr_app?schema=public|" /var/www/bkstr/.env /etc/bkstr/app.env

# 4. Restart bkstr-web to pick up new env:
sudo -u ubuntu PM2_HOME=/home/ubuntu/.pm2 pm2 reload bkstr-web

# 5. Verify connectivity:
curl -I https://bkstr.tmrwgroup.ai/   # should still be 200
```

**Severity:** medium (password is mode-protected on EC2 but exposed in chat-history backups). **Suggested resolution:** rotate before any Phase 2 user data lands.

---

*Last updated: 2026-05-08. Add new entries with the next available number; do not renumber existing entries even if older ones are resolved (mark resolved entries with a strikethrough and a one-line resolution note instead).*
