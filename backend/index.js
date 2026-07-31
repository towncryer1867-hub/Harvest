const express = require('express');
const { Pool } = require('pg');
const { runScraper } = require('./scraper');
const TVDBClient = require('./tvdb');
const { processPendingMatches } = require('./matcher');
const { sendError, initErrorLogging } = require('./errors');
const { waitForDatabase, ensureSchema } = require('./db');
const { registerPlexRoutes } = require('./plexRoutes');
const { registerQBittorrentRoutes } = require('./qbittorrentRoutes');
const {
  parseListQuery,
  buildSeriesQuery,
  buildMoviesQuery,
  buildFilterOptionsQueries,
} = require('./libraryQueries');
const { pickEnglishTranslation, extractSeriesFields, extractMovieFields } = require('./tvdbMetadata');
const { refreshAllTvdbMetadata } = require('./tvdbRefresh');
const { cleanupOrphanedMetadata } = require('./metadataCleanup');
const { runDueScheduledJobs, JOB_DEFINITIONS, JOB_KEYS } = require('./jobScheduler');
const { logPipelineEvent } = require('./pipelineLog');
const { syncShowCast, syncMovieCast } = require('./castSync');
const { parseWatchlistListQuery, buildWatchlistQuery } = require('./watchlistQueries');
const { matchWatchlistItem } = require('./watchlistMatcher');
const { parseSchedulerListQuery, buildSchedulerQuery } = require('./schedulerQueries');
const { normalizeResolutionPreferences } = require('./resolutionBuckets');

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
initErrorLogging(pool);
registerPlexRoutes(app, pool);
registerQBittorrentRoutes(app);


// =========================================================================
// LIBRARY API ENDPOINTS FOR THE NEW FRONTEND ARCHITECTURE
// =========================================================================

// MOVIES: List movie profiles with search, sort, filter, and pagination
app.get('/api/media/movies', async (req, res) => {
  try {
    const listQuery = parseListQuery(req, 'movie');
    const built = buildMoviesQuery({
      ...listQuery,
      filters: {
        genre: req.query.genre || '',
        studio: req.query.studio || '',
        production_company: req.query.production_company || '',
        release_year: req.query.release_year || '',
        original_country: req.query.original_country || '',
        original_language: req.query.original_language || '',
        in_plex: req.query.in_plex || '',
      },
    });

    const [countResult, movies] = await Promise.all([
      pool.query(built.countSql, built.params),
      pool.query(built.dataSql, built.dataParams),
    ]);

    const total = countResult.rows[0].total;
    const { page, limit } = built.pagination;

    res.json({
      movies: movies.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("Error fetching movies:", err.message);
    sendError(res, err);
  }
});

// MOVIES: Single movie profile (for deep-link / navigation restore)
app.get('/api/media/movies/:movieId', async (req, res) => {
  const { movieId } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, tvdb_id, title, overview, poster_path, release_date, release_year,
              genres, studios, production_companies, original_country, original_language,
              in_plex, plex_checked_at, trailer_url, imdb_id,
              EXISTS(SELECT 1 FROM watchlist w WHERE w.matched_movie_id = metadata_movies.id) AS in_watchlist,
              (SELECT si.id FROM scheduler_items si WHERE si.movie_id = metadata_movies.id) AS scheduler_item_id,
              (SELECT si.enabled FROM scheduler_items si WHERE si.movie_id = metadata_movies.id) AS scheduler_enabled,
              (SELECT si.resolution_preferences FROM scheduler_items si WHERE si.movie_id = metadata_movies.id) AS scheduler_resolution_preferences
       FROM metadata_movies WHERE id = $1`,
      [parseInt(movieId, 10)]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    res.json({ movie: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
});

// MOVIES: Cast list (see castSync.js for how this is populated from TVDB)
app.get('/api/media/movies/:movieId/cast', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.name, a.image_path, c.character_name, c.sort_order
       FROM metadata_movie_cast c
       JOIN metadata_actors a ON a.id = c.actor_id
       WHERE c.movie_id = $1
       ORDER BY c.sort_order ASC, a.name ASC`,
      [parseInt(req.params.movieId, 10)]
    );
    res.json({ cast: result.rows });
  } catch (err) {
    sendError(res, err);
  }
});

