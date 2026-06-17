-- 1. Create Scraper Sources Table
CREATE TABLE IF NOT EXISTS scrape_sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    config_mapping JSONB NOT NULL, -- Holds the flexible XML structural map
    is_active BOOLEAN DEFAULT TRUE,
    last_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create Core Metadata Table (Unified TV Shows & Movies)
CREATE TABLE IF NOT EXISTS metadata_items (
    id SERIAL PRIMARY KEY,
    tvdb_id VARCHAR(50) UNIQUE NOT NULL, -- The target unique ID from the TVDB API
    type VARCHAR(20) NOT NULL,           -- 'movie' or 'series'
    title VARCHAR(255) NOT NULL,
    overview TEXT,
    poster_path TEXT,
    banner_path TEXT,
    release_date VARCHAR(50),
    status VARCHAR(50),
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create TV Episodes Table (Child of metadata_items)
CREATE TABLE IF NOT EXISTS metadata_episodes (
    id SERIAL PRIMARY KEY,
    metadata_item_id INT REFERENCES metadata_items(id) ON DELETE CASCADE,
    season_number INT NOT NULL,
    episode_number INT NOT NULL,
    title VARCHAR(255),
    overview TEXT,
    air_date VARCHAR(50),
    -- This enforces uniqueness across the parent show, season number, and episode number
    CONSTRAINT unique_show_season_episode UNIQUE (metadata_item_id, season_number, episode_number)
);

-- 4. Create Scraped Entries Table (The main feed output)
CREATE TABLE IF NOT EXISTS scraped_entries (
    id SERIAL PRIMARY KEY,
    source_id INTEGER REFERENCES scrape_sources(id) ON DELETE SET NULL,
    metadata_item_id INTEGER REFERENCES metadata_items(id) ON DELETE SET NULL, -- Nullable until matched
    title TEXT NOT NULL,
    source_link TEXT UNIQUE NOT NULL,
    category VARCHAR(255),
    description TEXT,
    magnet_link TEXT,
    date_published TIMESTAMP WITH TIME ZONE,
    date_scraped TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    match_status VARCHAR(20) DEFAULT 'unmatched' -- 'unmatched', 'matched', 'ignored'
);

-- 5. Seed Initial Data: Add LimeTorrents as our first source
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
) ON CONFLICT DO NOTHING;