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
- Still exports are PNG and are refused over 30 MB. Headlines are limited to 40 characters; captions show about 125 characters before "more" (Instagram allows 2,200).

## Video (animated ads)

Read from the video pages of the same guide on **25 November 2026** (no "last updated" date shown).

| Placement                | Source                                                                                                                     | Figures                                                                                                                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram feed, video    | [Ads Guide: video ad specs on Instagram Feed](https://www.facebook.com/business/ads-guide/update/video/instagram-feed)     | MP4, MOV or GIF. Ratio 9:16 recommended, resolution 1080 x 1920 px, 1% ratio tolerance, minimum width 250 px. 1 second to 60 minutes, up to 4 GB. Sound and captions optional but recommended. "Videos should not contain edit lists or special boxes in file containers." No codec or frame rate named. |
| Instagram Stories, video | [Ads Guide: video ad specs on Instagram Stories](https://www.facebook.com/business/ads-guide/update/video/instagram-story) | MP4, MOV or GIF. Ratio 9:16, resolution 1440 x 2560 px. H.264, fixed frame rate (no number given). 1 second to 60 minutes, up to 4 GB. Sound optional but recommended; when present, stereo AAC at 128 kbps or more. Keep roughly 14% top, 35% bottom and 6% sides clear.                                |
| Instagram Reels, video   | [Ads Guide: video ad specs on Instagram Reels](https://www.facebook.com/business/ads-guide/update/video/instagram-reels)   | MP4 or MOV. Ratio 9:16, resolution 1440 x 2560 px. H.264, square pixels, fixed frame rate, progressive scan. 0 seconds to 15 minutes, up to 4 GB. Sound optional but strongly recommended; when present, stereo AAC at 128 kbps or more. The same 14% / 35% / 6% kept clear.                             |

What the studio makes of it (`ad:render` checks every file with ffprobe before it can be published):

- **MP4, H.264** (High profile), `yuv420p`, **30 frames per second, fixed**, progressive, square pixels (1:1), no B-frames and no edit list, `faststart` so it streams. Meta names no frame rate; 30 is the common fixed rate and keeps type motion smooth.
- **Silent, with no audio track.** Every page calls sound optional, so none is added. If Meta ever requires a track, add a silent stereo AAC one at 128 kbps.
- **Sizes:** the same two as the stills, feed 4:5 at 1440 x 1800 and Stories/Reels 9:16 at 1440 x 2560. Note: the feed video page now recommends 9:16 (1080 x 1920) for the feed as well; the 4:5 file is kept because it is the feed's tallest image shape and stays inside Meta's accepted range. The 9:16 file can be used in the feed if Meta's tools ask for it.
- **Length:** a loop of 1 to 15 seconds, a whole number of frames (inside every placement's range: feed and Stories need at least 1 second).
- **File size:** refused over 30 MB, the private bucket's limit (Meta allows 4 GB; a short type-only loop is well under 1 MB).
- **Poster:** a PNG of the last frame (the settled message), used as the still fallback.
