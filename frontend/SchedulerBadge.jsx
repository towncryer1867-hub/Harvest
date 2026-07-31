import React from 'react';

const badgeBaseStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '3px 8px',
  borderRadius: '4px',
  fontSize: '0.7rem',
  fontWeight: '700',
  letterSpacing: '0.2px',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
  backgroundColor: '#fff4e5',
  color: '#b45309',
  border: '1px solid #fbdca3',
};

const disabledStyle = {
  backgroundColor: '#f8f9fa',
  color: '#adb5bd',
  border: '1px solid #e9ecef',
};

const smallStyle = {
  padding: '2px 6px',
  fontSize: '0.65rem',
};

/**
 * Small pill badge shown on a Library card when the item has a scheduler
 * entry linked to it (scheduler_items.movie_id / show_id — see
 * backend/schedulerTrigger.js). Mirrors WatchlistBadge.jsx's shape.
 */
export function SchedulerBadge({ inScheduler, enabled = true, size = 'normal', style = {} }) {
  if (!inScheduler) return null;

  const sizeStyle = size === 'small' ? smallStyle : {};

  return (
    <span
      style={{ ...badgeBaseStyle, ...(enabled ? {} : disabledStyle), ...sizeStyle, ...style }}
      title={enabled ? 'Monitored by the scheduler' : 'Scheduler monitoring is paused for this title'}
    >
      🕐 {enabled ? 'Scheduled' : 'Paused'}
    </span>
  );
}

// Absolute-position variant for overlaying on top of poster images. Placed
// bottom-left — both top corners are already taken by PlexBadge (top-right)
// and WatchlistBadge (top-left).
export const schedulerPosterBadgeStyle = {
  position: 'absolute',
  bottom: '8px',
  left: '8px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
};

export default SchedulerBadge;