// MOVIES: Get scraped entries linked to a movie profile (via metadata_items)
app.get('/api/media/movies/:movieId/entries', async (req, res) => {
  const { movieId } = req.params;
  try {
    const entries = await pool.query(
      `SELECT e.id, e.title, e.category, e.magnet_link, e.size, e.date_scraped
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

// TV: List TV shows with search, sort, filter, and pagination
app.get('/api/media/shows', async (req, res) => {
  try {
    const listQuery = parseListQuery(req, 'series');
    const built = buildSeriesQuery({
      ...listQuery,
      filters: {
        network: req.query.network || '',
        genre: req.query.genre || '',
        status: req.query.status || '',
        first_aired_year: req.query.first_aired_year || '',
        original_country: req.query.original_country || '',
        original_language: req.query.original_language || '',
        in_plex: req.query.in_plex || '',
      },
    });

    const [countResult, shows] = await Promise.all([
      pool.query(built.countSql, built.params),
      pool.query(built.dataSql, built.dataParams),
    ]);

    const total = countResult.rows[0].total;
    const { page, limit } = built.pagination;

    res.json({
      shows: shows.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("Error fetching shows:", err.message);
    sendError(res, err);
  }
});

// LIBRARY: Distinct filter option values for dropdowns
app.get('/api/media/filter-options', async (req, res) => {
  const type = req.query.type === 'movie' ? 'movie' : 'series';
  try {
    const queries = buildFilterOptionsQueries(type);
    const entries = await Promise.all(
      Object.entries(queries).map(async ([key, sql]) => {
        const result = await pool.query(sql);
        return [key, result.rows.map((row) => row.value).filter((v) => v != null && v !== '')];
      })
    );
    res.json({ type, options: Object.fromEntries(entries) });
  } catch (err) {
    console.error("Error fetching filter options:", err.message);
    sendError(res, err);
  }
});

// =========================================================================
// WATCHLIST API ENDPOINTS
// =========================================================================

const IMDB_ID_PATTERN = /^tt\d{7,9}$/i;

// WATCHLIST: List entries with search, sort, type filter, and pagination
app.get('/api/watchlist', async (req, res) => {
  try {
    const listQuery = parseWatchlistListQuery(req);
    const built = buildWatchlistQuery(listQuery);

    const [countResult, items] = await Promise.all([
      pool.query(built.countSql, built.params),
      pool.query(built.dataSql, built.dataParams),
    ]);

    const total = countResult.rows[0].total;
    const { page, limit } = built.pagination;

    res.json({
      items: items.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("Error fetching watchlist:", err.message);
    sendError(res, err);
  }
});

// WATCHLIST: Add an item by IMDB id. Only the ID's format is validated (no
// live IMDB existence check — this is a single-user tool and the user is
// typing the ID themselves); TheTVDB match + library cross-reference then
// run synchronously so the response comes back fully enriched when
// possible. If that enrichment fails, the row is still kept (unmatched) —
// the weekly 'watchlist_recheck' job will retry it (see watchlistRecheck.js).
app.post('/api/watchlist', async (req, res) => {
  const { user_title, type, imdb_id } = req.body;

  if (!user_title || !String(user_title).trim()) {
    return res.status(400).json({ error: 'user_title is required.' });
  }
  if (type !== 'movie' && type !== 'show') {
    return res.status(400).json({ error: "type must be 'movie' or 'show'." });
  }
  if (!imdb_id || !IMDB_ID_PATTERN.test(String(imdb_id).trim())) {
    return res.status(400).json({ error: 'imdb_id must look like "tt1234567".' });
  }
  const normalizedImdbId = String(imdb_id).trim().toLowerCase();

  try {
    const existing = await pool.query('SELECT id FROM watchlist WHERE imdb_id = $1', [normalizedImdbId]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'That IMDB id is already on your watchlist.' });
    }

    const inserted = await pool.query(
      `INSERT INTO watchlist (imdb_id, user_title, type) VALUES ($1, $2, $3) RETURNING *`,
      [normalizedImdbId, String(user_title).trim(), type]
    );
    let item = inserted.rows[0];

    try {
      item = await matchWatchlistItem(pool, tvdb, item);
    } catch (matchErr) {
      console.error(`Watchlist enrichment failed for new item ${item.id}:`, matchErr.message);
      await logPipelineEvent(pool, {
        source: 'watchlist',
        message: `Enrichment failed for new watchlist item ${item.id} (${normalizedImdbId}): ${matchErr.message}`,
        detail: matchErr.stack,
      });
    }

    res.status(201).json({ success: true, item });
  } catch (err) {
    console.error("Error adding watchlist item:", err.message);
    sendError(res, err);
  }
});

// WATCHLIST: Remove an item
app.delete('/api/watchlist/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM watchlist WHERE id = $1 RETURNING id', [parseInt(req.params.id, 10)]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Watchlist item not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error removing watchlist item:", err.message);
    sendError(res, err);
  }
});

// =========================================================================
// SCHEDULER API ENDPOINTS
// =========================================================================

// SCHEDULER: List entries with search, sort, type filter, and pagination
app.get('/api/scheduler', async (req, res) => {
  try {
    const listQuery = parseSchedulerListQuery(req);
    const built = buildSchedulerQuery(listQuery);

    const [countResult, items] = await Promise.all([
      pool.query(built.countSql, built.params),
      pool.query(built.dataSql, built.dataParams),
    ]);

    const total = countResult.rows[0].total;
    const { page, limit } = built.pagination;

    res.json({
      items: items.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("Error fetching scheduler list:", err.message);
    sendError(res, err);
  }
});

// SCHEDULER: Add a show to the scheduler (from the "Add to Scheduler"
// button on the Show detail page). Movie scheduling has been removed from
// the product surface — `type` is hard-coded to 'show' here rather than
// stripped from the schema/queries, so the movie_id half of scheduler_items
// (and schedulerTrigger.js's movie branch) stays intact as dead-but-cheap
// infrastructure instead of a rewrite if this needs to come back.
// The unique partial index on scheduler_items(show_id) backs the 409 below
// — a show can only be scheduled once, matching Edit being the only way to
// change it afterwards.
app.post('/api/scheduler', async (req, res) => {
  const type = 'show';
  const { show_id, resolution_preferences, allow_season_packs } = req.body;

  const entityId = parseInt(show_id, 10);
  if (!entityId || Number.isNaN(entityId)) {
    return res.status(400).json({ error: 'show_id is required.' });
  }
  const resPrefs = normalizeResolutionPreferences(resolution_preferences);
  if (!resPrefs) {
    return res.status(400).json({ error: 'Invalid resolution_preferences.' });
  }

  try {
    const entityExists = await pool.query('SELECT id FROM metadata_shows WHERE id = $1', [entityId]);
    if (entityExists.rowCount === 0) {
      return res.status(404).json({ error: 'Show not found.' });
    }

    const existing = await pool.query(
      `SELECT id FROM scheduler_items WHERE show_id = $1`,
      [entityId]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'That title is already on the scheduler.' });
    }

    const inserted = await pool.query(
      `INSERT INTO scheduler_items (type, movie_id, show_id, resolution_preferences, allow_season_packs, enabled)
       VALUES ($1, NULL, $2, $3, $4, TRUE) RETURNING *`,
      [type, entityId, resPrefs, !!allow_season_packs]
    );

    res.status(201).json({ success: true, item: inserted.rows[0] });
  } catch (err) {
    console.error("Error adding scheduler item:", err.message);
    sendError(res, err);
  }
});

// SCHEDULER: Update resolution preferences / season-pack policy / enabled
// state (the Edit modal, opened from the Scheduler listing page or the
// detail page's "Edit Scheduler" button).
app.put('/api/scheduler/:id', async (req, res) => {
  const { resolution_preferences, allow_season_packs, enabled } = req.body;

  const resPrefs = normalizeResolutionPreferences(resolution_preferences);
  if (!resPrefs) {
    return res.status(400).json({ error: 'Invalid resolution_preferences.' });
  }

  try {
    const result = await pool.query(
      `UPDATE scheduler_items
       SET resolution_preferences = $1, allow_season_packs = $2, enabled = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [resPrefs, !!allow_season_packs, enabled !== false, parseInt(req.params.id, 10)]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Scheduler item not found.' });
    }
    res.json({ success: true, item: result.rows[0] });
  } catch (err) {
    console.error("Error updating scheduler item:", err.message);
    sendError(res, err);
  }
});

