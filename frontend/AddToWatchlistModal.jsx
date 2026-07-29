import React, { useEffect, useState } from 'react';
import { fetchJson } from './apiClient';

const IMDB_ID_PATTERN = /^tt\d{7,9}$/i;

/**
 * Modal for adding a new watchlist entry: a user-entered title, type, and
 * IMDB id. On submit, the backend runs TVDB + library matching synchronously
 * (see POST /api/watchlist), so the returned item may already come back
 * enriched with a TVDB title/poster/release date and a library link.
 */
export function AddToWatchlistModal({ onClose, onAdded }) {
  const [userTitle, setUserTitle] = useState('');
  const [type, setType] = useState('movie');
  const [imdbId, setImdbId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = userTitle.trim();
    const trimmedImdbId = imdbId.trim();

    if (!trimmedTitle) {
      setError('A title is required.');
      return;
    }
    if (!IMDB_ID_PATTERN.test(trimmedImdbId)) {
      setError('IMDB id must look like "tt1234567".');
      return;
    }

    setSubmitting(true);
    try {
      const data = await fetchJson('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_title: trimmedTitle, type, imdb_id: trimmedImdbId }),
      });
      await onAdded(data.item);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.title}>Add to Watchlist</h3>

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Title</label>
          <input
            style={styles.input}
            value={userTitle}
            onChange={(e) => setUserTitle(e.target.value)}
            placeholder="e.g. Dune: Part Two"
            autoFocus
          />

          <label style={styles.label}>Type</label>
          <select style={styles.input} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="movie">Movie</option>
            <option value="show">TV Show</option>
          </select>

          <label style={styles.label}>IMDB ID</label>
          <input
            style={styles.input}
            value={imdbId}
            onChange={(e) => setImdbId(e.target.value)}
            placeholder="e.g. tt15239678"
          />

          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.actions}>
            <button type="button" style={styles.cancelBtn} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" style={styles.submitBtn} disabled={submitting}>
              {submitting ? 'Adding...' : 'Add to Watchlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(10,10,12,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px',
  },
  modalBox: {
    width: '100%', maxWidth: '420px', backgroundColor: '#fff', borderRadius: '10px',
    padding: '22px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  },
  title: { margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: '700', color: '#2c3e50' },
  label: { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#495057', marginTop: '10px', marginBottom: '4px' },
  input: { width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.85rem', boxSizing: 'border-box' },
  error: { marginTop: '12px', fontSize: '0.8rem', color: '#dc3545' },
  actions: { display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' },
  cancelBtn: { padding: '8px 14px', borderRadius: '4px', border: '1px solid #dc3545', backgroundColor: '#fff', color: '#dc3545', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
  submitBtn: { padding: '8px 14px', borderRadius: '4px', border: 'none', backgroundColor: '#0d6efd', color: '#fff', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
};

export default AddToWatchlistModal;
