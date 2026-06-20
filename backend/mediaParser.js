/**
 * Utility to parse complex scene titles into structured media metadata objects.
 */
function parseMediaTitle(rawTitle, category = '') {
  const cleanTitle = rawTitle.trim();

  const epRegex = /(.*?)[\s\._\-]*(?:s(\d{1,2})e(\d{1,2})|(\d{1,2})x(\d{1,2})|(?:s|season[\s\._\-]*)(\d{1,2}))/i;
  const epMatch = cleanTitle.match(epRegex);

  const resRegex = /\b(\d{3,4}p|4k)\b/i;
  const resMatch = cleanTitle.match(resRegex);
  const resolution = resMatch ? resMatch[1].toLowerCase() : null;

  const seasonPackRegex = /^(.*?)(?:\s*\(\d{4}\))?\s*[-._]*\s*(?:S(\d+)|Season\s*(\d+))/i;

  function parseAsSeries() {
    let is_season_pack = false;
    let title = epMatch ? epMatch[1] : cleanTitle;
    let season = epMatch ? (epMatch[2] || epMatch[4] || epMatch[6]) : null;
    let episode = epMatch ? (epMatch[3] || epMatch[5]) : null;

    title = title.replace(/[\._\-]+$/, '').replace(/[\._\-]+/g, ' ').trim();

    if (!season && !episode) {
      const seasonMatch = rawTitle.match(seasonPackRegex);
      if (seasonMatch) {
        season = parseInt(seasonMatch[2] || seasonMatch[3], 10);
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

  // TV title patterns take priority regardless of RSS category
  if (epMatch || seasonPackRegex.test(rawTitle)) {
    return parseAsSeries();
  }

  const movieRegex = /(.*?)[\s\._\-]*\b((?:19|20)\d{2})\b/i;
  const movieMatch = cleanTitle.match(movieRegex);

  if (movieMatch) {
    const title = movieMatch[1].replace(/[\._\-]+$/, '').replace(/[\._\-]+/g, ' ').trim();
    return {
      type: 'movie',
      title,
      year: parseInt(movieMatch[2], 10),
      resolution,
      rawTitle
    };
  }

  const cat = category.toLowerCase();
  if (cat.includes('tv') || cat.includes('show') || cat.includes('anime') || cat.includes('series')) {
    return parseAsSeries();
  }

  return {
    type: 'unknown',
    title: cleanTitle.replace(/[\._\-]+/g, ' ').trim(),
    resolution,
    rawTitle
  };
}

module.exports = { parseMediaTitle };
