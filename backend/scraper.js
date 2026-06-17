const axios = require('axios');
const { parseXMLFeed } = require('./parser');

/**
 * Runs the scraper for all active sources found in the database.
 * @param {Pool} pool - The active PostgreSQL connection pool.
 */
async function runScraper(pool) {
  console.log(`[${new Date().toISOString()}] Starting scraper cycle...`);
  
  try {
    // 1. Grab all active targets
    const sourcesQuery = await pool.query(
      'SELECT id, name, url, config_mapping FROM scrape_sources WHERE is_active = TRUE'
    );
    
    for (const source of sourcesQuery.rows) {
      console.log(`Scraping source: ${source.name} via ${source.url}`);
      
      try {
        // 2. Fetch the raw XML feed data
        const response = await axios.get(source.url, { timeout: 10000 });
        
        // 3. Parse it using our dynamic database rules configuration map
        const parsedEntries = await parseXMLFeed(response.data, source.config_mapping);
        
        console.log(`Found ${parsedEntries.length} entries. Syncing to database...`);
        let insertedCount = 0;

        // 4. Save each item safely into the database
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

        // 5. Update last_run_at timestamp for this source
        await pool.query(
          'UPDATE scrape_sources SET last_run_at = CURRENT_TIMESTAMP WHERE id = $1',
          [source.id]
        );

        console.log(`Finished ${source.name}: ${insertedCount} new entries added.`);
        
      } catch (sourceError) {
        console.error(`Error processing source "${source.name}":`, sourceError.message);
        // In the future, we will write this error explicitly to our system error logs table
      }
    }
  } catch (error) {
    console.error('Global scraper engine error:', error.message);
  }
}

module.exports = { runScraper };