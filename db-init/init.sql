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
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
    CONSTRAINT unique_series_episode UNIQUE (show_id, season_id, episode_number),
    CONSTRAINT unique_movie_item UNIQUE (movie_id)
);

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
    date_published TIMESTAMP WITH TIME ZONE,
    date_scraped TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    match_status VARCHAR(20) DEFAULT 'unmatched' -- 'unmatched', 'matched', 'failed'
);

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
            "magnet_link": "enclosure"
        }
    }'::jsonb
) ON CONFLICT (url) DO NOTHING;