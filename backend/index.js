const express = require('express');
const { Pool } = require('pg');
const { runScraper } = require('./scraper');
const TVDBClient = require('./tvdb');
const { processPendingMatches } = require('./matcher');

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

// MOVIES: Get all unique movies
app.get('/api/media/movies', async (req, res) => {
  try {
    const movies = await pool.query(
      "SELECT id, title, overview, poster_path, release_date FROM metadata_items WHERE type = 'movie' ORDER BY title ASC"
    );
    res.json({ movies: movies.rows });
  } catch (err) {
    console.error("Error fetching movies:", err.message);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});


/// OLD ENTRIES... are these still needed or have they been replaced
/// OLD ENTRIES.Start

// API Route: Advanced Catalog Search (Queries against Shows & Movie items)
app.get('/api/media/search', async (req, res) => {
  const { query, type, year, hours } = req.query;
  
  let sql = `
    SELECT 
      COALESCE(ms.id, mi.id) as id,
      mi.tvdb_id, 
      mi.type, 
      COALESCE(ms.title, mi.title) as title, 
      COALESCE(ms.overview, mi.overview) as overview, 
      ms.poster_path as poster_path,
      mi.release_date,
      COUNT(DISTINCT CASE WHEN mi.type = 'episode' THEN mi.id END) as episode_count,
      MAX(se.date_scraped) as latest_arrival
    FROM metadata_items mi
    LEFT JOIN metadata_shows ms ON mi.show_id = ms.id
    LEFT JOIN scraped_entries se ON mi.id = se.metadata_item_id
    WHERE 1=1
  `;
  const params = [];

  if (query) {
    params.push(`%${query}%`);
    sql += ` AND (ms.title ILIKE $${params.length} OR mi.title ILIKE $${params.length})`;
  }

  if (type && type !== 'all') {
    params.push(type);
    sql += ` AND mi.type = $${params.length}`;
  }

  if (year) {
    params.push(`%${year}%`);
    sql += ` AND mi.release_date LIKE $${params.length}`;
  }

  if (hours && !isNaN(hours)) {
    params.push(`${parseInt(hours, 10)} hours`);
    sql += ` AND se.date_scraped >= NOW() - CAST($${params.length} AS INTERVAL)`;
  }

  // FIXED: Adjusted GROUP BY references to prevent positional syntax exceptions
  sql += ` GROUP BY ms.id, mi.id, mi.tvdb_id, mi.type, mi.title, mi.overview, ms.poster_path, mi.release_date ORDER BY latest_arrival DESC`;

  try {
    const results = await pool.query(sql, params);
    res.json({ count: results.rowCount, media: results.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Route: Retrieve all targeting units (episodes/packs) for a TV series container
app.get('/api/media/series/:id/episodes', async (req, res) => {
  const { id } = req.params; // This matches the metadata_shows.id returned from search
  try {
    const query = `
      SELECT 
        mi.id, 
        ms.season_number, 
        COALESCE(mi.episode_number, 0) as episode_number, 
        mi.title, 
        mi.overview, 
        mi.air_date,
        CASE WHEN mi.type = 'season_pack' THEN true ELSE false END as is_season_pack
      FROM metadata_items mi
      JOIN metadata_seasons ms ON mi.season_id = ms.id
      WHERE mi.show_id = $1
      ORDER BY ms.season_number ASC, mi.episode_number ASC NULLS FIRST
    `;
    const results = await pool.query(query, [parseInt(id, 10)]);
    res.json({ count: results.rowCount, episodes: results.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Route: Clean Direct Grab for Target Episodes
app.get('/api/media/episodes/:id/entries', async (req, res) => {
  const { id } = req.params; // Direct metadata_items.id reference from row selection
  try {
    const query = `
      SELECT id, title, category, COALESCE(date_scraped, date_published) AS date_scraped, is_season_pack 
      FROM scraped_entries 
      WHERE metadata_item_id = $1
      ORDER BY date_scraped DESC;
    `;
    const results = await pool.query(query, [parseInt(id, 10)]);
    res.json({ count: results.rowCount, entries: results.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Route: Clean Direct Grab for Target Season Packs
app.get('/api/media/episodes/:id/packentries', async (req, res) => {
  const { id } = req.params; // Direct metadata_items.id reference from pack row selection
  try {
    const query = `
      SELECT id, title, category, COALESCE(date_scraped, date_published) AS date_scraped, is_season_pack 
      FROM scraped_entries 
      WHERE metadata_item_id = $1
      ORDER BY date_scraped DESC;
    `;
    const results = await pool.query(query, [parseInt(id, 10)]);
    res.json({ count: results.rowCount, entries: results.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});
/// OLD ENTRIES.END



// =========================================================================
// ADMIN API ENDPOINTS
// =========================================================================

// API Route: SELECT all tracking scrape sources for the administration panels
app.get('/api/admin/sources', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, url, interval_minutes, is_active, last_run_at, created_at FROM scrape_sources ORDER BY id ASC"
    );
    res.json({ count: result.rowCount, sources: result.rows });
  } catch (error) {
    console.error("Failed to query scrape sources list:", error.message);
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});




app.listen(port, async () => {
  console.log(`Harvest Backend listening at http://localhost:${port}`);
  await runScraper(pool);
  await processPendingMatches(pool, tvdb);
  setInterval(async () => {
    await runScraper(pool);
    await processPendingMatches(pool, tvdb);
  }, 5 * 60 * 1000);
});