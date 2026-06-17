const { parseMediaTitle } = require('./mediaParser');

async function processPendingMatches(pool, tvdb) {
  console.log(`[${new Date().toISOString()}] Running advanced metadata matching cycle...`);

  try {
    // 1. Force the TVDB client to authenticate and acquire its JWT bearer token first
    await tvdb.authenticate();

    // 2. Fetch up to 10 unmatched items to process this cycle
    const pending = await pool.query(
      "SELECT id, title, category, match_status FROM scraped_entries WHERE match_status IN ('unmatched', 'failed') LIMIT 10"
    );

    for (const entry of pending.rows) {
      try {
        // 1. Break down the messy torrent title into clean data structures
        const parsed = parseMediaTitle(entry.title, entry.category);
        console.log(`Parsed details: (${entry.match_status})`, parsed);

        // Fallback catch if the parser can't deduce anything structured
        if (parsed.type === 'unknown') {
          await pool.query("UPDATE scraped_entries SET match_status = 'failed' WHERE id = $1", [entry.id]);
          continue;
        }

        // 2. Query TVDB for the parent entity (Limit 1 to be lean)
        const searchUrl = `${tvdb.baseUrl}/search`;
        const searchRes = await require('axios').get(searchUrl, {
          headers: tvdb.getHeaders(),
          params: { q: parsed.title, type: parsed.type, limit: 1 }
        });

        const results = searchRes.data.data || [];
        if (results.length === 0) {
          await pool.query("UPDATE scraped_entries SET match_status = 'failed' WHERE id = $1", [entry.id]);
          continue;
        }

        const rootAsset = results[0];
        let finalMetadataId = null;

        // ==========================================
        // CASE A: IT'S A TV EPISODE
        // ==========================================
        if (parsed.type === 'series') {
          console.log(`Checking Series`);
          if (parsed.season !== null && parsed.episode !== null) {
            
            console.log(`Found Series: "${rootAsset.name}" (ID: ${rootAsset.tvdb_id}). Fetching S${parsed.season}E${parsed.episode}...`);
            
            // Step 3: Fetch exact sub-episode asset metadata from TVDB
            const epUrl = `${tvdb.baseUrl}/series/${rootAsset.tvdb_id}/episodes/default`;
            const epRes = await require('axios').get(epUrl, {
              headers: tvdb.getHeaders(),
              params: { page: 0, season: parsed.season, episodeNumber: parsed.episode }
            });

            const episodes = epRes.data.data?.episodes || [];
            
            // Cache the main series asset container row first
            const seriesQuery = `
              INSERT INTO metadata_items (tvdb_id, type, title, overview, poster_path)
              VALUES ($1, 'series', $2, $3, $4)
              ON CONFLICT (tvdb_id) DO UPDATE SET title = EXCLUDED.title
              RETURNING id;
            `;
            const seriesRow = await pool.query(seriesQuery, [
              rootAsset.tvdb_id,
              rootAsset.name,
              rootAsset.overview || '',
              rootAsset.image_url || ''
            ]);
            finalMetadataId = seriesRow.rows[0].id;

            // If the specific episode was found, store it in the child table
            if (episodes.length > 0) {
              const matchEp = episodes[0];
              await pool.query(
                `INSERT INTO metadata_episodes (metadata_item_id, season_number, episode_number, title, overview)
                VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
                [finalMetadataId, parsed.season, parsed.episode, matchEp.name, matchEp.overview]
              );
              console.log(`Matched Episode: "${matchEp.name}"`);
            }

          } else if (parsed.season !== null) {
            // ==========================================
            // CASE A.1: IT'S A TV PACK
            // ==========================================
           
            console.log(`Found Series Pack: "${rootAsset.name}" (ID: ${rootAsset.tvdb_id}).`);
            
            // Cache the main series asset container row first
            const seriesQuery = `
              INSERT INTO metadata_items (tvdb_id, type, title, overview, poster_path)
              VALUES ($1, 'series', $2, $3, $4)
              ON CONFLICT (tvdb_id) DO UPDATE SET title = EXCLUDED.title
              RETURNING id;
            `;
            const seriesRow = await pool.query(seriesQuery, [
              rootAsset.tvdb_id,
              rootAsset.name,
              rootAsset.overview || '',
              rootAsset.image_url || ''
            ]);
            finalMetadataId = seriesRow.rows[0].id;

            await pool.query(
              `INSERT INTO metadata_episodes (metadata_item_id, season_number, episode_number, title, is_season_pack)
              VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
              [finalMetadataId, parsed.season, 0, 'Season Pack', true]
            );
            
            console.log(`Matched Season Pack: "${parsed.season}"`);
          }

        } 
        // ==========================================
        // CASE B: IT'S A MOVIE
        // ==========================================
        else if (parsed.type === 'movie') {
          console.log(`Found Movie: "${rootAsset.name}" (TVDB Year: ${rootAsset.year})`);

          // Cache movie container asset profile
          const movieQuery = `
            INSERT INTO metadata_items (tvdb_id, type, title, overview, poster_path, release_date)
            VALUES ($1, 'movie', $2, $3, $4, $5)
            ON CONFLICT (tvdb_id) DO UPDATE SET title = EXCLUDED.title
            RETURNING id;
          `;
          const movieRow = await pool.query(movieQuery, [
            rootAsset.tvdb_id,
            rootAsset.name,
            rootAsset.overview || '',
            rootAsset.image_url || '',
            rootAsset.year || parsed.year
          ]);
          finalMetadataId = movieRow.rows[0].id;
        }

        // 4. Update core scraped stream listing status pointer
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