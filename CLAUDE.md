# CLAUDE.md

Guidance for the development agent working on this project. Read this fully before making changes, and treat the **Definition of Done** as the bar for every task.

## What this is

Q3 Interiors is a multi-trade renovation contractor. This app is its customer acquisition journey: a homeowner follows a link from Instagram to a mobile enquiry form, the enquiry is saved, and they book a phone consultation or an on-site estimate visit against staff Google Calendars. Staff get an authenticated workspace for enquiries, appointments and outcomes. A separate estimating product will later reuse the enquiry ID.

Slices 1 (enquiry), 2 (booking against one Google Calendar, confirmation email, staff appointments and calendar settings) and 3 (cancel and reschedule, email reminders, attendance and won/lost outcomes, funnel report, calendar reconcile flags) are built. SMS, uploads, ad pixels, multi-staff and a form editor are not (see the vault decision `2026-11-20-q3-pilot-scope-and-hosting`).

| Concern            | Choice                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build              | Vite + React + TypeScript (strict, `noUncheckedIndexedAccess`, no `any`)                                                                                                 |
| Styling / UI       | Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui (Base UI)                                                                                                              |
| Routing            | React Router, `HashRouter` (GitHub Pages cannot serve deep links)                                                                                                        |
| Server state       | TanStack Query; Supabase reads/writes through hooks in `src/api/`                                                                                                        |
| Validation / forms | Zod + React Hook Form                                                                                                                                                    |
| Backend            | Self-hosted Supabase stack `q3-interiors` (`~/code/infra/stacks/q3-interiors`), public URL `https://api.chrisquinn.ie/q3-interiors`                                      |
| Tests              | Vitest + Testing Library; Playwright when e2e is warranted                                                                                                               |
| Lint / format      | oxlint (`jsx-a11y`), Prettier with `prettier-plugin-tailwindcss`                                                                                                         |
| Hosting            | GitHub Pages via GitHub Actions on push to `main`: customer site `book.q3interiors.ie` (this repo), staff console `staff.q3interiors.ie` (`chris-88/q3-interiors-staff`) |
| Node               | `.nvmrc` = 24                                                                                                                                                            |

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

## Brand

The Q3 Interiors website brand guide v2.0 (black and white wordmark, supplied 2026-11-25, kept outside the repo) is applied through the existing Tailwind/shadcn tokens in `src/index.css`; its `q3-web.css` is not imported.

