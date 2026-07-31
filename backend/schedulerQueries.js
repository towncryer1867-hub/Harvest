const VALID_SORTS = new Set(['added', 'title']);

function parseSchedulerListQuery(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const sort = VALID_SORTS.has(req.query.sort) ? req.query.sort : 'added';
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const search = (req.query.search || '').trim();
  const type = req.query.type === 'movie' || req.query.type === 'show' ? req.query.type : '';

  return { page, limit, offset: (page - 1) * limit, sort, order, search, type };
}

function buildSchedulerQuery({ page, limit, offset, sort, order, search, type }) {
  const conditions = [];
  const params = [];

  if (type) {
    params.push(type);
    conditions.push(`si.type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`COALESCE(m.title, s.title) ILIKE $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = sort === 'title' ? 'COALESCE(m.title, s.title)' : 'si.created_at';

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM scheduler_items si
    LEFT JOIN metadata_movies m ON si.movie_id = m.id
    LEFT JOIN metadata_shows s ON si.show_id = s.id
    ${whereClause}
  `;

  const dataSql = `
    SELECT
      si.id, si.type, si.movie_id, si.show_id,
      si.resolution_preferences, si.allow_season_packs, si.enabled,
      si.created_at, si.updated_at,
      COALESCE(m.title, s.title) AS title,
      COALESCE(m.poster_path, s.poster_path) AS poster_path,
      m.release_date,
      log.last_downloaded_at
    FROM scheduler_items si
    LEFT JOIN metadata_movies m ON si.movie_id = m.id
    LEFT JOIN metadata_shows s ON si.show_id = s.id
    LEFT JOIN LATERAL (
      SELECT MAX(l.downloaded_at) AS last_downloaded_at
      FROM scheduler_log l
      WHERE l.scheduler_item_id = si.id
    ) log ON true
    ${whereClause}
    ORDER BY ${sortCol} ${order}, si.id DESC
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

module.exports = { parseSchedulerListQuery, buildSchedulerQuery };
