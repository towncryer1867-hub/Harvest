/**
 * Utility to parse complex scene titles into structured media metadata objects.
 */
function parseMediaTitle(rawTitle, category = '') {
    const cleanTitle = rawTitle.trim();
    
    // 1. Detect TV Show Patterns: S00E00 or 00x00 or Season 00
    const epRegex = /(.*?)[\s\._\-]*(?:s(\d{1,2})e(\d{1,2})|(\d{1,2})x(\d{1,2})|(?:s|season[\s\._\-]*)(\d{1,2}))/i;
    const epMatch = cleanTitle.match(epRegex);
  
    // 2. Detect Resolution Patterns: 480p, 720p, 1080p, 2160p, 4k
    const resRegex = /\b(\d{3,4}p|4k)\b/i;
    const resMatch = cleanTitle.match(resRegex);
    const resolution = resMatch ? resMatch[1].toLowerCase() : null;
  
    if (category.toLowerCase().includes('tv') || category.toLowerCase().includes('show')) {
      let is_season_pack = false;
      let title = epMatch ? epMatch[1] : cleanTitle;
      let season = epMatch ? (epMatch[2] || epMatch[4] || epMatch[6]) : null;
      let episode = epMatch ? (epMatch[3] || epMatch[5]) : null;
  
      // Clean up trailing dots/dashes from title
      title = title.replace(/[\._\-]+$/, '').replace(/[\._\-]+/g, ' ').trim();

      // Check if entity is a Season Pack
      if (!season && !episode) {
        const seasonPackRegex = /^(.*?)(?:\s*\(\d{4}\))?\s*[-._]*\s*(?:S(\d+)|Season\s*(\d+))/i;
        const seasonMatch = rawTitle.match(seasonPackRegex);
        if (seasonMatch) {
          const rawSeason = seasonMatch[2] || seasonMatch[3];
          season = parseInt(rawSeason, 10);
          is_season_pack = true;
        }
      }
  
      return {
        type: 'series',
        title,
        season: season ? parseInt(season, 10) : null,
        episode: episode ? parseInt(episode, 10) : null,
        resolution,
        is_season_pack,
        rawTitle
      };
    }

    // 3. Detect Movie Patterns: Title followed by a 4-digit year (19xx or 20xx)
    const movieRegex = /(.*?)[\s\._\-]*\b((?:19|20)\d{2})\b/i;
    const movieMatch = cleanTitle.match(movieRegex);
  
    if (movieMatch) {
      let title = movieMatch[1].replace(/[\._\-]+$/, '').replace(/[\._\-]+/g, ' ').trim();
      return {
        type: 'movie',
        title,
        year: parseInt(movieMatch[2], 10),
        resolution,
        rawTitle
      };
    }
  
    // Fallback fallback if no year or season flag is matched
    return {
      type: 'unknown',
      title: cleanTitle.replace(/[\._\-]+/g, ' ').trim(),
      resolution,
      rawTitle
    };
  }

  module.exports = { parseMediaTitle };