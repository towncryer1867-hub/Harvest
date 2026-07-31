import React, { useEffect, useState, useCallback } from 'react';
import { fetchJson } from './apiClient';
import { AddToWatchlistModal } from './AddToWatchlistModal';

const PAGE_SIZE = 24;
const PLACEHOLDER_POSTER = 'https://via.placeholder.com/200x300?text=No+Poster';

// AP-style month abbreviations (March/April/May/June/July stay unabbreviated;
// September shortens to "Sept." rather than Intl's 3-letter "Sep").
const MONTH_ABBREVIATIONS = [
  'Jan.', 'Feb.', 'March', 'April', 'May', 'June',
  'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.',
];

// TVDB sometimes only has a bare year on file for release_date (see
// backend/tvdbMetadata.js's extractMovieFields fallback), which isn't a
// real date — only reformat when it's a full YYYY-MM-DD value, otherwise
// show it as-is rather than risk mangling a bare year.
function formatReleaseDate(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return `${MONTH_ABBREVIATIONS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function buildQueryString(params) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

const DEFAULT_FILTERS = { search: '', sort: 'added', order: 'desc', type: '', page: 1 };

/**
 * Standalone Watchlist grid page — mirrors main.jsx's Library Deck grid
 * (toolbar, pagination, card layout) but owns its own data/filter state
 * since main.jsx doesn't export those internals for reuse.
 *
 * Navigation to a matched catalog item is delegated to the parent via
 * onOpenMovie/onOpenShow, which already know how to fetch the full
 * movie/show record and drive main.jsx's existing detail-view handlers.
 */
export function WatchlistPage({ onOpenMovie, onOpenShow }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, total_pages: 1 });
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async (nextFilters) => {
    setLoading(true);
    setError(null);
    try {
      const query = buildQueryString({
        page: nextFilters.page,
        limit: PAGE_SIZE,
        search: nextFilters.search,
        sort: nextFilters.sort,
        order: nextFilters.order,
        type: nextFilters.type,
      });
      const data = await fetchJson(`/api/watchlist${query}`);
      setItems(data.items || []);
      setPagination(data.pagination || { page: 1, limit: PAGE_SIZE, total: 0, total_pages: 1 });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  // Debounce the free-text search box the same way main.jsx's library
  // toolbar does, so every keystroke doesn't trigger a fetch.
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((prev) => (prev.search === searchInput ? prev : { ...prev, search: searchInput, page: 1 }));
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const handleFilterChange = (updates) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  };

  const handleRemove = async (item) => {
    const label = item.tvdb_title || item.user_title;
    if (!window.confirm(`Remove "${label}" from your watchlist?`)) return;
    try {
      await fetchJson(`/api/watchlist/${item.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAdded = async () => {
    setFilters({ ...DEFAULT_FILTERS });
    setSearchInput('');
  };

  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.limit);

  return (
    <div>
      {error && <div style={styles.errorBanner}>{error}</div>}

      <div style={styles.toolbar}>
        <div style={styles.toolbarRow}>
          <input
            style={styles.searchInput}
            type="text"
            placeholder="Search your watchlist..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            style={styles.select}
            value={filters.type}
            onChange={(e) => handleFilterChange({ type: e.target.value, page: 1 })}
          >
            <option value="">All Types</option>
            <option value="movie">Movies</option>
            <option value="show">TV Shows</option>
          </select>
          <select
            style={styles.select}
            value={filters.sort}
            onChange={(e) => handleFilterChange({ sort: e.target.value, page: 1 })}
          >
            <option value="added">Date Added</option>
            <option value="title">Title (A-Z)</option>
          </select>
          <select
            style={styles.select}
            value={filters.order}
            onChange={(e) => handleFilterChange({ order: e.target.value, page: 1 })}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
          <button style={styles.addBtn} onClick={() => setShowAddModal(true)}>
            + Add to Watchlist
          </button>
        </div>
      </div>

      <div style={styles.grid}>
        {loading && items.length === 0 ? (
          <div style={styles.emptyNotice}>Loading watchlist...</div>
        ) : items.length === 0 ? (
          <div style={styles.emptyNotice}>Nothing on your watchlist yet.</div>
        ) : (
          items.map((item) => {
            const displayTitle = item.tvdb_title || item.user_title;
            const libraryId = item.matched_movie_id || item.matched_show_id;
            return (
              <div key={item.id} style={styles.card}>
                <div style={styles.posterWrapper}>
                  <img src={item.poster_path || PLACEHOLDER_POSTER} alt={displayTitle} style={styles.poster} />
                  <button
                    type="button"
                    style={styles.removeBtn}
                    onClick={() => handleRemove(item)}
                    title="Remove from watchlist"
                    aria-label="Remove from watchlist"
                  >
                    ✕
                  </button>
                </div>
                <div style={styles.cardInfo}>
                  <h4 style={styles.cardTitle}>{displayTitle}</h4>
                  <div style={styles.metaRow}>
                    <span style={styles.typeBadge}>{item.type === 'movie' ? 'Movie' : 'TV Show'}</span>
                    {item.release_date && <span style={styles.dateBadge}>Release: {formatReleaseDate(item.release_date)}</span>}
                  </div>
                  {libraryId ? (
                    <button
                      type="button"
                      style={styles.libraryLinkBtn}
                      onClick={() => (item.matched_movie_id ? onOpenMovie(item.matched_movie_id) : onOpenShow(item.matched_show_id))}
                    >
                      View in Library →
                    </button>
                  ) : (
                    <span style={styles.unmatchedNote}>Not yet in your library</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={styles.paginationBar}>
        <span style={styles.paginationMeta}>
          {pagination.total === 0 ? 'No items' : `Showing ${rangeStart}-${rangeEnd} of ${pagination.total}`}
        </span>
        <div style={styles.paginationControls}>
          <button
            style={styles.pageBtn}
            disabled={pagination.page <= 1 || loading}
            onClick={() => handleFilterChange({ page: pagination.page - 1 })}
          >
            Previous
          </button>
          <span style={styles.pageIndicator}>Page {pagination.page} of {pagination.total_pages}</span>
          <button
            style={styles.pageBtn}
            disabled={pagination.page >= pagination.total_pages || loading}
            onClick={() => handleFilterChange({ page: pagination.page + 1 })}
          >
            Next
          </button>
        </div>
      </div>

      {showAddModal && (
        <AddToWatchlistModal onClose={() => setShowAddModal(false)} onAdded={handleAdded} />
      )}
    </div>
  );
}

const styles = {
  errorBanner: { padding: '12px 16px', marginBottom: '16px', backgroundColor: '#f8d7da', color: '#842029', borderRadius: '6px', border: '1px solid #f5c2c7', fontSize: '0.85rem' },
  toolbar: { backgroundColor: '#fff', border: '1px solid #e9ecef', borderRadius: '8px', padding: '14px', marginBottom: '20px' },
  toolbarRow: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' },
  searchInput: { flex: '1 1 220px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ced4da', fontSize: '0.85rem' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ced4da', fontSize: '0.8rem', backgroundColor: '#fff', minWidth: '130px' },
  addBtn: { padding: '8px 16px', border: 'none', borderRadius: '6px', backgroundColor: '#0d6efd', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '700', marginLeft: 'auto' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', marginTop: '8px', marginBottom: '20px' },
  emptyNotice: { gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: '#6c757d', fontSize: '0.9rem', border: '1px dashed #dee2e6', borderRadius: '8px', backgroundColor: '#fafbfc' },
  card: { backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e9ecef', overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' },
  posterWrapper: { position: 'relative' },
  poster: { width: '100%', height: '280px', objectFit: 'cover', backgroundColor: '#dee2e6', display: 'block' },
  removeBtn: {
    position: 'absolute', top: '8px', right: '8px', width: '26px', height: '26px', borderRadius: '50%',
    border: 'none', backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: '0.75rem', fontWeight: '700',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
    boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
  },
  cardInfo: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  cardTitle: { margin: 0, fontSize: '0.9rem', fontWeight: '700', color: '#2c3e50', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  metaRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  typeBadge: { display: 'inline-block', backgroundColor: '#e9ecef', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', color: '#495057' },
  dateBadge: { display: 'inline-block', backgroundColor: '#eef2ff', color: '#3730a3', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600' },
  libraryLinkBtn: { padding: 0, border: 'none', background: 'none', color: '#0d6efd', fontWeight: '700', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left' },
  unmatchedNote: { fontSize: '0.75rem', color: '#adb5bd', fontStyle: 'italic' },
  paginationBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingTop: '4px', borderTop: '1px solid #f1f3f5' },
  paginationMeta: { fontSize: '0.8rem', color: '#6c757d' },
  paginationControls: { display: 'flex', alignItems: 'center', gap: '10px' },
  pageBtn: { padding: '6px 12px', borderRadius: '4px', border: '1px solid #ced4da', backgroundColor: '#fff', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
  pageIndicator: { fontSize: '0.8rem', color: '#495057', fontWeight: '600' },
};

export default WatchlistPage;
