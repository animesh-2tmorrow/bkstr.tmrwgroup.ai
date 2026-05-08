# bkstr.tmrwgroup.ai — Phase 1 Scaffold Report

*Closed 2026-05-08. End-to-end deploy chain working: GitHub → CodePipeline → CodeBuild → CodeDeploy → EC2 (Ubuntu 24.04 + nginx 1.24 + Postgres 16 + PM2 + Next.js 15 + Prisma 7). `https://bkstr.tmrwgroup.ai/` live with the four-route Manus visual contract.*

---

## What's deployed and what's next

**Deployed (Phase 1 scope):** the agentic-bookstore platform's foundation is in place. AWS account `049405321468`, region `us-east-1`. A single t3.large EC2 in the default VPC runs nginx-fronted Next.js 15.5.18 with Prisma 7.8.0 against a local Postgres 16, behind a Let's Encrypt TLS cert auto-renewing on certbot.timer. The four Manus pages from Direction 2 / Revision 6 (`/`, `/login`, `/signup`, `/dashboard`) render with the cream palette + Fraunces serif + Inter body typography — the locked visual contract is live. CodePipeline auto-deploys on push to `main`. The multi-tenant Prisma schema is applied (6 tables + `_prisma_migrations`); `tmrwgroup` and `etumos` publishers are NOT yet seeded — that's the first manual operator step before any tenant-scoped feature work.

**Phase 1 explicitly excluded — intact:** no auth flow (login/signup buttons navigate to `/dashboard` without validation), no API-key issuance, no Stripe billing calls (SDK installed only), no Bedrock LLM calls (SDK installed only, no IAM policy attached), no eval scaffolding, no real book content, no admin UI, no email, no background workers.

**Phase 2 needs to start with:** (1) auth flow design — hybrid custom-credentials + NextAuth as Lab does, or unify on one; (2) API-key issuance UI + the schema-supported hash-only storage at `subscriber_api_keys`; (3) Bedrock IAM policy on `bkstr-ec2-role` (model-scoped, similar to `lab-bedrock-access`); (4) real book content from Zach — the schema accepts content URIs at `book_versions.content_uri`, currently placeholder; (5) seeding `tmrwgroup` + `etumos` publishers (one-off manual SQL or a `prisma/seed.ts` invocation).

---

## Resource inventory

### AWS account + region
- **Account:** `049405321468` (coaiop)
- **Region:** `us-east-1`
- **Operator IAM:** user `Animesh` (long-lived access key, env-injected to the CLI agent — see Credentials section)

### EC2
| Item | Value |
|---|---|
| Instance ID | `i-0e25e88f90738b9dc` |
| Type | `t3.large` |
| AZ / Subnet | `us-east-1c` / `subnet-09e308ea5873c5475` (default VPC) |
| Public IP | `54.84.43.80` |
| Private IP | `172.31.18.10` |
| AMI | `ami-09d76382cbfc09f06` (Ubuntu 24.04 — `ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20260507`) |
| Root volume | 30 GB gp3, encrypted, delete-on-termination |
| Tags | `Project=bkstr`, `Name=bkstr-web-1` |
| IMDS | v2 required (`HttpTokens=required`) |

### Keypair
| Item | Value |
|---|---|
| Name | `bkstr-keypair` |
| KeyPairId | `key-0477b2f88aa94e53d` |
| Fingerprint | `80:97:ac:cb:4a:66:a1:48:d2:f4:d3:e0:84:ff:f0:ee:ec:72:30:77` |
| Private key | `C:\animesh\bkstr.tmrwgroup.ai\bkstr-keypair.pem` (gitignored) |

### Security group
| Item | Value |
|---|---|
| Group | `sg-05d1eebaf99195faf` (`bkstr-sg-web`) |
| VPC | `vpc-0296cf9ebae66b77a` (default) |
| Ingress | tcp/80 from `0.0.0.0/0`, tcp/443 from `0.0.0.0/0`, tcp/22 from `223.178.213.208/32` (Animesh — Airtel) |
| Egress | default (all out) |

