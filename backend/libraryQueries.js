const VALID_SORTS = {
  series: new Set(['title', 'release_date', 'published_date']),
  movie: new Set(['title', 'release_date', 'published_date']),
};

function parseListQuery(req, mediaType = 'series') {
  const validSorts = VALID_SORTS[mediaType] || VALID_SORTS.series;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const sort = validSorts.has(req.query.sort) ? req.query.sort : 'title';
  const order = req.query.order === 'desc' ? 'DESC' : 'ASC';
  const search = (req.query.search || '').trim();
  const letter = (req.query.letter || '').trim();

  return { page, limit, offset: (page - 1) * limit, sort, order, search, letter };
}

function appendLetterFilter(conditions, params, letter, column) {
  if (!letter) return;
  if (letter === '#') {
    conditions.push(`${column} !~* '^[A-Za-z]'`);
    return;
  }
  params.push(`${letter}%`);
  conditions.push(`${column} ILIKE $${params.length}`);
}

function appendSearchFilter(conditions, params, search, column) {
  if (!search) return;
  params.push(`%${search}%`);
  conditions.push(`${column} ILIKE $${params.length}`);
}

function appendExactFilter(conditions, params, value, column) {
  if (!value) return;
  params.push(value);
  conditions.push(`${column} = $${params.length}`);
}

function appendGenreFilter(conditions, params, genre, column) {
  if (!genre) return;
  params.push(genre);
  conditions.push(`$${params.length} = ANY(${column})`);
}

function appendYearFilter(conditions, params, year, column) {
  if (!year) return;
  const parsed = parseInt(year, 10);
  if (Number.isNaN(parsed)) return;
  params.push(parsed);
  conditions.push(`${column} = $${params.length}`);
}

function seriesSortColumn(sort) {
  if (sort === 'release_date') return 's.last_aired';
  if (sort === 'published_date') return 'pub.latest_published';
  return 's.title';
}

function movieSortColumn(sort) {
  if (sort === 'release_date') return 'COALESCE(m.release_year::text, m.release_date)';
  if (sort === 'published_date') return 'pub.latest_published';
  return 'm.title';
}

function buildSeriesQuery(options) {
  const { page, limit, offset, sort, order, search, letter, filters } = options;
  const conditions = [];
  const params = [];

  appendSearchFilter(conditions, params, search, 's.title');
  appendLetterFilter(conditions, params, letter, 's.title');
  appendExactFilter(conditions, params, filters.network, 's.network');
  appendGenreFilter(conditions, params, filters.genre, 's.genres');
  appendExactFilter(conditions, params, filters.status, 's.status');
  if (filters.first_aired_year) {
    const parsed = parseInt(filters.first_aired_year, 10);
    if (!Number.isNaN(parsed)) {
      params.push(parsed);
      conditions.push(`EXTRACT(YEAR FROM NULLIF(s.first_aired, '')::date)::int = $${params.length}`);
    }
  }
  appendExactFilter(conditions, params, filters.original_country, 's.original_country');
  appendExactFilter(conditions, params, filters.original_language, 's.original_language');

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = seriesSortColumn(sort);
  const nullsOrder = order === 'ASC' ? 'NULLS LAST' : 'NULLS FIRST';

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM metadata_shows s
    ${whereClause}
  `;

  const dataSql = `
    SELECT
      s.id, s.tvdb_id, s.title, s.overview, s.poster_path,
      s.status, s.network, s.genres, s.first_aired, s.last_aired,
      s.original_country, s.original_language,
      pub.latest_published
    FROM metadata_shows s
    LEFT JOIN LATERAL (
      SELECT MAX(e.date_published) AS latest_published
      FROM metadata_items i
      JOIN scraped_entries e ON e.metadata_item_id = i.id
      WHERE i.show_id = s.id
    ) pub ON true
    ${whereClause}
    ORDER BY ${sortCol} ${order} ${nullsOrder}, s.title ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  return {
    countSql,
    dataSql,
    params,
    dataParams: [...params, limit, offset],
    pagination: { page, limit },
  };
}

