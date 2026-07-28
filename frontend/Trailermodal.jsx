import React, { useEffect } from 'react';

/**
 * Converts a raw trailer URL (as stored straight from TVDB) into an
 * embeddable player URL when we recognize the host. Returns null for
 * anything we don't know how to embed, so the caller can fall back to a
 * plain "open trailer" link instead of a broken iframe.
 */
export function getEmbeddableTrailerUrl(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'youtube.com') {
    const videoId = parsed.searchParams.get('v');
    if (videoId) return `https://www.youtube.com/embed/${videoId}`;
    const pathMatch = parsed.pathname.match(/\/(embed|shorts)\/([a-zA-Z0-9_-]+)/);
    if (pathMatch) return `https://www.youtube.com/embed/${pathMatch[2]}`;
    return null;
  }

  if (host === 'youtu.be') {
    const videoId = parsed.pathname.replace(/^\//, '');
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
  }

  if (host === 'vimeo.com') {
    const idMatch = parsed.pathname.match(/(\d+)/);
    return idMatch ? `https://player.vimeo.com/video/${idMatch[1]}` : null;
  }

  return null;
}

function isDirectVideoFile(url) {
  return /\.(mp4|webm|ogv|ogg|mov|m3u8)(\?.*)?$/i.test(url || '');
}

/**
 * Fullscreen-overlay modal that plays a trailer.
 *  - YouTube / Vimeo links are embedded via their standard iframe players,
 *    which already ship play/pause, volume/mute, and fullscreen controls.
 *  - Direct video file links (.mp4 etc.) use a native <video controls>
 *    element, which provides the same standard control set natively.
 *  - Anything else falls back to a plain "open trailer" link so the modal
 *    never shows a broken player.
 * Closes on the X button, clicking the backdrop, or pressing Escape.
 */
export function TrailerModal({ url, onClose }) {
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

  if (!url) return null;

  const embedUrl = getEmbeddableTrailerUrl(url);
  const isDirectVideo = !embedUrl && isDirectVideoFile(url);

  return (
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          style={styles.closeBtn}
          onClick={onClose}
          aria-label="Close trailer"
          title="Close"
        >
          ✕
        </button>
        <div style={styles.playerWrapper}>
          {embedUrl ? (
            <iframe
              key={embedUrl}
              src={`${embedUrl}?autoplay=1`}
              title="Trailer"
              style={styles.frame}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : isDirectVideo ? (
            <video style={styles.frame} src={url} controls autoPlay playsInline />
          ) : (
            <div style={styles.fallback}>
              <p style={styles.fallbackText}>This trailer can't be played inline.</p>
              <a href={url} target="_blank" rel="noopener noreferrer" style={styles.fallbackLink}>
                Open Trailer ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(10,10,12,0.82)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px',
  },
  modalBox: {
    position: 'relative',
    width: '100%',
    maxWidth: '900px',
    backgroundColor: '#000',
    borderRadius: '10px',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
  },
  closeBtn: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    zIndex: 1001,
    width: '34px',
    height: '34px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'rgba(0,0,0,0.65)',
    color: '#fff',
    fontSize: '1rem',
    fontWeight: '700',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
  playerWrapper: {
    position: 'relative',
    width: '100%',
    paddingTop: '56.25%', // 16:9
    backgroundColor: '#000',
  },
  frame: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    border: 'none',
    backgroundColor: '#000',
  },
  fallback: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    color: '#fff',
  },
  fallbackText: { margin: 0, fontSize: '0.9rem', color: '#ccc' },
  fallbackLink: { color: '#4dabf7', fontWeight: '700', fontSize: '0.95rem', textDecoration: 'none' },
};

export default TrailerModal;