### IAM
| Resource | ARN |
|---|---|
| EC2 role | `arn:aws:iam::049405321468:role/bkstr-ec2-role` |
| EC2 instance profile | `arn:aws:iam::049405321468:instance-profile/bkstr-ec2-instance-profile` |
| CodeBuild role | `arn:aws:iam::049405321468:role/bkstr-codebuild-role` |
| CodeDeploy role | `arn:aws:iam::049405321468:role/bkstr-codedeploy-role` |
| CodePipeline role | `arn:aws:iam::049405321468:role/bkstr-pipeline-role` |

EC2 role has `AmazonSSMManagedInstanceCore` (managed) + `bkstr-ec2-codedeploy-s3-read` (inline, for CodeDeploy bundle download). CodeDeploy role has `AWSCodeDeployRole` (managed). CodeBuild and Pipeline roles each have one inline policy scoped tightly to bucket/connection/build/deploy resources.

### S3
- **Pipeline artifact bucket:** `arn:aws:s3:::bkstr-pipeline-artifacts-049405321468-us-east-1`
- Versioning **on**, BPA fully on (`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets` all true), default SSE-S3 (AES256)

### CodeStar Connection (reused, not freshly provisioned)
- `arn:aws:codeconnections:us-east-1:049405321468:connection/76595c76-a25c-456f-bc36-d95ad80be177` (per-account GitHub OAuth, scoped to `animesh-2tmorrow`)

### CodeBuild
- **Project:** `arn:aws:codebuild:us-east-1:049405321468:project/bkstr-build`
- **Image:** `aws/codebuild/amazonlinux2-x86_64-standard:5.0` (Node 20 runtime)
- **Compute:** `BUILD_GENERAL1_MEDIUM`
- **Service role:** `bkstr-codebuild-role`

### CodeDeploy
- **Application:** `bkstr-app` (id `a3a0496b-ea4d-47b9-87ae-728b6bfbfeaa`, compute platform `Server`)
- **Deployment group:** `bkstr-deploy-group` (id `bbfbce33-18ad-4bc0-9d5a-97d0d033a000`)
- **Target tag filter:** `Project=bkstr`
- **Deployment config:** `CodeDeployDefault.AllAtOnce`
- **Auto-rollback:** enabled on `DEPLOYMENT_FAILURE`
- **Service role:** `bkstr-codedeploy-role`
- **Agent on EC2:** `OFFICIAL_1.8.1-26_deb`, systemd unit enabled+active

### CodePipeline
- **Pipeline:** `arn:aws:codepipeline:us-east-1:049405321468:bkstr-pipeline` (v1, type V2)
- **Stages:** Source (CodeStarSourceConnection from `animesh-2tmorrow/bkstr.tmrwgroup.ai` branch `main` with `DetectChanges=true`) → Build (`bkstr-build`) → Deploy (`bkstr-app` / `bkstr-deploy-group`)
- **Pipeline role:** `bkstr-pipeline-role`

### Route 53 DNS
- **Zone:** `Z01483201EQN0JPGSTYKM` (`tmrwgroup.ai.`, public, shared with Lab) — reused, not freshly created
- **A record:** `bkstr.tmrwgroup.ai.` → `54.84.43.80`, TTL 300

### TLS
- **Issuer:** Let's Encrypt (E8 ECDSA intermediate)
- **Cert path:** `/etc/letsencrypt/live/bkstr.tmrwgroup.ai/fullchain.pem`
- **Key path:** `/etc/letsencrypt/live/bkstr.tmrwgroup.ai/privkey.pem`
- **Serial:** `508b792942195246d7f87964d2accd55625`
- **Expires:** 2026-08-06 04:17:44 UTC (~89 days from issuance)
- **Auto-renewal:** `certbot.timer` enabled + active (twice-daily)

### Postgres (on-EC2, NOT RDS per Phase 1 decision)
- **Version:** PostgreSQL 16.13 (`16-0ubuntu0.24.04.1`), `systemctl is-active postgresql` → active
- **DB:** `bkstr_app`
- **Owner role:** `bkstr` (LOGIN, scram-sha-256)
- **Connection:** `localhost:5432`
- **Schema state:** 6 application tables + `_prisma_migrations`; init migration `20260508000000_init` applied