function buildMoviesQuery(options) {
  const { page, limit, offset, sort, order, search, letter, filters } = options;
  const conditions = [];
  const params = [];

  appendSearchFilter(conditions, params, search, 'm.title');
  appendLetterFilter(conditions, params, letter, 'm.title');
  appendGenreFilter(conditions, params, filters.genre, 'm.genres');
  if (filters.studio) {
    params.push(filters.studio);
    conditions.push(`$${params.length} = ANY(m.studios)`);
  }
  if (filters.production_company) {
    params.push(filters.production_company);
    conditions.push(`$${params.length} = ANY(m.production_companies)`);
  }
  appendYearFilter(conditions, params, filters.release_year, 'm.release_year');
  appendExactFilter(conditions, params, filters.original_country, 'm.original_country');
  appendExactFilter(conditions, params, filters.original_language, 'm.original_language');

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = movieSortColumn(sort);
  const nullsOrder = order === 'ASC' ? 'NULLS LAST' : 'NULLS FIRST';

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM metadata_movies m
    ${whereClause}
  `;

  const dataSql = `
    SELECT
      m.id, m.tvdb_id, m.title, m.overview, m.poster_path, m.release_date,
      m.release_year, m.genres, m.studios, m.production_companies,
      m.original_country, m.original_language,
      pub.latest_published
    FROM metadata_movies m
    LEFT JOIN LATERAL (
      SELECT MAX(e.date_published) AS latest_published
      FROM metadata_items i
      JOIN scraped_entries e ON e.metadata_item_id = i.id
      WHERE i.movie_id = m.id AND i.type = 'movie'
    ) pub ON true
    ${whereClause}
    ORDER BY ${sortCol} ${order} ${nullsOrder}, m.title ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  return {
    countSql,
    dataSql,
    params,
    dataParams: [...params, limit, offset],
    pagination: { page, limit },
  };
}

function buildFilterOptionsQueries(type) {
  if (type === 'series') {
    return {
      networks: `SELECT DISTINCT network AS value FROM metadata_shows WHERE network IS NOT NULL AND network <> '' ORDER BY value`,
      genres: `SELECT DISTINCT unnest(genres) AS value FROM metadata_shows WHERE genres IS NOT NULL ORDER BY value`,
      statuses: `SELECT DISTINCT status AS value FROM metadata_shows WHERE status IS NOT NULL AND status <> '' ORDER BY value`,
      first_aired_years: `SELECT DISTINCT EXTRACT(YEAR FROM NULLIF(first_aired, '')::date)::int AS value FROM metadata_shows WHERE first_aired IS NOT NULL AND first_aired <> '' ORDER BY value DESC`,
      original_countries: `SELECT DISTINCT original_country AS value FROM metadata_shows WHERE original_country IS NOT NULL AND original_country <> '' ORDER BY value`,
      original_languages: `SELECT DISTINCT original_language AS value FROM metadata_shows WHERE original_language IS NOT NULL AND original_language <> '' ORDER BY value`,
    };
  }

  return {
    genres: `SELECT DISTINCT unnest(genres) AS value FROM metadata_movies WHERE genres IS NOT NULL ORDER BY value`,
    studios: `SELECT DISTINCT unnest(studios) AS value FROM metadata_movies WHERE studios IS NOT NULL ORDER BY value`,
    production_companies: `SELECT DISTINCT unnest(production_companies) AS value FROM metadata_movies WHERE production_companies IS NOT NULL ORDER BY value`,
    release_years: `SELECT DISTINCT release_year AS value FROM metadata_movies WHERE release_year IS NOT NULL ORDER BY value DESC`,
    original_countries: `SELECT DISTINCT original_country AS value FROM metadata_movies WHERE original_country IS NOT NULL AND original_country <> '' ORDER BY value`,
    original_languages: `SELECT DISTINCT original_language AS value FROM metadata_movies WHERE original_language IS NOT NULL AND original_language <> '' ORDER BY value`,
  };
}

module.exports = {
  parseListQuery,
  buildSeriesQuery,
  buildMoviesQuery,
  buildFilterOptionsQueries,
  VALID_SORTS,
};
