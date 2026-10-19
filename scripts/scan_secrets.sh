#!/usr/bin/env bash
# Fail the build when a credential is about to be committed.
#
#   scripts/scan_secrets.sh            # scan the working tree
#   scripts/scan_secrets.sh --history  # scan every commit as well
#
# What it looks for:
#   * Firebase service-account keys (the private key and its file name)
#   * the SMTP app password of a .env file
#   * the device credentials written by scripts/provision_device.py
#
# The Firebase *web* config in firebase-config.json is public by design —
# Firebase ships it in every browser bundle — so it is not treated as a
# secret. What protects the data is the database rules, not that file.
set -euo pipefail

cd "$(dirname "$0")/.."

status=0
report() {
  echo "::error::$1"
  status=1
}

# A private key block, however it is named.
if git grep -nIE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . \
  ':!scripts/scan_secrets.sh' ':!docs/*' ':!*.md' 2>/dev/null | grep -q .; then
  report "a private key is in the working tree"
  git grep -nIE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . \
    ':!scripts/scan_secrets.sh' ':!docs/*' ':!*.md' | head -5
fi

# A Firebase service-account key file, by name.
found=$(git ls-files | grep -E 'firebase-adminsdk-.*\.json$' || true)
if [ -n "$found" ]; then
  report "a service-account key file is tracked: ${found}"
fi

# The device credentials and the SMTP password must never be tracked either.
for tracked in device-credentials.local demo-accounts.local .env .env.local; do
  if git ls-files --error-unmatch "$tracked" >/dev/null 2>&1; then
    report "${tracked} is tracked; it holds credentials"
  fi
done

# An SMTP app password sitting in a tracked .env file.
if git grep -nIE '^SMTP_PASSWORD=.+$' -- '*.env' '*.env.example' 2>/dev/null | grep -qv 'your-app-password'; then
  report "a real SMTP_PASSWORD looks like it is in a tracked env file"
  git grep -nIE '^SMTP_PASSWORD=.+$' -- '*.env' '*.env.example' | head -3
fi

if [ "${1:-}" = "--history" ]; then
  # Every blob ever committed, not just the current tree. Written with grep
  # rather than a `case` block: bash 3.2 (still the default on macOS) mis-
  # parses a `case` inside a command substitution that holds a pipeline.
  leaked=$(git rev-list --objects --all \
    | git cat-file --batch-check='%(objectname) %(objecttype) %(rest)' \
    | grep -E '^[0-9a-f]{40} blob' \
    | grep -Ei 'service-account|\.pem$|credentials.*\.local|\.key$|\.env$' \
    || true)
  if [ -n "$leaked" ]; then
    report "the history contains credential-like files:"
    echo "$leaked" | head -5
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "No credentials found."
fi
exit "$status"
