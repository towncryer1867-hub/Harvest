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

function extractParenYear(raw) {
  const match = raw.match(/\((19|20)\d{2}\)/);
  return match ? parseInt(match[0].slice(1, -1), 10) : null;
}

function buildSeriesResult({ title, season, episode, year, resolution, is_season_pack, rawTitle }) {
  const result = {
    type: 'series',
    title: cleanSeriesTitle(title),
    season: season != null ? parseInt(season, 10) : null,
    episode: episode != null ? parseInt(episode, 10) : null,
    resolution,
    is_season_pack: !!is_season_pack,
    rawTitle
  };
  const resolvedYear = year ?? extractParenYear(title);
  if (resolvedYear) {
    result.year = resolvedYear;
  }
  return result;
}

/**
 * Parse a title known (from category) to be TV content.
 */
function parseAsSeries(rawTitle) {
  const cleanTitle = rawTitle.trim();

  const resRegex = /\b(\d{3,4}p|4k)\b/i;
  const resMatch = cleanTitle.match(resRegex);
  const resolution = resMatch ? resMatch[1].toLowerCase() : null;

  // YYYY SS EE — e.g. The Price Is Right 2026 06 19 1080p... (year, season, episode)
  const yearSeasonEpisodeRegex = /^(.*?)\s+(20\d{2})[\s.\-_]+(\d{1,2})[\s.\-_]+(\d{1,2})\b/i;
  const yseMatch = cleanTitle.match(yearSeasonEpisodeRegex);
  if (yseMatch) {
    return buildSeriesResult({
      title: yseMatch[1],
      year: parseInt(yseMatch[2], 10),
      season: yseMatch[3],
      episode: yseMatch[4],
      resolution,
      is_season_pack: false,
      rawTitle
    });
  }

  // Season N COMPLETE SERIES — e.g. Upload (2020).Season 1 COMPLETE SERIES.1080p...
  const completeSeriesRegex = /^(.*?)[\s.\-_]*Season\s*(\d{1,4})\s*COMPLETE\s*SERIES\b/i;
  const completeMatch = cleanTitle.match(completeSeriesRegex);
  if (completeMatch) {
    return buildSeriesResult({
      title: completeMatch[1],
      season: completeMatch[2],
      episode: null,
      resolution,
      is_season_pack: true,
      rawTitle
    });
  }

  // S04E01 / s4e1 — e.g. Upload (2020).S04E01.1080p...
  const sxeRegex = /^(.*?)[\s.\-_]*[Ss](\d{1,4})[Ee](\d{1,4})\b/i;
  const sxeMatch = cleanTitle.match(sxeRegex);
  if (sxeMatch) {
    return buildSeriesResult({
      title: sxeMatch[1],
      season: sxeMatch[2],
      episode: sxeMatch[3],
      resolution,
      is_season_pack: false,
      rawTitle
    });
  }

  // 3x1 — e.g. Upload.3x1.1080p
  const xRegex = /^(.*?)[\s.\-_]*(\d{1,4})[xX](\d{1,4})\b/i;
  const xMatch = cleanTitle.match(xRegex);
  if (xMatch) {
    return buildSeriesResult({
      title: xMatch[1],
      season: xMatch[2],
      episode: xMatch[3],
      resolution,
      is_season_pack: false,
      rawTitle
    });
  }

  // Season N pack (no episode) — e.g. Upload (2020).Season 1.1080p...
  const seasonPackRegex = /^(.*?)[\s.\-_]*Season\s*(\d{1,4})(?:[\s.\-_]|$)/i;
  const seasonMatch = cleanTitle.match(seasonPackRegex);
  if (seasonMatch) {
    return buildSeriesResult({
      title: seasonMatch[1],
      season: seasonMatch[2],
      episode: null,
      resolution,
      is_season_pack: true,
      rawTitle
    });
  }

  // S01 / Season 01 without episode
  const seasonOnlyRegex = /^(.*?)[\s.\-_]*(?:[Ss](\d{1,4})|Season\s*(\d{1,4}))(?:[\s.\-_]|$)/i;
  const seasonOnlyMatch = cleanTitle.match(seasonOnlyRegex);
  if (seasonOnlyMatch) {
    return buildSeriesResult({
      title: seasonOnlyMatch[1],
      season: seasonOnlyMatch[2] || seasonOnlyMatch[3],
      episode: null,
      resolution,
      is_season_pack: true,
      rawTitle
    });
  }

  return buildSeriesResult({
    title: cleanTitle.split(/[\s.\-_]*\d{3,4}p/i)[0] || cleanTitle,
    season: null,
    episode: null,
    resolution,
    is_season_pack: false,
    rawTitle
  });
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

const TV_TITLE_PATTERN = /Season\s*\d{1,4}\s*COMPLETE\s*SERIES|[Ss]\d{1,4}[Ee]\d{1,4}|\d{1,4}[xX]\d{1,4}\b|Season\s*\d{1,4}|20\d{2}[\s.\-_]+\d{1,2}[\s.\-_]+\d{1,2}\b/i;

function parseMediaTitle(rawTitle, category = '') {
  if (isTvCategory(category)) {
    return parseAsSeries(rawTitle);
  }

  if (isMovieCategory(category)) {
    return parseAsMovie(rawTitle);
  }

  const cleanTitle = rawTitle.trim();
  const resRegex = /\b(\d{3,4}p|4k)\b/i;
  const resolution = (cleanTitle.match(resRegex) || [])[1]?.toLowerCase() || null;

  if (TV_TITLE_PATTERN.test(cleanTitle)) {
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
