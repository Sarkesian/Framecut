# Library sources

Two reviews are recorded here. The audio review of 11 November 2026 comes first; the sticker and CC0 review of
9 November 2026 follows, with the parts that have since changed marked.

FrameCut's rule: a source is searched online only if it has a stable, permitted way to search and download, and
the license of each item can be checked. Nothing is bundled into the installer except small indexes.

# Audio review, 11 November 2026

Requirements 1.6 (samples that cannot be retrieved) and 1.8 (music and sound library). Every figure below was
measured on 11 November 2026 with the app's own code and its own User-Agent
(`FrameCutStudio/1.0 (local desktop video editor)`), one request at a time.

## What was tested

| Step | Sample | Result |
|---|---|---|
| Search, then full preview download, `ffprobe`, then import | 28 ccMixter tracks (10 imported), 13 Jamendo tracks through Openverse (4 imported), 27 Freesound sounds through Openverse (9 imported), 14 Internet Archive files (5 imported), 8 SFXMint sounds (2 imported), 6 SFX Kit sounds (2 imported) | 93 of 96 previews and all 32 imports succeeded. The 3 failures were SFXMint's download allowance (below) |
| Open the file address, read the first bytes, hang up | 104 more items, mostly from deep result pages: 36 ccMixter (pages 25 and 40), 28 Jamendo and 12 Freesound (Openverse pages 9 to 12), 18 Incompetech (pages 1, 40 and 70), 10 Internet Archive | 104 of 104 answered 200 with audio |

So files that are simply gone were not the cause: 0 of 200 files checked were missing. The failures came from
the places listed next.

## Why samples could not be grabbed

| # | Cause (class) | Evidence | Fix |
|---|---|---|---|
| 1 | **Library integration.** In a combined search only one Jamendo track per page survived. The cross-source duplicate check keyed on host and path, and Jamendo addresses every track as `prod-1.storage.jamendo.com/?trackid=…`, so a page of 20 looked like one file | Category audit before the fix: Openverse reported up to 240 Jamendo matches per category and exactly 1 was listed, in every category that had any. After the fix the same answers list up to 20 | `canonicalAudioUrl` (`shared/audio-library.mjs`) includes the query string |
| 2 | **Permissions / rate limit.** SFXMint counts every file fetched by something other than a browser against "5 different sounds a day per network" (20 with a free key) | Sixth SFXMint file in a row: HTTP 429 with `Retry-After: 74766`; the app then said only "The media service answered 429" | The first sentence of the source's own message is passed on, with when to try again and where a free key goes. In the app SFXMint previews play straight from the site (its documented hotlinking); checked in the app after the allowance was used up: the preview played, and adding said "SFXMint is limiting downloads right now. Try again in about 21 hours." If a direct preview fails the player falls back to FrameCut's fetch and then explains |
| 3 | **Library integration / rate limit.** Every import asks the catalog again for the license. When Openverse (20 requests a minute, 200 a day without credentials) or SFXMint (20 lookups a day) was limiting requests, items that were listed and playable could not be added | Reproduced with a mock catalog answering 429 (`tests/library-retrieval.test.cjs`). Not reproduced live: exhausting a real daily quota would lock the owner's network out | If the catalog cannot be asked (rate limit, timeout, outage) and the listing was verified within the last 24 hours, that listing's license evidence is used and recorded as `<source>-listing`. A changed or failed license still blocks the import |
| 4 | **Network.** Freesound's CDN delivers about 77 KB/s per connection (1.6 MB in 21 s, 6.5 MB in 85 s, 13.5 MB in 175 s). Adding a track after listening downloaded it a second time, and a preview whose host stopped sending had no timeout at all | Timings from the probe | Import reuses the cached or still-arriving preview (one download). Previews stop with a clear message if the host sends nothing for 25 s; the player gives up on a silent 30 s wait. One automatic retry after a dropped connection or a 5xx |
| 5 | **Format.** The Internet Archive serves M4A (AAC) files as `audio/mpeg`; they were saved with an `.mp3` name. Unknown types fell back to an `.audio` extension that the project cannot play. Incompetech serves MP3 as `application/octet-stream` | `ffprobe` on the cached file: `mov,mp4,m4a… / aac` under an `.mp3` name | The file's first bytes decide the extension (MP3, Ogg, WAV, FLAC, M4A). A web page where audio should be is reported as a refused download. Previews are relabelled from the listed file type when the host's label is vague or wrong |
| 6 | **Feedback.** A failed import job kept only its message, not its reason, so the UI showed raw text such as "The media service answered 404" | Code path: `jobs.cjs` stores `error` only | Failures are rewritten in one place (`explain` in `desktop/creative.cjs`) as what happened plus what to do, and the reason code travels in the job's `meta.failure`. Items that are gone, refused or not audio are marked unavailable for the session and left out of later results |
| 7 | **Content.** About a third of ccMixter's "music" results were bare vocal takes (a cappellas) and site promos: 14 of 30 for "upbeat", 8 of 30 for the acoustic tag | Upload types (`ccud`) of the top 30 results per query | Left out unless the search asks for vocals |
| 8 | **Content.** With credited music allowed, Openverse was asked for Freesound and Jamendo together; Freesound's word matches buried the songs | "rock": 9 of 10 results were recordings of waves on rocks | Credited views ask Jamendo; Freesound stays in the no-credit view and in sound effects |

