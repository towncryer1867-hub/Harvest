const { syncPlexFlags, buildPlexClientFromEnv } = require('./plexSync');
const { sendError } = require('./errors');

/**
 * Registers Plex cross-reference admin endpoints on an existing Express app.
 * Call this from index.js: registerPlexRoutes(app, pool);
 */
function registerPlexRoutes(app, pool) {
  // GET: current configuration state + last-known in_plex counts (no live Plex call)
  app.get('/api/admin/plex-status', async (req, res) => {
    try {
      const client = buildPlexClientFromEnv();
      const counts = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM metadata_shows WHERE in_plex) AS shows_in_plex,
          (SELECT COUNT(*)::int FROM metadata_shows) AS shows_total,
          (SELECT COUNT(*)::int FROM metadata_movies WHERE in_plex) AS movies_in_plex,
          (SELECT COUNT(*)::int FROM metadata_movies) AS movies_total,
          (SELECT COUNT(*)::int FROM metadata_items WHERE type = 'episode' AND in_plex) AS episodes_in_plex,
          (SELECT COUNT(*)::int FROM metadata_items WHERE type = 'episode') AS episodes_total,
          (SELECT COUNT(*)::int FROM metadata_items WHERE type = 'season_pack' AND in_plex) AS season_packs_in_plex,
          (SELECT COUNT(*)::int FROM metadata_items WHERE type = 'season_pack') AS season_packs_total
      `);
      res.json({
        configured: client.isConfigured(),
        counts: counts.rows[0],
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  // POST: runs a live sync against the Plex server and updates in_plex flags
  app.post('/api/admin/plex-sync', async (req, res) => {
    try {
      const summary = await syncPlexFlags(pool);
      if (summary.skipped) {
        return res.status(400).json({ success: false, ...summary });
      }
      res.json({ success: true, ...summary });
    } catch (error) {
      console.error('Plex sync failed:', error.message);
      sendError(res, error);
    }
  });
}

module.exports = { registerPlexRoutes };