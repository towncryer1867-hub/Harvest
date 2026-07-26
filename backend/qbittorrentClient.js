const axios = require('axios');

/**
 * Minimal client for the qBittorrent WebUI API.
 * Docs: https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#add-new-torrent
 *
 * Auth: the WebUI uses cookie-based session auth — POST /api/v2/auth/login
 * with username/password returns a `SID` cookie that has to be forwarded on
 * every subsequent request. We log in lazily on first use and cache the
 * cookie for the life of the process, re-authenticating once if a request
 * comes back 403 (session expired/invalidated).
 */
class QBittorrentClient {
  constructor({ baseUrl, username, password, timeoutMs = 15000 } = {}) {
    this.baseUrl = (baseUrl || '').replace(/\/$/, '');
    this.username = username || '';
    this.password = password || '';
    this.timeoutMs = timeoutMs;
    this.cookie = null;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async login() {
    const response = await axios.post(
      `${this.baseUrl}/api/v2/auth/login`,
      new URLSearchParams({ username: this.username, password: this.password }),
      { timeout: this.timeoutMs, headers: { Referer: this.baseUrl } }
    );

    const setCookie = response.headers['set-cookie'] || [];
    const sid = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('SID='));
    if (!sid) {
      throw new Error('qBittorrent login failed — no session cookie returned (check QBITTORRENT_USERNAME/PASSWORD).');
    }
    this.cookie = sid;
  }

  /**
   * Adds a magnet link (or torrent URL) to qBittorrent under the given
   * category (e.g. "tv" / "movies" — see QBITTORRENT_CATEGORY_TV/MOVIES).
   */
  async addTorrent(magnetUrl, category) {
    if (!this.isConfigured()) {
      throw new Error('qBittorrent is not configured (missing QBITTORRENT_URL).');
    }
    if (!magnetUrl) {
      throw new Error('No magnet/torrent URL provided.');
    }
    if (!this.cookie) {
      await this.login();
    }

    const form = new URLSearchParams();
    form.append('urls', magnetUrl);
    if (category) form.append('category', category);

    const doRequest = () => axios.post(`${this.baseUrl}/api/v2/torrents/add`, form, {
      timeout: this.timeoutMs,
      headers: { Cookie: this.cookie, Referer: this.baseUrl },
    });

    let response;
    try {
      response = await doRequest();
    } catch (err) {
      if (err.response?.status === 403) {
        // Session expired or was never valid — re-authenticate once and retry.
        await this.login();
        response = await doRequest();
      } else {
        throw err;
      }
    }

    if (String(response.data).trim() !== 'Ok.') {
      throw new Error(`qBittorrent rejected the torrent: ${response.data}`);
    }
    return true;
  }
}

function buildQBittorrentClientFromEnv() {
  return new QBittorrentClient({
    baseUrl: process.env.QBITTORRENT_URL,
    username: process.env.QBITTORRENT_USERNAME,
    password: process.env.QBITTORRENT_PASSWORD,
  });
}

module.exports = { QBittorrentClient, buildQBittorrentClientFromEnv };
