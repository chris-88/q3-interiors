// Regenerates supabase/forms/published.sql from src/forms/published.ts.
// Run with `npm run forms:sql` (Node 24 strips the types).
import { writeFileSync } from 'node:fs'
import { PUBLISHED_SQL_PATH, publishedFormsSql } from '../src/forms/sql.ts'

writeFileSync(PUBLISHED_SQL_PATH, publishedFormsSql())
console.log(`wrote ${PUBLISHED_SQL_PATH}`)
