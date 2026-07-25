const { pickEnglishTranslation, extractSeriesFields, extractMovieFields, computeRecentAirDate } = require('./tvdbMetadata');

/**
 * Re-fetches TVDB's extended record for every show and movie already in the
 * catalog (matched purely by their stored tvdb_id) and refreshes title,
 * overview, poster, genres, language, trailer, and IMDb link.
 *
 * For shows, last_aired is NOT taken from extractSeriesFields()'s value
 * (that's only ever a seed for brand-new shows -- see matcher.js). Instead,
 * same as after every live episode match, it's recomputed from the show's
 * real, current episode list via computeRecentAirDate() so a refresh always
 * gives the same authoritative answer the live pipeline would.
 *
 * Runs sequentially (one TVDB request chain per title) rather than in
 * parallel, same conservative approach the rest of this app takes toward
 * TVDB's API -- safer for rate limits, at the cost of taking a while for a
 * large library.
 */
async function refreshAllTvdbMetadata(pool, tvdb) {
  const summary = {
    shows_checked: 0, shows_updated: 0, shows_failed: 0,
    movies_checked: 0, movies_updated: 0, movies_failed: 0,
    errors: [],
  };

  await tvdb.authenticate();

  // ============================================================
  // SERIES
  // ============================================================
  const shows = await pool.query('SELECT id, tvdb_id, title FROM metadata_shows ORDER BY id ASC');
  summary.shows_checked = shows.rows.length;

  for (const show of shows.rows) {
    try {
      const details = await tvdb.getSeriesDetails(show.tvdb_id);
      if (!details) {
        summary.shows_failed++;
        summary.errors.push(`Show ID ${show.id} ("${show.title}"): TVDB returned no details for tvdb_id ${show.tvdb_id}.`);
        continue;
      }

      const englishTranslation =
        pickEnglishTranslation(details.translations) ||
        (await tvdb.getSeriesTranslation(show.tvdb_id));
      const seriesMeta = extractSeriesFields(details, englishTranslation);

      let recentAirDate = null;
      try {
        const seriesEpisodes = await tvdb.getSeriesEpisodesExtended(show.tvdb_id);
        recentAirDate = computeRecentAirDate(seriesEpisodes);
      } catch (airErr) {
        summary.errors.push(`Show ID ${show.id} ("${show.title}"): failed to refresh last_aired: ${airErr.message}`);
      }

      await pool.query(
        `UPDATE metadata_shows SET
           title = COALESCE(NULLIF($1, ''), title),
           overview = COALESCE(NULLIF($2, ''), overview),
           poster_path = COALESCE(NULLIF($3, ''), poster_path),
           status = COALESCE(NULLIF($4, ''), status),
           network = COALESCE(NULLIF($5, ''), network),
           genres = CASE WHEN COALESCE(array_length($6::text[], 1), 0) > 0 THEN $6::text[] ELSE genres END,
           first_aired = COALESCE(NULLIF($7, ''), first_aired),
           last_aired = COALESCE(NULLIF($8, ''), last_aired),
           original_country = COALESCE(NULLIF($9, ''), original_country),
           original_language = COALESCE(NULLIF($10, ''), original_language),
           trailer_url = COALESCE(NULLIF($11, ''), trailer_url),
           imdb_id = COALESCE(NULLIF($12, ''), imdb_id),
           last_updated_at = CURRENT_TIMESTAMP
         WHERE id = $13`,
        [
          seriesMeta.title,
          seriesMeta.overview,
          tvdb.normalizeImageUrl(seriesMeta.poster_path),
          seriesMeta.status,
          seriesMeta.network,
          seriesMeta.genres,
          seriesMeta.first_aired,
          recentAirDate || seriesMeta.last_aired,
          seriesMeta.original_country,
          seriesMeta.original_language,
          seriesMeta.trailer_url,
          seriesMeta.imdb_id,
          show.id,
        ]
      );
      summary.shows_updated++;
    } catch (err) {
      summary.shows_failed++;
      summary.errors.push(`Show ID ${show.id} ("${show.title}"): ${err.message}`);
    }
  }

  // ============================================================
  // MOVIES
  // ============================================================
  const movies = await pool.query('SELECT id, tvdb_id, title FROM metadata_movies ORDER BY id ASC');
  summary.movies_checked = movies.rows.length;

  for (const movie of movies.rows) {
    try {
      const details = await tvdb.getMovieDetails(movie.tvdb_id);
      if (!details) {
        summary.movies_failed++;
        summary.errors.push(`Movie ID ${movie.id} ("${movie.title}"): TVDB returned no details for tvdb_id ${movie.tvdb_id}.`);
        continue;
      }

      const englishTranslation =
        pickEnglishTranslation(details.translations) ||
        (await tvdb.getMovieTranslation(movie.tvdb_id));
      const movieMeta = extractMovieFields(details, englishTranslation);

      await pool.query(
        `UPDATE metadata_movies SET
           title = COALESCE(NULLIF($1, ''), title),
           overview = COALESCE(NULLIF($2, ''), overview),
           poster_path = COALESCE(NULLIF($3, ''), poster_path),
           release_date = COALESCE(NULLIF($4, ''), release_date),
           release_year = COALESCE($5, release_year),
           genres = CASE WHEN COALESCE(array_length($6::text[], 1), 0) > 0 THEN $6::text[] ELSE genres END,
           studios = CASE WHEN COALESCE(array_length($7::text[], 1), 0) > 0 THEN $7::text[] ELSE studios END,
           production_companies = CASE WHEN COALESCE(array_length($8::text[], 1), 0) > 0 THEN $8::text[] ELSE production_companies END,
           original_country = COALESCE(NULLIF($9, ''), original_country),
           original_language = COALESCE(NULLIF($10, ''), original_language),
           trailer_url = COALESCE(NULLIF($11, ''), trailer_url),
           imdb_id = COALESCE(NULLIF($12, ''), imdb_id),
           last_updated_at = CURRENT_TIMESTAMP
         WHERE id = $13`,
        [
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
          movie.id,
        ]
      );
      summary.movies_updated++;
    } catch (err) {
      summary.movies_failed++;
      summary.errors.push(`Movie ID ${movie.id} ("${movie.title}"): ${err.message}`);
    }
  }

  return summary;
}

module.exports = { refreshAllTvdbMetadata };