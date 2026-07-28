// Diagnostic event log for the background pipeline. Every catch block in the
// scraper/matcher/scheduler that would otherwise only print to container
// stdout also records here, so Admin Controls can surface silent failures
// (e.g. TVDB auth failing every cycle, which stalls matching entirely while
// scraping keeps running fine) without needing `docker logs`.
const MAX_LOG_ROWS = 1000;

async function logPipelineEvent(pool, { source, level = 'error', message, detail = null }) {
  try {
    await pool.query(
      `INSERT INTO pipeline_logs (source, level, message, detail) VALUES ($1, $2, $3, $4)`,
      [source, level, message, detail ? String(detail) : null]
    );
    // Keep the table bounded — trim anything past the most recent MAX_LOG_ROWS.
    await pool.query(
      `DELETE FROM pipeline_logs WHERE id NOT IN (SELECT id FROM pipeline_logs ORDER BY created_at DESC LIMIT $1)`,
      [MAX_LOG_ROWS]
    );
  } catch (err) {
    // Logging must never itself crash the pipeline it's trying to diagnose.
    console.error('Failed to record pipeline log entry:', err.message);
  }
}

module.exports = { logPipelineEvent };
