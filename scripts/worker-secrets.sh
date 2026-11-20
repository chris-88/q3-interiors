#!/usr/bin/env bash
# Puts the booking worker's credentials into Supabase Vault so pg_cron can call the
# booking-worker function: `q3_worker_secret` (pass infra/q3-interiors/WORKER_SECRET) and
# `q3_functions_jwt` (the anon key, which the functions router accepts as a JWT). Values travel
# from pass to psql on stdin, never on a command line, and are never printed. Safe to re-run.
set -euo pipefail

DB_URL="${DATABASE_URL:-$(pass show env/q3-interiors/DATABASE_URL)}"

{
  printf "\\set secret '%s'\n" "$(pass show infra/q3-interiors/WORKER_SECRET | head -1)"
  printf "\\set jwt '%s'\n" "$(pass show infra/q3-interiors/ANON_KEY | head -1)"
  cat <<'SQL'
select vault.update_secret(id, :'secret') from vault.secrets where name = 'q3_worker_secret';
select vault.create_secret(:'secret', 'q3_worker_secret')
  where not exists (select 1 from vault.secrets where name = 'q3_worker_secret');
select vault.update_secret(id, :'jwt') from vault.secrets where name = 'q3_functions_jwt';
select vault.create_secret(:'jwt', 'q3_functions_jwt')
  where not exists (select 1 from vault.secrets where name = 'q3_functions_jwt');
SQL
} | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null
echo "vault secrets q3_worker_secret and q3_functions_jwt are set"
