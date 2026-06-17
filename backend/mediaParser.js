/**
 * Utility to parse complex scene titles into structured media metadata objects.
 */
function parseMediaTitle(rawTitle, category = '') {
    const cleanTitle = rawTitle.trim();
    
    // 1. Detect TV Show Patterns: S00E00 or 00x00 or Season 00
    const tvRegex = /(.*?)[\s\._\-]*(?:s(\d{1,2})e(\d{1,2})|(\d{1,2})x(\d{1,2})|season[\s\._\-]*(\d{1,2}))/i;
    const tvMatch = cleanTitle.match(tvRegex);
  
    // 2. Detect Resolution Patterns: 480p, 720p, 1080p, 2160p, 4k
    const resRegex = /\b(\d{3,4}p|4k)\b/i;
    const resMatch = cleanTitle.match(resRegex);
    const resolution = resMatch ? resMatch[1].toLowerCase() : null;
  
    if (tvMatch || category.toLowerCase().includes('tv') || category.toLowerCase().includes('show')) {
      let title = tvMatch ? tvMatch[1] : cleanTitle;
      let season = tvMatch ? (tvMatch[2] || tvMatch[4] || tvMatch[6]) : null;
      let episode = tvMatch ? (tvMatch[3] || tvMatch[5]) : null;
  
      // Clean up trailing dots/dashes from title
      title = title.replace(/[\._\-]+$/, '').replace(/[\._\-]+/g, ' ').trim();
  
      return {
        type: 'series',
        title,
        season: season ? parseInt(season, 10) : null,
        episode: episode ? parseInt(episode, 10) : null,
        resolution
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
        resolution
      };
    }
  
    // Fallback fallback if no year or season flag is matched
    return {
      type: 'unknown',
      title: cleanTitle.replace(/[\._\-]+/g, ' ').trim(),
      resolution
    };
  }
  
  module.exports = { parseMediaTitle };