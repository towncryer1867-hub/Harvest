const { pickEnglishTranslation, extractSeriesFields, extractMovieFields } = require('./tvdbMetadata');
const { logPipelineEvent } = require('./pipelineLog');

/**
 * Pulls a usable { tvdbId, kind } pair out of TVDB's /search/remoteid
 * response. Each result wrapper carries at most one of `series`/`movie`
 * (plus other remote-id kinds like `people` we don't care about here);
 * `kind` matches watchlist.type's vocabulary ('show' | 'movie').
 */
function pickRemoteIdMatch(results, preferredKind) {
  const candidates = (results || [])
    .map((r) => {
      if (r?.series?.id) return { kind: 'show', tvdbId: r.series.id };
      if (r?.movie?.id) return { kind: 'movie', tvdbId: r.movie.id };
      return null;
    })
    .filter(Boolean);

  if (candidates.length === 0) return null;
  return candidates.find((c) => c.kind === preferredKind) || candidates[0];
}

/**
 * Enriches one watchlist row: looks it up on TVDB by its IMDB id, then
 * cross-references the resulting tvdb_id (or, if TVDB had no match, does
 * nothing further) against metadata_shows/metadata_movies — the same
 * tvdb_id join key plexSync.js uses to cross-reference Plex.
 *
 * Always stamps last_checked_at, even on a full miss, so
 * watchlistRecheck.js's weekly job can tell "checked, no match" apart from
 * "never checked".
 */
async function matchWatchlistItem(pool, tvdb, watchlistRow) {
  const { id, imdb_id, type } = watchlistRow;

  let tvdbId = null;
  let tvdbTitle = null;
  let posterPath = null;
  let releaseDate = null;

  try {
    const remoteResults = await tvdb.findByRemoteId(imdb_id);
    const match = pickRemoteIdMatch(remoteResults, type);

    if (match) {
      if (match.kind === 'show') {
        const details = await tvdb.getSeriesDetails(match.tvdbId);
        if (details) {
          const englishTranslation =
            pickEnglishTranslation(details.translations) ||
            (await tvdb.getSeriesTranslation(match.tvdbId));
          const meta = extractSeriesFields(details, englishTranslation);
          tvdbId = String(match.tvdbId);
          tvdbTitle = meta.title || null;
          posterPath = meta.poster_path ? tvdb.normalizeImageUrl(meta.poster_path) : null;
          releaseDate = meta.first_aired || null;
        }
      } else {
        const details = await tvdb.getMovieDetails(match.tvdbId);
        if (details) {
          const englishTranslation =
            pickEnglishTranslation(details.translations) ||
            (await tvdb.getMovieTranslation(match.tvdbId));
          const meta = extractMovieFields(details, englishTranslation);
          tvdbId = String(match.tvdbId);
          tvdbTitle = meta.title || null;
          posterPath = meta.poster_path ? tvdb.normalizeImageUrl(meta.poster_path) : null;
          releaseDate = meta.release_date || null;
        }
      }
    }
  } catch (err) {
    console.error(`Watchlist TVDB lookup failed for id ${id} (${imdb_id}):`, err.message);
    await logPipelineEvent(pool, {
      source: 'watchlist',
      message: `TVDB lookup failed for watchlist item ${id} (${imdb_id}): ${err.message}`,
      detail: err.stack,
    });
  }

  // Use the freshly-found tvdb_id when there is one, otherwise fall back to
  // whatever this row already had (e.g. this run's TVDB lookup errored out,
  // or watchlistRecheck.js is retrying a row that's already TVDB-matched but
  // still missing its library cross-reference) — either way we still want
  // to re-check the catalog for a newly-matched metadata_* row rather than
  // wiping out an existing match with NULL.
  const effectiveTvdbId = tvdbId || watchlistRow.tvdb_id || null;

  let matchedMovieId = null;
  let matchedShowId = null;

  if (effectiveTvdbId) {
    try {
      if (type === 'movie') {
        const row = await pool.query('SELECT id FROM metadata_movies WHERE tvdb_id = $1', [effectiveTvdbId]);
        matchedMovieId = row.rows[0]?.id || null;
      } else {
        const row = await pool.query('SELECT id FROM metadata_shows WHERE tvdb_id = $1', [effectiveTvdbId]);
        matchedShowId = row.rows[0]?.id || null;
      }
    } catch (err) {
      console.error(`Watchlist library cross-reference failed for id ${id}:`, err.message);
      await logPipelineEvent(pool, {
        source: 'watchlist',
        message: `Library cross-reference failed for watchlist item ${id}: ${err.message}`,
        detail: err.stack,
      });
    }
  }

  const updated = await pool.query(
    `UPDATE watchlist SET
       tvdb_id = COALESCE($1, tvdb_id),
       tvdb_title = COALESCE($2, tvdb_title),
       poster_path = COALESCE($3, poster_path),
       release_date = COALESCE($4, release_date),
       matched_movie_id = $5,
       matched_show_id = $6,
       last_checked_at = CURRENT_TIMESTAMP
     WHERE id = $7
     RETURNING *`,
    [tvdbId, tvdbTitle, posterPath, releaseDate, matchedMovieId, matchedShowId, id]
  );

  return updated.rows[0];
}

module.exports = { matchWatchlistItem };
