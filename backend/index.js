const express = require('express');
const { Pool } = require('pg');
const { runScraper } = require('./scraper');
const TVDBClient = require('./tvdb');
const { processPendingMatches } = require('./matcher');
const { sendError } = require('./errors');
const { waitForDatabase } = require('./db');

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const tvdb = new TVDBClient(process.env.TVDB_API_KEY);


// =========================================================================
// LIBRARY API ENDPOINTS FOR THE NEW FRONTEND ARCHITECTURE
// =========================================================================

// MOVIES: Get all unique movie profiles
app.get('/api/media/movies', async (req, res) => {
  try {
    const movies = await pool.query(
      "SELECT id, tvdb_id, title, overview, poster_path, release_date FROM metadata_movies ORDER BY title ASC"
    );
    res.json({ movies: movies.rows });
  } catch (err) {
    console.error("Error fetching movies:", err.message);
    sendError(res, err);
  }
});

// MOVIES: Get scraped entries linked to a movie profile (via metadata_items)
app.get('/api/media/movies/:movieId/entries', async (req, res) => {
  const { movieId } = req.params;
  try {
    const entries = await pool.query(
      `SELECT e.id, e.title, e.category, e.magnet_link, e.date_scraped
       FROM scraped_entries e
       JOIN metadata_items i ON e.metadata_item_id = i.id
       WHERE i.movie_id = $1 AND i.type = 'movie'
       ORDER BY e.date_scraped DESC`,
      [parseInt(movieId, 10)]
    );
    res.json({ entries: entries.rows });
  } catch (err) {
    console.error("Error fetching movie entries:", err.message);
    sendError(res, err);
  }
});

// TV: Get all top-level TV shows
app.get('/api/media/shows', async (req, res) => {
  try {
    const shows = await pool.query(
      "SELECT id, tvdb_id, title, overview, poster_path FROM metadata_shows ORDER BY title ASC"
    );
    res.json({ shows: shows.rows });
  } catch (err) {
    console.error("Error fetching shows:", err.message);
    sendError(res, err);
  }
});

// TV: Get all unique seasons for a specific show (Row 1 Selector)
app.get('/api/media/shows/:showId/seasons', async (req, res) => {
  const { showId } = req.params;
  try {
    const seasons = await pool.query(
      "SELECT id, season_number FROM metadata_seasons WHERE show_id = $1 ORDER BY season_number ASC",
      [parseInt(showId, 10)]
    );
    res.json({ seasons: seasons.rows });
  } catch (err) {
    console.error("Error fetching seasons:", err.message);
    sendError(res, err);
  }
});

// TV: Get all season packs for a show (Row 2 Display)
app.get('/api/media/shows/:showId/season-packs', async (req, res) => {
  const { showId } = req.params;
  try {
    const packs = await pool.query(
      `SELECT i.id, i.title, i.overview, s.season_number 
       FROM metadata_items i
       JOIN metadata_seasons s ON i.season_id = s.id
       WHERE i.show_id = $1 AND i.type = 'season_pack'
       ORDER BY s.season_number ASC`,
      [parseInt(showId, 10)]
    );
    res.json({ season_packs: packs.rows });
  } catch (err) {
    console.error("Error fetching season packs:", err.message);
    sendError(res, err);
  }
});

// TV: Get all episodes for a show (Row 3 Display)
app.get('/api/media/shows/:showId/episodes', async (req, res) => {
  const { showId } = req.params;
  try {
    const episodes = await pool.query(
      `SELECT i.id, i.title, i.overview, i.episode_number, i.air_date, s.season_number 
       FROM metadata_items i
       JOIN metadata_seasons s ON i.season_id = s.id
       WHERE i.show_id = $1 AND i.type = 'episode'
       ORDER BY s.season_number ASC, i.episode_number ASC`,
      [parseInt(showId, 10)]
    );
    res.json({ episodes: episodes.rows });
  } catch (err) {
    console.error("Error fetching episodes:", err.message);
    sendError(res, err);
  }
});

