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
};

const smallStyle = {
  padding: '2px 6px',
  fontSize: '0.65rem',
};

const inPlexStyle = {
  backgroundColor: '#e5f6ea',
  color: '#1a7a3e',
  border: '1px solid #b7e4c7',
};

const missingStyle = {
  backgroundColor: '#fdf1f1',
  color: '#c23b3b',
  border: '1px solid #f3c9c9',
};

const unsyncedStyle = {
  backgroundColor: '#f8f9fa',
  color: '#adb5bd',
  border: '1px solid #e9ecef',
};

/**
 * Small pill badge showing whether an item (show, movie, episode, or
 * season pack) has been matched against the user's Plex library.
 *
 * `inPlex` should come straight off the API:
 *   - true  -> found in Plex
 *   - false -> checked, not found
 *   - null / undefined -> a Plex sync has never run for this item, so we
 *     don't imply it's missing — we say status unknown instead.
 */
export function PlexBadge({ inPlex, size = 'normal', style = {} }) {
  const sizeStyle = size === 'small' ? smallStyle : {};

/*  if (inPlex === null || inPlex === undefined) {
    return (
      <span
        style={{ ...badgeBaseStyle, ...unsyncedStyle, ...sizeStyle, ...style }}
        title="Plex status unknown — run a sync from System Settings"
      >
        ○ Not synced
      </span>
    );
  }*/

  if (inPlex) {
    return (
      <span
        style={{ ...badgeBaseStyle, ...inPlexStyle, ...sizeStyle, ...style }}
        title="Found in your Plex library"
      >
        ✓ In Plex
      </span>
    );
  }

/*  return (
    <span
      style={{ ...badgeBaseStyle, ...missingStyle, ...sizeStyle, ...style }}
      title="Not found in your Plex library"
    >
      ✕ Missing
    </span>
  );*/
}

// Absolute-position variant for overlaying on top of poster images.
export const plexPosterBadgeStyle = {
  position: 'absolute',
  top: '8px',
  right: '8px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
};

export default PlexBadge;