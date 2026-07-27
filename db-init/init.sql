-- 1. Create Scraper Sources Table (Unchanged)
CREATE TABLE IF NOT EXISTS scrape_sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL UNIQUE,
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    config_mapping JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. New Table: Parent TV Shows / Series Profiles
CREATE TABLE IF NOT EXISTS metadata_shows (
    id SERIAL PRIMARY KEY,
    tvdb_id VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    overview TEXT,
    poster_path TEXT,
    banner_path TEXT,
    status VARCHAR(50),
    network VARCHAR(255),
    genres TEXT[] DEFAULT '{}',
    first_aired VARCHAR(50),
    last_aired VARCHAR(50),
    original_country VARCHAR(100),
    original_language VARCHAR(50),
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Plex cross-reference (see plexSync.js)
    in_plex BOOLEAN NOT NULL DEFAULT FALSE,
    plex_rating_key VARCHAR(50),
    plex_checked_at TIMESTAMP WITH TIME ZONE,
    -- Extra TVDB metadata (see tvdbMetadata.js): first trailer TVDB has on
    -- file (nullable — not every title has one) and the IMDB id from
    -- TVDB's remoteIds (nullable). TheTVDB's own link is derived from
    -- tvdb_id at render time, so it doesn't need a column.
    trailer_url TEXT,
    imdb_id VARCHAR(20)
);

-- 3. New Table: Season Containers
CREATE TABLE IF NOT EXISTS metadata_seasons (
    id SERIAL PRIMARY KEY,
    show_id INT REFERENCES metadata_shows(id) ON DELETE CASCADE,
    season_number INT NOT NULL,
    title VARCHAR(255), -- e.g., "Season 1"
    poster_path TEXT,
    CONSTRAINT unique_show_season UNIQUE (show_id, season_number)
);

-- 4. New Table: Parent Movie Profiles
CREATE TABLE IF NOT EXISTS metadata_movies (
    id SERIAL PRIMARY KEY,
    tvdb_id VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    overview TEXT,
    poster_path TEXT,
    release_date VARCHAR(50),
    release_year INTEGER,
    genres TEXT[] DEFAULT '{}',
    studios TEXT[] DEFAULT '{}',
    production_companies TEXT[] DEFAULT '{}',
    original_country VARCHAR(100),
    original_language VARCHAR(50),
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Plex cross-reference (see plexSync.js)
    in_plex BOOLEAN NOT NULL DEFAULT FALSE,
    plex_rating_key VARCHAR(50),
    plex_checked_at TIMESTAMP WITH TIME ZONE,
    -- Extra TVDB metadata (see tvdbMetadata.js) — see matching comment on
    -- metadata_shows above.
    trailer_url TEXT,
    imdb_id VARCHAR(20)
);

-- 5. Universal Media Units (Episodes, Movies, Season Packs)
CREATE TABLE IF NOT EXISTS metadata_items (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL,           -- 'episode', 'movie', 'season_pack'
    tvdb_id VARCHAR(50) UNIQUE,          -- Nullable; episode-level TVDB id only
    show_id INT REFERENCES metadata_shows(id) ON DELETE CASCADE,     -- Null for movies
    season_id INT REFERENCES metadata_seasons(id) ON DELETE CASCADE,   -- Null for movies
    movie_id INT REFERENCES metadata_movies(id) ON DELETE CASCADE,     -- Null for TV items
    episode_number INT,                  -- Null for movies and season packs
    title VARCHAR(255) NOT NULL,
    overview TEXT,
    air_date VARCHAR(50),
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Plex cross-reference (see plexSync.js): applies to episodes, season
    -- packs (proxy: at least one episode of that season found in Plex),
    -- and movie items alike.
    in_plex BOOLEAN NOT NULL DEFAULT FALSE,
    plex_checked_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_series_episode UNIQUE (show_id, season_id, episode_number),
    CONSTRAINT unique_movie_item UNIQUE (movie_id)
);

CREATE INDEX IF NOT EXISTS idx_metadata_shows_in_plex ON metadata_shows(in_plex);
CREATE INDEX IF NOT EXISTS idx_metadata_movies_in_plex ON metadata_movies(in_plex);
CREATE INDEX IF NOT EXISTS idx_metadata_items_in_plex ON metadata_items(in_plex);

