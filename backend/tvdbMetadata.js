const ENGLISH_CODES = new Set(['eng', 'en', 'en-US', 'en-GB']);

function pickEnglishTranslation(translations) {
  if (!translations) return null;
  const lists = [
    translations.nameTranslations,
    translations.overviewTranslations,
  ].filter(Boolean);

  for (const list of lists) {
    const match = list.find((t) => ENGLISH_CODES.has(t.language));
    if (match) return match;
  }
  return null;
}

function englishName(extended, englishTranslation) {
  return englishTranslation?.name || extended?.name || '';
}

function englishOverview(extended, englishTranslation) {
  return englishTranslation?.overview || extended?.overview || '';
}

function genreNames(genres) {
  return (genres || []).map((g) => g.name).filter(Boolean);
}

function companyNames(companies) {
  return (companies || []).map((c) => c.name).filter(Boolean);
}

function parseYear(value) {
  if (!value) return null;
  const match = String(value).match(/(19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : null;
}

function extractSeriesFields(extended, englishTranslation) {
  const network =
    extended?.originalNetwork?.name ||
    extended?.latestNetwork?.name ||
    null;

  return {
    title: englishName(extended, englishTranslation),
    overview: englishOverview(extended, englishTranslation),
    poster_path: extended?.image || '',
    status: extended?.status?.name || null,
    network,
    genres: genreNames(extended?.genres),
    // NOTE: this is only a seed value used when a show is first created
    // (e.g. from a season-pack match with no per-episode data yet).
    // The authoritative value going forward comes from
    // computeRecentAirDate() below, run against the real episode list
    // whenever an individual episode is synced. See matcher.js.
    first_aired: extended?.firstAired || null,
    last_aired: extended?.lastAired || null,
    original_country: extended?.originalCountry || extended?.country || null,
    original_language: extended?.originalLanguage || null,
  };
}

function extractMovieFields(extended, englishTranslation) {
  const companies = extended?.companies || {};
  const studios = [
    ...companyNames(extended?.studios),
    ...companyNames(companies.studio),
    ...companyNames(companies.distributor),
  ];
  const productionCompanies = companyNames(companies.production);
  const releaseYear = parseYear(extended?.year || extended?.first_release?.date);

  return {
    title: englishName(extended, englishTranslation),
    overview: englishOverview(extended, englishTranslation),
    poster_path: extended?.image || '',
    release_date: String(extended?.year || releaseYear || ''),
    release_year: releaseYear,
    genres: genreNames(extended?.genres),
    studios: [...new Set(studios)],
    production_companies: [...new Set(productionCompanies)],
    original_country: extended?.originalCountry || null,
    original_language: extended?.originalLanguage || null,
  };
}

/**
 * Derives an accurate "recent air date" for a series from its full episode
 * list (TVDB /series/{id}/extended?meta=episodes).
 *
 * Process:
 *  - Start from the LAST episode in the list (TVDB returns episodes in
 *    airing order, so this is the most recently/soon-to-be aired entry).
 *  - Check whether that episode's `aired` date is today or in the past.
 *    If so, it's a real, already-aired episode — use its date.
 *  - If it's in the future (e.g. TVDB has already listed next week's
 *    unaired episode), it doesn't count as "aired" yet, so step backward
 *    through the list until we find one that has actually aired.
 *
 * Returns a 'YYYY-MM-DD' string, or null if no aired episode is found
 * (e.g. brand new series with no episodes aired yet, or missing data).
 *
 * @param {Array} episodes - episodes array from getSeriesEpisodesExtended()
 * @param {Date} [referenceDate] - defaults to now; injectable for testing
 */
function computeRecentAirDate(episodes, referenceDate = new Date()) {
  if (!Array.isArray(episodes) || episodes.length === 0) return null;

  const todayStr = referenceDate.toISOString().slice(0, 10); // 'YYYY-MM-DD'

  for (let i = episodes.length - 1; i >= 0; i--) {
    const ep = episodes[i];
    const airedStr = ep?.aired;
    if (!airedStr) continue;

    // String comparison is safe here since both are 'YYYY-MM-DD'.
    if (airedStr <= todayStr) {
      return airedStr;
    }
  }

  return null;
}

module.exports = {
  pickEnglishTranslation,
  extractSeriesFields,
  extractMovieFields,
  computeRecentAirDate,
  parseYear,
};