#!/bin/bash
# Pre-install hook: validate prerequisites + apply Prisma migrations.
set -e
exec 2>&1

# CodeDeploy invokes hooks from the agent's working directory, not from
# the archive root. Move to archive root so relative paths resolve.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# 1. Pre-staged secrets must exist; CodeDeploy never writes here.
if [ ! -f /etc/bkstr/app.env ]; then
    echo "ERROR: /etc/bkstr/app.env missing — secrets must be pre-staged before first deploy"
    exit 1
fi
PERMS=$(stat -c '%a' /etc/bkstr/app.env)
if [ "$PERMS" != "600" ]; then
    echo "ERROR: /etc/bkstr/app.env mode is $PERMS, expected 600"
    exit 1
fi

# 2. Apply database migrations. Idempotent — Prisma's migration table prevents re-applying.
set -a
. /etc/bkstr/app.env
set +a
node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma

# 3. Ensure deploy destination exists (Install hook needs it for first deploy).
mkdir -p /var/www/bkstr
