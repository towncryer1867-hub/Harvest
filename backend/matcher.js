const { parseMediaTitle } = require('./mediaParser');

async function processPendingMatches(pool, tvdb) {
  console.log(`[${new Date().toISOString()}] Running advanced metadata matching cycle...`);

  try {
    await tvdb.authenticate();

    const pending = await pool.query(
      "SELECT id, title, category, match_status FROM scraped_entries WHERE match_status IN ('unmatched') LIMIT 10"
    );

    for (const entry of pending.rows) {
      try {
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

        // ==========================================
        // CASE A: IT'S A TV SHOW (EPISODE OR SEASON PACK)
        // ==========================================
        if (parsed.type === 'series') {
          
          // Step 3a: Ensure parent Show exists in `metadata_shows`
          const showQuery = `
            INSERT INTO metadata_shows (tvdb_id, title, overview, poster_path)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tvdb_id) DO UPDATE SET title = EXCLUDED.title
            RETURNING id;
          `;
          const showRow = await pool.query(showQuery, [
            rootAsset.tvdb_id,
            rootAsset.name,
            rootAsset.overview || '',
            tvdb.normalizeImageUrl(rootAsset.image_url)
          ]);
          const showId = showRow.rows[0].id;

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

          if (parsed.season !== null && parsed.episode !== null) {
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

            console.log(`Matched Episode ID ${matchEp ? matchEp.id : 'N/A'}: "${matchEp ? matchEp.name : parsed.episode}" (Aired: ${matchEp ? matchEp.aired : 'N/A'})`);

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

            console.log(`Matched Season Pack: "${parsed.season}"`);
          }

        } 
        // ==========================================
        // CASE B: IT'S A MOVIE
        // ==========================================
        else if (parsed.type === 'movie') {
          console.log(`Found Movie: "${rootAsset.name}" (TVDB Year: ${rootAsset.year})`);

          const movieDetails = await tvdb.getMovieDetails(rootAsset.tvdb_id);
          const overview = movieDetails?.overview || rootAsset.overview || '';
          const posterPath = tvdb.normalizeImageUrl(
            movieDetails?.image || rootAsset.image_url
          );
          const releaseDate = String(movieDetails?.year || rootAsset.year || parsed.year || '');

          const movieProfileQuery = `
            INSERT INTO metadata_movies (tvdb_id, title, overview, poster_path, release_date)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (tvdb_id) DO UPDATE SET
              title = EXCLUDED.title,
              overview = COALESCE(NULLIF(EXCLUDED.overview, ''), metadata_movies.overview),
              poster_path = COALESCE(NULLIF(EXCLUDED.poster_path, ''), metadata_movies.poster_path),
              release_date = COALESCE(NULLIF(EXCLUDED.release_date, ''), metadata_movies.release_date)
            RETURNING id;
          `;
          const movieProfileRow = await pool.query(movieProfileQuery, [
            rootAsset.tvdb_id,
            rootAsset.name,
            overview,
            posterPath,
            releaseDate
          ]);
          const movieId = movieProfileRow.rows[0].id;

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
            rootAsset.name,
            overview
          ]);
          finalMetadataId = itemRow.rows[0].id;
        }

        if (finalMetadataId) {
          await pool.query(
            "UPDATE scraped_entries SET metadata_item_id = $1, match_status = 'matched' WHERE id = $2",
            [finalMetadataId, entry.id]
          );
        }

      } catch (err) {
        console.error(`Error matching entry ID ${entry.id}:`, err.message);
        await pool.query("UPDATE scraped_entries SET match_status = 'failed' WHERE id = $1", [entry.id]);
      }
    }
  } catch (globalErr) {
    console.error("Global matcher error:", globalErr.message);
  }
}

module.exports = { processPendingMatches };