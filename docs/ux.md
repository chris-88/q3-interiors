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
| `won`                           | Won                        | Deposit                                         | Finished           | none                                       | none                  | Correct the result                                                                                                                                      |
| `lost`                          | Lost                       | none                                            | Finished           | none                                       | none                  | Correct the result                                                                                                                                      |
| `closed`                        | Closed (not suitable)      | none                                            | Finished           | none                                       | none                  | Correct the result                                                                                                                                      |
| any value a newer release wrote | its raw label              | none                                            | Your move          | none                                       | Ring                  | Email                                                                                                                                                   |

**Rules:**

- **First match wins**, in the order `enquiryStage` checks: outcome, then an appointment still to come, then a missed appointment, then the estimate and quote, then a held call, then status. An appointment still to come is never hidden.
- **Working days** are Monday to Friday in Europe/Dublin, counted from the next day. One function computes them: `addWorkingDays` in TypeScript, mirrored by `private.add_working_days` in SQL. Public holidays are not modelled yet.
- **Urgency:** overdue once the due day has passed; today on the day; later before it; neutral for a diary time or a good-until date.
- **Not built yet:**
  - A chase schedule (Visit link sent and Contacted wait with no date).
  - The estimate's 10-day clock pausing once a visit is booked (decision Q4).
  - Deposit received.

## 2. The strip is the record, not the stage

`stripSteps()` draws the five steps from what actually happened:

| Step       | Done when                                                    |
| ---------- | ------------------------------------------------------------ |
| Call       | a call was held (marked attended, or recorded as held early) |
| Site visit | a site visit was marked attended                             |
| Estimate   | an estimate was sent                                         |
| Quote      | a quote was sent or recorded                                 |
| Deposit    | won                                                          |

- **"Now"** is the stage's step while the enquiry is open. It is boxed, bold and labelled "now".
- **"Skipped"** is a step before the furthest step reached that never happened. It is drawn dashed and labelled "skipped". A skipped step never shows as done.
- **Lost or closed** keep what was done and have no "now".

## 3. Patterns

### The list

- **Groups:** Your move (overdue first, then oldest due), In the diary (next first), Waiting on them (soonest good-until first, undated last). Each group shows its count. Finished sits behind a link.
- **Rows** are two lines and at least 64px tall:
  - Line 1: the name and the due chip.
  - Line 2: the news and the job type.
- Nothing that matters is cut off at 390px.
- **Due chip:** filled when overdue or due today, outlined when later, grey for a diary time or a good-until date. Overdue is said in words ("Overdue · Ring, due Tue 24 Nov"), never by colour alone.

### The enquiry page

- **Order:** header (name, then job type and address), strip, Call / Email / Directions, the now card, the action bar, then the folds.
- **Now card:** read-only. It shows:
  - whose move it is
  - what, as the primary action's title or the appointment
  - when, as a due line
  - the call-back reason or the customer's words on a change, when there are some
  - "Estimate started, not sent (saved on this phone)" when a draft is waiting on this device
- **One primary action.** Exactly one filled button on screen: the bar's.
  - Buttons inside folds are outlined.
  - A form opened from a sheet row leads with its own filled button.
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
- **Frame:** `TaskFrame` gives "Back to {name}", "Step 1 of 2: the estimate", the title, one line on what the task is for and, for a draft, "Saved on this phone until you send it."
- **Bar:** the task's own action sits in the bar (`TaskBar`). The stage's bar is never shown during a task.
- **Two steps for anything sent:**
  1. The form. The first field takes focus. The estimate's plus or minus are chips (5, 10, 15, 20 %, Other), and its range sits on one line.
  2. "Check and send": the email or document exactly as it goes (To, Subject or good-until), and one button that names the person ("Send to Brian"). That button is the confirmation; there is no separate dialog.
- **Afterwards:** a send or a booking returns to the enquiry page with a line on what happened ("Estimate sent to … The email goes within a minute.").
- **Drafts:**
  - Kept per enquiry in this browser only (`src/lib/task-draft.ts`) until sent, and never sent to the server.
  - Each draft records the estimate or quote it was started on, so one started before another went out is dropped.
- **One document viewer:** `DocumentViewer` shows the estimate email, the quote and its PDF in a sandboxed frame, with the lines on who it goes to and Download PDF when stored.

### Confirming

- `Confirm` is the one confirm component for actions with no Check-and-send step (a booking link, We already spoke, a destructive row).
- It names the action, says what will happen, takes focus and keeps its error beside it.

## 4. The floor every screen keeps

- **Width:** phone-first at 390px with no horizontal scroll, checked by the e2e screenshot helper. 1280 is checked too.
- **Accessibility:** WCAG 2.2 AA:
  - Targets at least 48px, sheet rows at least 56px.
  - Visible focus: 3px black, offset 3px.
  - Focus moves into and back out of sheets.
  - Errors are written beside their field with `role="alert"`, and the first invalid field takes focus.
- **States:** loading, error (with Try again) and empty for every read.
- **Data:** tolerant reads. An unknown stage, value or kind renders plainly ("This was set by a newer version of the console. Reload to change it here.") instead of failing.
- **No new server action for a screen change.** Every redesign PR reused the existing ones.

## 5. Taps, as measured at 390 x 844

| Flow                             | Before the review | After PR B | After PR C | After the task screens |
| -------------------------------- | ----------------- | ---------- | ---------- | ---------------------- |
| Site visit over to estimate sent | see the review    | 6          | 4          | 4                      |
| Quote requested to quote sent    | see the review    | 3          | 3          | 3                      |

Taps exclude typing and ticks in the form itself.

**Site visit over to estimate sent:** How did it go?, It went ahead (the estimate screen opens in the price), Check and send, Send to {name}.

**Quote requested to quote sent:** Write the quote, Check and send, Send to {name}.
