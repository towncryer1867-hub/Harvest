const { normalizeResolution, matchesPreference } = require('./resolutionBuckets');

/**
 * Evaluates whether a just-matched scrape (episode, season pack, or movie)
 * should be auto-sent to qBittorrent, per the user-maintained scheduler_items
 * table. Called from matcher.js right after a metadata_items row is
 * upserted and its owning scraped_entries row is marked 'matched'.
 *
 * ctx = {
 *   entityType: 'episode' | 'season_pack' | 'movie',
 *   metadataItemId: number,   // the metadata_items row just matched
 *   showId: number|null,      // set for episode/season_pack
 *   movieId: number|null,     // set for movie
 *   resolutionRaw: string|null, // parsed.resolution from mediaParser.js
 *   magnetLink: string|null,
 * }
 */
async function evaluateSchedulerTrigger(pool, qbClient, ctx) {
  const { entityType, metadataItemId, showId, movieId, resolutionRaw, magnetLink } = ctx;

  const schedulerCol = entityType === 'movie' ? 'movie_id' : 'show_id';
  const schedulerEntityId = entityType === 'movie' ? movieId : showId;
  if (!schedulerEntityId) return;

  const schedulerRes = await pool.query(
    `SELECT id, resolution_preferences, allow_season_packs FROM scheduler_items WHERE ${schedulerCol} = $1 AND enabled = TRUE`,
    [schedulerEntityId]
  );
  if (schedulerRes.rowCount === 0) return; // not scheduled, or disabled
  const schedulerItem = schedulerRes.rows[0];

  if (entityType === 'season_pack' && !schedulerItem.allow_season_packs) return;

  const logRes = await pool.query(
    `SELECT id FROM scheduler_log WHERE scheduler_item_id = $1 AND metadata_item_id = $2`,
    [schedulerItem.id, metadataItemId]
  );
  if (logRes.rowCount > 0) return; // already grabbed once, regardless of resolution

  // Plex check doesn't apply to season packs (Plex has no native "pack"
  // concept — plexSync.js's proxy for a pack is "any episode of that season
  // in Plex", which isn't a meaningful gate for whether to grab the pack).
  if (entityType !== 'season_pack') {
    const itemRes = await pool.query('SELECT in_plex FROM metadata_items WHERE id = $1', [metadataItemId]);
    if (itemRes.rows[0]?.in_plex) return;
  }

  const bucket = normalizeResolution(resolutionRaw);
  if (!matchesPreference(bucket, schedulerItem.resolution_preferences)) return;

  if (!magnetLink || !qbClient.isConfigured()) return;

  const category = entityType === 'movie'
    ? (process.env.QBITTORRENT_CATEGORY_MOVIES || 'movies')
    : (process.env.QBITTORRENT_CATEGORY_TV || 'tv');

  await qbClient.addTorrent(magnetLink, category);

  await pool.query(
    `INSERT INTO scheduler_log (scheduler_item_id, metadata_item_id, resolution) VALUES ($1, $2, $3)
     ON CONFLICT (scheduler_item_id, metadata_item_id) DO NOTHING`,
    [schedulerItem.id, metadataItemId, bucket]
  );

  if (entityType === 'movie') {
    await pool.query(
      `UPDATE scheduler_items SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [schedulerItem.id]
    );
  }
}

module.exports = { evaluateSchedulerTrigger };