// SCHEDULER: Remove an item
app.delete('/api/scheduler/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM scheduler_items WHERE id = $1 RETURNING id', [parseInt(req.params.id, 10)]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Scheduler item not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error removing scheduler item:", err.message);
    sendError(res, err);
  }
});

// TV: Single show profile (for deep-link / navigation restore)
app.get('/api/media/shows/:showId/profile', async (req, res) => {
  const { showId } = req.params;
  try {
    const result = await pool.query(
      `SELECT s.id, s.tvdb_id, s.title, s.overview, s.poster_path, s.status, s.network, s.genres,
              s.first_aired, s.last_aired, s.original_country, s.original_language,
              s.in_plex, s.plex_checked_at, s.trailer_url, s.imdb_id,
              EXISTS(SELECT 1 FROM watchlist w WHERE w.matched_show_id = s.id) AS in_watchlist,
              (SELECT si.id FROM scheduler_items si WHERE si.show_id = s.id) AS scheduler_item_id,
              (SELECT si.enabled FROM scheduler_items si WHERE si.show_id = s.id) AS scheduler_enabled,
              (SELECT si.resolution_preferences FROM scheduler_items si WHERE si.show_id = s.id) AS scheduler_resolution_preferences,
              (SELECT si.allow_season_packs FROM scheduler_items si WHERE si.show_id = s.id) AS scheduler_allow_season_packs,
              pub.latest_published
       FROM metadata_shows s
       LEFT JOIN LATERAL (
         SELECT MAX(e.date_published) AS latest_published
         FROM metadata_items i
         JOIN scraped_entries e ON e.metadata_item_id = i.id
         WHERE i.show_id = s.id
       ) pub ON true
       WHERE s.id = $1`,
      [parseInt(showId, 10)]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Show not found' });
    }
    res.json({ show: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
});

// TV: Cast list (see castSync.js for how this is populated from TVDB)
app.get('/api/media/shows/:showId/cast', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.name, a.image_path, c.character_name, c.sort_order
       FROM metadata_show_cast c
       JOIN metadata_actors a ON a.id = c.actor_id
       WHERE c.show_id = $1
       ORDER BY c.sort_order ASC, a.name ASC`,
      [parseInt(req.params.showId, 10)]
    );
    res.json({ cast: result.rows });
  } catch (err) {
    sendError(res, err);
  }
});

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
      `SELECT i.id, i.title, i.overview, i.in_plex, s.season_number
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
      `SELECT i.id, i.title, i.overview, i.episode_number, i.air_date, i.in_plex, s.season_number
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
      "SELECT id, title, category, magnet_link, size, date_scraped FROM scraped_entries WHERE metadata_item_id = $1 ORDER BY date_scraped DESC",
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
      `SELECT e.id, e.title, e.category, e.magnet_link, e.size, e.date_scraped
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

// API Route: View raw unmatched or general feed logs (paginated, newest first)
app.get('/api/entries', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const status = req.query.status;

    const params = [];
    let whereClause = '';
    if (status && status !== 'all') {
      params.push(status);
      whereClause = 'WHERE e.match_status = $1';
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM scraped_entries e ${whereClause}`,
      params
    );
    const total = countResult.rows[0].total;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const entries = await pool.query(
      `SELECT e.id, e.title, e.category, e.date_published, e.date_scraped, e.match_status, s.name AS source_name
       FROM scraped_entries e
       LEFT JOIN scrape_sources s ON e.source_id = s.id
       ${whereClause}
       ORDER BY COALESCE(e.date_scraped, e.date_published) DESC, e.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset]
    );

    res.json({
      count: entries.rowCount,
      entries: entries.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
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

    const englishTranslation =
      pickEnglishTranslation(details.translations) ||
      (await tvdb.getSeriesTranslation(tvdb_id));
    const seriesMeta = extractSeriesFields(details, englishTranslation);

    const showRow = await pool.query(`
      INSERT INTO metadata_shows (
        tvdb_id, title, overview, poster_path, status, network, genres,
        first_aired, last_aired, original_country, original_language,
        trailer_url, imdb_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (tvdb_id) DO UPDATE SET title = EXCLUDED.title RETURNING id
    `, [
      tvdb_id,
      seriesMeta.title,
      seriesMeta.overview,
      tvdb.normalizeImageUrl(seriesMeta.poster_path),
      seriesMeta.status,
      seriesMeta.network,
      seriesMeta.genres,
      seriesMeta.first_aired,
      seriesMeta.last_aired,
      seriesMeta.original_country,
      seriesMeta.original_language,
      seriesMeta.trailer_url,
      seriesMeta.imdb_id,
    ]);

    // Create an explicit structural placeholder pack item for manual fallback allocations
    const seasonRow = await pool.query(`
      INSERT INTO metadata_seasons (show_id, season_number, title)
      VALUES ($1, 1, 'Season 1') ON CONFLICT (show_id, season_number) DO UPDATE SET title = EXCLUDED.title RETURNING id
    `, [showRow.rows[0].id]);

    const itemRow = await pool.query(`
      INSERT INTO metadata_items (type, show_id, season_id, title, overview)
      VALUES ('season_pack', $1, $2, $3, $4) RETURNING id
    `, [showRow.rows[0].id, seasonRow.rows[0].id, `${seriesMeta.title} - Manual Override Pack`, 'Manually linked resource listing']);

    await pool.query("UPDATE scraped_entries SET metadata_item_id = $1, match_status = 'matched' WHERE id = $2", [itemRow.rows[0].id, entry_id]);
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

// ENTRIES: Fix Match — re-point a single raw scraped entry at the correct
// TVDB series/season/episode or movie, WITHOUT touching whatever
// episode/movie item it's currently (mis)attached to. Every other entry
// still attached to that old item is left alone; we find-or-create the
// correct target item and move only this one entry onto it.
app.post('/api/entries/:entryId/fix-match', async (req, res) => {
  const entryId = parseInt(req.params.entryId, 10);
  const { type, tvdb_id } = req.body;

  if (type !== 'movie' && type !== 'episode') {
    return res.status(400).json({ error: "type must be 'movie' or 'episode'." });
  }
  if (!tvdb_id) {
    return res.status(400).json({ error: 'A TVDB ID is required.' });
  }

  try {
    const existingEntry = await pool.query('SELECT id FROM scraped_entries WHERE id = $1', [entryId]);
    if (existingEntry.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });

    let targetItemId;

    if (type === 'movie') {
      const details = await tvdb.getMovieDetails(tvdb_id);
      if (!details) return res.status(404).json({ error: 'No movie found on TheTVDB for that ID.' });

      const englishTranslation =
        pickEnglishTranslation(details.translations) ||
        (await tvdb.getMovieTranslation(tvdb_id));
      const movieMeta = extractMovieFields(details, englishTranslation);

      const movieRow = await pool.query(`
        INSERT INTO metadata_movies (
          tvdb_id, title, overview, poster_path, release_date, release_year,
          genres, studios, production_companies, original_country, original_language,
          trailer_url, imdb_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (tvdb_id) DO UPDATE SET title = EXCLUDED.title
        RETURNING id
      `, [
        tvdb_id,
        movieMeta.title,
        movieMeta.overview,
        tvdb.normalizeImageUrl(movieMeta.poster_path),
        movieMeta.release_date,
        movieMeta.release_year,
        movieMeta.genres,
        movieMeta.studios,
        movieMeta.production_companies,
        movieMeta.original_country,
        movieMeta.original_language,
        movieMeta.trailer_url,
        movieMeta.imdb_id,
      ]);
      const movieId = movieRow.rows[0].id;
      await syncMovieCast(pool, tvdb, movieId, details);

      const itemRow = await pool.query(`
        INSERT INTO metadata_items (type, movie_id, title, overview)
        VALUES ('movie', $1, $2, $3)
        ON CONFLICT (movie_id) DO UPDATE SET
          title = EXCLUDED.title,
          overview = COALESCE(NULLIF(EXCLUDED.overview, ''), metadata_items.overview)
        RETURNING id
      `, [movieId, movieMeta.title, movieMeta.overview]);
      targetItemId = itemRow.rows[0].id;

    } else {
      const { season, episode } = req.body;
      if (season === undefined || season === null || season === '' || episode === undefined || episode === null || episode === '') {
        return res.status(400).json({ error: 'Season and episode numbers are both required.' });
      }
      const seasonNum = parseInt(season, 10);
      const episodeNum = parseInt(episode, 10);
      if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) {
        return res.status(400).json({ error: 'Season and episode must be numbers.' });
      }

      const details = await tvdb.getSeriesDetails(tvdb_id);
      if (!details) return res.status(404).json({ error: 'No series found on TheTVDB for that ID.' });

      const englishTranslation =
        pickEnglishTranslation(details.translations) ||
        (await tvdb.getSeriesTranslation(tvdb_id));
      const seriesMeta = extractSeriesFields(details, englishTranslation);

      const showRow = await pool.query(`
        INSERT INTO metadata_shows (
          tvdb_id, title, overview, poster_path, status, network, genres,
          first_aired, last_aired, original_country, original_language,
          trailer_url, imdb_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (tvdb_id) DO UPDATE SET title = EXCLUDED.title
        RETURNING id
      `, [
        tvdb_id,
        seriesMeta.title,
        seriesMeta.overview,
        tvdb.normalizeImageUrl(seriesMeta.poster_path),
        seriesMeta.status,
        seriesMeta.network,
        seriesMeta.genres,
        seriesMeta.first_aired,
        seriesMeta.last_aired,
        seriesMeta.original_country,
        seriesMeta.original_language,
        seriesMeta.trailer_url,
        seriesMeta.imdb_id,
      ]);
      const showId = showRow.rows[0].id;
      await syncShowCast(pool, tvdb, showId, details);

      const seasonRow = await pool.query(`
        INSERT INTO metadata_seasons (show_id, season_number)
        VALUES ($1, $2)
        ON CONFLICT (show_id, season_number) DO UPDATE SET season_number = EXCLUDED.season_number
        RETURNING id
      `, [showId, seasonNum]);
      const seasonId = seasonRow.rows[0].id;

      const epUrl = `${tvdb.baseUrl}/series/${tvdb_id}/episodes/default`;
      const epRes = await require('axios').get(epUrl, {
        headers: tvdb.getHeaders(),
        params: { page: 0, season: seasonNum, episodeNumber: episodeNum }
      });
      const episodes = epRes.data.data?.episodes || [];
      const matchEp = episodes.find(e => e.seasonNumber === seasonNum && e.number === episodeNum) || episodes[0];

      const itemRow = await pool.query(`
        INSERT INTO metadata_items (type, tvdb_id, show_id, season_id, episode_number, title, overview, air_date)
        VALUES ('episode', $1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (show_id, season_id, episode_number) DO UPDATE SET
          title = EXCLUDED.title,
          overview = COALESCE(NULLIF(EXCLUDED.overview, ''), metadata_items.overview),
          air_date = COALESCE(NULLIF(EXCLUDED.air_date, ''), metadata_items.air_date),
          tvdb_id = COALESCE(NULLIF(EXCLUDED.tvdb_id, ''), metadata_items.tvdb_id)
        RETURNING id
      `, [
        matchEp && matchEp.id ? String(matchEp.id) : null,
        showId,
        seasonId,
        episodeNum,
        matchEp ? (matchEp.name || `Episode ${episodeNum}`) : `Episode ${episodeNum}`,
        matchEp ? matchEp.overview : '',
        matchEp ? matchEp.aired : null,
      ]);
      targetItemId = itemRow.rows[0].id;
    }

    await pool.query(
      "UPDATE scraped_entries SET metadata_item_id = $1, match_status = 'matched' WHERE id = $2",
      [targetItemId, entryId]
    );

    res.json({ success: true, metadata_item_id: targetItemId });
  } catch (error) {
    console.error('Failed to fix entry match:', error.message);
    sendError(res, error);
  }
});

// =========================================================================
// ADMIN API ENDPOINTS
// =========================================================================

// API Route: UPDATE a failed entry back to unmatched for reprocessing
app.post('/api/admin/entries/:id/retry', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "UPDATE scraped_entries SET match_status = 'unmatched' WHERE id = $1 AND match_status = 'failed' RETURNING id, title",
      [parseInt(id, 10)]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Entry not found or not in failed status.' });
    }
    res.json({ success: true, message: `Reset entry for reprocessing: ${result.rows[0].title}`, id: result.rows[0].id });
  } catch (error) {
    console.error("Failed to reset entry status:", error.message);
    sendError(res, error);
  }
});

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

// API Route: Bulk-refresh TVDB metadata (title, overview, poster, genres,
// language, trailer, IMDb link, and -- for shows -- a recomputed last
// aired date) for every show and movie already matched in the catalog.
app.post('/api/admin/tvdb-refresh', async (req, res) => {
  try {
    const summary = await refreshAllTvdbMetadata(pool, tvdb);
    res.json({ success: true, ...summary });
  } catch (error) {
    console.error('TVDB metadata refresh failed:', error.message);
    sendError(res, error);
  }
});

// API Route: Clean up orphaned metadata records (see metadataCleanup.js for
// the rules). Shared with the configurable scheduled job of the same name.
app.post('/api/admin/cleanup-metadata', async (req, res) => {
  try {
    const summary = await cleanupOrphanedMetadata(pool);
    res.json({ success: true, ...summary });
  } catch (error) {
    console.error('Metadata cleanup failed:', error.message);
    sendError(res, error);
  }
});

// API Route: List the configurable schedules backing each Admin Controls
// automation button (Plex sync, TVDB refresh, pipeline match, metadata
// cleanup), merged with their static labels from jobScheduler.js.
app.get('/api/admin/scheduled-jobs', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT job_key, interval_minutes, is_enabled, last_run_at FROM scheduled_jobs ORDER BY job_key ASC'
    );
    const jobs = result.rows.map((row) => ({
      ...row,
      label: JOB_DEFINITIONS[row.job_key]?.label || row.job_key,
    }));
    res.json({ jobs });
  } catch (error) {
    console.error('Failed to fetch scheduled jobs:', error.message);
    sendError(res, error);
  }
});

