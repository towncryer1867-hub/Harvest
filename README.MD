# Harvest Library

Harvest is a self-hosted media catalog and ingestion engine. It monitors RSS/XML syndication feeds, parses release titles, matches them against [TheTVDB](https://thetvdb.com/) metadata, and presents a browsable library UI with an admin console for pipeline triage.

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

metadata_shows          TV series profiles (TVDB id, poster, overview)
metadata_seasons        Season containers per show
metadata_movies         Movie profiles (TVDB id, poster, release date)
metadata_items          Linkable units: episodes, season packs, movies
                        └─ scraped_entries.metadata_item_id → metadata_items.id
```

TV hierarchy: `metadata_shows` → `metadata_seasons` → `metadata_items` (episodes / season packs)

Movie hierarchy: `metadata_movies` → `metadata_items` (type `movie`)

Schema is defined in `db-init/init.sql` and applied automatically on first database volume creation.

### Pipeline

On each tick (every 60 seconds, with overlap protection):

1. **Scraper** — fetches active sources from `scrape_sources`, but only runs a source when its configured `interval_minutes` has elapsed since `last_run_at`.
2. **Matcher** — parses unmatched/failed entry titles, searches TVDB, and upserts catalog rows.

Matching runs in batches of 10 entries per cycle. Title parsing detects TV patterns (`S01E02`, season packs) regardless of RSS category, then falls back to movie year patterns.

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

### Start the stack

```bash
docker compose up -d
```

Open the library at **http://localhost:3030**.

On first boot, Postgres initializes from `db-init/init.sql` (including a seeded LimeTorrents source). The backend retries the database connection until Postgres is ready.

---

## Using the UI

### Library view

The default view shows a grid of TV shows or movies. Click a title to open its detail page:

- **TV shows** — season selector, season packs, and per-episode scraped links
- **Movies** — overview, poster, and linked torrent entries

Toggle between **Library Deck** and **Admin Controls** using the top navigation bar. Navigation state is stored in `sessionStorage`, so each browser tab or window keeps its own view across refreshes.

### Admin console

Available under **Admin Controls** with three tabs:

| Tab | Purpose |
|-----|---------|
| **Scraped Streams** | Browse ingested entries, filter by match status, manual TVDB link, ignore |
| **Ingestion Sources** | View, create, and edit RSS source configurations |
| **System Settings** | Trigger **Trigger Complete Pipeline Match Cycle** to re-run matching immediately |

Sources loaded from the API (`/api/admin/sources`) — not hardcoded. Each source defines its own scrape interval in minutes.

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
| GET | `/api/media/movies/:movieId/entries` | Scraped entries for a movie |
| GET | `/api/media/shows` | List TV show profiles |
| GET | `/api/media/shows/:showId/seasons` | Seasons for a show |
| GET | `/api/media/shows/:showId/season-packs` | Season pack items |
| GET | `/api/media/shows/:showId/episodes` | Episode items |
| GET | `/api/media/items/:itemId/entries` | Scraped entries for an episode/item |
| GET | `/api/media/shows/:showId/seasons/:seasonNumber/pack-entries` | Scraped entries for a season pack |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/entries` | Recent scraped entries (feed log) |
| POST | `/api/manual-match` | Manually link an entry to a TVDB series |
| GET | `/api/admin/sources` | List scrape sources |
| POST | `/api/admin/sources` | Create a source |
| PUT | `/api/admin/sources/:id` | Update a source |
| GET | `/api/admin/queue` | Match status counts and failed items |
| POST | `/api/admin/force-sync` | Re-run the matcher on pending entries |
| POST | `/api/admin/entries/:id/ignore` | Mark an entry as ignored |

In production (`NODE_ENV=production`), 500 responses return a generic error message; details are logged server-side only.

---

## Project layout

```
harvest-app/
├── backend/           Express API, scraper, matcher, TVDB client
├── frontend/          React SPA (main.jsx, dashboard.jsx)
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
