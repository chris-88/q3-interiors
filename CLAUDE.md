# CLAUDE.md

Guidance for the development agent working on this project. Read this fully before making changes, and treat the **Definition of Done** as the bar for every task.

## What this is

Q3 Interiors is a multi-trade renovation contractor. This app is its customer acquisition journey: a homeowner follows a link from Instagram to a mobile enquiry form, the enquiry is saved, and they book a phone consultation or an on-site estimate visit against staff Google Calendars. Staff get an authenticated workspace for enquiries, appointments and outcomes. A separate estimating product will later reuse the enquiry ID.

Slice 1 (enquiry) and slice 2 (booking against one Google Calendar, confirmation email, staff appointments and calendar settings) are built. Cancel/reschedule, reminders, outcomes, uploads, ad pixels and a form editor are later slices (see the vault decision `2026-11-20-q3-pilot-scope-and-hosting`).

| Concern            | Choice                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Build              | Vite + React + TypeScript (strict, `noUncheckedIndexedAccess`, no `any`)                                                            |
| Styling / UI       | Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui (Base UI)                                                                         |
| Routing            | React Router, `HashRouter` (GitHub Pages cannot serve deep links)                                                                   |
| Server state       | TanStack Query; Supabase reads/writes through hooks in `src/api/`                                                                   |
| Validation / forms | Zod + React Hook Form                                                                                                               |
| Backend            | Self-hosted Supabase stack `q3-interiors` (`~/code/infra/stacks/q3-interiors`), public URL `https://api.chrisquinn.ie/q3-interiors` |
| Tests              | Vitest + Testing Library; Playwright when e2e is warranted                                                                          |
| Lint / format      | oxlint (`jsx-a11y`), Prettier with `prettier-plugin-tailwindcss`                                                                    |
| Hosting            | GitHub Pages via GitHub Actions on push to `main`, `q3.chrisquinn.ie`                                                               |
| Node               | `.nvmrc` = 24                                                                                                                       |

## Operating philosophy: lean surface, high floor

Two rules that look opposed but aren't:

1. **Keep the surface lean.** Don't add speculative features, abstractions, or dependencies. Every new library is a decision that must be justified by a concrete, present need — not "we might want it." Prefer the platform and what's already in the stack before reaching for something new.
2. **Keep the floor high.** Strict types, tests, linting, CI gates, accessibility, and real error handling are **not** "later" work — they are baseline and apply from the first commit. Restraint governs _scope_; it never governs _craft_.

When these tension, craft wins. A small, correct, well-tested feature beats a large, untested one.

## Definition of Done