## Sources

| Source | What it has | License | Access checked | Verdict |
|---|---|---|---|---|
| **Incompetech** (Kevin MacLeod) | 1,443 finished pieces with genre, feel, instruments, tempo, length | CC BY 4.0 for the whole catalog ("Creative Commons — Free. Requires that you credit the music"); the FAQ allows monetized YouTube videos with credit | The site publishes a catalog API for automated tools (`/.well-known/openapi.yaml`, linked from its file responses): `pieces.json`, `genre.json`, `collections.json`. `robots.txt` allows the music paths. MP3s are plain files | **Added.** One catalog fetch a week (881 KB, cached on disk), searched locally; only played or added tracks are downloaded |
| **ccMixter** | 10,163 uploads usable commercially: 339 CC0 and 9,824 CC BY (API counts). Uploader tags give real genres: electronic 2,383, chill 1,068, hip hop 1,047, piano 1,001, ambient 999, rock 705, acoustic 513, techno 423, jazz 370 | Per upload, read from its `license_url` | Documented query API. `robots.txt` disallows `/api/` for crawlers. File downloads need a `Referer` from the site (already sent since the last release) | **Kept**, now browsed by tag, a cappellas removed |
| **Jamendo through Openverse** | CC BY songs; Openverse returns at most 240 results per query | Per item (`by` only in the default view; share-alike in the widest view; NC and ND never in monetized projects) | Openverse API, documented, anonymous limits 20 a minute and 200 a day. Its `robots.txt` disallows `/v1/audio/` for crawlers | **Kept**, fixed (cause 1), now the song source for credited views |
| **Freesound through Openverse** | CC0 sounds and loops | Per item | As above; files come from Freesound's preview CDN | **Kept** for sound effects and the no-credit music view |
| **SFX Kit** (Wyzowl) | 320 sound effects, 28 categories | CC0 | Pinned GitHub commit, SHA-256 per file | **Kept** |
| **SFXMint** | 10,800+ sound effects, 23 categories | CC0 1.0 | Documented API and MCP server; API docs: "MP3 URLs are free to hotlink from your app… Please don't mirror-scrape the whole catalog". Without a key: 20 lookups and 5 different downloads a day per network. `robots.txt` disallows `/api/v1/` for crawlers | **Kept.** Its categories now feed the shared sound-effect categories; limits are explained when reached; previews no longer use the allowance |
| **Internet Archive** | CC0 audio uploads | Item and file `licenseurl`, both must be CC0 1.0 | Official search and metadata APIs; `robots.txt` allows them | **Kept optional, off by default.** Quality is uneven: "jazz" returned a two-hour radio show (59 MB) and "piano" a 173 MB broadcast recording. Widening it to CC BY netlabels was not done: the collection query answered `BACKEND_ERROR` twice, and results would need the same curation |
| **Free Music Archive** | Curated CC music | Per track | The old API address answers 404; there is no public API. `robots.txt` allows browsers | **Rejected**: no permitted way to search |
| **Musopen** | Public-domain classical | PD / CC | No API; `robots.txt` disallows its search and asks for 15 s between requests | **Rejected** |
| **Pixabay audio** | Music and sound effects on the site | Pixabay Content License | The API documentation still lists image and video endpoints only | **Rejected** (unchanged) |
| **nullrights**, **Kenney**, **OpenGameArt**, **CCHound** | See the 9 November review | | Not contacted or re-fetched in this review | **Unchanged**: not enabled |
| **Wikimedia Commons** | | | Removed earlier at the owner's request | **Stays removed** |
| **Freesound direct**, **Jamendo direct** | | API terms were recorded earlier as non-commercial | Not re-read in this review | **Unchanged**: not enabled |

