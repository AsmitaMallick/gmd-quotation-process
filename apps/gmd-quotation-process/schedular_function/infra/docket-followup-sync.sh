#!/bin/sh
# Usage: docket-followup-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/docket-followup
# Detects new pending-docket mail (GMD client + Laser Entry + docket context),
# flags pendingDocket = true, then runs one-by-one AI verification.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

url="${GMD_APP_SERVER}/api/scheduler/docket-followup"

echo "POST $url (key length ${#GMD_SYNC_API_KEY})"
body=$(wget -qO- -T 900 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: docket-followup sync reported success=false"
  exit 1
fi

echo "OK: docket-followup sync completed"
