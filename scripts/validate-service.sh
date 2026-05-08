#!/bin/bash
# Validate-service hook: poll loopback :3000 until it returns 200 (or fail).
# Non-zero exit triggers CodeDeploy auto-rollback.
set -u

# CodeDeploy invokes hooks from the agent's working directory, not from
# the archive root. Move to archive root so relative paths resolve.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

for i in 1 2 3 4 5 6 7 8 9 10; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/ 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then
        echo "validate-service: localhost:3000 returned 200 on attempt $i"
        exit 0
    fi
    echo "validate-service: attempt $i → $code, retrying in 2s..."
    sleep 2
done

echo "validate-service: FAILED — :3000 did not return 200 within 20s"
journalctl -u bkstr-app --no-pager --since '60 seconds ago' | tail -50
exit 1