A change is not done until **all** of these hold. Apply this to every task without being asked:

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run test` all pass.
- [ ] New/changed logic has tests (behavior, not implementation detail). Critical paths are covered.
- [ ] Every async UI has explicit **loading, error, and empty** states — no silent failures, no spinners that never resolve.
- [ ] User and external input is validated with **Zod** at the boundary; errors are handled and surfaced.
- [ ] UI is keyboard-navigable and accessible (labels, focus, roles). No new `jsx-a11y` violations.
- [ ] Any new Supabase table has **RLS enabled with explicit policies** before it ships.
- [ ] No secrets in client code or `VITE_` vars; no `service_role` key anywhere near the client.
- [ ] Env changes are reflected in `.env.example`.
- [ ] Commit follows Conventional Commits. The diff is focused — no drive-by reformatting of unrelated files.

If you can't satisfy an item, say so explicitly rather than quietly skipping it.

## Rules of the stack

- `src/lib/env.ts` is the only reader of `import.meta.env`; `src/lib/supabase.ts` is the one client. Anon key only; never `service_role` in anything a browser can reach.
- Build-time env lives in repo variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), never committed. `.env.local` is gitignored.
- Schema changes are SQL migrations in `supabase/migrations/`, never edited once applied. The backend is self-hosted, so there is no `supabase db push`: `npm run db:migrate` (`scripts/db-migrate.sh`) applies pending files with psql against `pass show env/q3-interiors/DATABASE_URL`, each in one transaction, records them in `supabase_migrations.schema_migrations`, re-applies `supabase/forms/published.sql` (a no-op unless a new form version was added), and tells PostgREST to reload its schema. RLS on every table from creation, and revoke Supabase's default grants explicitly (see the first migration).
- shadcn components land in `src/components/ui/`; check shadcn before hand-building a component.
- Conventional commits, one concern each.

## Routes (HashRouter)

| Route                    | What                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `/#/`                    | Landing page, one "Tell us about your project" action                                                                         |
| `/#/enquire`             | Multi-step enquiry form, then review, then send                                                                               |
| `/#/enquire/sent`        | Confirmation with the reference; only reachable after a successful save                                                       |
| `/#/staff`               | Staff sign-in, then the enquiry list (lazy-loaded chunk)                                                                      |
| `/#/staff/enquiries/:id` | Enquiry detail: answers via the stored form version, contact, status change, history, attribution                             |
| `/#/book/:token`         | Customer scheduling for one enquiry (opaque access token, 30 days): type, address for a visit, slot, book, pending, confirmed |
| `/#/staff/appointments`  | Appointments, upcoming first, plus past and failed                                                                            |
| `/#/staff/settings`      | Connect/reconnect/test/disconnect Google Calendar; availability and appointment types (placeholders)                          |

Campaign links carry `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, either before the `#` (`https://q3.chrisquinn.ie/?utm_source=instagram#/`) or inside the route (`/#/?utm_source=instagram`). `src/lib/attribution.ts` keeps the first tagged arrival for 30 days in localStorage; an untagged arrival is stored as `tracking = 'unknown'`. Click ids are recorded only as present or not. Never put customer data in a URL.

Customer-facing business values (service area, contact) live in `src/config/business.ts`; `null` placeholders are not shown, so nothing unconfirmed is claimed.

## Data model

- `enquiries`: `id` uuid (the stable id later slices and the estimating app reuse), `reference` (`Q3-XXXXXX`, shown to the customer), `idempotency_key` (unique), `status` (`new | in_review | contacted | unsuitable`, with `status_reason` required for unsuitable), `form_id` + `form_version`, `answers` jsonb keyed by field id, `marketing_opt_in` (+ `_at`), timestamps. Enquiry status is only about handling the enquiry; bookings and commercial outcomes get their own tables and states.
- `enquiry_revisions`: every version of the answers (revision 1 is the submission).
- `enquiry_attribution`: one row per enquiry; NULL means unknown.
- `enquiry_events`: submission and every status change, with the actor's name snapshotted.
- `form_versions`: immutable published schemas (a trigger blocks update and delete).
- `staff`: the allowlist (`user_id`, `role admin|staff`, `display_name`).
- Slice 2 adds `appointment_types`, `staff_availability`, `calendar_connections` (health only), `bookings`, `integration_jobs`, `communications`, enquiry `site_details` (a revision through the published `site_details` form) and `contact_requested_at`; tokens and OAuth state are in `private`. Staff may update availability and type settings directly (column grants + RLS); everything else is written by the functions as `postgres` through `private.*` functions.
- Slice 1 writes go through two `security definer` functions only: `submit_enquiry(p_idempotency_key uuid, p_form_id text, p_form_version int, p_answers jsonb, p_marketing_opt_in bool, p_attribution jsonb) returns text` (granted to anon; validates against the stored schema; a repeated key returns the original reference) and `set_enquiry_status(p_enquiry_id uuid, p_status enquiry_status, p_reason text)` (staff only). `anon` has no table privileges; `authenticated` can SELECT, and RLS filters every table to staff via `is_staff()`.

## Form versions

