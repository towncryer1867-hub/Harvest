const { buildQBittorrentClientFromEnv } = require('./qbittorrentClient');
const { sendError } = require('./errors');

/**
 * Registers the qBittorrent WebUI proxy endpoint on an existing Express app.
 * Call this from index.js: registerQBittorrentRoutes(app);
 *
 * The frontend never talks to qBittorrent directly (same reasoning as Plex:
 * credentials and the LAN-only target server stay server-side), it just
 * posts the magnet link and whether it came from an episode or a movie card
 * — this route resolves that into the right category and forwards the add.
 */
function registerQBittorrentRoutes(app) {
  app.post('/api/qbittorrent/add-torrent', async (req, res) => {
    const { magnet_link, type } = req.body;

    if (!magnet_link) {
      return res.status(400).json({ error: 'magnet_link is required.' });
    }
    if (type !== 'movie' && type !== 'episode') {
      return res.status(400).json({ error: "type must be 'movie' or 'episode'." });
    }

    const category = type === 'movie'
      ? (process.env.QBITTORRENT_CATEGORY_MOVIES || 'movies')
      : (process.env.QBITTORRENT_CATEGORY_TV || 'tv');

    try {
      const client = buildQBittorrentClientFromEnv();
      if (!client.isConfigured()) {
        return res.status(400).json({ error: 'qBittorrent is not configured. Set QBITTORRENT_URL in the backend .env.' });
      }
      await client.addTorrent(magnet_link, category);
      res.json({ success: true, category });
    } catch (error) {
      console.error('Failed to add torrent to qBittorrent:', error.message);
      sendError(res, error);
    }
  });
}

module.exports = { registerQBittorrentRoutes };