## How much music can be browsed

| | Before | After |
|---|---|---|
| Default view | "CC0 only": 339 ccMixter uploads (a cappellas included) plus Freesound CC0 clips matched by word | "Free to use, credit written for you": 1,443 Incompetech pieces, about 10,000 ccMixter uploads less the a cappellas, Jamendo CC BY songs, CC0 as before |
| Jamendo in combined results | 1 track per page | Up to 20 per page |
| Categories | 47 word searches sent to every source | 49 music categories (9 moods, 30 genres, 10 uses) mapped to ccMixter tags and Incompetech's genre and feel labels, 5 collections, 24 sound-effect categories |

Every music category was run against the live sources after the changes: the first page of each of the 49
holds between 21 and 69 tracks (thinnest: Chiptune & 8-bit, 21), with no source failing. Two were removed for
being thin: Synthwave (6 tracks in all) and R&B (8, merged into
"Soul & R&B"). All 24 sound-effect categories returned 20 to 60 sounds with SFXMint switched off.

Credit-required music is the default because that is where finished music is. Each such track carries a
"Credit" badge that copies its credit line; the license drawer shows the full credit; the export check still
refuses to finish until the credits are delivered. "No credit needed only" remains one click away in Filters
and as a collection, and the choice is remembered.

## Caching

- Provider answers are kept for 24 hours and now survive a restart (`cache/creative/search-cache.json`, at
  most 150 answers). If a source is limiting requests or offline, the previous answer is shown instead of an
  empty category.
- The Incompetech catalog is kept for a week; a stale copy is used if the site cannot be reached.
- Previews stay in a 250 MB cache, oldest removed first (unchanged). An import copies from it when the preview
  is the same file.
- Imported files are stored once and reused; identical bytes under another listing reuse the same file
  (unchanged).

## Needs a decision

1. **robots.txt on API paths.** Openverse, ccMixter and SFXMint each disallow their API path for crawlers while
   documenting that API for applications. FrameCut calls them only when a user searches or adds something, and
   caches the answers. If the rule is to be read strictly, these three would have to be switched off, which
   would leave Incompetech and SFX Kit.
2. **ccMixter's `Referer` requirement.** Downloads are refused without a ccMixter page as referrer. FrameCut
   sends the track's own page. That was decided in the previous release and is unchanged; it is worth asking
   ccMixter whether they are content with it.
3. **Jamendo files.** Jamendo's own API was rejected earlier for its terms, while its files are downloaded
   from the addresses Openverse lists. The Creative Commons license of each track permits the download; the
   host's own terms for that address were not reviewed.
4. **Keys.** A free Openverse application and a free SFXMint key lift the daily limits. Neither can ship inside
   the app; both are optional in Preferences.

