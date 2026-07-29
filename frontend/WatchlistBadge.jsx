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
  backgroundColor: '#eef4ff',
  color: '#1d4ed8',
  border: '1px solid #c7d9fb',
};

const smallStyle = {
  padding: '2px 6px',
  fontSize: '0.65rem',
};

/**
 * Small pill badge shown on a Library card when the item has a watchlist
 * entry linked to it (watchlist.matched_movie_id / matched_show_id — see
 * backend/watchlistMatcher.js). Mirrors PlexBadge.jsx's shape/conventions.
 */
export function WatchlistBadge({ inWatchlist, size = 'normal', style = {} }) {
  if (!inWatchlist) return null;

  const sizeStyle = size === 'small' ? smallStyle : {};

  return (
    <span
      style={{ ...badgeBaseStyle, ...sizeStyle, ...style }}
      title="On your watchlist"
    >
      👁 Watchlist
    </span>
  );
}

// Absolute-position variant for overlaying on top of poster images. Placed
// top-left so it doesn't collide with PlexBadge's top-right poster overlay.
export const watchlistPosterBadgeStyle = {
  position: 'absolute',
  top: '8px',
  left: '8px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
};

export default WatchlistBadge;
