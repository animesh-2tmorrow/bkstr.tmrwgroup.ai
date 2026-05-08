#!/bin/bash
# Application-start hook: install/refresh nginx site config, install/refresh
# systemd unit, start (or restart) bkstr-app.
set -e
exec 2>&1

# CodeDeploy invokes hooks from the agent's working directory, not from
# the archive root. Move to archive root so relative paths resolve.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# 1. nginx reverse-proxy config for bkstr.tmrwgroup.ai (HTTP→HTTPS, :443→:3000).
cp /var/www/bkstr/scripts/nginx-bkstr.conf /etc/nginx/sites-available/bkstr.conf
ln -sf /etc/nginx/sites-available/bkstr.conf /etc/nginx/sites-enabled/bkstr.conf
# Disable the certbot-modified default site if it's still linked.
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# 2. systemd unit for the Next.js app (reads /etc/bkstr/app.env at start).
cp /var/www/bkstr/scripts/bkstr-app.service /etc/systemd/system/bkstr-app.service
systemctl daemon-reload
systemctl enable bkstr-app
systemctl restart bkstr-app

# Give it a beat to bind :3000 before validate-service runs.
sleep 2
