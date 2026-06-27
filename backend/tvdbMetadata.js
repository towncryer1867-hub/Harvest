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

module.exports = {
  pickEnglishTranslation,
  extractSeriesFields,
  extractMovieFields,
  parseYear,
};
