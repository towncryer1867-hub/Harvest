const { logPipelineEvent } = require('./pipelineLog');

// Set once from index.js after the pool is created. Kept as a lazily-bound
// module-level reference (rather than threading `pool` through every one of
// the ~30 call sites) so every existing `sendError(res, err)` call — most of
// which predate this — starts logging to the Diagnostics tab for free.
let loggingPool = null;

function initErrorLogging(pool) {
  loggingPool = pool;
}

function clientErrorMessage(err) {
  if (process.env.NODE_ENV === 'production') {
    return 'An internal server error occurred.';
  }
  return err?.message || String(err);
}

function sendError(res, err, status = 500) {
  console.error(err?.message || err);

  if (loggingPool) {
    // `res.req` is Express's standard back-reference to the request that
    // produced this response — gives per-route detail (matching the
    // "[METHOD /path]" tag apiClient.js already prefixes frontend errors
    // with) without requiring every call site to pass `req` explicitly.
    const routeTag = res.req ? `${res.req.method} ${res.req.path}` : 'unknown route';
    // Fire-and-forget: logging a failed request must never itself delay or
    // fail the response being sent back to the client.
    logPipelineEvent(loggingPool, {
      source: 'api',
      message: `[${routeTag}] ${err?.message || String(err)}`,
      detail: err?.stack,
    }).catch(() => {});
  }

  res.status(status).json({ error: clientErrorMessage(err) });
}

module.exports = { sendError, clientErrorMessage, initErrorLogging };
