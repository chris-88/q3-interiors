#!/usr/bin/env bash
# Deploys supabase/functions to the self-hosted q3-interiors stack and restarts its functions
# container. The repo is the source of truth; the stack's copies (ignored by the infra repo,
# except the stack-owned `main` router) are overwritten.
#
#   scripts/functions-deploy.sh            # STACK_DIR defaults to ~/code/infra/stacks/q3-interiors
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_DIR="${STACK_DIR:-$HOME/code/infra/stacks/q3-interiors}"
DEST="$STACK_DIR/volumes/functions"
FUNCTIONS=(public-booking booking-worker calendar-admin google-oauth-callback staff-booking staff-accounts)

[[ -d "$DEST/main" ]] || { echo "no functions volume at $DEST"; exit 1; }

# Type-check the Deno entry points before anything is copied.
(cd supabase/functions && deno check --config deno.jsonc "${FUNCTIONS[@]/%//index.ts}")

for dir in _shared "${FUNCTIONS[@]}"; do
  rm -rf "${DEST:?}/$dir"
  command cp -r "supabase/functions/$dir" "$DEST/$dir"
done
rm -rf "$DEST/_shared/testing"
find "$DEST/_shared" -name '*.test.ts' -delete
command cp -f supabase/functions/deno.jsonc "$DEST/deno.jsonc"

sudo docker restart q3-interiors-edge-functions >/dev/null
for _ in $(seq 1 30); do
  status="$(sudo docker inspect -f '{{.State.Health.Status}}' q3-interiors-edge-functions)"
  [[ "$status" == healthy ]] && break
  sleep 1
done
echo "deployed ${FUNCTIONS[*]} to $DEST (container: $status)"
