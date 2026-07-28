const { extractCast } = require('./tvdbMetadata');

async function upsertActor(pool, tvdb, entry) {
  const result = await pool.query(
    `INSERT INTO metadata_actors (tvdb_people_id, name, image_path)
     VALUES ($1, $2, $3)
     ON CONFLICT (tvdb_people_id) DO UPDATE SET
       name = EXCLUDED.name,
       image_path = COALESCE(NULLIF(EXCLUDED.image_path, ''), metadata_actors.image_path)
     RETURNING id`,
    [entry.tvdb_people_id, entry.actor_name, tvdb.normalizeImageUrl(entry.image_path)]
  );
  return result.rows[0].id;
}

/**
 * Replaces a show's/movie's cast list with whatever TVDB's extended record
 * currently reports (full delete-then-reinsert of the join table rows, so a
 * recast or a since-removed credit doesn't linger). `extended` is the raw
 * response from tvdb.getSeriesDetails()/getMovieDetails() — if it's
 * missing/null (e.g. a transient fetch failure elsewhere in the caller),
 * this is a no-op rather than wiping out previously-synced cast data.
 *
 * Shared by matcher.js (first match), tvdbRefresh.js (periodic refresh), and
 * index.js's fix-match route (manual re-match) so all three paths keep cast
 * data in sync the same way.
 */
async function syncShowCast(pool, tvdb, showId, extended) {
  if (!extended) return;
  const cast = extractCast(extended);

  await pool.query('DELETE FROM metadata_show_cast WHERE show_id = $1', [showId]);
  for (const entry of cast) {
    const actorId = await upsertActor(pool, tvdb, entry);
    await pool.query(
      `INSERT INTO metadata_show_cast (show_id, actor_id, character_name, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (show_id, actor_id) DO UPDATE SET
         character_name = EXCLUDED.character_name, sort_order = EXCLUDED.sort_order`,
      [showId, actorId, entry.character_name, entry.sort_order]
    );
  }
}

async function syncMovieCast(pool, tvdb, movieId, extended) {
  if (!extended) return;
  const cast = extractCast(extended);

  await pool.query('DELETE FROM metadata_movie_cast WHERE movie_id = $1', [movieId]);
  for (const entry of cast) {
    const actorId = await upsertActor(pool, tvdb, entry);
    await pool.query(
      `INSERT INTO metadata_movie_cast (movie_id, actor_id, character_name, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (movie_id, actor_id) DO UPDATE SET
         character_name = EXCLUDED.character_name, sort_order = EXCLUDED.sort_order`,
      [movieId, actorId, entry.character_name, entry.sort_order]
    );
  }
}

module.exports = { syncShowCast, syncMovieCast };
