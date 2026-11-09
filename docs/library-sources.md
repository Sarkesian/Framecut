# Library sources: CC0 candidates

Checked 9 November 2026 by fetching each site, its terms and its endpoints. Counts are the providers' own
figures unless a line says otherwise. FrameCut's rule: a source is searched online only if it has a stable,
permitted way to search and download; default results are verified CC0 with no credit needed.

## Verdicts

| Source | What it has | Licence | Search / download | Verdict |
|---|---|---|---|---|
| **AssetPolish** (www.assetpolish.com) | 3,869 vector stickers, illustrations and icons; 338 animated (CSS-animated SVG) | CC0 1.0 for every item; "Modification and redistribution permitted" | No API, but a public `catalog.json` with a direct file address and SHA-256 per item. `robots.txt` allows everything | **Integrated** as an online sticker source |
| **nullrights** (nullrights.com) | 24,479 music recordings (API total), copies hosted by the site | CC0 today, per-item `license` field; plans to add CC BY | Working keyless JSON API (`/api/tracks?q=`), but undocumented, no terms, and `robots.txt` disallows `/api/` and `/download/` | **Not yet**: ask the operator first |
| **CCHound** (music.cchound.com) | Index of about 2.2 million tracks; 54,885 CC0 / public domain | Per item, mostly credit-required | No API; search is HTML on a path `robots.txt` disallows; hosts no files | **Skip** (use as a list of leads) |
| **Kenney** (kenney.nl) | CC0 packs: emotes, icons, UI, interface and impact sounds, jingles | CC0 for all asset packs | No catalog or per-file addresses; zips behind per-request signed links; `robots.txt` disallows the asset and download paths | **Bundle later** as a hand-picked starter pack |
| **OpenGameArt** (opengameart.org) | CC0 music, sound effects and art among other licences | Per item; CC0 filter exists | No API or search feed; HTML scraping only, with `Crawl-delay: 10` | **Hand-picked items only** |
| **Openverse, CC0 only** (api.openverse.org) | Freesound (CC0 sounds, preview MP3s), Wikimedia Commons | `license=cc0,pdm` | Already integrated | **Already in**; MIDI results now hidden |

## What was added

- `desktop/providers/assetpolish.cjs`: fetches the catalog at most once a day, searches it locally (every
  word must match the name, tags or collection; stickers rank above plain icons), drops anything not marked
  `CC0-1.0` or not hosted under the site's own `/assets/`, and checks each downloaded file against the
  catalog's SHA-256. It joins the combined sticker search and appears under Preferences › Library.
- Animated AssetPolish items are offered as their still version. They are SVGs animated with CSS; FrameCut's
  sticker bake path (`stickerFile` in `desktop/creative.cjs`) converts GIF, APNG, WebP and Lottie, and
  renders SVG as a still. Playing them needs a browser-engine frame renderer that steps CSS animation time.
- Openverse audio: MIDI and Ogg-container (`ogx`) files from Wikimedia Commons are no longer listed, because
  they cannot be previewed or placed on a timeline.
- nullrights, CCHound, Kenney and OpenGameArt are recorded in `shared/rights.mjs` as evaluated and not
  enabled, with the reason shown in Preferences.

## Needs a decision

1. **nullrights.** It is the largest clean music lead: keyless search with duration filters, a per-track
   licence, an attribution string, the original source address and direct downloads. It is run by Solanex BV
   (Belgium). Nothing on the site permits or forbids use by another app, and its `robots.txt` asks automated
   clients to stay off the API. Email them for permission; an adapter is roughly a day's work once they agree.
   Its catalog overlaps with ccMixter and Wikimedia Commons, so results would need de-duplicating by source
   address.
2. **Kenney starter pack.** Bundling is allowed (CC0), but the packs must be downloaded by hand from the site.
   Candidates: Emotes Pack (480 files), Game Icons (105), UI Pack (430), Interface Sounds (100), Impact Sounds
   (130), Music Jingles (85). File formats and sizes inside the zips were not checked. Do not use the Kenney
   logo.
3. **AssetPolish provenance.** The site is weeks old and its operator is anonymous, so the CC0 status of its
   original artwork rests on its own declaration. 753 items come from the established Maki and Temaki icon
   sets. If that is too thin, set `enabled: false` on `assetpolish` in `shared/rights.mjs`.
4. **Animated SVG stickers.** Worth building only if AssetPolish stays: 338 items would gain motion.

## Notes for later integration

- **Openverse limits.** Anonymous use is 20 requests a minute and 200 a day, 20 results a page, 240 results
  deep. `category=music` only matches Jamendo, which has no CC0, so CC0 music means Freesound previews plus
  Wikimedia Commons. A free registered key raises the limits but its secret should not ship inside the app.
- **Freesound originals** need a signed-in download; Openverse serves the preview MP3.
- **ccMixter** file downloads need a `Referer` from its own site (fixed in this release).
- **CCHound's source list** points at archives worth checking directly: Internet Archive, IMSLP and the UCSB
  cylinder archive.

## Not verified

- Who operates AssetPolish, and the origin of its own artwork.
- nullrights' rate limits, and its claim that each licence is re-checked at the source.
- Kenney zip contents, formats and sizes.
- Whether OpenGameArt's CC0 filter excludes items that also carry another licence.
- No CC0 label guarantees an asset is free of mistaken copyright or Content ID claims.
