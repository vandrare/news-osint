# News-OSINT

A standalone local news desk for Omarchy. No paid accounts or API keys.

```sh
git clone https://github.com/vandrare/news-osint.git
cd news-osint
python3 install.py
news-osint
```

Run `python3 install.py`, then launch **News-OSINT** from your application menu or run `news-osint`.
Python 3.11+, Chromium, and Electron (for the floating reader) are required. The launcher starts a local server at
http://127.0.0.1:47831 and opens a separate Chromium app window. This is a local
web application, not a Quickshell panel. Run `python3 launch.py --server-only`
to use an existing browser instead.

## Features

- Resizable 25% search / 50% news / 25% map columns; collapsible sidebars and expanded map.
- Google News RSS with query-specific searches, plus BBC World, Guardian World, Al Jazeera, NPR World, France 24.
- Headline and publisher excerpt search with phrases, implicit AND, OR, and -exclusions.
- Publication date and source filters; saved searches and optional auto refresh.
- Manual Google News research links and CSV export.
- 16px headlines and scrollbars that follow the current Omarchy palette.
- Select text in a headline or excerpt to search Wikipedia, find map matches, or search news.
- Floating, frameless article reader with remembered size and position, back/forward, reload, close, and open-in-browser controls.
- MapLibre with OpenFreeMap vector tiles, themed from Omarchy's palette; country labels hidden, city labels retained, blue-tinted water and coast outlines.
- News and Wikipedia search tabs; look up people, organizations, events, and subjects, then search news about the selected topic.
- Wikipedia place search, latitude/longitude navigation, Wikipedia/Wikidata profiles, infobox facts, and expandable article sections beneath the map.
- Manually linked story locations, map pins, and population dates where available.
- Source health and timestamps, 5-minute feed caching, last-good results when feeds fail.
- Settings for adding, testing, renaming, enabling, disabling, and removing RSS/Atom sources.

## Feed settings

Open **Settings** in the header to manage news sources. The six initial entries
are Google News, BBC World, The Guardian, Al Jazeera, NPR World, and France 24.
Enter a name and RSS or Atom URL, select **Add to list**, then **Save changes**.
**Test feed** checks the URL and reports how many readable stories it provides.
Newly added feeds are selected automatically in the sidebar and use the same
news cards, search, date filters, source health, article reader, and CSV export.

Existing entries can be renamed, edited, disabled, or removed. Disabled feeds
are retained in settings but are not fetched or offered in the sidebar. **Cancel**
discards the current edits. Changes are stored in
`~/.local/state/news-osint/sources.json`, separately from the source repository;
your custom feed addresses are not committed to Git. Settings apply to this
computer. Saved searches retain their source selections for feeds that still exist.

Google News's default feed URL retains its query-specific search behavior. If
you replace that URL, it is read and filtered as an ordinary RSS/Atom feed.

## Coverage and limitations

Google News receives the search query and publication window directly; publisher
feeds are filtered locally. Google News results identify the original publisher
and are marked “via Google News”; article links route through Google News.
The feed is used as a personal, noncommercial feed reader and requires no key.
Its availability and coverage are not guaranteed. Google results are not
rejected when a search term appears in the article body but not its headline.

Search covers the stories returned by the selected RSS feeds. Choosing
seven days does not retrieve a seven-day archive. It only filters the feed's
available entries. This is not a comprehensive web search or a Google scraper.
The “Open in Google” button also opens a separate Google News search.

Summaries are publisher-provided feed excerpts, not AI-written summaries or full
article copies. Locations are selected manually; articles are not automatically
geocoded, and a pin does not verify the location of an event. Place search uses
geolocated English Wikipedia articles and accepts `latitude, longitude`; it is
not a street-address geocoder. Hierarchy and population coverage vary by entity.
Wikipedia infobox label/value pairs are rendered as plain text in a collapsible
facts table; not all articles have an infobox. Scripts and Wikipedia page styles
are never embedded. Images and flags are not copied into this table.
The first version has individual pins, not marker clustering.

