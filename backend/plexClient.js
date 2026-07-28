const axios = require('axios');

/**
 * Minimal client for the Plex Media Server (PMS) API.
 * Docs: https://developer.plex.tv/pms/
 *
 * Auth: every request needs an X-Plex-Token. We send it as a query param
 * since that's what PMS accepts uniformly across GET requests.
 */
class PlexClient {
  constructor({ baseUrl, token, timeoutMs = 15000 } = {}) {
    this.baseUrl = (baseUrl || '').replace(/\/$/, '');
    this.token = token || '';
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.token);
  }

  async request(path, params = {}) {
    if (!this.isConfigured()) {
      throw new Error('Plex is not configured (missing PLEX_SERVER_URL or PLEX_TOKEN).');
    }
    const response = await axios.get(`${this.baseUrl}${path}`, {
      timeout: this.timeoutMs,
      headers: { Accept: 'application/json' },
      params: { ...params, 'X-Plex-Token': this.token },
    });
    return response.data?.MediaContainer || {};
  }

  /** Lists all library sections. Each has { key, title, type: 'movie' | 'show' | ... }. */
  async getSections() {
    const container = await this.request('/library/sections');
    return (container.Directory || []).map((d) => ({
      key: d.key,
      title: d.title,
      type: d.type,
    }));
  }

  /**
   * Fetches all top-level items (shows or movies) in a section.
   * includeGuids=1 makes Plex return the Guid[] array with external ids
   * (tvdb://, imdb://, tmdb://) for each item — this is what we match on.
   */
  async getSectionItems(sectionKey) {
    const container = await this.request(`/library/sections/${sectionKey}/all`, {
      includeGuids: 1,
    });
    return container.Metadata || [];
  }

  /** Fetches the direct children of a show or season (seasons, or episodes respectively). */
  async getChildren(ratingKey) {
    const container = await this.request(`/library/metadata/${ratingKey}/children`);
    return container.Metadata || [];
  }

  /**
   * Extracts normalized external ids from an item's Guid[] array, falling back to
   * the legacy single `guid` field used by older Plex agents
   * (e.g. com.plexapp.agents.thetvdb://121361?lang=en).
   */
  extractExternalIds(item) {
    const ids = { tvdb: null, imdb: null, tmdb: null };
    const guidStrings = [];

    if (Array.isArray(item.Guid)) {
      for (const g of item.Guid) if (g?.id) guidStrings.push(g.id);
    }
    if (item.guid) guidStrings.push(item.guid);

    for (const guid of guidStrings) {
      const tvdbMatch = guid.match(/(?:^|[./])(?:tvdb|thetvdb):\/\/(\d+)/);
      const imdbMatch = guid.match(/imdb:\/\/(tt\d+)/);
      const tmdbMatch = guid.match(/(?:tmdb|themoviedb):\/\/(\d+)/);
      if (tvdbMatch && !ids.tvdb) ids.tvdb = tvdbMatch[1];
      if (imdbMatch && !ids.imdb) ids.imdb = imdbMatch[1];
      if (tmdbMatch && !ids.tmdb) ids.tmdb = tmdbMatch[1];
    }

    return ids;
  }
}

module.exports = PlexClient;