import React, { useEffect, useState, useCallback } from 'react';
import { fetchJson } from './apiClient';
import { AddToSchedulerModal } from './AddToSchedulerModal';
import { RESOLUTION_OPTIONS, resolutionLabel } from './resolutionOptions';

const PAGE_SIZE = 24;
const PLACEHOLDER_POSTER = 'https://via.placeholder.com/200x300?text=No+Poster';

function buildQueryString(params) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function formatDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const DEFAULT_FILTERS = { search: '', sort: 'added', order: 'desc', resolution: '', page: 1 };

/**
 * Standalone Scheduler grid page — mirrors WatchlistPage.jsx's shape
 * (toolbar, pagination, card layout), pointed at /api/scheduler instead.
 * Shows only — movie scheduling has been removed from the product surface,
 * so there's no type filter here (the backend route still accepts one; it's
 * just not surfaced in this UI). Navigation to the linked show is delegated
 * to the parent via onOpenShow, same pattern as WatchlistPage.
 */
export function SchedulerPage({ onOpenShow }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, total_pages: 1 });
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingItem, setEditingItem] = useState(null);

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
        resolution: nextFilters.resolution,
      });
      const data = await fetchJson(`/api/scheduler${query}`);
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

  // Debounce the free-text search box the same way WatchlistPage does.
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
    if (!window.confirm(`Remove "${item.title}" from the scheduler?`)) return;
    try {
      await fetchJson(`/api/scheduler/${item.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaved = async (savedItem) => {
    setItems((prev) => prev.map((i) => (i.id === savedItem.id ? { ...i, ...savedItem } : i)));
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
            placeholder="Search the scheduler..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
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
          <select
            style={styles.select}
            value={filters.resolution}
            onChange={(e) => handleFilterChange({ resolution: e.target.value, page: 1 })}
          >
            <option value="">All Resolutions</option>
            {RESOLUTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.grid}>
        {loading && items.length === 0 ? (
          <div style={styles.emptyNotice}>Loading scheduler...</div>
        ) : items.length === 0 ? (
          <div style={styles.emptyNotice}>Nothing on the scheduler yet. Use "Add to Scheduler" from a Movie or Show page.</div>
        ) : (
          items.map((item) => {
            const lastDownloaded = formatDateOnly(item.last_downloaded_at);
            return (
              <div key={item.id} style={styles.card}>
                <div style={styles.posterWrapper}>
                  <img src={item.poster_path || PLACEHOLDER_POSTER} alt={item.title} style={styles.poster} />
                  {!item.enabled && <span style={styles.disabledBadge} title="Scheduler monitoring is paused">⏸ Paused</span>}
                  <button
                    type="button"
                    style={styles.editBtn}
                    onClick={() => setEditingItem(item)}
                    title="Edit scheduler entry"
                    aria-label="Edit scheduler entry"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    style={styles.removeBtn}
                    onClick={() => handleRemove(item)}
                    title="Remove from scheduler"
                    aria-label="Remove from scheduler"
                  >
                    ✕
                  </button>
                </div>
                <div style={styles.cardInfo}>
                  <h4 style={styles.cardTitle}>{item.title}</h4>
                  <div style={styles.metaRow}>
                    {item.type === 'movie' && item.release_date && (
                      <span style={styles.dateBadge}>{item.release_date}</span>
                    )}
                    {item.type === 'show' && (
                      <span style={styles.dateBadge}>{lastDownloaded ? `Last downloaded: ${lastDownloaded}` : 'Never downloaded'}</span>
                    )}
                  </div>
                  <div style={styles.metaRow}>
                    {(item.resolution_preferences || []).map((res) => (
                      <span key={res} style={styles.resolutionBadge}>{resolutionLabel(res)}</span>
                    ))}
                  </div>
                  <button
                    type="button"
                    style={styles.libraryLinkBtn}
                    onClick={() => onOpenShow(item.show_id)}
                  >
                    View in Library →
                  </button>
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

      {editingItem && (
        <AddToSchedulerModal
          mode="edit"
          item={editingItem}
          title={editingItem.title}
          onClose={() => setEditingItem(null)}
          onSaved={handleSaved}
        />
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', marginTop: '8px', marginBottom: '20px' },
  emptyNotice: { gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: '#6c757d', fontSize: '0.9rem', border: '1px dashed #dee2e6', borderRadius: '8px', backgroundColor: '#fafbfc' },
  card: { backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e9ecef', overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' },
  posterWrapper: { position: 'relative' },
  poster: { width: '100%', height: '280px', objectFit: 'cover', backgroundColor: '#dee2e6', display: 'block' },
  disabledBadge: {
    position: 'absolute', bottom: '8px', left: '8px', backgroundColor: '#f8f9fa', color: '#adb5bd',
    border: '1px solid #e9ecef', padding: '3px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '700',
    boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
  },
  editBtn: {
    position: 'absolute', top: '8px', left: '8px', width: '26px', height: '26px', borderRadius: '50%',
    border: 'none', backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: '0.75rem', fontWeight: '700',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
    boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
  },
  removeBtn: {
    position: 'absolute', top: '8px', right: '8px', width: '26px', height: '26px', borderRadius: '50%',
    border: 'none', backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: '0.75rem', fontWeight: '700',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
    boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
  },
  cardInfo: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  cardTitle: { margin: 0, fontSize: '0.9rem', fontWeight: '700', color: '#2c3e50', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  metaRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  dateBadge: { display: 'inline-block', backgroundColor: '#eef2ff', color: '#3730a3', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600' },
  resolutionBadge: { display: 'inline-block', backgroundColor: '#e7f1ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', border: '1px solid #bfdbfe' },
  libraryLinkBtn: { padding: 0, border: 'none', background: 'none', color: '#0d6efd', fontWeight: '700', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left' },
  paginationBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingTop: '4px', borderTop: '1px solid #f1f3f5' },
  paginationMeta: { fontSize: '0.8rem', color: '#6c757d' },
  paginationControls: { display: 'flex', alignItems: 'center', gap: '10px' },
  pageBtn: { padding: '6px 12px', borderRadius: '4px', border: '1px solid #ced4da', backgroundColor: '#fff', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
  pageIndicator: { fontSize: '0.8rem', color: '#495057', fontWeight: '600' },
};

export default SchedulerPage;
