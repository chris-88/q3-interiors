# Links from the website into booking

The public website (`https://q3interiors.ie`, its own repo) sends people to the booking site with one entry URL. This is the contract the booking site honours (phase 1, 2026-11-28).

```text
https://book.q3interiors.ie/?appointment=<call|visit>[&inspiration=<slug>][&project_type=<label>][&utm_source=…&utm_medium=…&utm_campaign=…&utm_content=…&utm_term=…]
```

Put the parameters in the real query string, before any `#`, and give no hash route. Parameters inside the hash route (`/#/?appointment=visit`) are read too; a value before the `#` wins.

| Parameter      | Values                                                                                                                                              | What happens                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appointment`  | `call`, `visit` (any case)                                                                                                                          | Opens the Project screen on that route, in the same tab, as the landing choice does. Any other value (or none): the landing page with both choices. The older `type=phone\|on_site` still works.                          |
| `project_type` | A visible label: Kitchen, Bathroom, Several rooms, Whole home renovation, Extension, Attic conversion, Workplace fit-out, Something else (any case) | Pre-selects that card once; the visitor can change it. Anything else is ignored.                                                                                                                                          |
| `inspiration`  | `donabate`, `fairview`, `fitzwilliam-office`, `castleknock`, `fitzwilliam-bathroom`, `adelaide`                                                     | Shows "You were looking at: Kitchen fit-out, Fairview, Dublin 3" with "Back to the project" (`https://q3interiors.ie/our-work/<slug>/`) on the Project screen, and is saved with the enquiry. An unknown slug is ignored. |
| `utm_*`        | as for any campaign link                                                                                                                            | Captured as campaign attribution and kept in the address bar; carried into the enquiry and the landing session.                                                                                                           |

- Once read, `appointment`, `type`, `project_type` and `inspiration` are removed from the address bar (`history.replaceState`), so Back and a reload do not restart the route or re-apply the suggestion. Campaign tags and click ids stay.
- A visitor who arrived with `appointment` (or a known project) sees a quiet "Back to q3interiors.ie" link in the header for the rest of the tab. Someone arriving from an ad at the plain landing page sees no change.
- Never put names, contact details, addresses or free text in a link.
- The projects live in `src/lib/website.ts` (slug, title, location; `WEBSITE_URL`). When the website adds a project, add it there too; until then its slug is ignored.
- The bathroom planner parameters (`plan`, `size`, `finish`, `layout`) are not handled yet and are ignored.
