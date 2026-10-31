#!/bin/sh
# Usage: ledger-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/ledger
# Replaces the Debtor, Creditor and CreditorAdvance tables from the DEBTORS,
# CREDITORS and ADVANCE TO CREDITORS tabs of GMD_EXECUTION_TRACKING_SPREADSHEET_ID.
# Daily at 01:55; each ledger is replaced in its own transaction.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

url="${GMD_APP_SERVER}/api/scheduler/ledger"

# Cheap credential probe first: GET authenticates but does NOT run the job.
probe=$(wget -qO- -T 30 --header "x-api-key: ${GMD_SYNC_API_KEY}" "${url}" || true)
case "$probe" in
  *'"auth":"ok"'*) : ;;
  *)
    echo "ERROR: credential probe failed for $url"
    echo "$probe"
    exit 1
    ;;
esac

echo "POST $url (key length ${#GMD_SYNC_API_KEY})"
body=$(wget -qO- -T 600 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: ledger sync reported success=false (a tab or column failed; see body)"
  exit 1
fi

# One bad tab still returns 200 with success:false (caught above) while the
# other ledgers were written. Skipped rows are in the body but are not fatal.

echo "OK: ledger sync completed"