// ENTITES: Get raw scraped stream items linked to a specific movie or episode
app.get('/api/media/items/:itemId/entries', async (req, res) => {
  const { itemId } = req.params;
  try {
    const entries = await pool.query(
      "SELECT id, title, category, magnet_link, date_scraped FROM scraped_entries WHERE metadata_item_id = $1 ORDER BY date_scraped DESC",
      [parseInt(itemId, 10)]
    );
    res.json({ entries: entries.rows });
  } catch (err) {
    console.error("Error fetching item links:", err.message);
    sendError(res, err);
  }
});

// ENTITES: Get raw scraped stream items linked to an entire Season Pack container
app.get('/api/media/shows/:showId/seasons/:seasonNumber/pack-entries', async (req, res) => {
  const { showId, seasonNumber } = req.params;
  try {
    // Looks up entries attached to the 'season_pack' row for that precise show season
    const entries = await pool.query(
      `SELECT e.id, e.title, e.category, e.magnet_link, e.date_scraped 
       FROM scraped_entries e
       JOIN metadata_items i ON e.metadata_item_id = i.id
       JOIN metadata_seasons s ON i.season_id = s.id
       WHERE i.show_id = $1 AND s.season_number = $2 AND i.type = 'season_pack'`,
      [parseInt(showId, 10), parseInt(seasonNumber, 10)]
    );
    res.json({ entries: entries.rows });
  } catch (err) {
    console.error("Error fetching pack links:", err.message);
    sendError(res, err);
  }
});

// API Route: View raw unmatched or general feed logs
app.get('/api/entries', async (req, res) => {
  try {
    const entries = await pool.query(`
      SELECT e.id, e.title, e.category, e.date_published, e.match_status, s.name as source_name 
      FROM scraped_entries e
      LEFT JOIN scrape_sources s ON e.source_id = s.id
      ORDER BY e.date_published DESC 
      LIMIT 50
    `);
    res.json({ count: entries.rowCount, entries: entries.rows });
  } catch (error) {
    sendError(res, error);
  }
});

// Manual Match Override Endpoint
app.post('/api/manual-match', async (req, res) => {
  const { entry_id, tvdb_id } = req.body;
  if (!entry_id || !tvdb_id) return res.status(400).json({ error: "Missing properties" });

  try {
    const details = await tvdb.getSeriesDetails(tvdb_id);
    if (!details) return res.status(404).json({ error: "No series found" });

    const showRow = await pool.query(`
      INSERT INTO metadata_shows (tvdb_id, title, overview, poster_path)
      VALUES ($1, $2, $3, $4) ON CONFLICT (tvdb_id) DO UPDATE SET title = EXCLUDED.title RETURNING id
    `, [tvdb_id, details.name, details.overview || '', details.image || '']);
    
    // Create an explicit structural placeholder pack item for manual fallback allocations
    const seasonRow = await pool.query(`
      INSERT INTO metadata_seasons (show_id, season_number, title)
      VALUES ($1, 1, 'Season 1') ON CONFLICT (show_id, season_number) DO UPDATE SET title = EXCLUDED.title RETURNING id
    `, [showRow.rows[0].id]);

    const itemRow = await pool.query(`
      INSERT INTO metadata_items (type, show_id, season_id, title, overview)
      VALUES ('season_pack', $1, $2, $3, $4) RETURNING id
    `, [showRow.rows[0].id, seasonRow.rows[0].id, `${details.name} - Manual Override Pack`, 'Manually linked resource listing']);

    await pool.query("UPDATE scraped_entries SET metadata_item_id = $1, match_status = 'matched' WHERE id = $2", [itemRow.rows[0].id, entry_id]);
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

// =========================================================================
// ADMIN API ENDPOINTS
// =========================================================================

// API Route: SELECT all tracking scrape sources for the administration panels
app.get('/api/admin/sources', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, url, interval_minutes, is_active, last_run_at, created_at, config_mapping FROM scrape_sources ORDER BY id ASC"
    );
    res.json({ count: result.rowCount, sources: result.rows });
  } catch (error) {
    console.error("Failed to query scrape sources list:", error.message);
    sendError(res, error);
  }
});

