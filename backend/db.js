async function waitForDatabase(pool, { retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('Database connection established.');
      return;
    } catch (err) {
      console.log(`Waiting for database (attempt ${attempt}/${retries})...`);
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Lightweight, idempotent schema migrations that run on every backend
 * startup. init.sql only executes once, when Postgres first initializes an
 * empty data volume (see docker-compose.yml's db-init mount), so any schema
 * change needed on an already-running database has to be applied here
 * instead — `ADD COLUMN IF NOT EXISTS` is safe to run on every boot whether
 * the column already exists or not.
 */
async function ensureSchema(pool) {
  await pool.query(`ALTER TABLE scraped_entries ADD COLUMN IF NOT EXISTS size VARCHAR(50);`);
  await pool.query(`ALTER TABLE metadata_shows ADD COLUMN IF NOT EXISTS trailer_url TEXT;`);
  await pool.query(`ALTER TABLE metadata_shows ADD COLUMN IF NOT EXISTS imdb_id VARCHAR(20);`);
  await pool.query(`ALTER TABLE metadata_movies ADD COLUMN IF NOT EXISTS trailer_url TEXT;`);
  await pool.query(`ALTER TABLE metadata_movies ADD COLUMN IF NOT EXISTS imdb_id VARCHAR(20);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      job_key VARCHAR(50) PRIMARY KEY,
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      last_run_at TIMESTAMP WITH TIME ZONE
    );
  `);
  // Pipeline Match Cycle is intentionally not schedulable — see the comment
  // on JOB_DEFINITIONS in jobScheduler.js for why — so it's excluded from
  // the seed below and explicitly removed for installs that already have it
  // from before this change.
  await pool.query(`
    INSERT INTO scheduled_jobs (job_key, interval_minutes, is_enabled) VALUES
      ('plex_sync', 60, FALSE),
      ('tvdb_refresh', 1440, FALSE),
      ('metadata_cleanup', 1440, FALSE),
      ('watchlist_recheck', 10080, TRUE)
    ON CONFLICT (job_key) DO NOTHING;
  `);
  await pool.query(`DELETE FROM scheduled_jobs WHERE job_key = 'pipeline_match';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      imdb_id VARCHAR(20) NOT NULL UNIQUE,
      user_title VARCHAR(255) NOT NULL,
      type VARCHAR(10) NOT NULL CHECK (type IN ('movie', 'show')),
      tvdb_id VARCHAR(50),
      tvdb_title VARCHAR(255),
      poster_path TEXT,
      release_date VARCHAR(50),
      matched_movie_id INT REFERENCES metadata_movies(id) ON DELETE SET NULL,
      matched_show_id INT REFERENCES metadata_shows(id) ON DELETE SET NULL,
      last_checked_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_watchlist_matched_movie ON watchlist(matched_movie_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_watchlist_matched_show ON watchlist(matched_show_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduler_items (
      id SERIAL PRIMARY KEY,
      type VARCHAR(10) NOT NULL CHECK (type IN ('movie', 'show')),
      movie_id INT REFERENCES metadata_movies(id) ON DELETE CASCADE,
      show_id INT REFERENCES metadata_shows(id) ON DELETE CASCADE,
      resolution_preferences TEXT[] NOT NULL DEFAULT ARRAY['any']::TEXT[],
      allow_season_packs BOOLEAN NOT NULL DEFAULT FALSE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CHECK (
          (type = 'movie' AND movie_id IS NOT NULL AND show_id IS NULL) OR
          (type = 'show'  AND show_id  IS NOT NULL AND movie_id IS NULL)
      )
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduler_items_movie ON scheduler_items(movie_id) WHERE movie_id IS NOT NULL;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduler_items_show ON scheduler_items(show_id) WHERE show_id IS NOT NULL;`);
  // Migrate the old single-value resolution_preference column (pre
  // multi-select) to a resolution_preferences array, for installs that
  // created scheduler_items before this change. Safe to run every boot:
  // once resolution_preference is gone, every statement below is a no-op.
  await pool.query(`ALTER TABLE scheduler_items ADD COLUMN IF NOT EXISTS resolution_preferences TEXT[];`);
  await pool.query(`
    UPDATE scheduler_items SET resolution_preferences = ARRAY[resolution_preference]
    WHERE resolution_preferences IS NULL AND resolution_preference IS NOT NULL;
  `).catch(() => {}); // resolution_preference column may already be gone
  await pool.query(`
    UPDATE scheduler_items SET resolution_preferences = ARRAY['any']::TEXT[]
    WHERE resolution_preferences IS NULL OR array_length(resolution_preferences, 1) IS NULL;
  `);
  await pool.query(`ALTER TABLE scheduler_items ALTER COLUMN resolution_preferences SET DEFAULT ARRAY['any']::TEXT[];`);
  await pool.query(`ALTER TABLE scheduler_items ALTER COLUMN resolution_preferences SET NOT NULL;`);
  await pool.query(`ALTER TABLE scheduler_items DROP COLUMN IF EXISTS resolution_preference;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduler_log (
      id SERIAL PRIMARY KEY,
      scheduler_item_id INT NOT NULL REFERENCES scheduler_items(id) ON DELETE CASCADE,
      metadata_item_id INT NOT NULL REFERENCES metadata_items(id) ON DELETE CASCADE,
      resolution VARCHAR(10),
      downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(scheduler_item_id, metadata_item_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_logs (
      id SERIAL PRIMARY KEY,
      source VARCHAR(50) NOT NULL,
      level VARCHAR(10) NOT NULL DEFAULT 'error',
      message TEXT NOT NULL,
      detail TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pipeline_logs_created_at ON pipeline_logs(created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_actors (
      id SERIAL PRIMARY KEY,
      tvdb_people_id VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      image_path TEXT,
      last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_show_cast (
      id SERIAL PRIMARY KEY,
      show_id INT REFERENCES metadata_shows(id) ON DELETE CASCADE,
      actor_id INT REFERENCES metadata_actors(id) ON DELETE CASCADE,
      character_name VARCHAR(255),
      sort_order INT DEFAULT 0,
      CONSTRAINT unique_show_actor UNIQUE (show_id, actor_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_movie_cast (
      id SERIAL PRIMARY KEY,
      movie_id INT REFERENCES metadata_movies(id) ON DELETE CASCADE,
      actor_id INT REFERENCES metadata_actors(id) ON DELETE CASCADE,
      character_name VARCHAR(255),
      sort_order INT DEFAULT 0,
      CONSTRAINT unique_movie_actor UNIQUE (movie_id, actor_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_metadata_show_cast_show_id ON metadata_show_cast(show_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_metadata_movie_cast_movie_id ON metadata_movie_cast(movie_id);`);

  console.log('Schema check complete (size, trailer_url, imdb_id, scheduled_jobs, pipeline_logs, cast tables, watchlist, scheduler ensured).');
}

module.exports = { waitForDatabase, ensureSchema };