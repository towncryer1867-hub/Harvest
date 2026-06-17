const axios = require('axios');

class TVDBClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api4.thetvdb.com/v4';
    this.token = null;
  }

  /**
   * Authenticates with TheTVDB API using the API Key and stores the JWT token.
   */
  async authenticate() {
    try {
      console.log('Authenticating with TheTVDB API...');
      const response = await axios.post(`${this.baseUrl}/login`, {
        apikey: this.apiKey
        // Note: No user pin is required as per your account configuration
      });

      if (response.data && response.data.data && response.data.data.token) {
        this.token = response.data.data.token;
        console.log('Successfully authenticated with TheTVDB!');
      } else {
        throw new Error('Authentication response did not return a valid token structure.');
      }
    } catch (error) {
      console.error('TheTVDB Authentication failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Helper method to generate headers containing our active JWT authorization token.
   */
  getHeaders() {
    if (!this.token) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json'
    };
  }

  /**
   * Searches for a movie or TV show by its text name string.
   * @param {string} query - The title of the item to search for.
   */
  async searchMedia(query) {
    if (!this.token) await this.authenticate();

    try {
      // Clean up common torrent naming noise to optimize the search query matching success
      const cleanedQuery = query
        .replace(/\b(s\d+e\d+|vostfr|multi|bluray|1080p|720p|h264|x264|web|xvid|dd5\.1)\b.*/i, '')
        .replace(/[\._\-]/g, ' ')
        .trim();

      console.log(`Searching TVDB for: "${cleanedQuery}" (Cleaned from: "${query}")`);

      const response = await axios.get(`${this.baseUrl}/search`, {
        headers: this.getHeaders(),
        params: { q: cleanedQuery, limit: 3 }
      });

      return response.data.data || [];
    } catch (error) {
      // If our token expired, clear it out so the next run tries to re-authenticate
      if (error.response?.status === 401) {
        this.token = null;
      }
      console.error(`TVDB Search error for "${query}":`, error.message);
      return [];
    }
  }

  /**
   * Fetches full expanded details for a specific Series by its TVDB ID.
   */
  async getSeriesDetails(tvdbId) {
    if (!this.token) await this.authenticate();
    try {
      const response = await axios.get(`${this.baseUrl}/series/${tvdbId}/extended`, {
        headers: this.getHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error(`Error fetching TVDB series extended metadata for ID ${tvdbId}:`, error.message);
      return null;
    }
  }
}

module.exports = TVDBClient;