// API Route: SELECT Dashboard Metrics
app.get('/api/admin/queue', async (req, res) => {
  try {
    const countsQuery = await pool.query(`
      SELECT match_status, COUNT(*) as count FROM scraped_entries GROUP BY match_status
    `);
    const failedItemsQuery = await pool.query(`
      SELECT id, title, category, date_scraped FROM scraped_entries WHERE match_status = 'failed' ORDER BY date_scraped DESC LIMIT 20
    `);

    const stats = { matched: 0, unmatched: 0, failed: 0, ignored: 0 };
    countsQuery.rows.forEach(row => { stats[row.match_status] = parseInt(row.count, 10); });

    res.json({ stats, failed_items: failedItemsQuery.rows });
  } catch (error) {
    sendError(res, error);
  }
});

// API Route: Force Engine Pipeline Sync
// NEED BETTER DESCRIPTION FOR THIS
app.post('/api/admin/force-sync', async (req, res) => {
  try {
    await processPendingMatches(pool, tvdb);
    const countsQuery = await pool.query(`SELECT match_status, COUNT(*) as count FROM scraped_entries GROUP BY match_status`);
    const stats = { matched: 0, unmatched: 0, failed: 0, ignored: 0 };
    countsQuery.rows.forEach(row => { stats[row.match_status] = parseInt(row.count, 10); });
    res.json({ success: true, message: "Metadata matching retry complete.", stats });
  } catch (error) {
    sendError(res, error);
  }
});

// API Route: UPDATE Entry as ignored so metadata parsing bypasses it
app.post('/api/admin/entries/:id/ignore', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "UPDATE scraped_entries SET match_status = 'ignored' WHERE id = $1 RETURNING id, title",
      [parseInt(id, 10)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Scraped entry item not found." });
    }

    res.json({
      success: true,
      message: `Successfully ignored entry: ${result.rows[0].title}`,
      id: result.rows[0].id
    });
  } catch (error) {
    console.error("Failed to flag entry as ignored:", error.message);
    sendError(res, error);
  }
});

// API Route: UPDATE an existing scraping source configuration
app.put('/api/admin/sources/:id', async (req, res) => {
  const { id } = req.params;
  const { name, url, interval_minutes, config, is_active } = req.body;

  if (!name || !url || !interval_minutes || !config) {
    return res.status(400).json({ error: "Name, url, interval_minutes, and config parameters are all required." });
  }

  try {
    const query = `
      UPDATE scrape_sources 
      SET 
        name = $1, 
        url = $2, 
        interval_minutes = $3, 
        config_mapping = $4::jsonb,
        is_active = $5
      WHERE id = $6
      RETURNING id, name;
    `;
    
    const result = await pool.query(query, [
      name, 
      url, 
      parseInt(interval_minutes, 10), 
      JSON.stringify(config), 
      is_active !== undefined ? is_active : true,
      parseInt(id, 10)
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Scraping source tracking entry not found." });
    }
    
    res.json({ 
      success: true, 
      message: "Source configuration successfully updated live.", 
      id: result.rows[0].id, 
      name: result.rows[0].name 
    });
  } catch (error) {
    console.error("Failed to update scraping source:", error.message);
    sendError(res, error);
  }
});

// API Route: INSRT INTO scraping source with new configuration
app.post('/api/admin/sources', async (req, res) => {
  const { name, url, interval_minutes, config } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO scrape_sources (name, url, interval_minutes, config_mapping) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, name`,
      [name, url, interval_minutes, JSON.stringify(config)]
    );
    res.status(201).json({ success: true, id: result.rows[0].id, name: result.rows[0].name });
  } catch (error) {
    sendError(res, error);
  }
});




const PIPELINE_TICK_MS = 60 * 1000;
let pipelineRunning = false;

async function runPipeline() {
  if (pipelineRunning) {
    console.log('Pipeline already running, skipping tick.');
    return;
  }
  pipelineRunning = true;
  try {
    await runScraper(pool);
    await processPendingMatches(pool, tvdb);
  } catch (err) {
    console.error('Pipeline error:', err.message);
  } finally {
    pipelineRunning = false;
  }
}

function schedulePipeline() {
  runPipeline().finally(() => {
    setTimeout(schedulePipeline, PIPELINE_TICK_MS);
  });
}

app.listen(port, async () => {
  try {
    await waitForDatabase(pool);
    console.log(`Harvest Backend listening at http://localhost:${port}`);
    schedulePipeline();
  } catch (err) {
    console.error('Failed to start backend:', err.message);
    process.exit(1);
  }
});