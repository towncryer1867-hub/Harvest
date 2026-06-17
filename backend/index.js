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

// API Route: View the latest items harvested by the engine
app.get('/api/entries', async (req, res) => {
  try {
    const entries = await pool.query(`
      SELECT e.id, e.title, e.category, e.date_published, e.match_status, s.name as source_name 
      FROM scraped_entries e
      LEFT JOIN  scrape_sources s ON e.source_id = s.id
      ORDER BY e.date_published DESC 
      LIMIT 50
    `);
    res.json({ count: entries.rowCount, entries: entries.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Route: Test live metadata search validation via TheTVDB
app.get('/api/test-search', async (req, res) => {
  const testTitle = req.query.q || "The Boys";
  try {
    const searchResults = await tvdb.searchMedia(testTitle);
    res.json({
      query_processed: testTitle,
      results_found: searchResults.length,
      data: searchResults
    });
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data || null });
  }
});

// API Health Check Route
app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT name, last_run_at, interval_minutes FROM scrape_sources');
    res.json({
      status: 'Harvest Backend is running',
      database: 'Connected successfully',
      sources: dbCheck.rows,
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({ database: 'Connection failed', error: error.message });
  }
});

// API Route: Manually match/override an item link using an explicit TVDB ID
app.post('/api/manual-match', async (req, res) => {
  const { entry_id, tvdb_id } = req.body;

  if (!entry_id || !tvdb_id) {
    return res.status(400).json({ error: "Missing required properties entry_id or tvdb_id" });
  }

  try {
    // 1. Fetch details directly from TVDB using the verified ID asset tag
    const details = await tvdb.getSeriesDetails(tvdb_id);
    if (!details) {
      return res.status(404).json({ error: "No series asset found on TVDB with that ID" });
    }

    // 2. Insert into metadata cache
    const metaInsert = `
      INSERT INTO metadata_items (tvdb_id, type, title, overview, poster_path)
      VALUES ($1, 'series', $2, $3, $4)
      ON CONFLICT (tvdb_id) DO UPDATE SET title = EXCLUDED.title
      RETURNING id;
    `;
    const metaRes = await pool.query(metaInsert, [
      tvdb_id,
      details.name,
      details.overview || '',
      details.image || ''
    ]);

    const metadataItemId = metaRes.rows[0].id;

    // 3. Force-bind the scraped entry item row and mark status complete
    await pool.query(
      "UPDATE scraped_entries SET metadata_item_id = $1, match_status = 'matched' WHERE id = $2",
      [metadataItemId, entry_id]
    );

    res.json({ success: true, message: `Successfully re-bound item to "${details.name}"` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Route: Fetch aggregate parsing metrics and failed items for the Admin Queue
app.get('/api/admin/queue', async (req, res) => {
  try {
    // 1. Get status counts
    const countsQuery = await pool.query(`
      SELECT match_status, COUNT(*) as count 
      FROM scraped_entries 
      GROUP BY match_status
    `);

    // 2. Get a list of failed items to display in the fix-it panel
    const failedItemsQuery = await pool.query(`
      SELECT id, title, category, date_scraped 
      FROM scraped_entries 
      WHERE match_status = 'failed'
      ORDER BY date_scraped DESC 
      LIMIT 20
    `);

    // Format counts into a clean key-value object
    const stats = { matched: 0, unmatched: 0, failed: 0 };
    countsQuery.rows.forEach(row => {
      stats[row.match_status] = parseInt(row.count, 10);
    });

    res.json({
      stats,
      failed_items: failedItemsQuery.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Route: Force ONLY the metadata matcher to re-evaluate pending/failed items
app.post('/api/admin/force-sync', async (req, res) => {
  console.log("Admin triggered a metadata-only matching cycle retry...");
  try {
    // 1. Skip the scraper entirely, go straight to processing the TVDB links
    await processPendingMatches(pool, tvdb);

    // 2. Grab the updated metrics to refresh the UI dashboard counters
    const countsQuery = await pool.query(`
      SELECT match_status, COUNT(*) as count 
      FROM scraped_entries 
      GROUP BY match_status
    `);

    const stats = { matched: 0, unmatched: 0, failed: 0 };
    countsQuery.rows.forEach(row => {
      stats[row.match_status] = parseInt(row.count, 10);
    });

    res.json({ success: true, message: "Metadata matching retry complete.", stats });
  } catch (error) {
    console.error("Manual matching retry failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// API Route: Consumer media search engine with advanced filtering options
app.get('/api/media/search', async (req, res) => {
  const { query, type, year, hours } = req.query;
  
  let sql = `
    SELECT mi.id, mi.tvdb_id, mi.type, mi.title, mi.overview, mi.poster_path, mi.release_date,
           COUNT(me.id) as episode_count,
           MAX(se.date_scraped) as latest_arrival
    FROM metadata_items mi
    LEFT JOIN metadata_episodes me ON mi.id = me.metadata_item_id
    LEFT JOIN scraped_entries se ON mi.id = se.metadata_item_id
    WHERE 1=1
  `;
  const params = [];

  if (query) {
    params.push(`%${query}%`);
    sql += ` AND mi.title ILIKE $${params.length}`;
  }

  if (type && type !== 'all') {
    params.push(type);
    sql += ` AND mi.type = $${params.length}`;
  }

  if (year) {
    params.push(`%${year}%`);
    sql += ` AND mi.release_date LIKE $${params.length}`;
  }

  // Safely inject hours parameter to prevent raw syntax string truncation
  if (hours && !isNaN(hours)) {
    params.push(`${parseInt(hours, 10)} hours`);
    sql += ` AND se.date_scraped >= NOW() - CAST($${params.length} AS INTERVAL)`;
  }

  sql += ` GROUP BY mi.id ORDER BY latest_arrival DESC`;

  try {
    const results = await pool.query(sql, params);
    res.json({ count: results.rowCount, media: results.rows });
  } catch (error) {
    console.error("Search API Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// API Route: Retrieve all episodes for a specific TV series
app.get('/api/media/series/:id/episodes', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      SELECT id, season_number, episode_number, title, overview, air_date, is_season_pack
      FROM metadata_episodes
      WHERE metadata_item_id = $1
      ORDER BY season_number ASC, episode_number ASC
    `;
    const results = await pool.query(query, [parseInt(id, 10)]);
    res.json({ count: results.rowCount, episodes: results.rows });
  } catch (error) {
    console.error("Failed to fetch series episodes:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// API Route: Retrieve all raw scraped releases matching a specific episode ID
app.get('/api/media/episodes/:id/entries', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      WITH target_ep AS (
        SELECT metadata_item_id, season_number, episode_number, is_season_pack 
        FROM metadata_episodes 
        WHERE id = $1
      )
      SELECT 
        se.id, 
        se.title, 
        se.category, 
        -- Select both possible naming variations safely so frontend never breaks
        COALESCE(se.date_scraped, se.date_published) AS date_scraped, 
        se.is_season_pack 
      FROM scraped_entries se
      CROSS JOIN target_ep te
      WHERE se.metadata_item_id = te.metadata_item_id
        AND (
          -- CASE 1: The clicked target is explicitly a season pack
          (
            te.is_season_pack = true
            AND se.is_season_pack = true
            -- Matches any variation containing S04 or Season 4
            AND (
              se.title ILIKE CONCAT('%S', LPAD(te.season_number::text, 2, '0'), '%')
              OR se.title ILIKE CONCAT('%S', te.season_number::text, '%')
              OR se.title ILIKE CONCAT('%Season%', te.season_number::text, '%')
            )
          )
          OR
          -- CASE 2: Standard Individual Episode Matching
          (
            COALESCE(te.is_season_pack, false) = false
            AND (
              se.title ILIKE CONCAT('%S', LPAD(te.season_number::text, 2, '0'), 'E', LPAD(te.episode_number::text, 2, '0'), '%')
              OR se.title ILIKE CONCAT('%S', te.season_number::text, 'E', te.episode_number::text, '%')
              OR se.title ILIKE CONCAT('%', te.season_number::text, 'x', LPAD(te.episode_number::text, 2, '0'), '%')
            )
          )
        )
      ORDER BY date_scraped DESC;
    `;
    
    const results = await pool.query(query, [parseInt(id, 10)]);
    res.json({ count: results.rowCount, entries: results.rows });
  } catch (error) {
    console.error("Failed to fetch raw entries for episode:", error.message);
    res.status(500).json({ error: error.message });
  }
});






// Admin API: Create a new scraping source configuration live
app.post('/api/admin/sources', async (req, res) => {
  const { name, url, interval_minutes, config } = req.body;

  // Basic validation to catch issues before hitting the DB
  if (!name || !url || !interval_minutes || !config) {
    return res.status(400).json({ error: "All parameters (name, url, interval_minutes, config) are required." });
  }

  try {
    const query = `
      INSERT INTO scrape_sources (name, url, interval_minutes, config_mapping)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, name;
    `;
    
    // We pass the JSON config object through JSON.stringify so Postgres treats it as valid JSONB text
    const result = await pool.query(query, [name, url, interval_minutes, JSON.stringify(config)]);
    
    res.status(201).json({ 
      success: true, 
      message: "Scraping source deployed live!",
      id: result.rows[0].id,
      name: result.rows[0].name
    });
  } catch (error) {
    console.error("Failed to insert live scraping source:", error.message);
    res.status(500).json({ error: error.message });
  }
});



// API Listener: Run initial scrape and process + check back every 5 min to ensure data is up-to-date
app.listen(port, async () => {
  console.log(`Harvest Backend listening at http://localhost:${port}`);
  
  // Trigger a baseline scrape instantly on startup so we don't have to wait for timers
  console.log("Bootstrapping initial scraper run...");
  await runScraper(pool);
  await processPendingMatches(pool, tvdb);

  // Poll for pipeline updates periodically every 5 minutes
  setInterval(async () => {
    await runScraper(pool);
    await processPendingMatches(pool, tvdb);
  }, 5 * 60 * 1000);
});