- A form is a versioned file, e.g. `src/forms/enquiry/v1.ts` (types in `src/forms/types.ts`). Field ids and option values are stable forever; labels may only change in a new version.
- The client renders the schema generically (`src/components/enquiry/form-field.tsx`), Zod validation is derived from it (`src/forms/logic.ts`), and `submit_enquiry` re-validates against the copy stored in `form_versions`. Email and phone regexes exist in both `logic.ts` and the migration; change them together.
- A published version is immutable. `src/forms/published.test.ts` pins its fingerprint and checks `supabase/forms/published.sql` matches the source; `publish_form_version` in the database refuses a changed schema.
- To publish a new version: copy `v1.ts` to `v2.ts`, bump `version`, make the change, append it to `publishedForms` in `src/forms/published.ts`, point `currentEnquiryForm` at it, run `npm run forms:sql`, add the new fingerprint to `published.test.ts`, then `npm run db:migrate` before (or with) the deploy. Old enquiries keep rendering through their own version. A draft saved in a browser for an older version is discarded and the customer starts the new one.

## Staff accounts

- Staff sign in with email and password (Supabase Auth). Being in `auth.users` is not enough: a `staff` row is required. Rows are inserted by an operator with psql, never by a migration (no personal data in the repo).
- The first admin was created on 2026-11-20 through the GoTrue admin API with the stack's service role key from pass; its password is in pass at `infra/q3-interiors/STAFF_ADMIN_PASSWORD`.
- Public sign-up is disabled on the stack (`DISABLE_SIGNUP=true`, infra `17c4c11`).

## Booking (slice 2)

Flow: `submit_enquiry_with_access` (anon) returns the reference plus an access token (32 random bytes; only its SHA-256 is stored, in `private.enquiry_access_tokens`, 30-day expiry; a retry with the same idempotency key returns the same reference and a fresh token for the same enquiry). The app goes straight to `/#/book/<token>`. `submit_enquiry` is unchanged for older clients.

Edge Functions (source of truth `supabase/functions/`, deployed with `npm run functions:deploy`):

| Function                | Auth                                                                           | What                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `public-booking`        | anon key (router JWT check) + enquiry token in the body                        | `context`, `availability`, `site_details`, `book`, `status`, `request_contact`                                           |
| `calendar-admin`        | signed-in staff (GoTrue `/user` + `staff` row)                                 | `start` (Google consent URL, PKCE, state), `test`, `disconnect`                                                          |
| `google-oauth-callback` | none: listed in `FUNCTIONS_PUBLIC`; authorised by a single-use 10-minute state | exchanges the code, stores the AES-GCM-encrypted refresh token, redirects to `/#/staff/settings?calendar=…`              |
| `booking-worker`        | anon key + `x-worker-secret`                                                   | retries due calendar jobs and emails; pg_cron calls it every minute via pg_net (`private.kick_worker`, secrets in Vault) |

Pure logic lives in `supabase/functions/_shared` and is unit-tested with Vitest (`slots.ts`, `calendar-job.ts`, `email.ts`, `public-booking.ts`; fakes in `_shared/testing/fakes.ts`). `db.ts` and `runtime.ts` are Deno-only and checked with `npm run functions:check`.

Rules that matter:

