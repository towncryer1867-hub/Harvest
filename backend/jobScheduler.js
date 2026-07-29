const { syncPlexFlags } = require('./plexSync');
const { refreshAllTvdbMetadata } = require('./tvdbRefresh');
const { cleanupOrphanedMetadata } = require('./metadataCleanup');
const { recheckUnmatchedWatchlist } = require('./watchlistRecheck');
const { logPipelineEvent } = require('./pipelineLog');

// One entry per schedulable automation button under Admin Controls ->
// System Settings. `label` drives the admin UI; `run` is the exact same
// function each button's manual-trigger route calls, so a scheduled run and
// a manual click always do identical work.
//
// Pipeline Match Cycle is deliberately NOT here — it already runs
// unconditionally every ~60s as part of the core scraper pipeline (see
// runPipeline() in index.js), so scheduling it here too would just be a
// redundant, confusing extra trigger for the same work. Its manual button
// still calls processPendingMatches directly via POST /api/admin/force-sync.
const JOB_DEFINITIONS = {
  plex_sync: {
    label: 'Plex Library Sync',
    run: (pool, tvdb) => syncPlexFlags(pool),
  },
  tvdb_refresh: {
    label: 'TheTVDB Metadata Refresh',
    run: (pool, tvdb) => refreshAllTvdbMetadata(pool, tvdb),
  },
  metadata_cleanup: {
    label: 'Metadata Database Cleanup',
    run: (pool, tvdb) => cleanupOrphanedMetadata(pool),
  },
  watchlist_recheck: {
    label: 'Watchlist Re-check',
    run: (pool, tvdb) => recheckUnmatchedWatchlist(pool, tvdb),
  },
};

const JOB_KEYS = Object.keys(JOB_DEFINITIONS);

function isJobDue(job) {
  if (!job.is_enabled) return false;
  if (!job.last_run_at) return true;
  const elapsedMs = Date.now() - new Date(job.last_run_at).getTime();
  const intervalMs = job.interval_minutes * 60 * 1000;
  return elapsedMs >= intervalMs;
}

/**
 * Checks every configured job and runs whichever ones are enabled and past
 * their interval. Called once per pipeline tick from index.js — same
 * due-check granularity `scrape_sources` already uses (see scraper.js's
 * isSourceDue), so nothing new to reason about there.
 */
async function runDueScheduledJobs(pool, tvdb) {
  const { rows } = await pool.query(
    'SELECT job_key, interval_minutes, is_enabled, last_run_at FROM scheduled_jobs'
  );

  for (const job of rows) {
    const definition = JOB_DEFINITIONS[job.job_key];
    if (!definition || !isJobDue(job)) continue;

    console.log(`[scheduler] Running due job: ${definition.label}`);
    try {
      await definition.run(pool, tvdb);
    } catch (err) {
      console.error(`[scheduler] Job "${job.job_key}" (${definition.label}) failed:`, err.message);
      await logPipelineEvent(pool, {
        source: `scheduler:${job.job_key}`,
        message: `${definition.label} failed: ${err.message}`,
        detail: err.stack,
      });
    } finally {
      await pool.query(
        'UPDATE scheduled_jobs SET last_run_at = CURRENT_TIMESTAMP WHERE job_key = $1',
        [job.job_key]
      );
    }
  }
}

module.exports = { runDueScheduledJobs, JOB_DEFINITIONS, JOB_KEYS };
