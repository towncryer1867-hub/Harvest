function clientErrorMessage(err) {
  if (process.env.NODE_ENV === 'production') {
    return 'An internal server error occurred.';
  }
  return err?.message || String(err);
}

function sendError(res, err, status = 500) {
  console.error(err?.message || err);
  res.status(status).json({ error: clientErrorMessage(err) });
}

module.exports = { sendError, clientErrorMessage };
