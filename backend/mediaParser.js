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
    .replace(/\s*\(\d{4}\)\s*/g, ' ')          // strip (YYYY)
    .replace(/\s+(?:19|20)\d{2}\s*$/g, ' ')    // strip trailing bare YYYY e.g. "What If 2021"
    .replace(/[\._\-]+$/, '')
    .replace(/[\._\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractParenYear(raw) {
  const match = raw.match(/\((19|20)\d{2}\)/);
  return match ? parseInt(match[0].slice(1, -1), 10) : null;
}

function extractInlineYear(raw) {
  // Catches year sitting directly before the S00E00 or Season marker without parens
  // e.g. "Survivor 2000 S02E01" or "The.Office.2005.S01E01"
  const match = raw.match(/\b((?:19|20)\d{2})\b(?=[\s._-]*(?:[Ss]\d{1,4}|[Ss]easons?\s*\d{1,4}))/i);
  return match ? parseInt(match[1], 10) : null;
}

function buildSeriesResult({ title, season, episode, year, resolution, is_season_pack, rawTitle }) {
  // Extract year from the raw title before cleaning strips it out.
  // Priority: explicitly passed year > parenthesized year in raw > inline year before season marker
  const resolvedYear = year
    ?? extractParenYear(rawTitle)
    ?? extractInlineYear(rawTitle)
    ?? null;

  const result = {
    type: 'series',
    title: cleanSeriesTitle(title),
    season: season != null ? parseInt(season, 10) : null,
    episode: episode != null ? parseInt(episode, 10) : null,
    resolution,
    is_season_pack: !!is_season_pack,
    rawTitle
  };

  if (resolvedYear) {
    result.year = resolvedYear;
  }

  return result;
}

/**
 * Parse a title known (from category) to be TV content.
 */
function parseAsSeries(rawTitle) {
  const cleanTitle = rawTitle.trim().replace(/&amp;/gi, '&');

  const resRegex = /\b(\d{3,4}p|4k)\b/i;
  const resMatch = cleanTitle.match(resRegex);
  const resolution = resMatch ? resMatch[1].toLowerCase() : null;

  // YYYY.MM.DD (dot-separated) talk show — e.g. The.Daily.Show.2026.06.19.1080p...
  const dotDateRegex = /^(.*?)[\s._-]+(20\d{2})\.(\d{2})\.(\d{2})(?:[\s._-]|$)/i;
  const dotDateMatch = cleanTitle.match(dotDateRegex);
  if (dotDateMatch) {
    return buildSeriesResult({
      title: dotDateMatch[1],
      year: parseInt(dotDateMatch[2], 10),
      season: parseInt(dotDateMatch[3], 10),
      episode: parseInt(dotDateMatch[4], 10),
      resolution,
      is_season_pack: false,
      rawTitle
    });
  }

  // YYYY MM DD (space/dash/underscore) talk show — existing pattern kept
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

  // Series.N.Part.N — e.g. Sherlock.Series.2.Part.1.1080p (British TV)
  const seriesPartRegex = /^(.*?)[.\s_-]+[Ss]eries[.\s_-]+(\d{1,2})[.\s_-]+[Pp]art[.\s_-]+(\d{1,2})\b/i;
  const seriesPartMatch = cleanTitle.match(seriesPartRegex);
  if (seriesPartMatch) {
    return buildSeriesResult({
      title: seriesPartMatch[1],
      season: seriesPartMatch[2],
      episode: seriesPartMatch[3],
      resolution,
      is_season_pack: false,
      rawTitle
    });
  }

  // NofN part numbering — e.g. Planet.Earth.2of6.1080p
  const partOfRegex = /^(.*?)[.\s_-]+(\d{1,2})of(\d{1,2})\b/i;
  const partOfMatch = cleanTitle.match(partOfRegex);
  if (partOfMatch) {
    return buildSeriesResult({
      title: partOfMatch[1],
      season: 1,          // no season info available, default to 1
      episode: partOfMatch[2],
      resolution,
      is_season_pack: false,
      rawTitle
    });
  }

  // Season N COMPLETE SERIES — existing
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

  // S04E01 — existing
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

  // 3x1 — existing
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

  // Season N pack — existing
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

  // S01 without episode — existing
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

  // Seasons N to N Complete — e.g. "What If 2021 Seasons 1 to 3 Complete 720p"
  // Takes the first season number; flags as a pack
  const multiSeasonRegex = /^(.*?)[\s._-]+[Ss]easons?\s*(\d{1,4})\s*(?:to|-)\s*\d{1,4}\s*Complete\b/i;
  const multiSeasonMatch = cleanTitle.match(multiSeasonRegex);
  if (multiSeasonMatch) {
    return buildSeriesResult({
      title: multiSeasonMatch[1],
      season: multiSeasonMatch[2],
      episode: null,
      resolution,
      is_season_pack: true,
      rawTitle
    });
  }

  // Resolution-as-delimiter fallback — e.g. Some.Show.Name.1080p.WEB...
  // Splits title on the resolution marker as a last resort
  const resSplitRegex = /^(.*?)[\s._-]+\d{3,4}[pP]\b/i;
  const resSplitMatch = cleanTitle.match(resSplitRegex);
  if (resSplitMatch) {
    return buildSeriesResult({
      title: resSplitMatch[1],
      season: null,
      episode: null,
      resolution,
      is_season_pack: false,
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

function parseMediaTitle(rawTitle, category = '') {
  // Normalize HTML entities before any pattern matching
  const title = rawTitle.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');

  if (isTvCategory(category)) {
    return parseAsSeries(title);
  }

  if (isMovieCategory(category)) {
    return parseAsMovie(title);
  }

  const categoryResult = category && category.trim().length > 0 ? category.trim().toLowerCase() : 'unknown';
  const cleanTitle = title.trim();
  const resRegex = /\b(\d{3,4}p|4k)\b/i;
  const resolution = (cleanTitle.match(resRegex) || [])[1]?.toLowerCase() || null;

  console.log(`parseMediaTitle: unrecognized category "${categoryResult}" for title "${cleanTitle}"`);

  return {
    type: categoryResult,
    title: cleanTitle.replace(/[\._\-]+/g, ' ').trim(),
    resolution,
    rawTitle: title
  };
}

module.exports = { parseMediaTitle, isTvCategory, isMovieCategory, parseAsSeries, parseAsMovie };