## Floating article reader

Click **Read article** to open the publisher's page in a separate,
reusable Electron reader window. It has no native title bar, address bar, tabs,
or status bar. Drag the narrow control strip to move it; resize the window edges.
Escape or Ctrl+W closes it. Alt+Left/Right navigates history and Ctrl+R reloads.
**Open in browser** remains available for normal browsing. Publisher styling,
cookie prompts, sign-ins, and paywalls remain in effect; only scrollbars are themed.
Size and position are remembered across closes in `reader/window.json` inside
the app's state directory. A disconnected display falls back to a visible area.

The reader uses the installed system Electron and a separate browser session in
`~/.local/state/news-osint/reader/`. Publisher pages have no Node.js access or
app control bridge; sandboxing and context isolation are enabled. Reader launch
requests require a same-origin POST from the local app. Logs are written to
`~/.local/state/news-osint/reader.log`.

On Hyprland, the reader uses `hyprctl` to float and restore only its own window.
This is needed because Wayland does not expose global window positions through
Electron. An existing reader-specific floating rule may remain in your desktop
configuration, but should not force a fixed size. Other Electron windows keep
their existing layout behavior. Other desktops use Electron's native restoration
where supported; window positioning under other Wayland compositors can differ.

## Wikipedia research

Select **Wikipedia** in the left sidebar to search people and general topics as
well as places. Selecting a result loads its introduction, facts table, and
expandable sections beneath the map. **Search news about this** switches back
to News with the topic filled in. **Read full article** uses the floating reader.
Geolocated articles offer **Show on map**; selecting a person or general subject
does not move the map. Article sections load on demand as plain text.

Headlines are plain, selectable text. Highlight a phrase in a headline or
publisher excerpt to open a small research toolbar. **Wikipedia** fills and runs
the left Wikipedia search; **Find on map** shows possible matches on the right
before you choose a location; **Search news** searches for the selected phrase.
The map action can link the chosen location to the original story. Escape,
clicking elsewhere, or scrolling dismisses the toolbar. **Read article** remains
the action for opening the floating reader.

Map water blends 15% of the active theme's blue with 85% of its background.
Country names are hidden while city labels remain visible at suitable zooms.

News, map tiles, and new place profiles require the internet. Previously fetched
news and profiles are cached on disk. Free third-party services may change or
be unavailable; source failures are shown without inventing substitute stories.

## Data and privacy

The server binds only to 127.0.0.1. No account or analytics. Theme files are read,
never edited; desktop theme changes are polled every three seconds. Backend
cache and logs: `~/.local/state/news-osint/`. Saved searches, layout, and manually
linked locations live in the dedicated Chromium profile in that directory.
The server remains available after closing the window for fast reopening.

Requests go to the configured publishers, Wikipedia/Wikidata, and OpenFreeMap.
Google News receives news queries when its source is selected, and Google is
also contacted when you explicitly open a Google research link. Publishers
are contacted when you open their articles. Browser extensions in your normal
profile do not run in this separate app profile.

## Attribution

- Map renderer: [MapLibre GL JS](https://maplibre.org/) 6.16.0, BSD-3-Clause.
- Map hosting: [OpenFreeMap](https://openfreemap.org/), OpenMapTiles,
  [OpenStreetMap contributors](https://www.openstreetmap.org/copyright); map attribution is displayed.
- Wikipedia excerpts: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/),
  truncated for display with a link to the original article and revision history.
- Wikidata structured facts: CC0. Each profile links to its entity.
- News excerpts and headlines remain the property of their publishers and link to the original story.

The MapLibre bundle and its license are stored in `static/vendor/` so the app
does not fetch executable JavaScript from a CDN at startup.

## Development

`python3 server.py --port 47831` runs the server. No pip or npm install is needed
to run the app. `python3 -m unittest discover -s tests -v` runs backend tests.
`node --check static/app.js` checks the frontend's syntax.
`node --test tests/geometry.test.cjs` checks geometry validation and display fallback.
