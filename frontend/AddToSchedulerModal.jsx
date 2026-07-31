import React, { useEffect, useState } from 'react';
import { fetchJson } from './apiClient';
import { RESOLUTION_OPTIONS } from './resolutionOptions';

/**
 * Add/Edit modal for a scheduler entry. Two modes:
 *  - create: opened from the Show detail page's "Add to Scheduler" button —
 *    `entityId` (show_id) is pre-set and POSTs to /api/scheduler. Movie
 *    scheduling has been removed from the product surface.
 *  - edit: opened from the Scheduler listing page's edit icon (or the
 *    detail page's "Edit Scheduler" button once already scheduled) — `item`
 *    is the existing scheduler_items row and PUTs to /api/scheduler/:id.
 * Mirrors AddToWatchlistModal.jsx's overlay/Escape/scroll-lock shape.
 */
export function AddToSchedulerModal({ mode = 'create', entityId, title, item, onClose, onSaved }) {
  const isEdit = mode === 'edit';

  // "Any" is exclusive with every other option — picking a specific
  // resolution clears "Any", and picking "Any" clears everything else,
  // since a resolution_preferences array containing 'any' already matches
  // every release regardless of what else is in it (see
  // backend/resolutionBuckets.js's matchesPreference).
  const [resolutionPreferences, setResolutionPreferences] = useState(
    Array.isArray(item?.resolution_preferences) && item.resolution_preferences.length
      ? item.resolution_preferences
      : ['any']
  );
  const [allowSeasonPacks, setAllowSeasonPacks] = useState(!!item?.allow_season_packs);
  const [enabled, setEnabled] = useState(item ? item.enabled !== false : true);
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

  const toggleResolution = (value) => {
    setResolutionPreferences((prev) => {
      if (value === 'any') {
        return prev.includes('any') ? [] : ['any'];
      }
      const withoutAny = prev.filter((v) => v !== 'any');
      return withoutAny.includes(value)
        ? withoutAny.filter((v) => v !== value)
        : [...withoutAny, value];
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (resolutionPreferences.length === 0) {
      setError('Select at least one resolution (or Any).');
      return;
    }

    setSubmitting(true);
    try {
      const data = isEdit
        ? await fetchJson(`/api/scheduler/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              resolution_preferences: resolutionPreferences,
              allow_season_packs: allowSeasonPacks,
              enabled,
            }),
          })
        : await fetchJson('/api/scheduler', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              show_id: entityId,
              resolution_preferences: resolutionPreferences,
              allow_season_packs: allowSeasonPacks,
            }),
          });
      await onSaved(data.item);
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
        <h3 style={styles.title}>{isEdit ? 'Edit Scheduler Entry' : 'Add to Scheduler'}</h3>
        {title && <p style={styles.subtitle}>{title}</p>}

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Resolution Preference</label>
          <div style={styles.checkboxGrid}>
            {RESOLUTION_OPTIONS.map((opt) => (
              <label key={opt.value} style={styles.gridCheckboxRow}>
                <input
                  type="checkbox"
                  checked={resolutionPreferences.includes(opt.value)}
                  onChange={() => toggleResolution(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>

          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={allowSeasonPacks}
              onChange={(e) => setAllowSeasonPacks(e.target.checked)}
            />
            Allow Season Packs
          </label>

          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>

          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.actions}>
            <button type="button" style={styles.cancelBtn} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" style={styles.submitBtn} disabled={submitting}>
              {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Add to Scheduler'}
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
  title: { margin: '0 0 4px 0', fontSize: '1.1rem', fontWeight: '700', color: '#2c3e50' },
  subtitle: { margin: '0 0 16px 0', fontSize: '0.8rem', color: '#6c757d' },
  label: { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#495057', marginTop: '10px', marginBottom: '4px' },
  input: { width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.85rem', boxSizing: 'border-box' },
  checkboxGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 12px', marginTop: '4px' },
  gridCheckboxRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: '#2c3e50', cursor: 'pointer' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#2c3e50', marginTop: '14px', cursor: 'pointer' },
  error: { marginTop: '12px', fontSize: '0.8rem', color: '#dc3545' },
  actions: { display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' },
  cancelBtn: { padding: '8px 14px', borderRadius: '4px', border: '1px solid #dc3545', backgroundColor: '#fff', color: '#dc3545', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
  submitBtn: { padding: '8px 14px', borderRadius: '4px', border: 'none', backgroundColor: '#0d6efd', color: '#fff', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
};

export default AddToSchedulerModal;
