const { matchWatchlistItem } = require('./watchlistMatcher');

// Same conservative spacing matcher.js uses between TVDB calls within a
// batch — keeps well under TVDB's rate limit.
const INTER_REQUEST_DELAY_MS = 1500;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries the TVDB + library match for every watchlist row that isn't fully
 * resolved yet — no TVDB match at all, or a TVDB match with no linked
 * catalog entry. Run weekly by the 'watchlist_recheck' scheduled job (see
 * jobScheduler.js), and re-runs the exact same logic a fresh POST /api/watchlist
 * insert triggers (matchWatchlistItem), so nothing new to reason about here.
 */
async function recheckUnmatchedWatchlist(pool, tvdb) {
  const summary = { checked: 0, tvdb_matched: 0, library_matched: 0, errors: [] };

  const rows = await pool.query(
    `SELECT id, imdb_id, type, tvdb_id
     FROM watchlist
     WHERE tvdb_id IS NULL OR (matched_movie_id IS NULL AND matched_show_id IS NULL)
     ORDER BY id ASC`
  );

  await tvdb.authenticate();

  for (const row of rows.rows) {
    summary.checked++;
    try {
      const updated = await matchWatchlistItem(pool, tvdb, row);
      if (updated.tvdb_id) summary.tvdb_matched++;
      if (updated.matched_movie_id || updated.matched_show_id) summary.library_matched++;
    } catch (err) {
      summary.errors.push(`Watchlist item ${row.id} (${row.imdb_id}): ${err.message}`);
    }
    await delay(INTER_REQUEST_DELAY_MS);
  }

  return summary;
}

module.exports = { recheckUnmatchedWatchlist };
