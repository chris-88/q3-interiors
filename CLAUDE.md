# CLAUDE.md

Guidance for the development agent working on this project. Read this fully before making changes, and treat the **Definition of Done** as the bar for every task.

## What this is

Q3 Interiors is a multi-trade renovation contractor. This app is its customer acquisition journey: a homeowner follows a link from Instagram to a mobile enquiry form, the enquiry is saved, and they book a phone consultation or an on-site estimate visit against staff Google Calendars. Staff get an authenticated workspace for enquiries, appointments and outcomes. A separate estimating product will later reuse the enquiry ID.

The scaffold is a hello page with a working Supabase client; no features, pages or tables yet.

| Concern            | Choice                                                                          |
| ------------------ | ------------------------------------------------------------------------------- |
| Build              | Vite + React + TypeScript (strict, `noUncheckedIndexedAccess`, no `any`)        |
| Styling / UI       | Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui (Base UI)                     |
| Routing            | React Router, `HashRouter` (GitHub Pages cannot serve deep links)               |
| Server state       | TanStack Query; Supabase reads/writes through hooks in `src/api/`               |
| Validation / forms | Zod + React Hook Form                                                           |
| Backend            | Supabase project `SUPABASE_REF_PLACEHOLDER` (eu-west-2)                         |
| Tests              | Vitest + Testing Library; Playwright when e2e is warranted                      |
| Lint / format      | oxlint (`jsx-a11y`), Prettier with `prettier-plugin-tailwindcss`                |
| Hosting            | GitHub Pages via GitHub Actions on push to `main`, `q3-interiors.chrisquinn.ie` |
| Node               | `.nvmrc` = 24                                                                   |

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
- Schema changes are SQL migrations (`supabase migration new`, then `supabase db push`). RLS on every table from creation.
- shadcn components land in `src/components/ui/`; check shadcn before hand-building a component.
- Conventional commits, one concern each.

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
npx shadcn@latest add <component>
```

Deploy: push to `main`; GitHub Actions runs the quality gate, builds and publishes.
