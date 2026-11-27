import { describe, expect, it } from 'vitest'
import migration from '../../supabase/migrations/20261129100000_estimates.sql?raw'
import { WORDING } from '../../supabase/functions/_shared/messages'

describe('estimate rules in the database', () => {
  it('use the same default caveats as the email', () => {
    expect(migration).toContain(`select '${WORDING.estimate_caveats.default}'::text`)
  })
})