## Not verified

- A real Openverse daily limit: the response header reported 199 of 200 requests still available after every
  call made during this review, so the daily counter may not work the way its documentation says.
- SFXMint's limits for a network that has a free key (20 downloads a day): no key was used.
- The probe used up this network's SFXMint allowance for 11 November (UTC). It resets by itself.
- ccMixter's and Jamendo's rate limits. Neither refused a request during testing.
- Who owns what uploaders marked CC0 or CC BY on ccMixter, Jamendo, Freesound or the Internet Archive.
  FrameCut reports the license the source gives and keeps that record with the project.
- Content ID behaviour of any track on YouTube.

# Sticker and CC0 review, 9 November 2026

Checked 9 November 2026 by fetching each site, its terms and its endpoints. Counts are the providers' own
figures unless a line says otherwise.

> Changed since: AssetPolish and Wikimedia Commons were later removed from discovery (see `shared/rights.mjs`
> and `desktop/providers/blocked-sources.cjs`). The rows below are kept as the record of that review.

## Verdicts

| Source | What it has | Licence | Search / download | Verdict |
|---|---|---|---|---|
| **AssetPolish** (www.assetpolish.com) | 3,869 vector stickers, illustrations and icons; 338 animated (CSS-animated SVG) | CC0 1.0 for every item; "Modification and redistribution permitted" | No API, but a public `catalog.json` with a direct file address and SHA-256 per item. `robots.txt` allows everything | Integrated on 9 November; **since removed** |
| **nullrights** (nullrights.com) | 24,479 music recordings (API total), copies hosted by the site | CC0 today, per-item `license` field; plans to add CC BY | Working keyless JSON API (`/api/tracks?q=`), but undocumented, no terms, and `robots.txt` disallows `/api/` and `/download/` | **Not yet**: ask the operator first |
| **CCHound** (music.cchound.com) | Index of about 2.2 million tracks; 54,885 CC0 / public domain | Per item, mostly credit-required | No API; search is HTML on a path `robots.txt` disallows; hosts no files | **Skip** (use as a list of leads) |
| **Kenney** (kenney.nl) | CC0 packs: emotes, icons, UI, interface and impact sounds, jingles | CC0 for all asset packs | No catalog or per-file addresses; zips behind per-request signed links; `robots.txt` disallows the asset and download paths | **Bundle later** as a hand-picked starter pack (it would add to the installer) |
| **OpenGameArt** (opengameart.org) | CC0 music, sound effects and art among other licences | Per item; CC0 filter exists | No API or search feed; HTML scraping only, with `Crawl-delay: 10` | **Hand-picked items only** |
| **Openverse, CC0 only** (api.openverse.org) | Freesound (CC0 sounds, preview MP3s) | `license=cc0,pdm` | Already integrated | **Already in**; MIDI results hidden |

## Still open from that review

1. **nullrights.** The largest clean CC0 music lead: keyless search with duration filters, a per-track licence,
   an attribution string, the original source address and direct downloads. It is run by Solanex BV (Belgium).
   Nothing on the site permits or forbids use by another app, and its `robots.txt` asks automated clients to
   stay off the API. Email them for permission; an adapter is roughly a day's work once they agree. Its catalog
   overlaps with ccMixter, so results would need de-duplicating by source address.
2. **Kenney starter pack.** Bundling is allowed (CC0), but the packs must be downloaded by hand from the site
   and would add to the installer. Candidates: Interface Sounds (100), Impact Sounds (130), Music Jingles (85).
   File formats and sizes inside the zips were not checked. Do not use the Kenney logo.

## Notes

- **Openverse limits.** Anonymous use is documented as 20 requests a minute and 200 a day, 20 results a page,
  240 results deep. A free registered key raises the limits but its secret should not ship inside the app.
- **Freesound originals** need a signed-in download; Openverse serves the preview MP3.
- No CC0 label guarantees an asset is free of mistaken copyright or Content ID claims.
