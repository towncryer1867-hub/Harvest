# Harvest Library

Harvest is a self-hosted media catalog and ingestion engine. It monitors RSS/XML syndication feeds, parses release titles, matches them against [TheTVDB](https://thetvdb.com/) metadata, and presents a browsable library UI with a watchlist, auto-download scheduler, and an admin console for pipeline triage. Optional integrations push completed matches into qBittorrent and check library presence against Plex.

---

## Architecture

The stack runs as four Docker Compose services:

| Service | Role | Port |
|---------|------|------|
| **frontend** | Vite + React SPA (library + admin UI) | 3030 |
| **backend** | Node.js + Express API, scraper, and matcher | 5000 |
| **db** | PostgreSQL 15 | 5432 |
| **pgadmin** | Database admin UI (optional, dev) | 5050 |

The frontend proxies `/api` requests to the backend via Vite (`frontend/vite.config.js`). The backend waits for Postgres to become healthy before starting, then runs a background pipeline on a 60-second tick.

### Data model

```
scrape_sources          RSS/XML feed configurations (interval, selectors)
scraped_entries         Raw ingested torrent rows (magnet links, match status)

metadata_shows          TV series profiles (TVDB id, poster, overview, imdb_id, Plex presence)
metadata_seasons        Season containers per show
metadata_movies         Movie profiles (TVDB id, poster, release date, imdb_id, Plex presence)
metadata_items          Linkable units: episodes, season packs, movies
                        └─ scraped_entries.metadata_item_id → metadata_items.id
metadata_actors         Cast members
metadata_show_cast      Show ↔ actor billing
metadata_movie_cast     Movie ↔ actor billing

watchlist               IMDB-id tracked titles, cross-linked to metadata_shows/metadata_movies once matched
scheduler_items         Shows flagged for auto-download, with resolution preferences and season-pack policy
scheduler_log           Dedup log of auto-grabbed items per scheduler_item

scheduled_jobs          Interval/enabled config for background jobs (Plex sync, TVDB refresh, metadata cleanup, watchlist recheck)
pipeline_logs           Diagnostic event log surfaced in System Settings
```

TV hierarchy: `metadata_shows` → `metadata_seasons` → `metadata_items` (episodes / season packs)

Movie hierarchy: `metadata_movies` → `metadata_items` (type `movie`)

Schema is defined in `db-init/init.sql` and applied automatically on first database volume creation.

### Pipeline

On each tick (every 60 seconds, with overlap protection):

1. **Scraper** — fetches active sources from `scrape_sources`, but only runs a source when its configured `interval_minutes` has elapsed since `last_run_at`.
2. **Matcher** — parses unmatched/failed entry titles, searches TVDB, and upserts catalog rows.
3. **Scheduler trigger** — for each newly matched entry, checks whether its show has an enabled `scheduler_items` row; if the entry's resolution is in the show's preferences (and it's not a season pack unless allowed), the magnet link is auto-submitted to qBittorrent and logged in `scheduler_log` to prevent duplicate grabs.

Matching runs in batches of 10 entries per cycle. Title parsing detects TV patterns (`S01E02`, season packs) regardless of RSS category, then falls back to movie year patterns, and also extracts a resolution token (`480p`/`720p`/`1080p`/`2160p`/etc.) used for display badges and scheduler matching.

Separately, background **jobs** run on their own configurable intervals (toggle in System Settings): Plex library sync, bulk TVDB metadata refresh, orphaned metadata cleanup, and weekly re-checks of unmatched watchlist entries.

---

## Quick start

### Prerequisites

- Docker and Docker Compose

### Configure environment

Copy the example env file and set your TVDB API key:

```bash
cp .env.example .env
```

Edit `.env` and set `TVDB_API_KEY`. Other defaults work for local Docker development. Never commit `.env` — it is listed in `.gitignore`.

Two integrations are optional — the app runs without them, but their features are inert until configured:

| Purpose | Variables |
|---------|-----------|
| qBittorrent (Scheduler auto-download, manual "Add to qBittorrent") | `QBITTORRENT_URL`, `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD`, `QBITTORRENT_CATEGORY_TV`, `QBITTORRENT_CATEGORY_MOVIES` |
| Plex (library presence check + sync) | `PLEX_SERVER_URL`, `PLEX_TOKEN`, `PLEX_TV_SECTION_ID`, `PLEX_MOVIE_SECTION_ID` |

### Start the stack

```bash
docker compose up -d
```

Open the library at **http://localhost:3030**.

On first boot, Postgres initializes from `db-init/init.sql` (including a seeded LimeTorrents source). The backend retries the database connection until Postgres is ready.

---

## Using the UI

The top navigation bar switches between four views: **Library**, **Watchlist**, **Scheduler**, and **Admin Controls**. Navigation state is stored in `sessionStorage`, so each browser tab or window keeps its own view across refreshes.

### Library view

The default view shows a grid of TV shows or movies, with a search box (filters by title server-side) and genre/studio/network filter dropdowns. Click a title to open its detail page:

- **TV shows** — season selector, season packs, per-episode scraped links, cast, and resolution/file-size badges
- **Movies** — overview, poster, cast, and linked torrent entries

If a search returns matches, an **Initiate a Search** button can spin up a one-off RSS ingestion source scoped to that keyword (movies append the release year), so future scrapes pick up releases for a title the existing sources haven't found yet.

Each detail page also exposes **Add to Watchlist** and **Add to Scheduler** actions, and a manual **Add to qBittorrent** action on individual scraped entries (when qBittorrent is configured).

### Watchlist

Track titles you don't have yet by IMDB id (`tt1234567`). On add, Harvest immediately tries to resolve a TVDB match and cross-link it to the existing catalog if already present — clicking a matched watchlist entry deep-links straight into its library page. Unmatched entries are retried automatically by the weekly `watchlist_recheck` job. The list supports search, sorting, filtering by type, and pagination.

### Scheduler

Flag a show for automatic downloading. Choose which resolutions to accept (`SD` through `4K`, or any) and whether season packs are allowed. Whenever the pipeline matches a new entry for a scheduled show at an accepted resolution, its magnet link is submitted to qBittorrent automatically (see [Pipeline](#pipeline)). Movie scheduling exists in the schema but is not yet exposed in the UI/API.

### Admin console

Available under **Admin Controls** with three tabs:

| Tab | Purpose |
|-----|---------|
| **Scraped Streams** | Browse ingested entries, filter by match status, manual TVDB link, retry/fix a single match, ignore |
| **Ingestion Sources** | View, create, and edit RSS source configurations |
| **System Settings** | Force a match cycle, configure automated job intervals, trigger Plex sync / bulk TVDB refresh / metadata cleanup, and view pipeline diagnostics/logs |

Sources loaded from the API (`/api/admin/sources`) — not hardcoded. Each source defines its own scrape interval in minutes.

**System Settings** sections:

| Section | Purpose |
|---------|---------|
| Trigger Complete Pipeline Match Cycle | Re-run matching immediately |
| Automated Job Scheduling | Enable/disable and set the interval (minutes) for each background job in `scheduled_jobs` |
| Plex Library Sync | Manually trigger a sync and view last-checked status |
| TheTVDB Metadata Refresh | Bulk-refresh poster/overview/cast data for the whole catalog |
| Metadata Database Cleanup | Remove orphaned `metadata_items`/shows/movies with no scraped entries |
| Pipeline Diagnostics | View recent `pipeline_logs` entries; clear the log |

### Adding a scraping source

1. Open **Admin Controls** → **Ingestion Sources**.
2. Fill in the source name, RSS/XML URL, and check interval (minutes).
3. Provide a JSON selector mapping for the feed format:

```json
{
  "parser": "xml",
  "selectors": {
    "item": "item",
    "title": "title",
    "source_link": "link",
    "date_published": "pubDate",
    "category": "category",
    "description": "description",
    "magnet_link": "enclosure"
  }
}
```

4. Click **Initialize Pipeline** (or **Save Configurations** when editing).

---

## API overview

### Library

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/media/movies` | List movie profiles |
| GET | `/api/media/movies/:movieId` | Movie detail |
| GET | `/api/media/movies/:movieId/entries` | Scraped entries for a movie |
| GET | `/api/media/movies/:movieId/cast` | Cast for a movie |
| GET | `/api/media/shows` | List TV show profiles |
| GET | `/api/media/shows/:showId/profile` | Show detail |
| GET | `/api/media/shows/:showId/cast` | Cast for a show |
| GET | `/api/media/shows/:showId/seasons` | Seasons for a show |
| GET | `/api/media/shows/:showId/season-packs` | Season pack items |
| GET | `/api/media/shows/:showId/episodes` | Episode items |
| GET | `/api/media/items/:itemId/entries` | Scraped entries for an episode/item |
| GET | `/api/media/shows/:showId/seasons/:seasonNumber/pack-entries` | Scraped entries for a season pack |
| GET | `/api/media/filter-options?type=movie\|series` | Genre/studio/network values for library filter dropdowns |

### Watchlist

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/watchlist` | List watchlist entries (search/sort/type filter/pagination) |
| POST | `/api/watchlist` | Add an IMDB id to the watchlist and attempt a TVDB match |
| DELETE | `/api/watchlist/:id` | Remove a watchlist entry |

### Scheduler

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduler` | List scheduled (auto-download) shows |
| POST | `/api/scheduler` | Add a show with resolution preferences and season-pack policy |
| PUT | `/api/scheduler/:id` | Update preferences or enabled state |
| DELETE | `/api/scheduler/:id` | Remove a scheduler entry |

### qBittorrent

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/qbittorrent/add-torrent` | Submit a magnet link to qBittorrent (`{ magnet_link, type }`) |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/entries` | Recent scraped entries (feed log) |
| POST | `/api/manual-match` | Manually link an entry to a TVDB series |
| POST | `/api/entries/:entryId/fix-match` | Re-match a single entry |
| GET | `/api/admin/sources` | List scrape sources |
| POST | `/api/admin/sources` | Create a source |
| PUT | `/api/admin/sources/:id` | Update a source |
| GET | `/api/admin/queue` | Match status counts and failed items |
| POST | `/api/admin/force-sync` | Re-run the matcher on pending entries |
| POST | `/api/admin/entries/:id/ignore` | Mark an entry as ignored |
| POST | `/api/admin/entries/:id/retry` | Retry matching for a failed entry |
| GET | `/api/admin/scheduled-jobs` | List background job intervals/enabled state |
| PUT | `/api/admin/scheduled-jobs/:jobKey` | Update a background job's interval/enabled state |
| POST | `/api/admin/tvdb-refresh` | Bulk-refresh TVDB metadata for the catalog |
| POST | `/api/admin/cleanup-metadata` | Remove orphaned metadata rows |
| GET | `/api/admin/plex-status` | Last Plex sync status |
| POST | `/api/admin/plex-sync` | Trigger a Plex library sync |
| GET | `/api/admin/diagnostics/summary` | Pipeline diagnostics summary |
| GET | `/api/admin/logs` | Recent pipeline log entries |
| DELETE | `/api/admin/logs` | Clear pipeline logs |

In production (`NODE_ENV=production`), 500 responses return a generic error message; details are logged server-side only.

---

## Project layout

```
harvest-app/
├── backend/           Express API, scraper, matcher, TVDB client, qBittorrent/Plex clients
├── frontend/          React SPA (main.jsx library/watchlist/scheduler, dashboard.jsx admin console)
├── db-init/init.sql   Postgres schema and seed data
├── docker-compose.yml
├── .env.example       Environment template
└── .env               Local secrets (not committed)
```

---

## Diagnostics

### Container status

```bash
docker compose ps
```

### Backend logs

```bash
docker compose logs -f backend
```

### Force a match cycle

Use **Admin Controls** → **System Settings** → **Trigger Complete Pipeline Match Cycle**, or:

```bash
curl -X POST http://localhost:5000/api/admin/force-sync
```

Scraping still respects per-source `interval_minutes`; the force-sync endpoint only re-runs matching.

### Reset the database

To re-apply `db-init/init.sql` from scratch:

```bash
docker compose down -v
docker compose up -d
```

This destroys all ingested and catalog data.

---

## License

Internal Application Deployment — All Rights Reserved.
