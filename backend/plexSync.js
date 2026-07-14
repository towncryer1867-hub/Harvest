const PlexClient = require('./plexClient');

function buildPlexClientFromEnv() {
  return new PlexClient({
    baseUrl: process.env.PLEX_SERVER_URL,
    token: process.env.PLEX_TOKEN,
  });
}

/**
 * Cross-references Harvest's catalog (shows, movies, episodes, season packs)
 * against a Plex Media Server library and flags what's already in Plex.
 *
 * Matching strategy:
 *  - Shows / Movies: matched by TVDB id (metadata_shows.tvdb_id / metadata_movies.tvdb_id
 *    vs the tvdb:// guid Plex reports for the item, requested via includeGuids=1).
 *  - Episodes: for each show matched in Plex, we walk its seasons -> episodes and match
 *    by (season_number, episode_number) against Harvest's metadata_items.
 *  - Season packs: flagged in_plex = true if Plex has at least one episode for that season
 *    (a "pack" isn't a first-class Plex concept, so presence of the season is our proxy).
 *
 * Writes results into the `in_plex` / `plex_rating_key` / `plex_checked_at` columns
 * added by migrations/001_add_plex_flags.sql.
 */
async function syncPlexFlags(pool, plexClient = buildPlexClientFromEnv()) {
  if (!plexClient.isConfigured()) {
    return {
      skipped: true,
      reason: 'Plex is not configured. Set PLEX_SERVER_URL and PLEX_TOKEN.',
    };
  }

  const summary = {
    skipped: false,
    shows_checked: 0, shows_matched: 0,
    movies_checked: 0, movies_matched: 0,
    episodes_checked: 0, episodes_matched: 0,
    season_packs_checked: 0, season_packs_matched: 0,
    errors: [],
  };

  const sections = await plexClient.getSections();

  const tvSectionFilter = process.env.PLEX_TV_SECTION_ID ? String(process.env.PLEX_TV_SECTION_ID) : null;
  const movieSectionFilter = process.env.PLEX_MOVIE_SECTION_ID ? String(process.env.PLEX_MOVIE_SECTION_ID) : null;

  const tvSections = sections.filter(
    (s) => s.type === 'show' && (!tvSectionFilter || String(s.key) === tvSectionFilter)
  );
  const movieSections = sections.filter(
    (s) => s.type === 'movie' && (!movieSectionFilter || String(s.key) === movieSectionFilter)
  );

  if (tvSections.length === 0 && movieSections.length === 0) {
    summary.errors.push('No matching TV or Movie sections found on the Plex server.');
  }

  // ============================================================
  // MOVIES
  // ============================================================
  const plexMoviesByTvdb = new Map();
  for (const section of movieSections) {
    try {
      const items = await plexClient.getSectionItems(section.key);
      for (const item of items) {
        const ids = plexClient.extractExternalIds(item);
        if (ids.tvdb) plexMoviesByTvdb.set(String(ids.tvdb), item);
      }
    } catch (err) {
      summary.errors.push(`Failed to read Plex movie section "${section.title}": ${err.message}`);
    }
  }

  const harvestMovies = await pool.query('SELECT id, tvdb_id FROM metadata_movies');
  summary.movies_checked = harvestMovies.rows.length;

  for (const movie of harvestMovies.rows) {
    const plexItem = plexMoviesByTvdb.get(String(movie.tvdb_id));
    const inPlex = Boolean(plexItem);
    if (inPlex) summary.movies_matched++;

    await pool.query(
      `UPDATE metadata_movies SET in_plex = $1, plex_rating_key = $2, plex_checked_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [inPlex, plexItem ? plexItem.ratingKey : null, movie.id]
    );
    await pool.query(
      `UPDATE metadata_items SET in_plex = $1, plex_checked_at = CURRENT_TIMESTAMP WHERE movie_id = $2 AND type = 'movie'`,
      [inPlex, movie.id]
    );
  }

  // ============================================================
  // TV SHOWS, EPISODES, SEASON PACKS
  // ============================================================
  const plexShowsByTvdb = new Map();
  for (const section of tvSections) {
    try {
      const items = await plexClient.getSectionItems(section.key);
      for (const item of items) {
        const ids = plexClient.extractExternalIds(item);
        if (ids.tvdb) plexShowsByTvdb.set(String(ids.tvdb), item);
      }
    } catch (err) {
      summary.errors.push(`Failed to read Plex TV section "${section.title}": ${err.message}`);
    }
  }

  const harvestShows = await pool.query('SELECT id, tvdb_id FROM metadata_shows');
  summary.shows_checked = harvestShows.rows.length;

  for (const show of harvestShows.rows) {
    const plexShow = plexShowsByTvdb.get(String(show.tvdb_id));
    const showInPlex = Boolean(plexShow);
    if (showInPlex) summary.shows_matched++;

    await pool.query(
      `UPDATE metadata_shows SET in_plex = $1, plex_rating_key = $2, plex_checked_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [showInPlex, plexShow ? plexShow.ratingKey : null, show.id]
    );

    // season_number -> Set(episode_number) available in Plex for this show
    const plexEpisodesBySeason = new Map();
    if (showInPlex) {
      try {
        const seasons = await plexClient.getChildren(plexShow.ratingKey);
        for (const season of seasons) {
          if (season.type !== 'season' || season.index == null) continue;
          const episodes = await plexClient.getChildren(season.ratingKey);
          const epNumbers = new Set(
            episodes.filter((e) => e.type === 'episode' && e.index != null).map((e) => e.index)
          );
          plexEpisodesBySeason.set(season.index, epNumbers);
        }
      } catch (err) {
        summary.errors.push(`Failed to read Plex seasons for TVDB id ${show.tvdb_id}: ${err.message}`);
      }
    }

    const episodes = await pool.query(
      `SELECT i.id, s.season_number, i.episode_number
       FROM metadata_items i
       JOIN metadata_seasons s ON i.season_id = s.id
       WHERE i.show_id = $1 AND i.type = 'episode'`,
      [show.id]
    );
    summary.episodes_checked += episodes.rows.length;

    for (const ep of episodes.rows) {
      const seasonEpisodes = plexEpisodesBySeason.get(ep.season_number);
      const inPlex = Boolean(seasonEpisodes && seasonEpisodes.has(ep.episode_number));
      if (inPlex) summary.episodes_matched++;
      await pool.query(
        `UPDATE metadata_items SET in_plex = $1, plex_checked_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [inPlex, ep.id]
      );
    }

    const packs = await pool.query(
      `SELECT i.id, s.season_number
       FROM metadata_items i
       JOIN metadata_seasons s ON i.season_id = s.id
       WHERE i.show_id = $1 AND i.type = 'season_pack'`,
      [show.id]
    );
    summary.season_packs_checked += packs.rows.length;

    for (const pack of packs.rows) {
      const seasonEpisodes = plexEpisodesBySeason.get(pack.season_number);
      const inPlex = Boolean(seasonEpisodes && seasonEpisodes.size > 0);
      if (inPlex) summary.season_packs_matched++;
      await pool.query(
        `UPDATE metadata_items SET in_plex = $1, plex_checked_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [inPlex, pack.id]
      );
    }
  }

  return summary;
}

module.exports = { syncPlexFlags, buildPlexClientFromEnv, PlexClient };