// API Route: UPDATE a scheduled job's interval and enabled state
app.put('/api/admin/scheduled-jobs/:jobKey', async (req, res) => {
  const { jobKey } = req.params;
  const { interval_minutes, is_enabled } = req.body;

  if (!JOB_KEYS.includes(jobKey)) {
    return res.status(404).json({ error: `Unknown job "${jobKey}".` });
  }
  const intervalNum = parseInt(interval_minutes, 10);
  if (Number.isNaN(intervalNum) || intervalNum < 1) {
    return res.status(400).json({ error: 'interval_minutes must be a positive number.' });
  }

  try {
    const result = await pool.query(
      `UPDATE scheduled_jobs SET interval_minutes = $1, is_enabled = $2 WHERE job_key = $3
       RETURNING job_key, interval_minutes, is_enabled, last_run_at`,
      [intervalNum, !!is_enabled, jobKey]
    );
    res.json({ success: true, job: { ...result.rows[0], label: JOB_DEFINITIONS[jobKey].label } });
  } catch (error) {
    console.error(`Failed to update scheduled job "${jobKey}":`, error.message);
    sendError(res, error);
  }
});

// API Route: Per-source health rollup for the Diagnostics panel — the most
// recent error logged for each pipeline component (scraper, matcher,
// scheduler:*, etc.) plus how many errors that source has logged in the
// last hour/24h, so a stalled component (e.g. matcher erroring every cycle)
// is obvious at a glance without reading raw log rows.
app.get('/api/admin/diagnostics/summary', async (req, res) => {
  try {
    const latestPerSource = await pool.query(`
      SELECT DISTINCT ON (source) source, level, message, created_at
      FROM pipeline_logs
      WHERE level = 'error'
      ORDER BY source, created_at DESC
    `);

    const countsPerSource = await pool.query(`
      SELECT source,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS count_last_hour,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS count_last_24h
      FROM pipeline_logs
      WHERE level = 'error'
      GROUP BY source
    `);

    const countsBySource = Object.fromEntries(
      countsPerSource.rows.map((row) => [row.source, row])
    );

    const sources = latestPerSource.rows.map((row) => ({
      source: row.source,
      last_error_message: row.message,
      last_error_at: row.created_at,
      count_last_hour: countsBySource[row.source]?.count_last_hour || 0,
      count_last_24h: countsBySource[row.source]?.count_last_24h || 0,
    }));

    res.json({ sources });
  } catch (error) {
    console.error('Failed to fetch diagnostics summary:', error.message);
    sendError(res, error);
  }
});