-- 5b. Actors/people (from TVDB's `characters` records — see tvdbMetadata.js's
-- extractCast()). Deduped by TVDB's own people id since the same actor can
-- appear on multiple shows/movies; the join tables below are what "reference
-- out" a given actor to a specific series or movie (with their character
-- name and billing order for that title).
CREATE TABLE IF NOT EXISTS metadata_actors (
    id SERIAL PRIMARY KEY,
    tvdb_people_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    image_path TEXT,
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS metadata_show_cast (
    id SERIAL PRIMARY KEY,
    show_id INT REFERENCES metadata_shows(id) ON DELETE CASCADE,
    actor_id INT REFERENCES metadata_actors(id) ON DELETE CASCADE,
    character_name VARCHAR(255),
    sort_order INT DEFAULT 0,
    CONSTRAINT unique_show_actor UNIQUE (show_id, actor_id)
);

CREATE TABLE IF NOT EXISTS metadata_movie_cast (
    id SERIAL PRIMARY KEY,
    movie_id INT REFERENCES metadata_movies(id) ON DELETE CASCADE,
    actor_id INT REFERENCES metadata_actors(id) ON DELETE CASCADE,
    character_name VARCHAR(255),
    sort_order INT DEFAULT 0,
    CONSTRAINT unique_movie_actor UNIQUE (movie_id, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_metadata_show_cast_show_id ON metadata_show_cast(show_id);
CREATE INDEX IF NOT EXISTS idx_metadata_movie_cast_movie_id ON metadata_movie_cast(movie_id);

-- 6. Scraped Entries (Points directly to the actual item)
CREATE TABLE IF NOT EXISTS scraped_entries (
    id SERIAL PRIMARY KEY,
    source_id INTEGER REFERENCES scrape_sources(id) ON DELETE SET NULL,
    metadata_item_id INTEGER REFERENCES metadata_items(id) ON DELETE SET NULL, -- Directly targets the unit
    title TEXT NOT NULL,
    source_link TEXT UNIQUE NOT NULL,
    category VARCHAR(255),
    description TEXT,
    magnet_link TEXT,
    size VARCHAR(50), -- Human-readable size straight from the source feed (e.g. "1.4 GB")
    date_published TIMESTAMP WITH TIME ZONE,
    date_scraped TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    match_status VARCHAR(20) DEFAULT 'unmatched' -- 'unmatched', 'matched', 'failed', 'processing', 'ignored'
);

-- 7. Configurable schedules for the Admin Controls automation buttons (Plex
-- sync, TVDB refresh, pipeline match cycle, metadata cleanup). One row per
-- job_key, seeded below; see backend/jobScheduler.js for the run logic.
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    job_key VARCHAR(50) PRIMARY KEY,
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_run_at TIMESTAMP WITH TIME ZONE
);

-- Pipeline Match Cycle is intentionally not schedulable here — see the
-- comment on JOB_DEFINITIONS in backend/jobScheduler.js for why.
INSERT INTO scheduled_jobs (job_key, interval_minutes, is_enabled) VALUES
    ('plex_sync', 60, FALSE),
    ('tvdb_refresh', 1440, FALSE),
    ('metadata_cleanup', 1440, FALSE)
ON CONFLICT (job_key) DO NOTHING;

-- 8. Diagnostic event log for the background pipeline (scraper, matcher,
-- Plex sync, TVDB refresh, cleanup, scheduled jobs). Lets Admin Controls
-- surface silent failures (e.g. TVDB auth failing every cycle) that would
-- otherwise only show up in container stdout. See backend/pipelineLog.js.
CREATE TABLE IF NOT EXISTS pipeline_logs (
    id SERIAL PRIMARY KEY,
    source VARCHAR(50) NOT NULL,
    level VARCHAR(10) NOT NULL DEFAULT 'error',
    message TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_created_at ON pipeline_logs(created_at DESC);

-- Idempotent safety net: if this script is ever re-run against a database
-- that already has the scraped_entries table from before the `size` column
-- existed, this adds it without erroring. (Note: on a live deployment,
-- Postgres only auto-runs this file once against an empty data volume --
-- see docker-compose.yml's db-init mount -- so the actual migration for
-- already-running installs happens at backend startup via db.js's
-- ensureSchema(), not here.)
ALTER TABLE scraped_entries ADD COLUMN IF NOT EXISTS size VARCHAR(50);
ALTER TABLE metadata_shows ADD COLUMN IF NOT EXISTS trailer_url TEXT;
ALTER TABLE metadata_shows ADD COLUMN IF NOT EXISTS imdb_id VARCHAR(20);
ALTER TABLE metadata_movies ADD COLUMN IF NOT EXISTS trailer_url TEXT;
ALTER TABLE metadata_movies ADD COLUMN IF NOT EXISTS imdb_id VARCHAR(20);

-- 7. Seed Initial Data: Add LimeTorrents as our first source
INSERT INTO scrape_sources (name, url, interval_minutes, config_mapping)
VALUES (
    'LimeTorrents - TV: Upload',
    'https://www.limetorrents.fun/searchrss/Upload/',
    30,
    '{
        "parser": "xml",
        "selectors": {
            "item": "item",
            "title": "title",
            "source_link": "link",
            "date_published": "pubDate",
            "category": "category",
            "description": "description",
            "magnet_link": "enclosure",
            "size": "size"
        }
    }'::jsonb
),
(
    'LimeTorrents - Movies',
    'https://www.limetorrents.fun/rss/16/',
    60,
    '{
        "parser": "xml",
        "selectors": {
            "item": "item",
            "title": "title",
            "source_link": "link",
            "date_published": "pubDate",
            "category": "category",
            "description": "description",
            "magnet_link": "enclosure",
            "size": "size"
        }
    }'::jsonb
),
(
    'LimeTorrents - TV',
    'https://www.limetorrents.fun/rss/20/',
    30,
    '{
        "parser": "xml",
        "selectors": {
            "item": "item",
            "title": "title",
            "source_link": "link",
            "date_published": "pubDate",
            "category": "category",
            "description": "description",
            "magnet_link": "enclosure",
            "size": "size"
        }
    }'::jsonb
) ON CONFLICT (url) DO NOTHING;