- Slots = working hours (the appointment itself; buffers may fall outside) minus Google free/busy minus live bookings' buffered ranges, honouring notice, horizon (local days, today included) and the on-site daily limit. All local times are Europe/Dublin; storage is UTC. A failed free/busy is "unavailable", never "free": the customer gets "ask us to contact you" (`enquiries.contact_requested_at`), staff see it.
- `private.reserve_booking` is the race guard: exclusion constraint `bookings_no_overlap` (staff + buffered `tstzrange`, live states only), one live booking per enquiry, idempotency key, and an advisory lock per staff and day for the visit limit. Eligibility is decided in one place: `public.enquiry_booking_eligibility`.
- Booking states: `reserved` (held, nothing sent to Google) → `calendar_pending` → `confirmed` | `failed` (slot released); `cancelled` is for slice 3. Enquiry status is separate.
- Calendar event ids are fixed before the first attempt (`q3` + booking uuid hex). Every attempt reads the event first and only inserts if it is absent; a 409 is resolved by reading. A timeout after an insert sets `integration_jobs.outcome_unknown`. Backoff 30 s → 1 h, 8 attempts; an auth failure marks the calendar disconnected and retries every 15 minutes; reconnecting makes queued jobs due at once.
- Emails go through `communications` (dedupe key `booking_confirmation:<booking id>`, also sent as Resend's `Idempotency-Key`). Reserved test domains (`example.com`, `*.invalid`, `*.test`) are recorded as failed and never sent. Sender: `Q3 Interiors (test) <q3-interiors-test@baz.chrisquinn.ie>` (POC only; change before the pilot). Customers are never Google attendees.
- Scopes: `openid email calendar.freebusy calendar.events.owned` (checked against Google's docs 2026-11-20). A Google app in Testing mode expires refresh tokens after 7 days: reconnect from Settings (one click; `prompt=consent` always returns a new refresh token).

Stack wiring (infra repo, `stacks/q3-interiors/`): `docker-compose.q3-interiors.yml` passes `FUNCTIONS_PUBLIC`, `GOOGLE_CLIENT_ID/SECRET`, `TOKEN_ENCRYPTION_KEY`, `WORKER_SECRET`, `SMTP_PASS` (Resend key) and URLs to the functions container; `volumes/functions/main/index.ts` (the router) skips JWT verification for names in `FUNCTIONS_PUBLIC`. Secrets live in pass under `infra/q3-interiors/`. After adding or changing one: `~/code/infra/scripts/render-env q3-interiors && cd ~/code/infra/stacks/q3-interiors && sudo docker compose up -d functions`. Vault secrets for the cron worker: `npm run functions:secrets`.

## Testing

- `npm run test`: unit tests (schema-to-validation, conditional visibility, attribution parsing, drafts and idempotency keys, published-form drift, a few component tests).
- `npm run test:e2e`: Playwright at 390px against `vite preview` of the current `dist/` (run `npm run build` first; a stale `dist/` tests old code). `e2e/fake-backend.ts` runs the real `public-booking` logic in Node over an in-memory database and a fake Google Calendar and blocks every other backend request, so nothing reaches the stack. Set `SCREENSHOTS_DIR` to keep step screenshots. Runs in CI on pull requests and before deploy.
- `npm run test:db`: against the live stack: `supabase/tests/access.sql` and `booking.sql` inside transactions that are always rolled back (privileges, RLS, validation, idempotency, tokens, reservations, job and email transitions), the form drift check, `supabase/tests/race.sh` (a real two-session race for one slot; it deletes what it creates), then `scripts/check-anon-http.sh` through the public gateway (tables, RPCs, functions, the OAuth callback). Run it after any migration or functions deploy. Not in CI (the database is not reachable from GitHub).
- Local dev must run on `http://localhost:5173` (the gateway's CORS allow-list); `.env.local` carries the URL and anon key.

## Commands

```bash
npm run dev            # local dev server
npm run build          # type-check + production build
npm run typecheck      # tsc --noEmit
npm run lint           # oxlint src/
npm run format         # prettier --write
npm run format:check   # prettier --check
npm run test           # vitest run
npm run test:coverage  # vitest run --coverage
npm run test:e2e       # playwright (after npm run build)
npm run test:db        # live database checks (rolled back)
npm run db:migrate     # apply migrations and published forms
npm run forms:sql      # regenerate supabase/forms/published.sql
npm run functions:check   # deno check the Edge Functions
npm run functions:deploy  # copy them to the stack and restart its functions container
npm run functions:secrets # put the worker secret into Vault for pg_cron
npx shadcn@latest add <component>
```

Deploy: push to `main`; GitHub Actions runs the quality gate (including e2e), builds and publishes. Pull requests run the same gate in `ci.yml`. Apply migrations with `npm run db:migrate` before merging code that needs them.
