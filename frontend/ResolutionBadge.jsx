import React from 'react';

/**
 * Parses a scraped release title (e.g. "Movie.Name.2020.1080p.WEB-DL.x264")
 * and returns a normalized resolution label, or null if none was found.
 * Mirrors the resolution regex used server-side in mediaParser.js so the
 * badges line up with how entries get matched.
 */
export function parseResolution(title) {
  if (!title) return null;
  const match = title.match(/\b(2160p|4320p|1080p|720p|576p|480p|360p|4k|8k)\b/i);
  if (!match) return null;
  const raw = match[1].toLowerCase();

  if (raw === '2160p' || raw === '4k') return '4K';
  if (raw === '4320p' || raw === '8k') return '8K';
  if (raw === '1080p') return '1080p';
  if (raw === '720p') return '720p';
  if (raw === '576p' || raw === '480p' || raw === '360p') return 'SD';
  return raw.toUpperCase();
}

const badgeBaseStyle = {
  display: 'inline-flex',
  alignItems: 'center',
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

// Color tiers roughly follow "the higher the resolution, the cooler/richer
// the color" so quality is scannable at a glance across a list of entries.
const RESOLUTION_STYLES = {
  '8K': { backgroundColor: '#fdeaea', color: '#a4133c', border: '1px solid #f5c2c7' },
  '4K': { backgroundColor: '#f3e8ff', color: '#6b21a8', border: '1px solid #e0c3fa' },
  '1080p': { backgroundColor: '#e7f1ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  '720p': { backgroundColor: '#e6f7ee', color: '#15803d', border: '1px solid #bbf7d0' },
  'SD': { backgroundColor: '#fff7e6', color: '#b45309', border: '1px solid #fde68a' },
};

const unknownStyle = { backgroundColor: '#f1f3f5', color: '#868e96', border: '1px solid #e9ecef' };

/**
 * Small color-coded pill showing the detected resolution of a scraped
 * release entry. Pass either a pre-parsed `resolution` label directly,
 * or a raw release `title` to parse it on the fly.
 */
export function ResolutionBadge({ title, resolution = null, size = 'normal', style = {} }) {
  const label = resolution || parseResolution(title);
  const sizeStyle = size === 'small' ? smallStyle : {};

  if (!label) {
    return (
      <span
        style={{ ...badgeBaseStyle, ...unknownStyle, ...sizeStyle, ...style }}
        title="Resolution not detected from the release title"
      >
        Unknown
      </span>
    );
  }

  const colorStyle = RESOLUTION_STYLES[label] || unknownStyle;

  return (
    <span
      style={{ ...badgeBaseStyle, ...colorStyle, ...sizeStyle, ...style }}
      title={`Detected resolution: ${label}`}
    >
      {label}
    </span>
  );
}

export default ResolutionBadge;