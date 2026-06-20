const axios = require('axios');
const { parseXMLFeed } = require('./parser');

function isSourceDue(source) {
  if (!source.last_run_at) return true;
  const elapsedMs = Date.now() - new Date(source.last_run_at).getTime();
  const intervalMs = source.interval_minutes * 60 * 1000;
  return elapsedMs >= intervalMs;
}

/**
 * Runs the scraper for active sources whose interval_minutes schedule has elapsed.
 * @param {Pool} pool - The active PostgreSQL connection pool.
 */
async function runScraper(pool) {
  console.log(`[${new Date().toISOString()}] Starting scraper cycle...`);

  try {
    const sourcesQuery = await pool.query(
      `SELECT id, name, url, config_mapping, interval_minutes, last_run_at
       FROM scrape_sources WHERE is_active = TRUE`
    );

    for (const source of sourcesQuery.rows) {
      if (!isSourceDue(source)) {
        const elapsedMin = (Date.now() - new Date(source.last_run_at).getTime()) / 60000;
        const remaining = Math.ceil(source.interval_minutes - elapsedMin);
        console.log(`Skipping ${source.name}: next run in ~${remaining} min`);
        continue;
      }

      console.log(`Scraping source: ${source.name} via ${source.url}`);

      try {
        const response = await axios.get(source.url, { timeout: 10000 });
        const parsedEntries = await parseXMLFeed(response.data, source.config_mapping);

        console.log(`Found ${parsedEntries.length} entries. Syncing to database...`);
        let insertedCount = 0;

        for (const entry of parsedEntries) {
          const insertQuery = `
            INSERT INTO scraped_entries 
              (source_id, title, source_link, category, description, magnet_link, date_published)
            VALUES 
              ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (source_link) DO NOTHING
            RETURNING id;
          `;

          const result = await pool.query(insertQuery, [
            source.id,
            entry.title,
            entry.source_link,
            entry.category,
            entry.description,
            entry.magnet_link,
            entry.date_published
          ]);

          if (result.rowCount > 0) {
            insertedCount++;
          }
        }

        await pool.query(
          'UPDATE scrape_sources SET last_run_at = CURRENT_TIMESTAMP WHERE id = $1',
          [source.id]
        );

        console.log(`Finished ${source.name}: ${insertedCount} new entries added.`);

      } catch (sourceError) {
        console.error(`Error processing source "${source.name}":`, sourceError.message);
      }
    }
  } catch (error) {
    console.error('Global scraper engine error:', error.message);
  }
}

module.exports = { runScraper };
