#!/bin/bash
set -e

HOST_HEADER="${APP_HOST:-bkstr.tmrwgroup.ai}"

echo "Waiting up to 90 seconds for bkstr to start..."
for i in $(seq 1 45); do
  status_code="$(curl -s -o /dev/null -w "%{http_code}" -H "Host: ${HOST_HEADER}" -H "X-Forwarded-Proto: https" http://localhost:3000 || true)"
  if [ "$status_code" -ge 200 ] && [ "$status_code" -lt 500 ]; then
    echo "bkstr is healthy (HTTP $status_code)"
    exit 0
  fi
  echo "Attempt $i/45 – waiting (HTTP $status_code)..."
  sleep 2
done

echo "ERROR: App failed to start"
exit 1
