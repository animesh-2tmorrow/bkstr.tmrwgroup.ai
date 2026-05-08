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

# Graceful reload: reloads if running, starts if not.
# First deploy hits the start branch (no existing process); subsequent
# deploys hit the reload branch (zero-downtime).
sudo -u ubuntu -E pm2 reload bkstr-web || sudo -u ubuntu -E pm2 start npm --name "bkstr-web" -- run start

# Save PM2 process list so pm2-ubuntu.service can resurrect it on boot.
sudo -u ubuntu -E pm2 save

# Pre-warm: first hit triggers Next.js boot+JIT; warming reduces
# first-visitor latency.
echo "Pre-warming Next.js app..."
curl -s -o /dev/null http://localhost:3000 || true

echo "Deployment completed successfully – "
