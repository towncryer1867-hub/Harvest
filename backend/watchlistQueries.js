const VALID_SORTS = new Set(['added', 'title']);

function parseWatchlistListQuery(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const sort = VALID_SORTS.has(req.query.sort) ? req.query.sort : 'added';
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const search = (req.query.search || '').trim();
  const type = req.query.type === 'movie' || req.query.type === 'show' ? req.query.type : '';

  return { page, limit, offset: (page - 1) * limit, sort, order, search, type };
}

function buildWatchlistQuery({ page, limit, offset, sort, order, search, type }) {
  const conditions = [];
  const params = [];

  if (type) {
    params.push(type);
    conditions.push(`w.type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`COALESCE(w.tvdb_title, w.user_title) ILIKE $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = sort === 'title' ? 'COALESCE(w.tvdb_title, w.user_title)' : 'w.created_at';

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM watchlist w
    ${whereClause}
  `;

  const dataSql = `
    SELECT
      w.id, w.imdb_id, w.user_title, w.type,
      w.tvdb_id, w.tvdb_title, w.poster_path, w.release_date,
      w.matched_movie_id, w.matched_show_id,
      w.last_checked_at, w.created_at
    FROM watchlist w
    ${whereClause}
    ORDER BY ${sortCol} ${order}, w.id DESC
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

module.exports = { parseWatchlistListQuery, buildWatchlistQuery };
