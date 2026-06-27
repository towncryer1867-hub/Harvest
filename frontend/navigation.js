const NAV_KEY = 'harvest_nav';

const DEFAULT_NAV = {
  view: 'library',
  mediaType: 'series',
  movieId: null,
  showId: null,
  activeSeasonFilter: null,
};

export function readNavigation() {
  try {
    const raw = sessionStorage.getItem(NAV_KEY);
    if (!raw) return { ...DEFAULT_NAV };
    return { ...DEFAULT_NAV, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_NAV };
  }
}

export function writeNavigation(updates) {
  const next = { ...readNavigation(), ...updates };
  sessionStorage.setItem(NAV_KEY, JSON.stringify(next));
  return next;
}

/** Remove legacy localStorage key from before per-tab sessionStorage migration. */
export function migrateLegacyNavigation() {
  localStorage.removeItem('harvest_current_view');
}
