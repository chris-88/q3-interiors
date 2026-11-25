---
name: q3-ad
description: Build a Q3 Interiors Instagram ad from Chris's dictation and publish it to the staff console. Use when Chris describes an ad he wants ("make an ad that says...", "an Instagram ad for...", "/q3-ad"), hands in photos for an ad, or asks to republish an ad. Still ads only for now (no animation or video).
---

# Q3 ad: from dictation to the staff console

You are in the `q3-interiors` repo. Chris dictates an ad; you build it with the ad kit, show him the rendered images, publish it, and staff review it at https://staff.q3interiors.ie/#/ads. Ads are **not** committed to this public repo.

## Read first

- `ads/kit/RULES.md`: the rules every ad follows. Short; read it every time.
- `ads/kit/ad.css`: brand tokens, Roboto, the placement classes and the `.safe` area.
- `ads/kit/templates/type-only/`: starting layouts for the two sizes.
- `docs/instagram-ad-specs.md`: Meta's sizes and covered areas, with sources.

## The two sizes (every ad)

| File            | Class             | Size                                 | Keep text, logo and key content inside `.safe`                 |
| --------------- | ----------------- | ------------------------------------ | -------------------------------------------------------------- |
| `portrait.html` | `ad ad--portrait` | 1440 x 1800 (feed 4:5)               | 6% margin all round                                            |
| `vertical.html` | `ad ad--vertical` | 1440 x 2560 (Stories and Reels 9:16) | 358 px clear at the top, 896 px at the bottom, 86 px each side |

Add `square.html` (`ad ad--square`, 1440 x 1440) and `"square"` in `sizes` only if Chris asks for square.

## Steps

1. **Pin down the ad with Chris** in a sentence or two: the headline, one supporting line, the action, and whether it belongs to a campaign creative (Settings > Campaigns on the staff site; you need both slugs). If he asks for anything the site cannot back up (prices, dates, areas, reviews, credentials), say so and leave it out unless he confirms it is true and approved.
2. **Make the working directory** (gitignored): `ads/work/<short-slug>/`. Copy the two templates in:
   `cp ads/kit/templates/type-only/*.html ads/work/<slug>/`
3. **Assets**: photos Chris hands in go in `ads/work/<slug>/assets/` (JPG, PNG or WebP). Use only approved Q3 project photos; until there are some, ads are type-only. Refer to them as `assets/name.jpg`; logo and fonts as `kit:wordmark-black.svg`, `kit:wordmark-white.svg`, `kit:q-black.svg`, `kit:q-white.svg`. Never link anything on the web: rendering refuses it.
4. **Write the words** into both HTML files, keeping the kit's classes (`ad-headline`, `ad-line`, `ad-kicker`, `ad-wordmark`, `ad-rule`). Sentence case, Irish English, black and white. Black background: add `ad--dark` and use the white wordmark. Keep each file to one `<main class="ad ad--...">`. No scripts.
5. **Write `ads/work/<slug>/ad.json`**:
   ```json
   {
     "name": "Spring kitchens: Planning a home renovation?",
     "caption": "The post text, up to 2,200 characters; the first 125 matter most.",
     "headline": "Up to 40 characters",
     "button_label": "Learn more",
     "campaign": "spring-kitchens",
     "creative": "reel-1",
     "sizes": ["portrait", "vertical"],
     "notes": "Anything staff should know when reviewing."
   }
   ```
   `campaign` and `creative` are optional (both or neither). `button_label` is one of Instagram's buttons, usually "Learn more" or "Contact us".
6. **Preview locally**: `npm run ad:render -- ads/work/<slug> --guides`. It inlines everything, checks the files, and writes `out/portrait.png`, `out/vertical.png` and `.guides.png` copies with the covered areas shaded red. Look at the guides images (Read them); nothing that matters may sit in the red. Fix and re-run until clean. Errors name the file and the problem.
7. **Show Chris** the two plain PNGs (`out/portrait.png`, `out/vertical.png`) and the caption, headline and button label. Change what he asks; re-run step 6.
8. **Publish** once Chris is happy: `npm run ad:publish -- ads/work/<slug>`. It re-renders, reads the service key from `pass` for that run only (never print it, never write it anywhere), uploads the HTML and PNGs to the private `ads` bucket, and creates the ad, version 1 and its variants (status "New"). If anything fails it undoes what it did.
9. **Tell Chris**: the ad's name, that it is on the staff site under Ads (https://staff.q3interiors.ie/#/ads) as "New", that staff can preview each size there, download the images and copy the caption, headline, button label and tagged link, and whether it has a tagged link (only if it was linked to a campaign creative).

## Do not

- Do not commit anything under `ads/work/`, and do not put ad files anywhere else in the repo.
- Do not change the wordmark artwork, the colours or the kit to suit one ad; raise it with Chris instead.
- Do not publish an ad Chris has not seen, and do not publish duplicates: a change after publishing is a new ad for now (part B adds versions and edit requests).
- Do not sign in to the staff site or touch other live data.
