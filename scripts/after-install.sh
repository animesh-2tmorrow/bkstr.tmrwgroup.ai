#!/bin/bash

set -e

echo "=== CodeDeploy – AfterInstall ==="
cd /var/www/release/bkstr

# Copy live .env (secrets). Pre-staged at /var/www/bkstr/.env in Phase A,
# preserved across deploys via rsync --exclude .env in start.sh.
if [ -f /var/www/bkstr/.env ]; then
  cp /var/www/bkstr/.env /var/www/release/bkstr/.env
  echo "Live .env copied"
else
  echo "No live .env found at /var/www/bkstr/.env"
  exit 1
fi

# Validate that build artifacts are present from CodeBuild output.
if [ ! -d ".next" ]; then
  echo "Missing .next build output in deployment artifact."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Missing node_modules in deployment artifact."
  exit 1
fi

# Next.js 16 + Turbopack may reference hashed package aliases under
# .next/node_modules. We're on Next 15.5.18 today so this is a no-op,
# but cheap insurance against a future upgrade reintroducing the issue.
if [ -d ".next/server" ]; then
  echo "Ensuring Next.js hashed package aliases exist..."
  while IFS= read -r module_path; do
    alias_path=".next/${module_path}"
    target_module_path="$(echo "$module_path" | sed -E 's/-[0-9a-f]{16}$//')"
    target_path="$PWD/$target_module_path"

    if [ ! -e "$target_path" ]; then
      echo "Skipping alias for missing target: $target_path"
      continue
    fi

    mkdir -p "$(dirname "$alias_path")"
    if [ ! -e "$alias_path" ]; then
      ln -s "$target_path" "$alias_path"
      echo "Created alias: $alias_path -> $target_path"
    fi
  done < <(grep -Rho 'node_modules/@[^"]*-[0-9a-f]\{16\}' .next/server 2>/dev/null | sort -u)
fi

# Permissions — use ubuntu (NOT www-data; reference uses www-data, our PM2
# is wired to ubuntu in Phase A).
chown -R ubuntu:ubuntu /var/www/release/bkstr

echo "AfterInstall completed (prebuilt artifact; no on-instance install/build)"
