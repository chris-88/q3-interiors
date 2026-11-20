#!/usr/bin/env bash
# Applies pending migrations to the self-hosted q3-interiors stack, then the published form
# versions. Each migration runs in one transaction and is recorded in
# supabase_migrations.schema_migrations (the table the Supabase CLI uses), so re-running is safe.
#
#   scripts/db-migrate.sh            # uses pass env/q3-interiors/DATABASE_URL
#   DATABASE_URL=... scripts/db-migrate.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="${DATABASE_URL:-$(pass show env/q3-interiors/DATABASE_URL)}"
PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" <<'SQL'
set client_min_messages = warning;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

for file in supabase/migrations/*.sql; do
  base="$(basename "$file" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  applied="$("${PSQL[@]}" -At -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")"
  if [[ -n "$applied" ]]; then
    echo "skip   $base"
    continue
  fi
  echo "apply  $base"
  {
    echo 'begin;'
    cat "$file"
    echo
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');"
    echo 'commit;'
  } | "${PSQL[@]}"
done

echo "apply  supabase/forms/published.sql"
"${PSQL[@]}" -1 -f supabase/forms/published.sql >/dev/null
# PostgREST caches the schema; tell it to pick up new functions and tables.
"${PSQL[@]}" -c "notify pgrst, 'reload schema'"
echo "done"
