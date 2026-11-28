# Staff console UX: the stage model and the patterns as built

This is the standard that later staff screens are graded against. It describes what the Enquiries list, the enquiry page and its task screens do as of the 2026-11-30 redesign (UX review 1, slices 2 to 5: PRs #63, #64, #65 and the task-screen PR). The code is the source of truth. If a screen and this page disagree, fix whichever one is wrong in the same change.

## 1. One stage model

Every enquiry has exactly one stage, worked out in the browser by `stageOf()` in `src/lib/enquiry-stage.ts`. The list groups, the list rows, the strip, the now card, the action bar and the sheet all read it. Screens never work out a stage of their own.

`stageOf()` returns:

- `key` and `label`
- `step`: the place on the strip
- `whose`: whose move it is, which sets the list group
- `due`, `urgency` and `chip`
- `news`: what happened, one line
- `primary`: the one primary action
- `others`: the other actions
- `next`: the next appointment

| Stage (`key`)                   | Label                      | Step                                            | Whose move / group | Due date                                   | Primary action        | Other actions                                                                                                                                           |
| ------------------------------- | -------------------------- | ----------------------------------------------- | ------------------ | ------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new`, `in_review`              | New / In review            | Call                                            | Your move          | Day of the enquiry                         | Ring {first name}     | How did it go?, Book a call, Email, Record a quote or result, Not suitable                                                                              |
| `contact`                       | Call back                  | Call                                            | Your move          | Day of the call-back request               | Ring {first name}     | as for New                                                                                                                                              |
| `contacted`                     | Contacted                  | Call                                            | Waiting on them    | none                                       | Book a call           | Ring, How did it go?, Email, Record a quote or result, Not suitable                                                                                     |
| `booked`                        | Booked                     | the appointment's own step (Call or Site visit) | In the diary       | the appointment's time                     | (bar: Move or cancel) | Move or cancel, Cancel the appointment, and How did it go? for a call                                                                                   |
| `to_record`                     | How did it go?             | the appointment's step                          | Your move          | the appointment's day                      | How did it go?        | Move or cancel, Record a quote or result                                                                                                                |
| `missed_call`, `missed_visit`   | Missed call / Missed visit | Call / Site visit                               | Your move          | the appointment's day                      | Ring {first name}     | call: Book a call, Email, Not suitable · visit: Book the site visit, Send a booking link, Email, Not suitable                                           |
| `call_held`                     | Call held                  | Call                                            | Your move          | the day of the call                        | Choose the next step  | Book the site visit, Send a booking link, Write the estimate, Record a quote or result, Not suitable                                                    |
| `link_sent`                     | Visit link sent            | Site visit                                      | Waiting on them    | none                                       | Book the site visit   | Send a booking link, Write the estimate, Ring, Record a quote or result                                                                                 |
| `awaiting_quote`                | Estimate to write          | Estimate                                        | Your move          | the visit's day                            | Write the estimate    | Book the site visit, Record a quote or result, Not suitable                                                                                             |
| `estimate_sent`                 | Estimate sent              | Estimate                                        | Waiting on them    | good until (10 days after sending)         | Ring                  | Write the quote, Send an updated estimate, Record a quote or result, Mark lost                                                                          |
| `no_answer`                     | No answer in 10 days       | Estimate                                        | Your move          | the estimate's good-until date             | Ring                  | as for Estimate sent                                                                                                                                    |
| `quote_requested`               | Quote to write             | Quote                                           | Your move          | 3 working days after the ask               | Write the quote       | Record a quote or result, Send an updated estimate, Mark lost                                                                                           |
| `change_requested`              | Change asked for           | Quote                                           | Your move          | 3 working days after the change request    | Send an updated quote | View or download the quote, Mark won, Mark lost                                                                                                         |
| `quoted`                        | Quote sent / Quoted        | Quote                                           | Waiting on them    | good until (15 working days after sending) | Ring                  | Send an updated quote, View or download the quote, Mark won, Mark lost (Record a quote or result instead of the first two for a quote recorded by hand) |
| `quote_no_answer`               | No answer to the quote     | Quote                                           | Your move          | the quote's good-until date                | Ring                  | Send an updated quote, View or download the quote, Mark won, Mark lost                                                                                  |
| `won`                           | Won                        | Deposit (drawn as "Won")                        | Finished           | none                                       | none                  | Correct the result                                                                                                                                      |
| `lost`                          | Lost                       | none                                            | Finished           | none                                       | none                  | Correct the result                                                                                                                                      |
| `closed`                        | Closed (not suitable)      | none                                            | Finished           | none                                       | none                  | Correct the result                                                                                                                                      |
| any value a newer release wrote | its raw label              | none                                            | Your move          | none                                       | Ring                  | Email                                                                                                                                                   |

**Rules:**

- **First match wins**, in the order `enquiryStage` checks: outcome, then an appointment still to come, then a missed appointment, then the estimate and quote, then a held call, then status. An appointment still to come is never hidden.
- **Working days** are Monday to Friday in Europe/Dublin, counted from the next day. One function computes them: `addWorkingDays` in TypeScript, mirrored by `private.add_working_days` in SQL. Public holidays are not modelled yet.
- **Urgency:** overdue once the due day has passed; today on the day; later before it; neutral for a diary time or a good-until date.
- **Known limits (not built yet):**
  - A chase schedule (Visit link sent and Contacted wait with no date).
  - The estimate's 10-day clock pausing once a visit is booked (decision Q4).
  - Deposit received: nothing records a deposit, so the Deposit step is never done.
  - The Report page is not on `stageOf()`: its funnel counts come from the database functions.
  - Drafts are per device: a draft started on the phone is not on the laptop.
  - Job plans: no dates, no order-by, nothing sent to a tradesperson or supplier, stage templates seeded only (no screen to edit them), prices with no VAT label.

## 2. The strip is the record, not the stage

`stripSteps()` draws the five steps from what actually happened:

| Step       | Done when                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Call       | a call was held (marked attended, or recorded as held early), even if a visit has come since   |
| Site visit | a site visit was marked attended                                                               |
| Estimate   | an estimate was sent                                                                           |
| Quote      | a quote was sent from here or recorded by hand (`quote_amount`), whatever the outcome is now   |
| Deposit    | a deposit is recorded; nothing records one yet, so never. On a win this step is drawn as "Won" |

- **"Now"** is the stage's step while the enquiry is open. It is boxed, bold and labelled "now".
- **"Skipped"** is a step before the furthest step reached that never happened. It is drawn dashed and labelled "skipped". A skipped step never shows as done.
- **Won, lost and closed** keep every step that really happened and have no "now". A win ends on "Won", never on "Deposit" done; a step a won job never went through (no visit, no estimate) shows as skipped.

## 3. Patterns

### The list

- **Groups:** Your move (overdue first, then oldest due), In the diary (next first), Waiting on them (soonest good-until first, undated last). Each group shows its count. Finished sits behind a link.
- **Rows** are two lines and at least 64px tall:
  - Line 1: the name and the due chip.
  - Line 2: the news and the job type; "Draft ·" first when an estimate or quote was started on this device and not sent.
- Nothing that matters is cut off at 390px.
- **Due chip:** filled when overdue or due today, outlined when later, grey for a diary time or a good-until date. Overdue is said in words ("Overdue · Ring, due Tue 24 Nov"), never by colour alone.

### The enquiry page

- **Order:** header (name, then job type and address), strip, Call / Email / Directions, the now card, the action bar, then the folds.
- **Now card:** read-only. It shows:
  - whose move it is
  - what, as the primary action's title or the appointment
  - when, as a due line
  - the call-back reason or the customer's words on a change, when there are some
  - "Estimate started, not sent (saved on this device)" when a draft is waiting on this device
- **One primary action.** Exactly one filled button on screen: the bar's.
  - Buttons inside folds are outlined.
  - A form opened from a sheet row leads with its own filled button.
  - The exception: a selected choice (a ticked work item, the chosen plus-or-minus chip, a chosen time) is drawn filled to show it is selected. It is a state, not an action, and it carries `aria-checked` or `aria-pressed`.
  - While a draft waits, the bar's primary reads "Carry on with the estimate" (or the quote).
- **Action bar:**
  - Below 1024px it is fixed to the bottom, in thumb reach, safe area included.
  - From 1024px it sits under the now card, in the sticky left column.
  - It holds the primary action and "More actions" (just "Actions" when there is no primary).
- **WCAG 2.4.11:** because the bar is fixed, the page sets `scroll-padding-bottom` (the bar plus the safe area) and pads its bottom, so nothing focused sits under it. An e2e test tabs through at 390 x 640, on the enquiry page and on a task screen.
- **Folds:** every other section is one line (title, then a summary such as "Sent 23 Nov · €9,500 to €10,500") that opens in place:
  - Their answers
  - Appointments
  - Estimate
  - Quote
  - Notes and history
  - Details
- **Won and lost** show the result only. Corrections live in the sheet.

### The other-actions sheet

- **Component:** shadcn Sheet on Base UI's dialog.
- **Focus:** lands on the sheet's title, never on the first row (which can be destructive), and goes back to the button that opened it.
- **Size:** the close button is 48px and every row is at least 56px.
- **Rows:**
  - Each row has a title and one line on what it does.
  - Destructive rows are red and confirm inside the sheet.
  - A row opens only its own small form. Mark won is the won form, and saving ends it.
- **Back:** appears only after choosing from the list. A panel opened straight from the bar has no Back.
- **What a row is:** a link (the phone, email or a task screen) or a panel.

### Questions with answers ("How did it go?")

- An outcome is asked as a question with answers. Each answer says what happens next ("Next: ring them, then rebook").
- Answering moves on in place:
  - A visit that went ahead opens the estimate screen.
  - A call that went ahead carries on to "Choose the next step", in this order: Book the site visit (first, filled), Send a booking link, Write the estimate (last).
- **Choices that expand:** an open choice carries `aria-expanded`, a heavier edge and a turned chevron, never only a lighter fill.

### Task screens

- **Routes:** `#/enquiries/:id/estimate`, `/quote`, `/visit`, `/call`.
- **Frame:** `TaskFrame` gives "Back to {name}", "Step 1 of 2: the estimate", the title, one line on what the task is for and, for a draft, "Saved on this device until you send it." From 1024px these and the bar are a sticky left column, so the task's action is always on the first screen.
- **Bar:** the task's own action sits in the bar (`TaskBar`). The stage's bar is never shown during a task.
- **Focus on open:** the first field (the estimate's and the quote's price), else the title (booking a visit or a call).
- **Two steps for anything sent:**
  1. The form. The first field takes focus. The estimate's plus or minus are chips (5, 10, 15, 20 %, Other), and its range sits on one line.
  2. "Check and send": the email or document exactly as it goes (To, Subject or good-until), and one button that names the person ("Send to Brian"). That button is the confirmation; there is no separate dialog.
- **Bookings are deliberately one step.** Booking a visit or a call has no Check and send: picking a time puts it in the bar's button ("Book Wed 2 Dec, 14:00"), so the button itself says what will happen.
- **Afterwards:** a send or a booking returns to the enquiry page with a line on what happened ("Estimate sent to … The email goes within a minute.").
- **Drafts:**
  - Kept per enquiry in this browser only (`src/lib/task-draft.ts`) until sent, and never sent to the server. The words say "this device", never "this phone".
  - Each draft records the estimate or quote it was started on, so one started before another went out is dropped.
  - While one waits: the task screen says "Saved on this device until you send it.", the now card "Estimate started, not sent (saved on this device)", the bar "Carry on with the estimate", and the list row "Draft ·".
- **One document viewer:** `DocumentViewer` shows the estimate email, the quote and its PDF in a sandboxed frame (scripts off), with the lines on who it goes to and Download PDF when stored. The frame takes the document's own height, so the page scrolls, never a box inside it.

### The job plan (a won job's own module)

- **Way in:** a won job's one action is "Open the job plan" (`stageOf()` gives `won` the primary `plan`; it stays under Finished, and nothing in a plan puts a job back in "Your move"). The enquiry page has a "Plan" fold with its summary ("5 stages · 12 items · €3,420", or "Not started").
- **Task screen** `#/enquiries/:id/plan` in the task frame, stacked (the title above the plan at every width, so the table has the room). Not started: the usual stages for the job type, listed, and "Start the plan" in the bar. Started: the job's total, items got and stages done on one line, then the plan; no bar (each stage's "Add item" is the action).
- **390px: stage sections with rows**, never a wide table and never sideways scroll. Each stage: its name, Done, what it has ("2 items · 1 got · €318.25"), the tradesperson, its items (Got it, the name with "12.5 m2 × €24.50", the line total; tap the name to change quantity, unit or price each, or remove), "Add item", and "Change stage" (rename, move up or down, remove with a confirm).
- **From 1024px: one table** with the columns Stage, Item, Qty, Unit, Price each, Total, Got it, Tradesperson. A stage's cell (name, totals, Done, Change stage) and its tradesperson span its rows; the footer is the job total.
- **Recognition over recall:** "Add item" asks the server as he types (every word in any order, or the SKU; six results after a short pause): products he has used on a job first, then his own, then the supplier catalogue. Each result shows its price line ("€12 / bag" for his own, "€12.80 inc VAT · Goodwins" and the category for a catalogue product, "Used before" when it is on a job), then "Add “…” as new", which asks only the price each and unit (supplier optional). A product is never entered twice. Text typed while an item is going in is never cleared.
- **Lists that can be large are paged and filtered on the server**: the Product list shows "Mine and used" by default so the catalogue does not bury his own, with Mine, Used on jobs, each supplier and All; "Show more" loads the next 50; a supplier page opens in a new tab.
- **Picking from a list, or adding in place:** the tradesperson picker lists the people and ends with "Add someone new…", which opens name, trade and phone right there and assigns them on save.
- **Ticks show at once** and say "Not saved" if the write fails.
- **Prices:** "Price each", as paid, no VAT claim (open with Chris). A line keeps the price it was planned at; the product's usual price changes future lines only, and the product screen says so.
- **The lists** (Settings > Job plans > Product list, Tradespeople; linked from the plan): search, change, archive (Show archived to bring one back). Any staff member.