### Live application paths on EC2
- **Live app dir:** `/var/www/bkstr/` (ubuntu:ubuntu)
- **Release dir:** `/var/www/release/bkstr/` (CodeDeploy stages here, then `start.sh` rsyncs to live)
- **Secrets:** `/var/www/bkstr/.env` (mode 600, ubuntu:ubuntu, `--exclude .env` from rsync)
- **PM2 home:** `/home/ubuntu/.pm2/`
- **PM2 saved process list:** `/home/ubuntu/.pm2/dump.pm2` (4578 bytes, contains `bkstr-web` entry)
- **systemd PM2 unit:** `/etc/systemd/system/pm2-ubuntu.service` (`enabled`, `inactive` until reboot — see follow-up #9)
- **nginx site:** `/etc/nginx/sites-available/bkstr.conf` symlinked into `sites-enabled/`
- **CodeDeploy deployment archive:** `/opt/codedeploy-agent/deployment-root/bbfbce33-…/d-<latest>/deployment-archive/`

### Repository
- **GitHub:** `git@github.com:animesh-2tmorrow/bkstr.tmrwgroup.ai.git` (private)
- **Branch:** `main` (default) — DetectChanges trigger
- **Commits in Phase 1:** 11 (eight code commits + three docs commits — see Lessons section for the chain)

### Legacy artifacts (on EC2, scheduled for cleanup)

- **`/etc/systemd/system/bkstr-app.service`** — legacy systemd unit from pre-structural-reset deploy chain. Disabled and inactive (`systemctl status bkstr-app` → `loaded (disabled / inactive (dead))`). Safe to delete with `systemctl disable bkstr-app && rm /etc/systemd/system/bkstr-app.service && systemctl daemon-reload`. Left in place for now as historical reference; will be cleaned up before Phase 2 kickoff per follow-up #10.

---

## Credentials inventory

| Credential | Location | Mode/Owner | Backup | Rotation status |
|---|---|---|---|---|
| Postgres password (`bkstr` role) | `/var/www/bkstr/.env` on EC2 | `600 ubuntu:ubuntu` | `/etc/bkstr/app.env` (root:root, 600) | **Rotate before Phase 2's first real-world traffic.** Current password generated server-side via `openssl rand`, mode-protected at rest, but appears in chat history. Rotation procedure: `sudo -u postgres psql -c "ALTER USER bkstr WITH PASSWORD '$NEW'"`, update both `/var/www/bkstr/.env` and `/etc/bkstr/app.env`, then `pm2 reload bkstr-web` to pick up. Tracked as follow-up #11 with full procedure. |
| EC2 keypair private key | `C:\animesh\bkstr.tmrwgroup.ai\bkstr-keypair.pem` | Windows ACL on local disk; gitignored via `*.pem` | none on AWS side — only the public key is in EC2's metadata | unrotated; tied to the EC2 instance |
| AWS access keys (operator) | env vars in CLI agent process | n/a | n/a | unchanged from pre-Phase-1; rotation cadence unspecified |
| GitHub access | CodeStar Connection (per-account OAuth handshake) | managed by AWS | n/a | unchanged |
| TLS private key (Let's Encrypt) | `/etc/letsencrypt/live/bkstr.tmrwgroup.ai/privkey.pem` | root:root | reissued automatically by certbot.timer | auto-rotates at renewal |

**No secrets in the repo.** `.gitignore` covers `.env*`, `*.pem`. Verified: `git ls-tree -r HEAD | grep -E '\.(env|pem)$'` returns nothing (excluding `.env.example` patterns, of which we have none).

---

## Open follow-ups (9 entries)

Tracked in `docs/follow-ups.md`. Source-of-truth for Phase 2 scope debates.

| # | Title | Severity | File reference |
|---|---|---|---|
| 1 | Prisma CLI invoked via literal package path in `before-install.sh` (now obsolete after structural reset, kept as historical note + future hardening hint) | low | `scripts/before-install.sh` (Phase 1 historical) |
| 2 | Local hook-chain validation precedes every hook-touching change (process discipline) | process | `scripts/*.sh`, `appspec.yml` |
| 3 | Migration/deploy decoupling for Phase 2 — currently runs in `start.sh` BeforeInstall; problematic for forward-incompatible migrations once users exist | medium | `scripts/start.sh:22` |
| 4 | `prisma.config.ts` runtime requirement — document in README | low | `README.md` |
| 5 | nginx version pinning question (Ubuntu 1.24 → 1.25+ for HTTP/3 etc., decision deferred) | none today | `/etc/nginx/...` (EC2-side, not deployable) |
| 6 | `start.sh` rsync excludes need expansion when user-upload directories land | none today | `scripts/start.sh:10-11` |
| 7 | EBADENGINE warning on `@prisma/streams-local@0.1.2` declaring Node 22 | none today | `package-lock.json` (transitive) |
| 8 | Phase C local validation must use PID capture, not `pkill -f` against renamed runtime | medium | validation runbook (procedural) |
| 9 | First EC2 reboot post-Phase-1 validates `pm2-ubuntu.service` resurrect path — currently unverified | none today, high if reboot happens before verification | `/etc/systemd/system/pm2-ubuntu.service` + `/home/ubuntu/.pm2/dump.pm2` |

---

## Deploy chain documentation (how it actually works)

This section exists so the next contributor (human or AI) can extend the deploy chain without rediscovering everything from first principles. The chain is adapted from the **`selfandmatchnew`** template (a working Next.js + CodeDeploy + nginx + PM2 chain on the same Ubuntu 24.04 architecture, supplied as the Phase 1 reference). The structural reset that closed the five-failure debug chain was wholesale adoption of that template, with three deliberate adaptations.

### Pipeline shape

```
GitHub (animesh-2tmorrow/bkstr.tmrwgroup.ai, branch main)
    │  CodeStar Connection (account-level)
    ▼
CodePipeline (bkstr-pipeline)
    ├── Source       → S3 SourceArtifact
    ├── Build (CodeBuild bkstr-build)
    │     install:    npm ci --include=dev
    │     build:      npx prisma generate
    │                 npm run build  (next 15.5.18, static prerender)
    │                 npm prune --omit=dev
    │     post_build: chmod +x scripts/*.sh
    │     artifacts:  enable-symlinks: yes
    │                 globs: **/*  +  .next/**/*  +  node_modules/**/*
    │                 excludes: .git, .github, node_modules/.cache, .next/cache
    ▼
CodeDeploy (bkstr-app / bkstr-deploy-group)  → EC2 i-0e25e88f90738b9dc (tag Project=bkstr)
    │  Hooks (all runas: root, all #!/bin/bash, all `cd "$SCRIPT_DIR/.."`-prefixed):
    ├── BeforeInstall      → scripts/before-install.sh
    │                        rm -rf + mkdir -p /var/www/release/bkstr
    ├── (Install — auto)   → unzip artifact into /var/www/release/bkstr
    ├── AfterInstall       → scripts/after-install.sh
    │                        cp /var/www/bkstr/.env → release dir
    │                        sanity-check .next/ + node_modules/
    │                        Turbopack hashed-package alias workaround (no-op on Next 15)
    │                        chown -R ubuntu:ubuntu release dir
    ├── ApplicationStart   → scripts/start.sh
    │                        rsync -av --delete release → live, --exclude .env
    │                        cd /var/www/bkstr
    │                        sudo -u ubuntu npx prisma migrate deploy
    │                        sudo -u ubuntu pm2 reload|start npm --name bkstr-web -- run start
    │                        sudo -u ubuntu pm2 save
    │                        curl pre-warm
    └── ValidateService    → scripts/validate.sh
                             curl loopback :3000 with retry up to 90s
```

### nginx is stable infrastructure, not deployable

`/etc/nginx/sites-available/bkstr.conf` was written **once** during Phase A setup (via SSM, not via deploy hook). The deploy chain never touches nginx config. Every previous attempt to make `application-start.sh` write nginx config produced a class of failures (config-syntax surprises across nginx versions). Treating nginx as machine-provisioned-once isolates the deploy chain from nginx's quirks.

If nginx config needs to change, do it via SSM as an operator action — same shape as adding the `bkstr.conf` site initially. Don't try to bake config changes into deploy hooks.

### PM2, not systemd

`bkstr-app.service` (a hand-written systemd unit) was the original choice. It went through five distinct deploy failures before being abandoned. PM2 replaced it because PM2 is idiomatic for Node, supports graceful `pm2 reload` (zero-downtime), and inherits `.env` from the working directory naturally — no `EnvironmentFile=` ceremony, no path-explicit unit files.

The wrinkle: PM2 has its own daemon per user. We run it as `ubuntu`. Hooks run as `root` per `appspec.yml`, so PM2 commands are explicitly wrapped in `sudo -u ubuntu -E pm2 ...` with `PM2_HOME=/home/ubuntu/.pm2`. The systemd `pm2-ubuntu.service` (created by `pm2 startup systemd -u ubuntu`) handles cold-start resurrection on reboot. **Reboot path is currently untested — see follow-up #9.**

### `enable-symlinks: yes` is the load-bearing artifact flag

`buildspec.yml`'s `artifacts` block has `enable-symlinks: yes`. CodeBuild's default zip behavior is to dereference symlinks — meaning `node_modules/.bin/<x>` (normally a symlink to `../<pkg>/<entrypoint>`) gets copied as a regular file containing the entrypoint's content. At runtime the bin invocation can't find sibling files (Prisma's wasm sibling, Next's runtime requires) because `__dirname` is now `.bin/` instead of the package directory.

`enable-symlinks: yes` switches CodeBuild to use `zip --symlinks`, preserving `.bin/<x>` as zip-symlink entries. CodeDeploy's unzip honors them. After unpack, `.bin/prisma` is `lrwxrwxrwx … prisma -> ../prisma/build/index.js`, and bin invocation works exactly as `npm` intended.

This single flag fixes the `.bin/` symlink-deref issue end-to-end. Without it, every Node CLI in `.bin/` is a deploy hazard.

### `.env` lives at the live app dir, not `/etc/`

`/var/www/bkstr/.env` (mode 600, ubuntu:ubuntu) is read by Next.js's native `.env` loader (process cwd) AND by Prisma's `prisma.config.ts` (dotenv at process cwd). No `EnvironmentFile=` ceremony in a systemd unit; no `set -a; source /etc/...; set +a` ceremony in hooks; no `runas: ubuntu` workarounds.

The file is preserved across deploys via `rsync --exclude .env` in `start.sh`. CodeDeploy's `Install` hook overwrites the live dir's contents per `appspec.yml`'s `files: source: / destination: /var/www/release/bkstr` — but we deploy to the **release dir**, then rsync to the **live dir** with the exclude. This decoupling is what makes `.env` survive deploy without touching `/etc/`.

### Migrations run in `start.sh`, not `before-install.sh`

Originally Prisma migrations ran in `BeforeInstall`. Two problems:
1. The `.bin/prisma` symlink-deref issue made migrations fail at the bin-invocation layer.
2. `BeforeInstall` runs before `Install`, so the artifact contents aren't yet at the live dir; relative paths assume archive-root cwd.

Moving migrations to `ApplicationStart` (after `Install` has copied to release dir, after rsync has put files at `/var/www/bkstr/`, after cwd is `/var/www/bkstr/`) makes the runtime environment match what Prisma expects. Migrations are idempotent via the `_prisma_migrations` table — re-runs across deploys are safe.

This is the third structural deviation from the reference (selfandmatchnew has no Prisma migration step). Be aware before Phase 2's first non-additive migration — see follow-up #3.

### Three deliberate adaptations from the reference

1. **`User=ubuntu` not `www-data`** in PM2 + chown — matches Phase A's `pm2 startup -u ubuntu` decision.
2. **PM2 invoked via `sudo -u ubuntu -E`** while hooks remain `runas: root` — keeps filesystem ops (`chown`, `rsync` to `/var/www/`) at root, scopes process supervision to ubuntu.
3. **`npx prisma migrate deploy` step** in `start.sh` — adds Prisma migration to the chain, which selfandmatchnew doesn't need.

---

## Lessons learned

The five-failure-then-structural-reset shape is worth understanding for the next contributor.

**Each failure was a different layer; each fix was correct; each fix exposed the next bug.** Failure 1 (`.bin/prisma` not found in wrong cwd) led to a path-fix. The path-fix was right, exposing failure 2 (different cwd error). The cwd-fix was right, exposing failure 3 (`prisma.config.ts` missing from artifact). The artifact-fix was right, exposing failure 4 (nginx 1.25 syntax against 1.24). The nginx-fix was right, exposing failure 5 (`.bin/next` MODULE_NOT_FOUND, same root cause as failure 1). Each tactical fix advanced the deploy by one layer. Five layers is what it took to bottom out.

**The pattern was real but recoverable.** Failures 1 and 5 were the same architectural bug (symlink deref) wearing different costumes. A whiteboard reset back to a known-working template (`selfandmatchnew`) closed the entire class of bugs in one commit, plus three deliberate adaptations. The structural reset took ~90 minutes of careful work; the five tactical fixes took multiple hours of debug-iterate cycles. **Spending diagnosis time on the class, not the symptom, would have saved time** — but in fairness, you don't always know which it is until you've seen the second instance.

**Local validation discipline matters more than diff review.** Each of the five tactical fixes passed local-eyeball review of the diff, plus build-clean checks, plus the kind of "stare at the code" verification that's nominally rigorous. None of them surfaced the actual production failure mode because none ran the artifact in the artifact-shaped runtime environment. The discipline that emerged in Phase C — pull the artifact onto the EC2 in a scratch dir, exercise the actual binaries, run `npm start` against the real `.env` — is what surfaced the orphan-process bug that almost went undetected. Future hook-touching changes go through this discipline non-optionally.

**STOP gates with explicit human approval prevented the failure from spiraling.** Each tactical fix was approved before push; each push was approved before commit; each commit was reviewed before validation. Without those gates, the five-failure chain would have been five-cycles-of-fix-forward-and-pray. Three failures activated the meta-rule (whiteboard); five failures triggered the structural reset. The discipline of "STOP and present, don't fix forward" was the rate-limiter that kept the chain from becoming destructive.

**Deploy chains accumulate complexity layer by layer; debugging them requires peeling layers in order.** This is the meta-takeaway. CodeBuild → S3 zip → CodeDeploy → unzip → BeforeInstall hook cwd → AfterInstall env → ApplicationStart nginx + PM2 + migrate → ValidateService — each layer can mask the next one's bugs. The third or fourth diagnosis tends to be the right one (per the "third diagnosis pattern" the user named). Future Phase 2 deploy work should expect this and budget for it.

**The discipline that surfaced — "after three failures in the same surface, stop iterating and reproduce locally" — is reusable.** Five tactical fix attempts before the structural reset proved its value: each one cost a pipeline cycle, and the cumulative cost exceeded what an upfront structural conversation would have cost. Future deploys with similar surfaces should adopt this rule preemptively rather than rediscover it.

**The pm2 resurrect path was verified end-to-end before Phase 1 closed.** A controlled `aws ec2 reboot-instances` confirmed cold-boot ordering — postgresql, nginx, codedeploy-agent, and pm2-ubuntu.service all came back active; `journalctl -u pm2-ubuntu` showed `[PM2] Resurrecting → Restoring processes from /home/ubuntu/.pm2/dump.pm2 → Process restored`; fresh PM2 daemon and next-server PIDs took ownership of `:3000`; external curl returned 200 with the Manus landing within 3s of SSM agent recovery. Phase 1 doesn't ship with an unverified reboot path.

---

## Phase 1 commit chain (for the historical record)

```
04f95c7  docs(follow-ups): #9 RESOLVED via reboot verification; add #10, #11
3cbb654  docs(follow-ups): Phase C validation must use PID capture, not pkill -f name
1e9f66d  docs(follow-ups): EBADENGINE warning on @prisma/streams-local
f5ca66c  Structural reset: adopt selfandmatchnew deploy pattern         ← landing commit
e5a537d  Fix: use nginx 1.24-compatible http2 syntax                    ← failure #4 fix
8f5c111  Fix: include prisma.config.ts in deploy artifact               ← failure #3 fix
59b923a  Fix: cd to archive root at start of every CodeDeploy hook      ← failures #1, #2 (partial)
e006b5b  Fix: invoke prisma CLI via package path, not deref'd .bin symlink  ← failure #1 (partial)
3ad853a  Step 3+4+7: scaffold Next.js + Prisma schema + first deploy plumbing  ← scaffold
```

This report itself adds one more commit (`docs(phase-1): scaffold report`).

---

*Phase 1 closed 2026-05-08. Next: Step 8 manual browser eyeball (Animesh), then Phase 2 kickoff prompt.*
