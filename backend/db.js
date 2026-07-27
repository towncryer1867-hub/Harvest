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
      ('metadata_cleanup', 1440, FALSE)
    ON CONFLICT (job_key) DO NOTHING;
  `);
  await pool.query(`DELETE FROM scheduled_jobs WHERE job_key = 'pipeline_match';`);

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

  console.log('Schema check complete (size, trailer_url, imdb_id, scheduled_jobs, pipeline_logs ensured).');
}

module.exports = { waitForDatabase, ensureSchema };