- Roles (named by role, never by colour): `action` `#000000` (primary buttons, links, focus; hover `action-hover` `#2B2B2B`), `ink` `#171717` (text), muted text `#555555`, `soft` `#F5F5F5` (occasional section background; also shadcn secondary/muted/accent), `edge` `#767676` (field and option boundaries), `rule` `#D4D4D4` (dividers). Black panels: `panel` `#000000` with `on-panel` white text and buttons (hover `on-panel-hover` `#E6E6E6`). White is the page and card background.
- Errors stay red `#943B30` (`destructive`) with a written instruction. This is a deliberate departure from guide v2.0, which makes errors black: red keeps an error distinct from the black primary actions and focus ring. Status colours that carry meaning (checklist amber, badges) also stay.
- Type: Roboto 400/500/700 self-hosted via `@fontsource/roboto` (latin subset, `font-display: swap`). Headings use 500 (`font-medium`); 700 only for selective emphasis. Scale: `text-display`, `text-section`, `text-title`, `text-body` (fluid clamps from the guide).
- Shape and size: 4px radius; controls 48px (`h-12`, `min-h-12`); widths `max-w-page` (1200px), `max-w-form` (640px), `max-w-prose` (64ch). Native radios and checkboxes use the action colour (`accent-color`).
- Focus: 3px black outline, 3px offset, unlayered in `index.css` so it beats utilities; white inside `.on-panel`.
- Light only: no dark tokens; `dark:` utilities never apply.
- Logos: the two supplied SVGs, unchanged, in `public/brand/` (`q3-full-black.svg` 243x93, `q3-mark-black.svg` 77x93); the white versions are the same paths with `fill="white"`, generated, never redrawn. Public header: the full wordmark only (no text beside it), about 144px wide on phones and 160px from 768px, in a link at least 48px high; the link is named "Q3 Interiors home" and the image is decorative. Footer: black panel with the white wordmark. Staff header: the compact Q. Page text, titles and emails say "Q3 Interiors"; "Q THREE" appears only in the artwork.
- Generated images (`npm run brand:images`, `scripts/brand-images.cjs`, all from the two SVGs): the white logos; `public/favicon.svg` (the Q alone on a white tile: at 16px the logo's thin rules would blur, so they are left out) with `favicon-16.png` and `favicon-32.png`; `apple-touch-icon.png` (180px, compact Q with both rules); `public/og/q3-og.png` (1200x630, white card, wordmark, the main line); `public/brand/q3-email-logo.png` (the wordmark at 2x for HTML emails, shown at 160px).
- Emails: the wordmark PNG at the top, ink text on white, one black button for the main action, black links; the plain-text part is unchanged.
- One site URL: `SITE_URL` in `supabase/functions/_shared/site.ts`. Vite injects it into `index.html` (`%SITE_URL%`, Open Graph/Twitter tags) and the functions use it for every link and image in emails.
- Wording: public states use the guide's section 5 phrases, shown only when the saved state supports them. Vocabulary: enquiry; a call or a site visit; an estimate is a price range; a quote covers an agreed scope. No "Our work" until approved photos exist.

## Routes (HashRouter)

| Route             | What                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `/#/`             | Landing page, one "Tell us about your project" action                   |
| `/#/enquire`      | Multi-step enquiry form, then review, then send                         |
| `/#/enquire/sent` | Confirmation with the reference; only reachable after a successful save |

Staff console routes (on `https://staff.q3interiors.ie`, no `/staff` prefix):

| Route                                         | What                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/#/` (also `/#/enquiries`)                   | Staff sign-in, then the enquiry list                                                                                                         |
| `/#/enquiries/:id`                            | Enquiry detail: answers via the stored form version, contact, status change, history, attribution                                            |
| `/#/appointments`                             | Appointments, upcoming first, plus past and failed                                                                                           |
| `/#/report`                                   | Funnel report: enquiries -> booked -> attended -> won, overall and by campaign, for a date range                                             |
| `/#/settings`                                 | Own Google Calendar and the booking hours; admins: links to `/#/settings/people`, `business`, `wording`, `campaigns`, `checklist`, `booking` |
| `/#/forgot`, `/#/set-password?token_hash=...` | Forgot password; set a password from an emailed link                                                                                         |

Old `/#/staff/...` links: on the customer site they go to the same place on the staff site (query kept, so emailed set-password links still work); on the staff site they drop the prefix.

Campaign links carry `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, either before the `#` (`https://book.q3interiors.ie/?utm_source=instagram#/`) or inside the route (`/#/?utm_source=instagram`). `src/lib/attribution.ts` keeps the first tagged arrival for 30 days in localStorage; an untagged arrival is stored as `tracking = 'unknown'`. Click ids are recorded only as present or not. Never put customer data in a URL.

Two builds, one codebase (`VITE_SURFACE`, read once in `src/main.tsx` so the other surface is left out of the bundle): `npm run build` makes the customer site in `dist/` (`src/App.tsx`: landing, enquiry, booking, privacy, and a redirect for old `/staff` links) and the staff console in `dist-staff/` (`src/StaffApp.tsx`; title "Q3 Interiors Staff", `noindex` meta, `robots.txt` Disallow, its own `CNAME`, `.nojekyll`). `npm run check:surfaces` greps both bundles to prove neither carries the other. The deploy workflow publishes `dist/` to this repo's Pages and the `deploy-staff` job commits `dist-staff/` to `chris-88/q3-interiors-staff` (`main`, root; deploy key in the secret `STAFF_DEPLOY_KEY`; never a force-push), whose Pages serves `staff.q3interiors.ie`. Absolute URLs: `SITE_URL` (customer) and `STAFF_URL` (staff alerts, account emails, the Google Calendar return) in `supabase/functions/_shared/site.ts`.

Staff app (PWA, staff build only; the customer build has no manifest and no service worker): `scripts/staff-site-files.cjs` writes `dist-staff/manifest.webmanifest` ("Q3 Interiors Staff", "Q3 Staff", standalone, start URL and scope `/`, white), copies the icons from `staff-pwa/` (192, 512, maskable 512 with the Q at 40% of the tile, apple-touch; rendered by `npm run brand:images`), and generates `dist-staff/sw.js`.

- Caching rule: the worker precaches this build's own files (the app shell) and nothing else. It never intercepts another origin, so every request to the API, storage or Google goes to the network and no customer data is ever cached. Page loads go to the network first; the cached shell only when offline, and the console then shows "You're offline" instead of any data.
- Updates: a new worker installs and takes over at once (`skipWaiting` + `clients.claim`), old shell caches are deleted, and the open page shows "A new version of the staff console is ready. Reload." It checks for updates when the app comes back to the foreground and every 30 minutes. If a deploy removed a chunk an old page still needs, the page reloads (`vite:preloadError`) rather than going blank.
- "Install the app" (Settings): the browser's install prompt where there is one; on an iPhone the Share > Add to Home Screen instruction; hidden when already installed.

The public host is `https://book.q3interiors.ie` (Cloudflare zone `q3interiors.ie`, proxied CNAME to GitHub Pages; `public/CNAME` and the Pages custom domain match it; HTTPS is Cloudflare's, so GitHub's enforce-HTTPS is not used). The old host `q3.chrisquinn.ie` redirects to it at Cloudflare. The API stays at `https://api.chrisquinn.ie/q3-interiors`; its gateway reflects the request origin for CORS.

Customer-facing business values live in the database (Business details, below); unset values are not shown, so nothing unconfirmed is claimed.

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

- Staff sign in with email and password (Supabase Auth). Being in `auth.users` is not enough: an active `staff` row is required. Admins add people in Settings > People (the `staff-accounts` function); no migration ever inserts people (no personal data in the repo).
- The first admin was created on 2026-11-20 through the GoTrue admin API; its password is in pass at `infra/q3-interiors/STAFF_ADMIN_PASSWORD`.
- Public sign-up is disabled on the stack (`DISABLE_SIGNUP=true`, infra `17c4c11`).

## Booking (slice 2)

Flow: `submit_enquiry_with_access` (anon) returns the reference plus an access token (32 random bytes; only its SHA-256 is stored, in `private.enquiry_access_tokens`, 30-day expiry; a retry with the same idempotency key returns the same reference and a fresh token for the same enquiry). The app goes straight to `/#/book/<token>`. `submit_enquiry` is unchanged for older clients.

Edge Functions (source of truth `supabase/functions/`, deployed with `npm run functions:deploy`):

| Function                | Auth                                                                           | What                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `public-booking`        | anon key (router JWT check) + enquiry token in the body                        | `context`, `availability`, `site_details`, `book`, `status`, `request_contact`, `move_options`, `reschedule`, `cancel`            |
| `calendar-admin`        | signed-in staff (GoTrue `/user` + `staff` row)                                 | `start` (Google consent URL, PKCE, state), `test`, `disconnect`                                                                   |
| `google-oauth-callback` | none: listed in `FUNCTIONS_PUBLIC`; authorised by a single-use 10-minute state | exchanges the code, stores the AES-GCM-encrypted refresh token, redirects to `https://staff.q3interiors.ie/#/settings?calendar=…` |
| `staff-booking`         | signed-in staff (GoTrue `/user` + `staff` row)                                 | `move_options`, `reschedule`, `cancel` for any booking (no cut-off)                                                               |
| `booking-worker`        | anon key + `x-worker-secret`                                                   | retries due calendar jobs and emails; pg_cron calls it every minute via pg_net (`private.kick_worker`, secrets in Vault)          |

Pure logic lives in `supabase/functions/_shared` and is unit-tested with Vitest (`slots.ts`, `calendar-job.ts`, `email.ts`, `public-booking.ts`; fakes in `_shared/testing/fakes.ts`). `db.ts` and `runtime.ts` are Deno-only and checked with `npm run functions:check`.

Rules that matter:

- Slots = working hours (the appointment itself; buffers may fall outside) minus Google free/busy minus live bookings' buffered ranges, honouring notice, horizon (local days, today included) and the on-site daily limit. All local times are Europe/Dublin; storage is UTC. A failed free/busy is "unavailable", never "free": the customer gets "ask us to contact you" (`enquiries.contact_requested_at`), staff see it.
- `private.reserve_booking` is the race guard: exclusion constraint `bookings_no_overlap` (staff + buffered `tstzrange`, live states only), one live booking per enquiry, idempotency key, and an advisory lock per staff and day for the visit limit. Eligibility is decided in one place: `public.enquiry_booking_eligibility`.
- Booking states: `reserved` (held, nothing sent to Google) → `calendar_pending` → `confirmed` | `failed` (slot released); `cancelled` is for slice 3. Enquiry status is separate.
- Calendar event ids are fixed before the first attempt (`q3` + booking uuid hex). Every attempt reads the event first and only inserts if it is absent; a 409 is resolved by reading. A timeout after an insert sets `integration_jobs.outcome_unknown`. Backoff 30 s → 1 h, 8 attempts; an auth failure marks the calendar disconnected and retries every 15 minutes; reconnecting makes queued jobs due at once.
- Emails go through `communications` (dedupe key `booking_confirmation:<booking id>`, also sent as Resend's `Idempotency-Key`). Reserved test domains (`example.com`, `*.invalid`, `*.test`) are recorded as failed and never sent. Sender: `Q3 Interiors <bookings@q3interiors.ie>` (stack env `Q3_EMAIL_FROM`; the `q3interiors.ie` domain is verified at Resend). Customers are never Google attendees.
- Scopes: `openid email calendar.freebusy calendar.events.owned` (checked against Google's docs 2026-11-20). A Google app in Testing mode expires refresh tokens after 7 days: reconnect from Settings (one click; `prompt=consent` always returns a new refresh token).

Stack wiring (infra repo, `stacks/q3-interiors/`): `docker-compose.q3-interiors.yml` passes `FUNCTIONS_PUBLIC`, `GOOGLE_CLIENT_ID/SECRET`, `TOKEN_ENCRYPTION_KEY`, `WORKER_SECRET`, `SMTP_PASS` (Resend key) and URLs to the functions container; `volumes/functions/main/index.ts` (the router) skips JWT verification for names in `FUNCTIONS_PUBLIC`. Secrets live in pass under `infra/q3-interiors/`. After adding or changing one: `~/code/infra/scripts/render-env q3-interiors && cd ~/code/infra/stacks/q3-interiors && sudo docker compose up -d functions`. Vault secrets for the cron worker: `npm run functions:secrets`.

## Changes, reminders and outcomes (slice 3)

- Cancel and reschedule go through `private.cancel_booking` / `private.reschedule_booking`, called by `public-booking` (customers, only before the cut-off in `booking_settings.change_cutoff_minutes`) and `staff-booking` (staff, no cut-off). Both are one transaction each. A reschedule keeps the booking id and its calendar event id and runs under the same `bookings_no_overlap` constraint: a lost race returns alternatives and keeps the old time. Repeating a reschedule to the same time is a no-op; cancelling twice is a no-op.
- Google follows through `integration_jobs` of kind `update_calendar_event` / `delete_calendar_event` (at most one open job of each kind per booking). Each attempt reads the event first; an update patches start/end only if they differ, and finishes only if the booking still has the time it wrote. After retries, a failed update sets `bookings.calendar_mismatch` (needs attention) and the database time stays the truth. A create job for a booking cancelled meanwhile queues a delete.
- Reconcile (flag only): every worker run checks up to 10 upcoming confirmed bookings (each at most every 30 minutes) against Google and writes "Event deleted / moved in Google Calendar" to `calendar_mismatch`. It never changes the booking.
- Reminders: one email, `booking_settings.reminder_lead_minutes` before the start (placeholder 24 h). Planned in `_shared/rules.ts` (`planReminder`): none if the time was chosen inside the lead time, none once started, a missed one goes straight away. Stored with dedupe key `booking_reminder:<booking>:<start epoch>`, so exactly once per booking and start; a reschedule skips the old one and plans a new one; a cancel skips it; the worker re-checks before sending (`staleReason`). A new lead time applies to bookings made or moved after the change.
- Messages: confirmation, reminder, new time and cancellation. **All customer wording is in `supabase/functions/_shared/messages.ts`** (placeholder). Each email carries a fresh 30-day "Change or cancel" link (`/#/book/<token>`), minted at send time; tokens are never logged. Messages made obsolete are marked `skipped`, not sent.
- Outcomes: staff mark a past confirmed appointment attended or no-show (`public.set_booking_attendance`) and record won (optional quoted value) or lost (reason from a fixed list plus free text; `other` needs text) with `public.set_enquiry_outcome`. The outcome is a separate field from `enquiries.status` on purpose (handling status vs commercial result); both write to `enquiry_events`.
- Report: `public.funnel_report(from, to)` (staff only, security definer with an `is_staff()` check) groups enquiries submitted in the Irish date range by `utm_campaign` (`(unknown)` when untagged). Booked = an appointment that reached confirmed (even if later cancelled). Rates are computed in `src/lib/funnel.ts`.

## Pre-pilot hardening (slice 4 part A)

- **Limits** (per client address per hour; values in `public.booking_settings`, changed with SQL only): `enquiry_limit_per_hour` 5 (in `submit_enquiry_with_access`), `booking_write_limit_per_hour` 20 (public-booking `book`, `reschedule`, `cancel`, `request_contact`, `site_details`), `booking_read_limit_per_hour` 300 (the other actions). The address is `cf-connecting-ip` (Cloudflare; the origin is tunnel-only), else the first `x-forwarded-for` hop, else one `shared` bucket. Only an HMAC-SHA256 of it is stored (`private.rate_limit_hits`, key = the worker secret, in Vault for SQL and `Q3_WORKER_SECRET` for the functions; `limits.test.ts` pins parity). A retry with the same idempotency key is never counted twice; an unknown token is refused before the limiter (no row). Rows are purged hourly (`q3-purge-rate-limits`), so none live past 25 hours. A limited customer sees "Please try again later" (`src/components/trouble-message.tsx`). To clear a bucket by hand: `delete from private.rate_limit_hits where addr_hash = private.address_hash('<address>')`.
- **Honeypot**: an off-screen, `aria-hidden`, `tabIndex=-1` "Website" field on the contact step (`p_trap`). Filled: a normal-looking reference, no enquiry, no alert (the attempt still counts against the address).
- `submit_enquiry` is no longer callable by anon; every submission goes through the limit.
- **Staff alerts**: `staff_new_enquiry` and `staff_callback_request` messages, one per enquiry and staff member (dedupe key), sent by the worker to every `staff` row's auth email. Subject: reference and project type only. Wording in `messages.ts`.
- **Graceful failure**: submit and booking errors keep the answers, retry with the same key, and show contact details from `src/config/business.ts` (left out while they are null placeholders).
- **Uptime**: `.github/workflows/uptime.yml` every 15 minutes (site shell, `api.chrisquinn.ie/health`, gateway 401, a rolled-back invalid submission, a malformed public-booking call). No personal data, no rows. A failed scheduled run emails the repo owner.
- **Deletion**: staff "Delete this enquiry" (detail page, typed reference) calls `public.delete_enquiry`; `private.delete_enquiry_data` queues any Google events in `private.pending_event_deletions` (removed by the worker; stuck ones show in needs attention), logs `public.deletion_log` (reference, reason, who, when; no personal data) and deletes the enquiry with everything attached.
- **Retention**: `booking_settings.retention_months`, NULL = off (the default; Chris has not chosen a period). `q3-retention` runs `private.run_retention()` daily at 03:15 and deletes enquiries older than that, except those marked won, through the same deletion path. Settings shows the field and `retention_preview()`.

## Admin set-up (slice 5)

Pilot inputs go in through Settings, not code. Settings is split: everyone sees their Google Calendar and the booking hours; admins also get links to People, Business details, Wording, Campaigns, Go-live checklist and Booking rules and data (`/#/settings/<people|business|wording|campaigns|checklist|booking>` on the staff console).

Roles (`staff.role`, enforced by RLS, security-definer checks and the functions; the screens only explain):

|                                                                                                                                                                                   | staff | admin                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------- |
| Enquiries, appointments (move, cancel), outcomes, status, report funnel                                                                                                           | yes   | yes                             |
| Own Google Calendar connection; own availability                                                                                                                                  | yes   | yes (and anyone's availability) |
| People, who takes bookings, business details, wording, appointment types, change/reminder rules, retention, request limits, delete enquiry, campaigns, spend and costs, checklist | no    | yes                             |

- A deactivated person (`staff.active = false`) keeps their row; `is_staff()` is false for them, so every read and action stops at their next request, they get no alerts, and the staff-accounts function also bans them in GoTrue. Guards: never the last active admin, never the person who takes bookings (choose someone else first), never yourself.
- Staff accounts: the `staff-accounts` Edge Function (service key from the container env `SUPABASE_SERVICE_ROLE_KEY`, never in a browser) adds, deactivates/reactivates, re-roles and sends password links; `set_password` (any active staff session) enforces 12 to 72 characters; `forgot` answers the same for any address and is limited per address (`password_reset` bucket). Invite and reset emails go through `communications` (`staff_invite`, `staff_password_reset`); the worker asks GoTrue's `generate_link` for a recovery token hash at send time (nothing usable is stored) and links to `https://staff.q3interiors.ie/#/set-password?token_hash=...&type=recovery`, which calls `verifyOtp` once and removes the token from the address bar.
- Who takes bookings: `booking_settings.bookable_staff_user_id`, set with `set_bookable_staff()` (admins). New bookings use that person's availability and calendar; existing bookings keep their `staff_user_id` (and calendar) for moves, cancellations, reminders and reconcile. A person with no connected calendar means customers get the call-back path. Appointment types (lengths, buffers) are business-wide.
- Business details: `business_details` (one row; NULL = not confirmed and never shown). Public pages read `public_business_details()` (only public fields, the privacy-review flag and the retention period) and keep the last copy in localStorage (`q3.business.v1`) for the failure state; a first-time visitor who cannot reach the server sees no contact line. The functions read the ring-us phone from here.
- Wording: each email is a fixed structure (greeting, date and time, where, reference, Change-or-cancel button, privacy link, plain-text part) with named text blocks (`WORDING` in `supabase/functions/_shared/messages.ts`). Only changed blocks are stored (`message_blocks`); reset deletes the row. Blocks are plain text, escaped, length-checked and limited to their tokens (`{first_name}`, `{event}`); an invalid stored block falls back to the default. The visit disclaimer on the booked page comes from `public_wording()`. What-to-prepare stays on `appointment_types`.
- Campaigns: `campaigns` (slug = `utm_campaign`), `campaign_creatives` (slug = `utm_content`; own rows so an ad can attach later), `campaign_spend` (euro cents per day, admin-only). The link builder (`src/lib/campaigns.ts`) puts the tags before the `#` for `SITE_URL`. A slug is locked once a link was copied or tested (`link_used_at`) or an enquiry carries it. `campaign_costs()` feeds the report's spend and cost per enquiry/booked/won (admins); no spend shows as "No spend entered".
- Go-live checklist: `go_live_checklist()` computes what it can; admins tick the rest (`setup_ticks`), mark the connected Google account as the test account (`setup_state.test_calendar_email`, via `mark_test_calendar()`), and mark the privacy notice reviewed (`business_details.privacy_reviewed_at`, only once legal name, address and privacy contact are set; removes the public "Draft" marker). Logic in `src/lib/checklist.ts`.
- Request limits (`booking_settings.*_limit_per_hour`) are editable by admins within database bounds (1-100, 5-500, 50-5000).

## Ad studio (slice 6, part A: still ads)

Chris dictates an ad in a Claude session in this repo; the project skill `.claude/skills/q3-ad/SKILL.md` builds it with the kit, renders it, and publishes it to the staff console (Ads), where staff preview each size, download the image and copy the caption, headline, button label and tagged link.

- Kit (committed): `ads/kit/` (`ad.css` tokens, Roboto, placement classes and `.safe` areas; `templates/type-only/`; `RULES.md`). Sizes and Meta's covered areas: `src/lib/ads/spec.ts`, sources in `docs/instagram-ad-specs.md`. Every ad is built at feed 4:5 (1440 x 1800) and Stories/Reels 9:16 (1440 x 2560); square only on request.
- Working files and handed-in assets: `ads/work/<ad>/` (gitignored). Ads are never committed to this public repo.
- `npm run ad:render -- ads/work/<ad> [--guides]`: inlines `kit:` and local references, refuses any file that would still reach the network (or has scripts), and renders each PNG with Playwright from the exact HTML that is published (network blocked, size checked, 30 MB limit).
- `ad:publish`, `ad:requests` and `ad:pull` talk to the stack's own gateway on this machine (`http://localhost:8003`, override with `Q3_STACK_URL`), never through Cloudflare; if it is not answering they stop with a message and never fall back to the public URL with the service key.
- `npm run ad:publish -- ads/work/<ad>`: renders, then uploads the HTML and PNGs and creates `ads`, `ad_versions` (version 1) and `ad_variants`. It reads the service role key with `pass show infra/q3-interiors/SERVICE_ROLE_KEY` for that run only; the key is never written, printed, or anywhere a browser can reach. A failure undoes what was created.
- Storage rule: ad files live only in the private `ads` bucket (no public URLs, no anonymous access). Active staff read them through the storage API with their own session (policy "staff read ad files"); only the service role writes. Tables: staff read, nobody else; writes only by the publish command. Status: `new | changes_requested | approved | archived` (part A sets `new`; part B adds edit requests, approval and versions).
- Preview isolation: the staff console fetches the HTML as text and shows it as `srcdoc` of an iframe with `sandbox=""` (no scripts, opaque origin: it cannot read the page, its storage or the session), with a Content-Security-Policy meta injected as the first thing in `<head>` (`default-src 'none'`; data: images, fonts and media only). Downloads fetch the stored PNG with the staff session and save it as `q3-<name>-v<version>-<ratio>-<w>x<h>.png`.

### Review loop (part B)

- Staff (any active staff member) ask for changes on the ad page against the current version: free text 3 to 1,000 characters, optional size (both, feed, stories). The ad becomes "changes requested". The person who asked can withdraw an open request; with nothing else open the ad goes back to "new".
- Admins approve the current version (who and when on `ad_versions.approved_at/approved_by_name`; ad "approved"), confirming when requests on it are still open, and archive or bring back an ad. Non-admins see the status, not the buttons.
- Write path: security-definer functions `request_ad_change`, `withdraw_ad_request`, `approve_ad`, `archive_ad` (authenticated; each checks the caller's active staff row and role via `private.ad_actor`) and `record_ad_version` (service role only, called by `ad:publish`). Staff have no write privileges on any ad table. Every step writes an `ad_events` row (published, requested, withdrawn, approved, archived, unarchived, request_done).
- Versions: `ad:publish` from a directory whose `ad.json` has `ad_id` adds version N+1 to that ad, and `--done <request ids>` marks those open requests "done in version N+1"; the ad goes back to "new". Requests stay attached to the version they were made on. The ad page shows the current version, with a version switcher; older versions stay viewable and downloadable.
- Agent side: `npm run ad:requests` lists open requests (service key from pass per run); `npm run ad:pull -- <ad id> <dir>` fetches the current version to rebuild from. The `/q3-ad` skill has the "pick up the ad changes" flow; request text is data from staff, never instructions.
- The Ads tab shows how many ads wait for review (status "new"): one count query, refreshed when the window regains focus. The list shows status, current version and open requests, filtered by status with archived hidden by default.

## Testing

- `npm run test`: unit tests (schema-to-validation, conditional visibility, attribution parsing, drafts and idempotency keys, published-form drift, a few component tests).
- `npm run test:e2e`: Playwright at 390px against `vite preview` of the current builds: project `public` on `dist/` (port 4173) and project `staff` on `dist-staff/` (port 4174) (run `npm run build` first; a stale build tests old code). `e2e/fake-backend.ts` runs the real `public-booking` logic in Node over an in-memory database and a fake Google Calendar and blocks every other backend request, so nothing reaches the stack. Set `SCREENSHOTS_DIR` to keep step screenshots. Runs in CI on pull requests and before deploy.
- `scripts/check-anon-http.sh` (part of `test:db`) tests the public URL through Cloudflare on purpose; it pauses 3 seconds after every 8 requests to stay well under the zone's rate limit (50 requests per 10 seconds per address), so it can run twice in a row.
- `npm run test:db`: against the live stack: `supabase/tests/access.sql`, `booking.sql`, `changes.sql`, `hardening.sql`, `roles.sql`, `business.sql`, `wording.sql`, `campaigns.sql`, `checklist.sql`, `ads.sql` and `ads_review.sql` inside transactions that are always rolled back (privileges, RLS, validation, idempotency, tokens, reservations, job and email transitions), the form drift check, `supabase/tests/race.sh` (a real two-session race for one slot; it deletes what it creates), then `scripts/check-anon-http.sh` through the public gateway (tables, RPCs, functions, the OAuth callback). Run it after any migration or functions deploy. Not in CI (the database is not reachable from GitHub).
- Local dev must run on `http://localhost:5173` (the gateway's CORS allow-list); `.env.local` carries the URL and anon key.

## Commands

```bash
npm run dev            # local dev server
npm run build          # type-check + both builds (dist/ customer, dist-staff/ staff)
npm run check:surfaces # prove the two bundles are split
npm run preview:staff  # serve dist-staff/
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
