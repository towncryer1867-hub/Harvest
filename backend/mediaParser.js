/**
 * Utility to parse complex scene titles into structured media metadata objects.
 * RSS category strings from scrape sources are trusted for media type.
 */

function isTvCategory(category) {
  const cat = (category || '').toLowerCase();
  return /tv|show|anime|series|episode/.test(cat);
}

function isMovieCategory(category) {
  const cat = (category || '').toLowerCase();
  return /movie|film|feature/.test(cat);
}

function cleanSeriesTitle(raw) {
  return raw
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .replace(/[\._\-]+$/, '')
    .replace(/[\._\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a title known (from category) to be TV content.
 */
function parseAsSeries(rawTitle) {
  const cleanTitle = rawTitle.trim();

  const resRegex = /\b(\d{3,4}p|4k)\b/i;
  const resMatch = cleanTitle.match(resRegex);
  const resolution = resMatch ? resMatch[1].toLowerCase() : null;

  // Season N COMPLETE SERIES — e.g. Upload (2020).Season 1 COMPLETE SERIES.1080p...
  const completeSeriesRegex = /^(.*?)[\s.\-_]*Season\s*(\d{1,4})\s*COMPLETE\s*SERIES\b/i;
  const completeMatch = cleanTitle.match(completeSeriesRegex);
  if (completeMatch) {
    return {
      type: 'series',
      title: cleanSeriesTitle(completeMatch[1]),
      season: parseInt(completeMatch[2], 10),
      episode: null,
      resolution,
      is_season_pack: true,
      rawTitle
    };
  }

  // S04E01 / s4e1 — e.g. Upload (2020).S04E01.1080p...
  const sxeRegex = /^(.*?)[\s.\-_]*[Ss](\d{1,4})[Ee](\d{1,4})\b/i;
  const sxeMatch = cleanTitle.match(sxeRegex);
  if (sxeMatch) {
    return {
      type: 'series',
      title: cleanSeriesTitle(sxeMatch[1]),
      season: parseInt(sxeMatch[2], 10),
      episode: parseInt(sxeMatch[3], 10),
      resolution,
      is_season_pack: false,
      rawTitle
    };
  }

  // 3x1 — e.g. Upload.3x1.1080p
  const xRegex = /^(.*?)[\s.\-_]*(\d{1,4})[xX](\d{1,4})\b/i;
  const xMatch = cleanTitle.match(xRegex);
  if (xMatch) {
    return {
      type: 'series',
      title: cleanSeriesTitle(xMatch[1]),
      season: parseInt(xMatch[2], 10),
      episode: parseInt(xMatch[3], 10),
      resolution,
      is_season_pack: false,
      rawTitle
    };
  }

  // Season N pack (no episode) — e.g. Upload (2020).Season 1.1080p...
  const seasonPackRegex = /^(.*?)[\s.\-_]*Season\s*(\d{1,4})(?:[\s.\-_]|$)/i;
  const seasonMatch = cleanTitle.match(seasonPackRegex);
  if (seasonMatch) {
    return {
      type: 'series',
      title: cleanSeriesTitle(seasonMatch[1]),
      season: parseInt(seasonMatch[2], 10),
      episode: null,
      resolution,
      is_season_pack: true,
      rawTitle
    };
  }

  // S01 / Season 01 without episode
  const seasonOnlyRegex = /^(.*?)[\s.\-_]*(?:[Ss](\d{1,4})|Season\s*(\d{1,4}))(?:[\s.\-_]|$)/i;
  const seasonOnlyMatch = cleanTitle.match(seasonOnlyRegex);
  if (seasonOnlyMatch) {
    const season = parseInt(seasonOnlyMatch[2] || seasonOnlyMatch[3], 10);
    return {
      type: 'series',
      title: cleanSeriesTitle(seasonOnlyMatch[1]),
      season,
      episode: null,
      resolution,
      is_season_pack: true,
      rawTitle
    };
  }

  return {
    type: 'series',
    title: cleanSeriesTitle(cleanTitle.split(/[\s.\-_]*\d{3,4}p/i)[0] || cleanTitle),
    season: null,
    episode: null,
    resolution,
    is_season_pack: false,
    rawTitle
  };
}

function parseAsMovie(rawTitle) {
  const cleanTitle = rawTitle.trim();

  const resRegex = /\b(\d{3,4}p|4k)\b/i;
  const resMatch = cleanTitle.match(resRegex);
  const resolution = resMatch ? resMatch[1].toLowerCase() : null;

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

  return {
    type: 'unknown',
    title: cleanTitle.replace(/[\._\-]+/g, ' ').trim(),
    resolution,
    rawTitle
  };
}

function parseMediaTitle(rawTitle, category = '') {
  if (isTvCategory(category)) {
    return parseAsSeries(rawTitle);
  }

  if (isMovieCategory(category)) {
    return parseAsMovie(rawTitle);
  }

  // Uncategorized: infer from title patterns only (no cross-type guessing)
  const cleanTitle = rawTitle.trim();
  const resRegex = /\b(\d{3,4}p|4k)\b/i;
  const resolution = (cleanTitle.match(resRegex) || [])[1]?.toLowerCase() || null;

  if (/Season\s*\d{1,4}\s*COMPLETE\s*SERIES|[Ss]\d{1,4}[Ee]\d{1,4}|\d{1,4}[xX]\d{1,4}\b|Season\s*\d{1,4}/i.test(cleanTitle)) {
    return parseAsSeries(rawTitle);
  }

  const movieResult = parseAsMovie(rawTitle);
  if (movieResult.type === 'movie') {
    return movieResult;
  }

  return {
    type: 'unknown',
    title: cleanTitle.replace(/[\._\-]+/g, ' ').trim(),
    resolution,
    rawTitle
  };
}

module.exports = { parseMediaTitle, isTvCategory, isMovieCategory, parseAsSeries, parseAsMovie };
