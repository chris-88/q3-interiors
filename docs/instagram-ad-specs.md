# Instagram ad sizes used by the ad studio

Read from Meta's published Ads Guide on **25 November 2026**. The pages carry no "last updated" date; recheck them before relying on these figures for a new placement. The values in code live in `src/lib/ads/spec.ts`.

| Placement                | Source                                                                                                                     | Figures                                                                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram feed, image    | [Ads Guide: image ad specs on Instagram Feed](https://www.facebook.com/business/ads-guide/update/image/instagram-feed)     | Recommended ratio 4:5, resolution 1440 x 1800 px. JPG or PNG, up to 30 MB, minimum width 500 px. Accepted ratios run from 1.91:1 to 4:5 (1% tolerance). Primary text 125 characters, headline 40 characters, up to 30 hashtags. No covered area is named for the feed. |
| Instagram Stories, image | [Ads Guide: image ad specs on Instagram Stories](https://www.facebook.com/business/ads-guide/update/image/instagram-story) | Ratio 9:16, resolution 1440 x 2560 px. JPG or PNG, up to 30 MB, minimum width 500 px. Leave roughly 14% at the top, 35% at the bottom and 6% on each side free of text, logos and key elements (profile icon and call-to-action button).                               |
| Instagram Reels, image   | [Ads Guide: image ad specs on Instagram Reels](https://www.facebook.com/business/ads-guide/update/image/instagram-reels)   | Ratio 9:16 (1% tolerance), resolution 1440 x 2560 px. JPG or PNG, up to 30 MB, minimum width 500 px. The same 14% top, 35% bottom and 6% sides kept clear.                                                                                                             |

## What the studio builds

- **Feed 4:5** at 1440 x 1800 for every ad. Meta names no covered area, so the kit keeps a 6% margin all round (108 px top and bottom, 86 px sides).
- **Stories and Reels 9:16** at 1440 x 2560 for every ad. Text, logo and key content stay inside the safe area: 358 px from the top, 896 px from the bottom, 86 px from each side.
- **Square 1:1** at 1440 x 1440 only on request. Meta's feed page does not list a square size; 1:1 sits inside the accepted 1.91:1 to 4:5 range, so the studio uses the same 1440 width.
- Exports are PNG and are refused over 30 MB. Headlines are limited to 40 characters; captions show about 125 characters before "more" (Instagram allows 2,200).

Video and animated ads (part C) will need the video pages of the same guide.
