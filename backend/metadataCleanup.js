/**
 * Removes orphaned metadata records that have drifted out of sync with the
 * raw scraped entries that back them:
 *   1. Episode items with no scraped entry pointing at them anymore.
 *   2. Movies whose sole item has no scraped entry pointing at it anymore
 *      (cascades to the movie's metadata_items row).
 *   3. Shows left with zero episodes once step 1 runs (cascades to their
 *      seasons and any remaining season-pack items).
 * Order matters: episodes must be cleared before shows are evaluated.
 *
 * Shared by the manual "Clean Up Metadata Database" admin button and the
 * configurable scheduled job (see jobScheduler.js) so both paths run the
 * exact same logic.
 */
async function cleanupOrphanedMetadata(pool) {
  const orphanedEpisodes = await pool.query(`
    DELETE FROM metadata_items
    WHERE type = 'episode'
      AND NOT EXISTS (
        SELECT 1 FROM scraped_entries se WHERE se.metadata_item_id = metadata_items.id
      )
    RETURNING id
  `);

  const orphanedMovies = await pool.query(`
    DELETE FROM metadata_movies
    WHERE id IN (
      SELECT mi.movie_id FROM metadata_items mi
      WHERE mi.type = 'movie'
        AND NOT EXISTS (
          SELECT 1 FROM scraped_entries se WHERE se.metadata_item_id = mi.id
        )
    )
    RETURNING id
  `);

  const emptyShows = await pool.query(`
    DELETE FROM metadata_shows
    WHERE id NOT IN (
      SELECT DISTINCT show_id FROM metadata_items WHERE type = 'episode' AND show_id IS NOT NULL
    )
    RETURNING id
  `);

  return {
    episodes_removed: orphanedEpisodes.rowCount,
    movies_removed: orphanedMovies.rowCount,
    shows_removed: emptyShows.rowCount,
  };
}

module.exports = { cleanupOrphanedMetadata };
