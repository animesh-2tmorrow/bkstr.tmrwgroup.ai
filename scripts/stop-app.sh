#!/bin/bash
# Stop the running bkstr-app systemd unit if it exists.
# On the very first deploy this is a no-op (unit doesn't exist yet); CodeDeploy
# tolerates that. Use systemctl-list to avoid stop failing on a missing unit.
set -u
if systemctl list-unit-files bkstr-app.service --no-legend 2>/dev/null | grep -q '^bkstr-app.service'; then
    systemctl stop bkstr-app || true
fi
exit 0