### Confirming

- `Confirm` is the one confirm component for actions with no Check-and-send step (a booking link, We already spoke, a destructive row).
- It names the action, says what will happen, takes focus and keeps its error beside it.

## 4. Rules for any new list or detail screen

- **The default view answers the screen's main question** (for the list: what do I do next; for an enquiry: where are they and what is my move) without a tap or a scroll at 390px.
- **One filled action** per screen, in the bar on phones; everything else outlined, in a sheet, or a link.
- **Disclosures use the Fold look:** one line with a title, a short summary on the right and a chevron, opening in place (`Fold` on the enquiry page). No bespoke accordions.
- **Read the stage model**, never a private copy of the rules; a new stage goes into `stageOf()` and the table above.
- **Focused work gets a task screen** (`TaskFrame`) rather than a form expanding inside a long page.

## 5. The floor every screen keeps

- **Width:** phone-first at 390px with no horizontal scroll, checked by the e2e screenshot helper. 1280 is checked too.
- **Accessibility:** WCAG 2.2 AA:
  - Targets at least 48px, sheet rows at least 56px.
  - Visible focus: 3px black, offset 3px.
  - Focus moves into and back out of sheets.
  - Errors are written beside their field with `role="alert"`, and the first invalid field takes focus.
- **States:** loading, error (with Try again) and empty for every read.
- **Data:** tolerant reads. An unknown stage, value or kind renders plainly ("This was set by a newer version of the console. Reload to change it here.") instead of failing.
- **No new server action for a screen change.** Every redesign PR reused the existing ones.

## 6. Taps, as measured at 390 x 844

| Flow                             | UX review 1 (before) | After PR B | After PR C | After the task screens |
| -------------------------------- | -------------------- | ---------- | ---------- | ---------------------- |
| Site visit over to estimate sent | 5                    | 6          | 4          | 4                      |
| Quote requested to quote sent    | 3                    | 3          | 3          | 3                      |

The tap counts held, but scrolling went: before, both forms opened in long sections that had to be scrolled past to reach Send.

Taps exclude typing and ticks in the form itself.

**Site visit over to estimate sent:** How did it go?, It went ahead (the estimate screen opens in the price), Check and send, Send to {name}.

**Quote requested to quote sent:** Write the quote, Check and send, Send to {name}.