// API Route: Raw pipeline log listing (the "log checker"), most recent
// first. Optional ?source= and ?level= filters, ?limit= caps rows (max 500).
app.get('/api/admin/logs', async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const { source, level } = req.query;

  const conditions = [];
  const params = [];
  if (source) {
    params.push(source);
    conditions.push(`source = $${params.length}`);
  }
  if (level) {
    params.push(level);
    conditions.push(`level = $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  try {
    const result = await pool.query(
      `SELECT id, source, level, message, detail, created_at FROM pipeline_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json({ logs: result.rows });
  } catch (error) {
    console.error('Failed to fetch pipeline logs:', error.message);
    sendError(res, error);
  }
});

// API Route: Clear the pipeline log (e.g. after resolving whatever was
// causing the errors, to reset the Diagnostics view to a clean slate).
app.delete('/api/admin/logs', async (req, res) => {
  try {
    await pool.query('DELETE FROM pipeline_logs');
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to clear pipeline logs:', error.message);
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

  // `!interval_minutes` would wrongly reject a legitimate 0 (falsy in JS —
  // used by the "Find more from X" / "Initiate a Search" quick-search
  // sources for "run on every tick"), so check for actually-missing instead
  // of falsy.
  const intervalProvided = interval_minutes !== undefined && interval_minutes !== null && interval_minutes !== '';
  const intervalNum = parseInt(interval_minutes, 10);
  if (!name || !url || !intervalProvided || Number.isNaN(intervalNum) || intervalNum < 0 || !config) {
    return res.status(400).json({ error: "Name, url, interval_minutes (0 or greater), and config parameters are all required." });
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
      intervalNum,
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
  if (!url) {
    return res.status(400).json({ error: 'url is required.' });
  }

  try {
    // Check first rather than leaning on the UNIQUE constraint catch below —
    // url is the uniqueness factor (both here and for the main.jsx
    // "Find more from X" / "Initiate a Search" quick-search buttons, whose
    // URL is deterministic from the sanitized keyword, so re-searching the
    // same title/keyword lands here every time). Checking up front means a
    // duplicate is a normal "already exists" response instead of a failed
    // write — and, since sendError now logs every API 500 to the
    // Diagnostics tab, it also keeps that log free of non-error noise.
    const existing = await pool.query('SELECT id, name FROM scrape_sources WHERE url = $1', [url]);
    if (existing.rowCount > 0) {
      return res.status(200).json({
        success: true,
        already_existed: true,
        id: existing.rows[0].id,
        name: existing.rows[0].name,
      });
    }

    const result = await pool.query(
      `INSERT INTO scrape_sources (name, url, interval_minutes, config_mapping) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, name`,
      [name, url, interval_minutes, JSON.stringify(config)]
    );
    res.status(201).json({ success: true, id: result.rows[0].id, name: result.rows[0].name });
  } catch (error) {
    // Fallback safety net for a race between two near-simultaneous requests
    // for the same new URL (both pass the SELECT above before either INSERT
    // commits) — should be rare given this is a single-admin internal tool.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A search source for this already exists in Ingestion Sources.' });
    }
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
    await runDueScheduledJobs(pool, tvdb);
  } catch (err) {
    console.error('Pipeline error:', err.message);
    await logPipelineEvent(pool, {
      source: 'pipeline',
      message: `Pipeline tick aborted: ${err.message}`,
      detail: err.stack,
    });
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
    await ensureSchema(pool);
    console.log(`Harvest Backend listening at http://localhost:${port}`);
    schedulePipeline();
  } catch (err) {
    console.error('Failed to start backend:', err.message);
    process.exit(1);
  }
});