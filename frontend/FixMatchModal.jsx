import React, { useEffect, useState } from 'react';
import { fetchJson } from './apiClient';

/**
 * Modal for correcting a single mismatched raw release: lets the user
 * hand-enter the right TheTVDB id (plus season/episode for episodes) and
 * re-points just this one scraped entry at the correct (found-or-created)
 * episode/movie, without touching whatever other entries are already
 * correctly attached to its current episode/movie.
 */
export function FixMatchModal({ type, entryId, currentLabel, onClose, onSuccess }) {
  const [tvdbId, setTvdbId] = useState('');
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');
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

    const trimmedId = tvdbId.trim();
    if (!trimmedId) {
      setError('A TVDB ID is required.');
      return;
    }
    if (type === 'episode' && (season.trim() === '' || episode.trim() === '')) {
      setError('Season and episode numbers are both required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = type === 'movie'
        ? { type, tvdb_id: trimmedId }
        : { type, tvdb_id: trimmedId, season: season.trim(), episode: episode.trim() };

      await fetchJson(`/api/entries/${entryId}/fix-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      await onSuccess();
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
        <h3 style={styles.title}>Fix Match</h3>
        <p style={styles.currentLabel}>Fixing match for: <strong>{currentLabel}</strong></p>

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>TheTVDB {type === 'movie' ? 'Movie' : 'Series'} ID</label>
          <input
            style={styles.input}
            value={tvdbId}
            onChange={(e) => setTvdbId(e.target.value)}
            placeholder="e.g. 81189"
            autoFocus
          />

          {type === 'episode' && (
            <div style={styles.row}>
              <div style={styles.rowField}>
                <label style={styles.label}>Season Number</label>
                <input
                  style={styles.input}
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                  placeholder="e.g. 1"
                  inputMode="numeric"
                />
              </div>
              <div style={styles.rowField}>
                <label style={styles.label}>Episode Number</label>
                <input
                  style={styles.input}
                  value={episode}
                  onChange={(e) => setEpisode(e.target.value)}
                  placeholder="e.g. 5"
                  inputMode="numeric"
                />
              </div>
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.actions}>
            <button type="button" style={styles.cancelBtn} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" style={styles.submitBtn} disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Match'}
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
  title: { margin: '0 0 6px 0', fontSize: '1.1rem', fontWeight: '700', color: '#2c3e50' },
  currentLabel: { margin: '0 0 16px 0', fontSize: '0.8rem', color: '#6c757d' },
  label: { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#495057', marginTop: '10px', marginBottom: '4px' },
  input: { width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.85rem', boxSizing: 'border-box' },
  row: { display: 'flex', gap: '10px' },
  rowField: { flex: 1 },
  error: { marginTop: '12px', fontSize: '0.8rem', color: '#dc3545' },
  actions: { display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' },
  cancelBtn: { padding: '8px 14px', borderRadius: '4px', border: '1px solid #dc3545', backgroundColor: '#fff', color: '#dc3545', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
  submitBtn: { padding: '8px 14px', borderRadius: '4px', border: 'none', backgroundColor: '#0d6efd', color: '#fff', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
};

export default FixMatchModal;
