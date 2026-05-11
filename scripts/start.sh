#!/bin/bash
set -e  # Fail fast on any error

echo "===  CodeDeploy – ApplicationStart ==="

# Atomic sync of new release to live (zero downtime).
# --exclude .env preserves the pre-staged secret file across deploys.
# Phase 1 has no user uploads to preserve; broader exclude list
# (public/images/products, storage, etc.) added per-feature later.
rsync -av --delete /var/www/release/bkstr/ /var/www/bkstr/ \
  --exclude .env

# Change to live app directory.
cd /var/www/bkstr

# Source app env files into this shell so `sudo -u ubuntu -E` propagates
# them to prisma + pm2. /var/www/bkstr/.env is rsync-preserved (DATABASE_URL).
# /etc/bkstr/<service>.env files are operator-staged (mode 600 root) per
# D9.4 / D10.3 — one file per concern (OAuth, Stripe, AWS, …) so independent
# rotations don't cross-contaminate. Absence is tolerated for first-deploy-
# before-staging cases but logged loudly so the "feature enabled in code but
# secrets not staged" failure mode is caught at deploy time, not at first use.
set -a
source /var/www/bkstr/.env
if [ -f /etc/bkstr/roles.env ]; then
  source /etc/bkstr/roles.env
  echo "[start.sh] Roles env sourced from /etc/bkstr/roles.env (keys: $(grep -oE '^[A-Z_]+=' /etc/bkstr/roles.env | tr -d '=' | tr '\n' ' '))"
else
  echo "[start.sh] WARN: /etc/bkstr/roles.env not present — role auto-promotion disabled; existing roles preserved."
fi
# Phase 5 Stream B (D14.2) — admin assistant model id. Optional; absence
# defaults to Sonnet 4.5 (see src/lib/admin/assistant/bedrock-client.ts).
# Operator stages /etc/bkstr/assistant.env to override (e.g. to Opus 4.7
# once follow-up #84 lands).
if [ -f /etc/bkstr/assistant.env ]; then
  source /etc/bkstr/assistant.env
  echo "[start.sh] Assistant env sourced from /etc/bkstr/assistant.env (keys: $(grep -oE '^[A-Z_]+=' /etc/bkstr/assistant.env | tr -d '=' | tr '\n' ' '))"
else
  echo "[start.sh] WARN: /etc/bkstr/assistant.env not present — admin assistant defaults to Sonnet 4.5 (see follow-up #84 for Opus 4.7 upgrade)."
fi
# Phase 3 D9.4: per-service env files; add new ones above this comment
if [ -f /etc/bkstr/aws.env ]; then
  source /etc/bkstr/aws.env
  echo "[start.sh] AWS env sourced from /etc/bkstr/aws.env (keys: $(grep -oE '^[A-Z_]+=' /etc/bkstr/aws.env | tr -d '=' | tr '\n' ' '))"
else
  echo "[start.sh] WARN: /etc/bkstr/aws.env not present — S3-backed book content reads will fail until staged."
fi
if [ -f /etc/bkstr/oauth.env ]; then
  source /etc/bkstr/oauth.env
  echo "[start.sh] OAuth env sourced from /etc/bkstr/oauth.env (keys: $(grep -oE '^[A-Z_]+=' /etc/bkstr/oauth.env | tr -d '=' | tr '\n' ' '))"
else
  echo "[start.sh] WARN: /etc/bkstr/oauth.env not present — Google sign-in will fail until staged."
fi
if [ -f /etc/bkstr/stripe.env ]; then
  source /etc/bkstr/stripe.env
  echo "[start.sh] Stripe env sourced from /etc/bkstr/stripe.env (keys: $(grep -oE '^[A-Z_]+=' /etc/bkstr/stripe.env | tr -d '=' | tr '\n' ' '))"
else
  echo "[start.sh] WARN: /etc/bkstr/stripe.env not present — Stripe Checkout + webhooks will fail until staged."
fi
set +a


# Prisma migration runs HERE (not before-install). At this point .env is
# in /var/www/bkstr/.env (rsync preserved it via --exclude) and
# node_modules/.bin/prisma is a real symlink (enable-symlinks: yes in
# buildspec). Migrations are idempotent — Prisma's _prisma_migrations
# table prevents re-applying.
echo "Applying Prisma migrations..."
sudo -u ubuntu -E npx prisma migrate deploy --schema prisma/schema.prisma

# Use ubuntu's PM2 home consistently for deploy hooks AND systemd's
# pm2-ubuntu.service unit (Phase A wired pm2 startup to user=ubuntu).
# Hook runs as root per appspec; we sudo to ubuntu specifically for PM2
# commands so the daemon owns its own files in /home/ubuntu/.pm2/.
export PM2_HOME=/home/ubuntu/.pm2

# Graceful reload with --update-env so newly added OAuth vars propagate to
# the running process (without --update-env, pm2 reuses the env captured at
# the original `pm2 start` invocation, leaving GOOGLE_CLIENT_ID undefined).
# First deploy hits the start branch (no existing process); subsequent
# deploys hit the reload branch (zero-downtime).
sudo -u ubuntu -E pm2 reload bkstr-web --update-env || sudo -u ubuntu -E pm2 start npm --name "bkstr-web" -- run start

# Save PM2 process list so pm2-ubuntu.service can resurrect it on boot.
sudo -u ubuntu -E pm2 save

# Pre-warm: first hit triggers Next.js boot+JIT; warming reduces
# first-visitor latency.
echo "Pre-warming Next.js app..."
curl -s -o /dev/null http://localhost:3000 || true

echo "Deployment completed successfully – "
