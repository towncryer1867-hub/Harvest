const { parseMediaTitle } = require('./mediaParser');
const { pickEnglishTranslation, extractSeriesFields, extractMovieFields, computeRecentAirDate } = require('./tvdbMetadata');
const { logPipelineEvent } = require('./pipelineLog');
const { syncShowCast, syncMovieCast } = require('./castSync');
const { buildQBittorrentClientFromEnv } = require('./qbittorrentClient');
const { evaluateSchedulerTrigger } = require('./schedulerTrigger');
const { buildPlexClientFromEnv, buildPlexIndex, checkEntityInPlex } = require('./plexSync');

async function processPendingMatches(pool, tvdb) {
  console.log(`[${new Date().toISOString()}] Running advanced metadata matching cycle...`);
  const qbClient = buildQBittorrentClientFromEnv();

  // Built once per cycle (not per entry) so up to 10 matches this tick share
  // one Plex library fetch instead of re-walking every section per entry.
  // syncPlexFlags (the scheduled job) still runs independently to catch
  // titles added to Plex between matching cycles.
  const plexClient = buildPlexClientFromEnv();
  let plexIndex = null;
  if (plexClient.isConfigured()) {
    try {
      plexIndex = await buildPlexIndex(plexClient);
    } catch (err) {
      console.error('Failed to build Plex index for match-time check:', err.message);
      await logPipelineEvent(pool, {
        source: 'matcher',
        message: `Plex lookup unavailable for this matching cycle: ${err.message}`,
      });
    }
  }

  try {
    await tvdb.authenticate();

    // ORDER BY guarantees FIFO processing — without it, Postgres doesn't
    // promise which 10 rows come back on a given call, so a batch of
    // never-clearing rows (see the `else` below) could keep crowding out
    // newer entries from ever being selected at all.
    const pending = await pool.query(
      "SELECT id, title, category, match_status, magnet_link FROM scraped_entries WHERE match_status IN ('unmatched') ORDER BY id ASC LIMIT 10"
    );

    for (const entry of pending.rows) {
      try {
        // Mark as processing so the UI can show in-flight entries
        await pool.query("UPDATE scraped_entries SET match_status = 'processing' WHERE id = $1", [entry.id]);

        const parsed = parseMediaTitle(entry.title, entry.category);
        console.log(`Parsed details: (${entry.match_status})`, parsed);

        if (parsed.type === 'unknown') {
          await pool.query("UPDATE scraped_entries SET match_status = 'failed' WHERE id = $1", [entry.id]);
          continue;
        }

        const searchParams = { q: parsed.title, type: parsed.type, limit: 1 };
        if (parsed.year) {
          searchParams.year = parsed.year;
        }

        const searchUrl = `${tvdb.baseUrl}/search`;
        const searchRes = await require('axios').get(searchUrl, {
          headers: tvdb.getHeaders(),
          params: searchParams
        });

        const results = searchRes.data.data || [];
        if (results.length === 0) {
          await pool.query("UPDATE scraped_entries SET match_status = 'failed' WHERE id = $1", [entry.id]);
          continue;
        }

        const rootAsset = results[0];
        let finalMetadataId = null;
        let triggerEntityType = null;
        let triggerShowId = null;
        let triggerMovieId = null;
        let triggerSeasonNumber = null;
        let triggerEpisodeNumber = null;

        // ==========================================
        // CASE A: IT'S A TV SHOW (EPISODE OR SEASON PACK)
        // ==========================================
        if (parsed.type === 'series') {
          const seriesDetails = await tvdb.getSeriesDetails(rootAsset.tvdb_id);
          const englishTranslation =
            pickEnglishTranslation(seriesDetails?.translations) ||
            (await tvdb.getSeriesTranslation(rootAsset.tvdb_id));
          const seriesMeta = seriesDetails
            ? extractSeriesFields(seriesDetails, englishTranslation)
            : {
                title: rootAsset.name,
                overview: rootAsset.overview || '',
                poster_path: tvdb.normalizeImageUrl(rootAsset.image_url),
                status: null,
                network: null,
                genres: [],
                first_aired: null,
                last_aired: null,
                original_country: null,
                original_language: null,
                trailer_url: null,
                imdb_id: null,
              };

          const showQuery = `
            INSERT INTO metadata_shows (
              tvdb_id, title, overview, poster_path, status, network, genres,
              first_aired, last_aired, original_country, original_language,
              trailer_url, imdb_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (tvdb_id) DO UPDATE SET
              title = EXCLUDED.title,
              overview = COALESCE(NULLIF(EXCLUDED.overview, ''), metadata_shows.overview),
              poster_path = COALESCE(NULLIF(EXCLUDED.poster_path, ''), metadata_shows.poster_path),
              status = COALESCE(NULLIF(EXCLUDED.status, ''), metadata_shows.status),
              network = COALESCE(NULLIF(EXCLUDED.network, ''), metadata_shows.network),
              genres = CASE WHEN COALESCE(array_length(EXCLUDED.genres, 1), 0) > 0 THEN EXCLUDED.genres ELSE metadata_shows.genres END,
              first_aired = COALESCE(NULLIF(EXCLUDED.first_aired, ''), metadata_shows.first_aired),
              -- Seed only: real, ongoing accuracy comes from computeRecentAirDate()
              -- below once episodes are synced, which overwrites this unconditionally.
              last_aired = COALESCE(NULLIF(EXCLUDED.last_aired, ''), metadata_shows.last_aired),
              original_country = COALESCE(NULLIF(EXCLUDED.original_country, ''), metadata_shows.original_country),
              original_language = COALESCE(NULLIF(EXCLUDED.original_language, ''), metadata_shows.original_language),
              trailer_url = COALESCE(NULLIF(EXCLUDED.trailer_url, ''), metadata_shows.trailer_url),
              imdb_id = COALESCE(NULLIF(EXCLUDED.imdb_id, ''), metadata_shows.imdb_id)
            RETURNING id;
          `;
          const showRow = await pool.query(showQuery, [
            rootAsset.tvdb_id,
            seriesMeta.title,
            seriesMeta.overview,
            tvdb.normalizeImageUrl(seriesMeta.poster_path || rootAsset.image_url),
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
          await syncShowCast(pool, tvdb, showId, seriesDetails);

          // Step 3b: Ensure parent Season exists in `metadata_seasons`
          let seasonId = null;
          if (parsed.season !== null) {
            const seasonQuery = `
              INSERT INTO metadata_seasons (show_id, season_number)
              VALUES ($1, $2)
              ON CONFLICT (show_id, season_number) DO UPDATE SET season_number = EXCLUDED.season_number
              RETURNING id;
            `;
            const seasonRow = await pool.query(seasonQuery, [showId, parsed.season]);
            seasonId = seasonRow.rows[0].id;
          }

          if (parsed.is_dated_episode && parsed.air_date) {
            // ----------------------------------------
            // CASE A.0: DATED EPISODE MATCHING
            // Daily/talk shows (Jeopardy, Dateline NBC, etc.) are released
            // with a calendar date instead of a season/episode number, so
            // look the episode up by its air date rather than guessing a
            // season/episode from those digits.
            // ----------------------------------------
            console.log(`Found Series: "${rootAsset.name}" (ID: ${rootAsset.tvdb_id}). Fetching episode aired ${parsed.air_date}...`);

            const epUrl = `${tvdb.baseUrl}/series/${rootAsset.tvdb_id}/episodes/default`;
            const epRes = await require('axios').get(epUrl, {
              headers: tvdb.getHeaders(),
              params: { page: 0, airDate: parsed.air_date }
            });

            const episodes = epRes.data.data?.episodes || [];
            const matchEp = episodes.find(e => e.aired === parsed.air_date) || episodes[0];

            if (matchEp && matchEp.seasonNumber != null) {
              const seasonQuery = `
                INSERT INTO metadata_seasons (show_id, season_number)
                VALUES ($1, $2)
                ON CONFLICT (show_id, season_number) DO UPDATE SET season_number = EXCLUDED.season_number
                RETURNING id;
              `;
              const seasonRow = await pool.query(seasonQuery, [showId, matchEp.seasonNumber]);
              seasonId = seasonRow.rows[0].id;
            }

            const episodeNumber = matchEp ? matchEp.number : null;

            const itemQuery = `
              INSERT INTO metadata_items (type, tvdb_id, show_id, season_id, episode_number, title, overview, air_date)
              VALUES ('episode', $1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (show_id, season_id, episode_number) DO UPDATE SET
                title = EXCLUDED.title,
                overview = COALESCE(NULLIF(EXCLUDED.overview, ''), metadata_items.overview),
                air_date = COALESCE(NULLIF(EXCLUDED.air_date, ''), metadata_items.air_date),
                tvdb_id = COALESCE(NULLIF(EXCLUDED.tvdb_id, ''), metadata_items.tvdb_id)
              RETURNING id;
            `;

            const itemRow = await pool.query(itemQuery, [
              matchEp && matchEp.id ? String(matchEp.id) : null,
              showId,
              seasonId,
              episodeNumber,
              matchEp ? (matchEp.name || `Episode aired ${parsed.air_date}`) : `Episode aired ${parsed.air_date}`,
              matchEp ? matchEp.overview : '',
              matchEp ? matchEp.aired : parsed.air_date
            ]);
            finalMetadataId = itemRow.rows[0].id;
            triggerEntityType = 'episode';
            triggerShowId = showId;
            triggerSeasonNumber = matchEp ? matchEp.seasonNumber : null;
            triggerEpisodeNumber = episodeNumber;

            console.log(`Matched Episode ID ${matchEp ? matchEp.id : 'N/A'}: "${matchEp ? matchEp.name : parsed.air_date}" (Aired: ${matchEp ? matchEp.aired : parsed.air_date})`);

            try {
              const seriesEpisodes = await tvdb.getSeriesEpisodesExtended(rootAsset.tvdb_id);
              const recentAirDate = computeRecentAirDate(seriesEpisodes);

              if (recentAirDate) {
                await pool.query(
                  `UPDATE metadata_shows SET last_aired = $1 WHERE id = $2`,
                  [recentAirDate, showId]
                );
                console.log(`Refreshed last_aired for show ID ${showId} ("${rootAsset.name}") -> ${recentAirDate}`);
              }
            } catch (airDateErr) {
              console.error(`Failed to refresh last_aired for show ID ${showId}:`, airDateErr.message);
            }

          } else if (parsed.season !== null && parsed.episode !== null) {
            // ----------------------------------------
            // CASE A.1: SINGLE EPISODE MATCHING
            // ----------------------------------------
            console.log(`Found Series: "${rootAsset.name}" (ID: ${rootAsset.tvdb_id}). Fetching S${parsed.season}E${parsed.episode}...`);

            const epUrl = `${tvdb.baseUrl}/series/${rootAsset.tvdb_id}/episodes/default`;
            const epRes = await require('axios').get(epUrl, {
              headers: tvdb.getHeaders(),
              params: { page: 0, season: parsed.season, episodeNumber: parsed.episode }
            });

            const episodes = epRes.data.data?.episodes || [];

            // Explicitly filter to ensure we grab the exact matching episode number and season matching our parsed values
            const matchEp = episodes.find(e => e.seasonNumber === parsed.season && e.number === parsed.episode) || episodes[0];

            // FIXED: Added 'air_date' column, values, and updates to the query sequence
            const itemQuery = `
              INSERT INTO metadata_items (type, tvdb_id, show_id, season_id, episode_number, title, overview, air_date)
              VALUES ('episode', $1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (show_id, season_id, episode_number) DO UPDATE SET
                title = EXCLUDED.title,
                overview = COALESCE(NULLIF(EXCLUDED.overview, ''), metadata_items.overview),
                air_date = COALESCE(NULLIF(EXCLUDED.air_date, ''), metadata_items.air_date),
                tvdb_id = COALESCE(NULLIF(EXCLUDED.tvdb_id, ''), metadata_items.tvdb_id)
              RETURNING id;
            `;

            // FIXED: TVDB returns episode IDs as integers under '.id'; air dates are under '.aired'
            const itemRow = await pool.query(itemQuery, [
              matchEp && matchEp.id ? String(matchEp.id) : null,
              showId,
              seasonId,
              parsed.episode,
              matchEp ? (matchEp.name || `Episode ${parsed.episode}`) : `Episode ${parsed.episode}`,
              matchEp ? matchEp.overview : '',
              matchEp ? matchEp.aired : null
            ]);
            finalMetadataId = itemRow.rows[0].id;
            triggerEntityType = 'episode';
            triggerShowId = showId;
            triggerSeasonNumber = parsed.season;
            triggerEpisodeNumber = parsed.episode;

            console.log(`Matched Episode ID ${matchEp ? matchEp.id : 'N/A'}: "${matchEp ? matchEp.name : parsed.episode}" (Aired: ${matchEp ? matchEp.aired : 'N/A'})`);

            // ----------------------------------------
            // Refresh the show's recent air date.
            // This is the new authoritative process: pull the series'
            // full episode list and derive the most recent *actually
            // aired* date from it, rather than trusting TVDB's own
            // (often stale) `lastAired` field on the base series record.
            // ----------------------------------------
            try {
              const seriesEpisodes = await tvdb.getSeriesEpisodesExtended(rootAsset.tvdb_id);
              const recentAirDate = computeRecentAirDate(seriesEpisodes);

              if (recentAirDate) {
                await pool.query(
                  `UPDATE metadata_shows SET last_aired = $1 WHERE id = $2`,
                  [recentAirDate, showId]
                );
                console.log(`Refreshed last_aired for show ID ${showId} ("${rootAsset.name}") -> ${recentAirDate}`);
              } else {
                console.log(`No aired episodes found yet for show ID ${showId} ("${rootAsset.name}"); leaving last_aired unchanged.`);
              }
            } catch (airDateErr) {
              console.error(`Failed to refresh last_aired for show ID ${showId}:`, airDateErr.message);
            }

          } else if (parsed.season !== null) {
            // ----------------------------------------
            // CASE A.2: SEASON PACK MATCHING
            // ----------------------------------------
            console.log(`Found Series Pack: "${rootAsset.name}" (ID: ${rootAsset.tvdb_id}).`);

            const itemQuery = `
              INSERT INTO metadata_items (type, tvdb_id, show_id, season_id, episode_number, title, overview, air_date)
              VALUES ('season_pack', $1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (show_id, season_id, episode_number) DO UPDATE SET title = EXCLUDED.title
              RETURNING id;
            `;
            const itemRow = await pool.query(itemQuery, [
              null, // Explicitly keeping it NULL as requested for complete season packs
              showId,
              seasonId,
              0,
              `Season ${parsed.season} Pack`,
              `Full season pack release for Season ${parsed.season}`,
              null
            ]);
            finalMetadataId = itemRow.rows[0].id;
            triggerEntityType = 'season_pack';
            triggerShowId = showId;
            triggerSeasonNumber = parsed.season;

            console.log(`Matched Season Pack: "${parsed.season}"`);
          }

        }
        // ==========================================
        // CASE B: IT'S A MOVIE
        // ==========================================
        else if (parsed.type === 'movie') {
          console.log(`Found Movie: "${rootAsset.name}" (TVDB Year: ${rootAsset.year})`);

          const movieDetails = await tvdb.getMovieDetails(rootAsset.tvdb_id);
          const englishTranslation =
            pickEnglishTranslation(movieDetails?.translations) ||
            (await tvdb.getMovieTranslation(rootAsset.tvdb_id));
          const movieMeta = movieDetails
            ? extractMovieFields(movieDetails, englishTranslation)
            : {
                title: rootAsset.name,
                overview: rootAsset.overview || '',
                poster_path: tvdb.normalizeImageUrl(rootAsset.image_url),
                release_date: String(rootAsset.year || parsed.year || ''),
                release_year: rootAsset.year ? parseInt(rootAsset.year, 10) : parsed.year || null,
                genres: [],
                studios: [],
                production_companies: [],
                original_country: null,
                original_language: null,
                trailer_url: null,
                imdb_id: null,
              };

          const movieProfileQuery = `
            INSERT INTO metadata_movies (
              tvdb_id, title, overview, poster_path, release_date, release_year,
              genres, studios, production_companies, original_country, original_language,
              trailer_url, imdb_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (tvdb_id) DO UPDATE SET
              title = EXCLUDED.title,
              overview = COALESCE(NULLIF(EXCLUDED.overview, ''), metadata_movies.overview),
              poster_path = COALESCE(NULLIF(EXCLUDED.poster_path, ''), metadata_movies.poster_path),
              release_date = COALESCE(NULLIF(EXCLUDED.release_date, ''), metadata_movies.release_date),
              release_year = COALESCE(EXCLUDED.release_year, metadata_movies.release_year),
              genres = CASE WHEN COALESCE(array_length(EXCLUDED.genres, 1), 0) > 0 THEN EXCLUDED.genres ELSE metadata_movies.genres END,
              studios = CASE WHEN COALESCE(array_length(EXCLUDED.studios, 1), 0) > 0 THEN EXCLUDED.studios ELSE metadata_movies.studios END,
              production_companies = CASE WHEN COALESCE(array_length(EXCLUDED.production_companies, 1), 0) > 0 THEN EXCLUDED.production_companies ELSE metadata_movies.production_companies END,
              original_country = COALESCE(NULLIF(EXCLUDED.original_country, ''), metadata_movies.original_country),
              original_language = COALESCE(NULLIF(EXCLUDED.original_language, ''), metadata_movies.original_language),
              trailer_url = COALESCE(NULLIF(EXCLUDED.trailer_url, ''), metadata_movies.trailer_url),
              imdb_id = COALESCE(NULLIF(EXCLUDED.imdb_id, ''), metadata_movies.imdb_id)
            RETURNING id;
          `;
          const movieProfileRow = await pool.query(movieProfileQuery, [
            rootAsset.tvdb_id,
            movieMeta.title,
            movieMeta.overview,
            tvdb.normalizeImageUrl(movieMeta.poster_path || rootAsset.image_url),
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
          const movieId = movieProfileRow.rows[0].id;
          await syncMovieCast(pool, tvdb, movieId, movieDetails);

          const itemQuery = `
            INSERT INTO metadata_items (type, movie_id, title, overview)
            VALUES ('movie', $1, $2, $3)
            ON CONFLICT (movie_id) DO UPDATE SET
              title = EXCLUDED.title,
              overview = COALESCE(NULLIF(EXCLUDED.overview, ''), metadata_items.overview)
            RETURNING id;
          `;
          const itemRow = await pool.query(itemQuery, [
            movieId,
            movieMeta.title,
            movieMeta.overview
          ]);
          finalMetadataId = itemRow.rows[0].id;
          triggerEntityType = 'movie';
          triggerMovieId = movieId;
        }

        if (finalMetadataId) {
          await pool.query(
            "UPDATE scraped_entries SET metadata_item_id = $1, match_status = 'matched' WHERE id = $2",
            [finalMetadataId, entry.id]
          );

          if (plexIndex && triggerEntityType) {
            try {
              await checkEntityInPlex(pool, plexClient, plexIndex, {
                entityType: triggerEntityType,
                tvdbId: rootAsset.tvdb_id,
                metadataItemId: finalMetadataId,
                showId: triggerShowId,
                movieId: triggerMovieId,
                seasonNumber: triggerSeasonNumber,
                episodeNumber: triggerEpisodeNumber,
              });
            } catch (plexErr) {
              console.error(`Plex check failed for entry ID ${entry.id}:`, plexErr.message);
              await logPipelineEvent(pool, {
                source: 'matcher',
                message: `Plex check failed for entry ${entry.id} ("${entry.title}"): ${plexErr.message}`,
                detail: plexErr.stack,
              });
            }
          }

          if (triggerEntityType) {
            try {
              await evaluateSchedulerTrigger(pool, qbClient, {
                entityType: triggerEntityType,
                metadataItemId: finalMetadataId,
                showId: triggerShowId,
                movieId: triggerMovieId,
                resolutionRaw: parsed.resolution,
                magnetLink: entry.magnet_link,
              });
            } catch (triggerErr) {
              console.error(`Scheduler trigger failed for entry ID ${entry.id}:`, triggerErr.message);
              await logPipelineEvent(pool, {
                source: 'scheduler',
                message: `Scheduler trigger failed for entry ${entry.id} ("${entry.title}"): ${triggerErr.message}`,
                detail: triggerErr.stack,
              });
            }
          }
        } else {
          // A TV-categorized title that didn't match the dated/S-E/season-pack
          // cases above (or a movie search that somehow produced no usable
          // metadata) falls through here with nothing to attach. Without this,
          // match_status never leaves 'unmatched' and the same row gets
          // reselected and silently no-op'd on every future cycle forever.
          console.warn(`No matchable season/episode/pack info found for entry ID ${entry.id} ("${entry.title}") — marking failed.`);
          await pool.query("UPDATE scraped_entries SET match_status = 'failed' WHERE id = $1", [entry.id]);
          await logPipelineEvent(pool, {
            source: 'matcher',
            message: `Entry ${entry.id} ("${entry.title}") parsed as "${parsed.type}" but no season/episode/pack info was detected — no metadata item could be created.`,
          });
        }

      } catch (err) {
        console.error(`Error matching entry ID ${entry.id}:`, err.message);
        await pool.query("UPDATE scraped_entries SET match_status = 'failed' WHERE id = $1", [entry.id]);
        await logPipelineEvent(pool, {
          source: 'matcher',
          message: `Failed to match entry ${entry.id} ("${entry.title}"): ${err.message}`,
          detail: err.stack,
        });
      }
    }
  } catch (globalErr) {
    console.error("Global matcher error:", globalErr.message);
    // This is the critical one to surface: if this fires every cycle (e.g.
    // TVDB auth failing), the pending-entries query above never even runs,
    // so nothing gets marked 'matched' OR 'failed' — scraping keeps working
    // while matching silently stalls. See pipelineLog.js.
    await logPipelineEvent(pool, {
      source: 'matcher',
      message: `Matching cycle aborted before processing any entries: ${globalErr.message}`,
      detail: globalErr.stack,
    });
  }
}

module.exports = { processPendingMatches };