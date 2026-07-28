import React, { useState, useEffect, useCallback, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import AdminDashboard from './dashboard'
import { fetchJson } from './apiClient'
import { readNavigation, writeNavigation, migrateLegacyNavigation } from './navigation'
import { PlexBadge, plexPosterBadgeStyle } from './PlexBadge'
import { ResolutionBadge } from './ResolutionBadge'
import { TrailerModal } from './TrailerModal'
import { FixMatchModal } from './FixMatchModal'



const PAGE_SIZE = 24;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ISO 639-2/B language codes as returned by TVDB's `originalLanguage` field.
// Falls back to the raw (uppercased) code for anything not in this table.
const LANGUAGE_NAMES = {
  eng: 'English', spa: 'Spanish', fra: 'French', fre: 'French', deu: 'German', ger: 'German',
  ita: 'Italian', jpn: 'Japanese', kor: 'Korean', zho: 'Chinese', chi: 'Chinese', cmn: 'Mandarin',
  rus: 'Russian', por: 'Portuguese', ara: 'Arabic', hin: 'Hindi', nld: 'Dutch', dut: 'Dutch',
  swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', pol: 'Polish',
  tur: 'Turkish', tha: 'Thai', vie: 'Vietnamese', ces: 'Czech', cze: 'Czech',
  ell: 'Greek', gre: 'Greek', heb: 'Hebrew', ind: 'Indonesian', ukr: 'Ukrainian',
  hun: 'Hungarian', ron: 'Romanian', rum: 'Romanian', bul: 'Bulgarian', hrv: 'Croatian',
  srp: 'Serbian', slk: 'Slovak', slo: 'Slovak', slv: 'Slovenian', lit: 'Lithuanian',
  lav: 'Latvian', est: 'Estonian', isl: 'Icelandic', cat: 'Catalan', fil: 'Filipino',
  may: 'Malay', msa: 'Malay', ben: 'Bengali', urd: 'Urdu', fas: 'Persian', per: 'Persian',
};

function formatLanguage(code) {
  if (!code) return null;
  const key = code.toLowerCase().trim();
  if (!key) return null;
  return LANGUAGE_NAMES[key] || code.toUpperCase();
}

// TVDB doesn't hand back a direct link to itself, but its "dereferrer"
// URL scheme resolves straight from the numeric id we already store, no
// slug needed — so this is always available once a title is matched.
function getTvdbUrl(tvdbId, kind) {
  if (!tvdbId) return null;
  return `https://www.thetvdb.com/dereferrer/${kind}/${tvdbId}`;
}

// imdb_id is TVDB's raw remoteIds entry (e.g. "tt1234567"), or null when
// TVDB doesn't have an IMDB cross-reference for this title.
function getImdbUrl(imdbId) {
  if (!imdbId) return null;
  return `https://www.imdb.com/title/${imdbId}/`;
}

// Default sort applies to both media types via the shared 'release_date'
// sort key: libraryQueries.js maps it to s.last_aired for series (i.e.
// "Recent Air Date") and to release_year/release_date for movies, so one
// shared default gives "TV Shows: Recent Air Date Desc" and
// "Movies: Release Date Desc" as requested.
const DEFAULT_LIBRARY_FILTERS = {
  search: '',
  sort: 'release_date',
  order: 'desc',
  letter: '',
  network: '',
  genre: '',
  status: '',
  first_aired_year: '',
  studio: '',
  production_company: '',
  release_year: '',
  original_country: '',
  // Defaults the Language filter to English. This matches the raw TVDB
  // originalLanguage code stored in the DB (e.g. 'eng'), same convention
  // used by the Language filter dropdown values and by formatLanguage()
  // below on the detail pages.
  original_language: 'eng',
  in_plex: '',
  page: 1,
};

function formatDateOnly(value) {
  if (!value) return 'Unknown';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFileSize(bytes) {
  const num = Number(bytes);
  if (!num || Number.isNaN(num) || num <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = num;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function buildQueryString(params) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// Same selector schema dashboard.jsx defaults new manually-created sources
// to, and that the seeded LimeTorrents sources in db-init/init.sql use.
const STANDARD_SOURCE_CONFIG = {
  parser: 'xml',
  selectors: {
    item: 'item',
    title: 'title',
    source_link: 'link',
    date_published: 'pubDate',
    category: 'category',
    description: 'description',
    magnet_link: 'enclosure',
    size: 'size',
  },
};

// Strips everything but letters/digits/whitespace, then collapses the
// whitespace left behind by removed punctuation (e.g. "Spider-Man: Homecoming"
// -> "SpiderMan Homecoming") so the LimeTorrents search URL gets a clean
// keyword segment.
function sanitizeSearchKeyword(raw) {
  return (raw || '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Creates a one-off LimeTorrents search ingestion source for a raw
// title/keyword (POST /api/admin/sources — the same endpoint the Sources
// tab's manual "Deploy New Scraper Endpoint" form uses). `releaseYear`, when
// given, is appended to the *sanitized* keyword before URL-encoding (movie
// pages only — series pages and catalog keyword searches omit it). The
// display name always uses the raw, unsanitized title/keyword.
async function createQuickSearchSource(rawKeywordOrTitle, releaseYear = null) {
  const sanitizedBase = sanitizeSearchKeyword(rawKeywordOrTitle);
  const sanitizedKeyword = releaseYear ? `${sanitizedBase} ${releaseYear}`.trim() : sanitizedBase;

  return fetchJson('/api/admin/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `LimeTorrents - Search: ${rawKeywordOrTitle}`,
      url: `https://www.limetorrents.fun/searchrss/${encodeURIComponent(sanitizedKeyword)}/`,
      interval_minutes: 0,
      config: STANDARD_SOURCE_CONFIG,
    }),
  });
}

// Just the "Showing X-Y of Z" + Previous/Page/Next controls, with none of
// the search/sort/letter/filter inputs — used standalone under the grid so
// the footer doesn't repeat the full toolbar (see PaginationBar usage below).
function PaginationBar({ pagination, libraryLoading, onFilterChange }) {
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const rangeEnd = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <div style={styles.paginationBar}>
      <span style={styles.paginationMeta}>
        {libraryLoading
          ? 'Loading catalog...'
          : pagination.total === 0
            ? 'No items match the current filters'
            : `Showing ${rangeStart}–${rangeEnd} of ${pagination.total}`}
      </span>
      <div style={styles.paginationControls}>
        <button type="button" style={styles.pageBtn} disabled={pagination.page <= 1 || libraryLoading} onClick={() => onFilterChange({ page: pagination.page - 1 })}>Previous</button>
        <span style={styles.pageIndicator}>Page {pagination.page} of {pagination.total_pages}</span>
        <button type="button" style={styles.pageBtn} disabled={pagination.page >= pagination.total_pages || libraryLoading} onClick={() => onFilterChange({ page: pagination.page + 1 })}>Next</button>
      </div>
    </div>
  );
}

function LibraryToolbar({
  mediaType,
  filters,
  filterOptions,
  pagination,
  libraryLoading,
  onFilterChange,
  onResetFilters,
}) {
  const isSeries = mediaType === 'series';

  return (
    <div style={styles.libraryToolbar}>
      <div style={styles.toolbarRow}>
        <input
          type="search"
          placeholder={isSeries ? 'Search series name...' : 'Search movie title...'}
          style={styles.searchInput}
          value={filters.search}
          onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
        />
        <select
          style={styles.toolbarSelect}
          value={filters.sort}
          onChange={(e) => onFilterChange({ sort: e.target.value, page: 1 })}
        >
          <option value="title">Alphabetical</option>
          <option value="release_date">{isSeries ? 'Recent Air Date' : 'Release Date'}</option>
          <option value="published_date">Published Date</option>
        </select>
        <select
          style={styles.toolbarSelect}
          value={filters.order}
          onChange={(e) => onFilterChange({ order: e.target.value, page: 1 })}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
        <button type="button" style={styles.resetBtn} onClick={onResetFilters}>
          Clear Filters
        </button>
      </div>

      <div style={styles.letterStrip}>
        <button
          type="button"
          style={!filters.letter ? styles.letterBtnActive : styles.letterBtn}
          onClick={() => onFilterChange({ letter: '', page: 1 })}
        >
          All
        </button>
        {ALPHABET.map((ch) => (
          <button
            key={ch}
            type="button"
            style={filters.letter === ch ? styles.letterBtnActive : styles.letterBtn}
            onClick={() => onFilterChange({ letter: ch, page: 1 })}
          >
            {ch}
          </button>
        ))}
        <button
          type="button"
          style={filters.letter === '#' ? styles.letterBtnActive : styles.letterBtn}
          onClick={() => onFilterChange({ letter: '#', page: 1 })}
        >
          #
        </button>
      </div>

      <div style={styles.toolbarRow}>
        {isSeries ? (
          <>
            <FilterSelect label="Network" value={filters.network} options={filterOptions.networks || []} onChange={(v) => onFilterChange({ network: v, page: 1 })} />
            <FilterSelect label="Genre" value={filters.genre} options={filterOptions.genres || []} onChange={(v) => onFilterChange({ genre: v, page: 1 })} />
            <FilterSelect label="Status" value={filters.status} options={filterOptions.statuses || []} onChange={(v) => onFilterChange({ status: v, page: 1 })} />
            <FilterSelect label="First Aired Year" value={filters.first_aired_year} options={filterOptions.first_aired_years || []} onChange={(v) => onFilterChange({ first_aired_year: v, page: 1 })} />
          </>
        ) : (
          <>
            <FilterSelect label="Genre" value={filters.genre} options={filterOptions.genres || []} onChange={(v) => onFilterChange({ genre: v, page: 1 })} />
            <FilterSelect label="Studio / Distributor" value={filters.studio} options={filterOptions.studios || []} onChange={(v) => onFilterChange({ studio: v, page: 1 })} />
            <FilterSelect label="Production Company" value={filters.production_company} options={filterOptions.production_companies || []} onChange={(v) => onFilterChange({ production_company: v, page: 1 })} />
            <FilterSelect label="Release Year" value={filters.release_year} options={filterOptions.release_years || []} onChange={(v) => onFilterChange({ release_year: v, page: 1 })} />
          </>
        )}
        <FilterSelect label="Country" value={filters.original_country} options={filterOptions.original_countries || []} onChange={(v) => onFilterChange({ original_country: v, page: 1 })} />
        <FilterSelect label="Language" value={filters.original_language} options={filterOptions.original_languages || []} onChange={(v) => onFilterChange({ original_language: v, page: 1 })} />
        <PlexFilterSelect value={filters.in_plex} onChange={(v) => onFilterChange({ in_plex: v, page: 1 })} />
      </div>

      <PaginationBar pagination={pagination} libraryLoading={libraryLoading} onFilterChange={onFilterChange} />
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label style={styles.filterSelectLabel}>
      <span style={styles.filterSelectText}>{label}</span>
      <select style={styles.toolbarSelect} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((opt) => (
          <option key={opt} value={String(opt)}>{opt}</option>
        ))}
      </select>
    </label>
  );
}

const PLEX_FILTER_OPTIONS = [
  { value: 'true', label: 'In Plex' },
  { value: 'false', label: 'Missing from Plex' },
];

function PlexFilterSelect({ value, onChange }) {
  return (
    <label style={styles.filterSelectLabel}>
      <span style={styles.filterSelectText}>Plex Status</span>
      <select style={styles.toolbarSelect} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {PLEX_FILTER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

// Trailer / IMDb / TheTVDB buttons for a movie or show hero section.
// Renders nothing at all if none of the three links are available. The
// Trailer button opens the in-page modal player; IMDb and TheTVDB are
// plain new-tab links so the browser's native "open in new window/tab"
// behavior applies — both are only rendered when their link is present.
function ExternalLinksRow({ trailerUrl, imdbUrl, tvdbUrl, onPlayTrailer }) {
  if (!trailerUrl && !imdbUrl && !tvdbUrl) return null;

  return (
    <div style={styles.externalLinksRow}>
      {trailerUrl && (
        <button
          type="button"
          style={styles.externalLinkBtn}
          onClick={() => onPlayTrailer(trailerUrl)}
        >
          ▶ Watch Trailer
        </button>
      )}
      {imdbUrl && (
        <a href={imdbUrl} target="_blank" rel="noopener noreferrer" style={styles.externalLinkBtn}>
          IMDb ↗
        </a>
      )}
      {tvdbUrl && (
        <a href={tvdbUrl} target="_blank" rel="noopener noreferrer" style={styles.externalLinkBtn}>
          TheTVDB ↗
        </a>
      )}
    </div>
  );
}

// "Series Cast" / "Movie Cast" row shown under the description. Renders
// nothing while loading, on a fetch error, or once loaded with an empty
// list — a below-the-fold section failing quietly is better than an error
// banner cluttering the detail page.
function CastSection({ showId = null, movieId = null }) {
  const [cast, setCast] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = movieId ? `/api/media/movies/${movieId}/cast` : `/api/media/shows/${showId}/cast`;
    fetchJson(url)
      .then((data) => { if (!cancelled) setCast(data.cast || []); })
      .catch((err) => { console.error('Error fetching cast:', err); if (!cancelled) setCast([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [showId, movieId]);

  if (loading) return <div style={styles.subText}>Loading cast...</div>;
  if (cast.length === 0) return null;

  return (
    <div style={styles.castSection}>
      <h3 style={styles.sectionHeading}>{movieId ? 'Movie Cast' : 'Series Cast'}</h3>
      <div style={styles.castScrollRow}>
        {cast.map((member) => (
          <div key={member.id} style={styles.castCard}>
            <img
              src={member.image_path || 'https://via.placeholder.com/90x90?text=No+Photo'}
              alt={member.name}
              style={styles.castPhoto}
            />
            <p style={styles.castActorName}>{member.name}</p>
            {member.character_name && <p style={styles.castCharacterName}>{member.character_name}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// "Find more from {title}" button shown under the poster on movie/series
// detail pages. `releaseYear` is only ever passed on the movie page — see
// createQuickSearchSource().
function FindMoreButton({ rawTitle, releaseYear = null }) {
  const [status, setStatus] = useState('idle'); // idle | working | done | exists | error
  const [message, setMessage] = useState('');

  const handleClick = async () => {
    setStatus('working');
    setMessage('');
    try {
      const data = await createQuickSearchSource(rawTitle, releaseYear);
      if (data.already_existed) {
        setStatus('exists');
        setMessage(`A search source for "${rawTitle}" already exists in Ingestion Sources.`);
      } else {
        setStatus('done');
        setMessage('Search source created — check Ingestion Sources in Admin Controls.');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  return (
    <div style={styles.findMoreWrap}>
      <button
        type="button"
        style={styles.findMoreBtn}
        onClick={handleClick}
        disabled={status === 'working' || status === 'done' || status === 'exists'}
      >
        {status === 'working' ? 'Creating Search...'
          : status === 'done' ? 'Search Source Created ✓'
          : status === 'exists' ? 'Search Already Exists'
          : `Find more from ${rawTitle}`}
      </button>
      {message && <p style={status === 'error' ? styles.errorText : styles.subText}>{message}</p>}
    </div>
  );
}

// Prompt shown above the catalog grid (below the toolbar's pagination bar)
// whenever a keyword search is active, offering to spin up a dedicated
// LimeTorrents search source for that exact keyword. Keyed by `keyword` at
// the call site so its idle/done/error state resets whenever the search
// term changes, instead of showing a stale "Search Source Created" after
// the user searches for something else.
function CatalogSearchPrompt({ keyword }) {
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  if (!keyword) return null;

  const handleClick = async () => {
    setStatus('working');
    setMessage('');
    try {
      const data = await createQuickSearchSource(keyword);
      if (data.already_existed) {
        setStatus('exists');
        setMessage(`A search source for "${keyword}" already exists in Ingestion Sources.`);
      } else {
        setStatus('done');
        setMessage('Search source created — check Ingestion Sources in Admin Controls.');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  return (
    <div style={styles.catalogSearchPrompt}>
      <p style={styles.catalogSearchPromptText}>
        Would you like to find more results for "{keyword}"? Initiate a Search for {keyword}
      </p>
      <button
        type="button"
        style={styles.findMoreBtn}
        onClick={handleClick}
        disabled={status === 'working' || status === 'done' || status === 'exists'}
      >
        {status === 'working' ? 'Creating Search...'
          : status === 'done' ? 'Search Source Created ✓'
          : status === 'exists' ? 'Search Already Exists'
          : 'Initiate a Search'}
      </button>
      {message && <p style={status === 'error' ? styles.errorText : styles.subText}>{message}</p>}
    </div>
  );
}

function ScrapedEntriesDropdown({ itemId, movieId = null, isSeasonPack = false, seasonNumber = null, showId = null }) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState([]);
  const [fetchError, setFetchError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fixMatchEntry, setFixMatchEntry] = useState(null);
  const [sendingEntryId, setSendingEntryId] = useState(null);
  const [sentEntryIds, setSentEntryIds] = useState(() => new Set());
  const [sendError, setSendError] = useState(null);

  const fetchEntries = async () => {
    try {
      setLoading(true);
      let url = `/api/media/items/${itemId}/entries`;
      if (movieId) {
        url = `/api/media/movies/${movieId}/entries`;
      } else if (isSeasonPack) {
        url = `/api/media/shows/${showId}/seasons/${seasonNumber}/pack-entries`;
      }

      const data = await fetchJson(url);
      setEntries(data.entries || []);
      setFetchError(null);
    } catch (e) {
      console.error("Error fetching linked raw streams:", e);
      setFetchError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = async () => {
    if (!expanded && entries.length === 0) {
      await fetchEntries();
    }
    setExpanded(!expanded);
  };

  // Fix Match re-points a single raw entry at the correct episode/movie —
  // season packs aren't a per-episode/movie match target, so they're excluded.
  const canFixMatch = !isSeasonPack;
  // Also drives the qBittorrent category: episodes/season packs -> "tv",
  // movies -> "movies" (see QBITTORRENT_CATEGORY_TV/MOVIES in the backend .env).
  const fixMatchType = movieId ? 'movie' : 'episode';

  const handleSendToQbittorrent = async (entry) => {
    setSendingEntryId(entry.id);
    setSendError(null);
    try {
      await fetchJson('/api/qbittorrent/add-torrent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet_link: entry.magnet_link, type: fixMatchType })
      });
      setSentEntryIds(prev => new Set(prev).add(entry.id));
    } catch (err) {
      setSendError(`"${entry.title}": ${err.message}`);
    } finally {
      setSendingEntryId(null);
    }
  };

  return (
    <div style={styles.dropdownWrapper}>
      <button style={styles.expandBtn} onClick={toggleExpand}>
        {expanded ? '▲ Hide Stream Source Items' : '▼ View Available Source Links'}
      </button>

      {expanded && (
        <div style={styles.entriesPanel}>
          {loading ? (
            <div style={styles.subText}>Querying ingestion archives...</div>
          ) : fetchError ? (
            <div style={styles.errorText}>{fetchError}</div>
          ) : entries.length === 0 ? (
            <div style={styles.subText}>No active scraped records attached to this item context.</div>
          ) : (
            <ul style={styles.rawList}>
              {entries.map(entry => (
                <li key={entry.id} style={styles.rawItem}>
                  <strong style={styles.entryTitle}>{entry.title}</strong>
                  <div style={styles.metaRow}>
                    <span style={styles.badge}>{entry.category || 'N/A'}</span>
                    <ResolutionBadge title={entry.title} size="small" />
                    <span style={styles.sizeBadge}>{formatFileSize(entry.size) || 'Size unknown'}</span>
                    <button
                      style={sentEntryIds.has(entry.id) ? styles.magnetSentBtn : styles.magnetLink}
                      onClick={() => handleSendToQbittorrent(entry)}
                      disabled={sendingEntryId === entry.id || sentEntryIds.has(entry.id)}
                    >
                      {sendingEntryId === entry.id
                        ? 'Sending...'
                        : sentEntryIds.has(entry.id)
                          ? 'Sent to qBittorrent ✓'
                          : 'Send to qBittorrent'}
                    </button>
                    <span style={styles.subText}>Harvested: {new Date(entry.date_scraped).toLocaleDateString()}</span>
                    {canFixMatch && (
                      <button style={styles.fixMatchBtn} onClick={() => setFixMatchEntry(entry)}>
                        Fix Match
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {sendError && <div style={styles.errorText}>{sendError}</div>}
        </div>
      )}

      {fixMatchEntry && (
        <FixMatchModal
          type={fixMatchType}
          entryId={fixMatchEntry.id}
          currentLabel={fixMatchEntry.title}
          onClose={() => setFixMatchEntry(null)}
          onSuccess={fetchEntries}
        />
      )}
    </div>
  );
}

function App() {
  const [view, setView] = useState('library');
  const [mediaType, setMediaType] = useState('series');
  const [restoring, setRestoring] = useState(true);

  const [movies, setMovies] = useState([]);
  const [shows, setShows] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [selectedShow, setSelectedShow] = useState(null);
  const [trailerModalUrl, setTrailerModalUrl] = useState(null);

  const [showSeasons, setShowSeasons] = useState([]);
  const [showEpisodes, setShowEpisodes] = useState([]);
  const [showSeasonPacks, setShowSeasonPacks] = useState([]);
  const [activeSeasonFilter, setActiveSeasonFilter] = useState(null);
  const [libraryError, setLibraryError] = useState(null);
  const [showDetailError, setShowDetailError] = useState(null);
  const [libraryFilters, setLibraryFilters] = useState({ ...DEFAULT_LIBRARY_FILTERS });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterOptions, setFilterOptions] = useState({});
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, total_pages: 1 });
  const [totalCounts, setTotalCounts] = useState({ series: 0, movie: 0 });

  const activeQueryFilters = useMemo(
    () => ({ ...libraryFilters, search: debouncedSearch }),
    [libraryFilters, debouncedSearch]
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(libraryFilters.search), 300);
    return () => clearTimeout(timer);
  }, [libraryFilters.search]);

  const handleLibraryFilterChange = useCallback((updates) => {
    setLibraryFilters((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetLibraryFilters = useCallback(() => {
    setLibraryFilters({ ...DEFAULT_LIBRARY_FILTERS });
    setDebouncedSearch('');
  }, []);

  const loadFilterOptions = useCallback(async (type) => {
    try {
      const data = await fetchJson(`/api/media/filter-options?type=${type}`);
      setFilterOptions(data.options || {});
    } catch (err) {
      console.error('Error loading filter options:', err);
    }
  }, []);

  const loadLibrary = useCallback(async (type, filters) => {
    setLibraryLoading(true);
    try {
      setLibraryError(null);
      const query = buildQueryString({
        page: filters.page,
        limit: PAGE_SIZE,
        sort: filters.sort,
        order: filters.order,
        search: filters.search,
        letter: filters.letter,
        network: filters.network,
        genre: filters.genre,
        status: filters.status,
        first_aired_year: filters.first_aired_year,
        studio: filters.studio,
        production_company: filters.production_company,
        release_year: filters.release_year,
        original_country: filters.original_country,
        original_language: filters.original_language,
        in_plex: filters.in_plex,
      });

      if (type === 'series') {
        const data = await fetchJson(`/api/media/shows${query}`);
        setShows(data.shows || []);
        setPagination(data.pagination || { page: 1, limit: PAGE_SIZE, total: 0, total_pages: 1 });
        setTotalCounts((prev) => ({ ...prev, series: data.pagination?.total ?? 0 }));
        return data.shows || [];
      }

      const data = await fetchJson(`/api/media/movies${query}`);
      setMovies(data.movies || []);
      setPagination(data.pagination || { page: 1, limit: PAGE_SIZE, total: 0, total_pages: 1 });
      setTotalCounts((prev) => ({ ...prev, movie: data.pagination?.total ?? 0 }));
      return data.movies || [];
    } catch (err) {
      console.error('Error loading library:', err);
      setLibraryError(err.message);
      return [];
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const goToLibrary = () => {
    writeNavigation({
      view: 'library',
      movieId: null,
      showId: null,
      activeSeasonFilter: null,
    });
    setView('library');
    setSelectedMovie(null);
    setSelectedShow(null);
    setShowSeasons([]);
    setShowEpisodes([]);
    setShowSeasonPacks([]);
    setActiveSeasonFilter(null);
    setShowDetailError(null);
    setTrailerModalUrl(null);
  };

  const goToAdmin = () => {
    writeNavigation({
      view: 'admin',
      movieId: null,
      showId: null,
      activeSeasonFilter: null,
    });
    setView('admin');
    setSelectedMovie(null);
    setSelectedShow(null);
    setTrailerModalUrl(null);
  };

  const setLibraryMediaType = (type) => {
    setMediaType(type);
    resetLibraryFilters();
    writeNavigation({ mediaType: type });
  };

  const fetchShowById = async (showId) => {
    const data = await fetchJson(`/api/media/shows/${showId}/profile`);
    return data.show;
  };

  const fetchMovieById = async (movieId) => {
    const data = await fetchJson(`/api/media/movies/${movieId}`);
    return data.movie;
  };

  const loadShowDetail = async (show, preferredSeason = null) => {
    setSelectedShow(show);
    setShowDetailError(null);
    const [seasonsData, epData, packsData] = await Promise.all([
      fetchJson(`/api/media/shows/${show.id}/seasons`),
      fetchJson(`/api/media/shows/${show.id}/episodes`),
      fetchJson(`/api/media/shows/${show.id}/season-packs`)
    ]);

    const sortedSeasons = seasonsData.seasons || [];
    setShowSeasons(sortedSeasons);
    setShowEpisodes(epData.episodes || []);
    setShowSeasonPacks(packsData.season_packs || []);

    const seasonNumbers = sortedSeasons.map(s => s.season_number);
    const restoredSeason = preferredSeason != null && seasonNumbers.includes(preferredSeason)
      ? preferredSeason
      : (sortedSeasons.length > 0 ? sortedSeasons[0].season_number : null);

    setActiveSeasonFilter(restoredSeason);
    writeNavigation({
      view: 'show-detail',
      showId: show.id,
      movieId: null,
      activeSeasonFilter: restoredSeason,
    });
    setView('show-detail');
  };

  // Restore navigation state on mount
  useEffect(() => {
    migrateLegacyNavigation();

    (async () => {
      const nav = readNavigation();
      setMediaType(nav.mediaType);
      await loadFilterOptions(nav.mediaType);

      try {
        if (nav.view === 'movie-detail' && nav.movieId) {
          const movie = await fetchMovieById(nav.movieId);
          if (movie) {
            setSelectedMovie(movie);
            setView('movie-detail');
            return;
          }
        }

        if (nav.view === 'show-detail' && nav.showId) {
          const show = await fetchShowById(nav.showId);
          if (show) {
            await loadShowDetail(show, nav.activeSeasonFilter);
            return;
          }
        }

        if (nav.view === 'admin') {
          setView('admin');
          return;
        }

        setView('library');
      } catch (err) {
        console.error("Error restoring navigation state:", err);
        goToLibrary();
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  // Load library when view/filters change
  useEffect(() => {
    if (restoring || view !== 'library') return;
    loadLibrary(mediaType, activeQueryFilters);
  }, [restoring, view, mediaType, activeQueryFilters, loadLibrary]);

  // Auto-refresh library every 30 seconds when on the library view
  useEffect(() => {
    if (restoring || view !== 'library') return;
    const interval = setInterval(() => {
      loadLibrary(mediaType, activeQueryFilters);
    }, 30000);
    return () => clearInterval(interval);
  }, [restoring, view, mediaType, activeQueryFilters, loadLibrary]);

  useEffect(() => {
    if (view === 'library') {
      loadFilterOptions(mediaType);
    }
  }, [mediaType, view, loadFilterOptions]);

  // Keep total counts fresh on the type toggle buttons
  useEffect(() => {
    if (restoring || view !== 'library') return;
    Promise.all([
      fetchJson('/api/media/shows?limit=1'),
      fetchJson('/api/media/movies?limit=1'),
    ]).then(([showsData, moviesData]) => {
      setTotalCounts({
        series: showsData.pagination?.total ?? 0,
        movie: moviesData.pagination?.total ?? 0,
      });
    }).catch(() => {});
  }, [restoring, view]);

  const handleSelectMovie = (movie) => {
    setSelectedMovie(movie);
    writeNavigation({
      view: 'movie-detail',
      movieId: movie.id,
      showId: null,
      activeSeasonFilter: null,
    });
    setView('movie-detail');
  };

  const handleSelectShow = async (show) => {
    try {
      await loadShowDetail(show);
    } catch (err) {
      console.error("Error building hierarchy context:", err);
      setShowDetailError(err.message);
    }
  };

  const handleSeasonFilterChange = (seasonNumber) => {
    setActiveSeasonFilter(seasonNumber);
    writeNavigation({ activeSeasonFilter: seasonNumber });
  };

  if (restoring) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif', color: '#666' }}>
        Loading catalog...
      </div>
    );
  }

  return (
    <div style={styles.appContainer}>
      {/* Universal Control Dashboard Navbar */}
      <header style={styles.navbar}>
        <h2 style={styles.brandTitle} onClick={() => { goToLibrary(); }}>
          Harvest Media Catalog
        </h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button style={view !== 'admin' ? styles.navActiveBtn : styles.navBtn} onClick={() => { goToLibrary(); }}>
            Library Deck
          </button>
          <button style={view === 'admin' ? styles.navActiveBtn : styles.navBtn} onClick={goToAdmin}>
            Admin Controls
          </button>
        </div>
      </header>

      {/* VIEW A: MAIN GRID LIBRARY DECK */}
      {view === 'library' && (
        <div>
          {libraryError && <div style={styles.errorBanner}>{libraryError}</div>}
          <div style={styles.typeToggleBar}>
            <button
              style={mediaType === 'series' ? styles.toggleActive : styles.toggleInactive}
              onClick={() => setLibraryMediaType('series')}
            >
              TV Shows ({totalCounts.series})
            </button>
            <button
              style={mediaType === 'movie' ? styles.toggleActive : styles.toggleInactive}
              onClick={() => setLibraryMediaType('movie')}
            >
              Movies ({totalCounts.movie})
            </button>
          </div>

          <LibraryToolbar
            mediaType={mediaType}
            filters={libraryFilters}
            filterOptions={filterOptions}
            pagination={pagination}
            libraryLoading={libraryLoading}
            onFilterChange={handleLibraryFilterChange}
            onResetFilters={resetLibraryFilters}
          />

          <CatalogSearchPrompt key={activeQueryFilters.search} keyword={activeQueryFilters.search} />

          <div style={styles.mediaGrid}>
            {libraryLoading && (mediaType === 'series' ? shows : movies).length === 0 ? (
              <div style={styles.emptyGridNotice}>Loading catalog entries...</div>
            ) : mediaType === 'series' ? (
              shows.length === 0 ? (
                <div style={styles.emptyGridNotice}>No TV series match the current filters.</div>
              ) : (
                shows.map(show => (
                  <div key={show.id} style={styles.mediaCard} onClick={() => handleSelectShow(show)}>
                    <div style={styles.posterWrapper}>
                      <img src={show.poster_path || 'https://via.placeholder.com/200x300?text=No+Poster'} alt={show.title} style={styles.poster} />
                      <PlexBadge inPlex={show.in_plex} size="small" style={plexPosterBadgeStyle} />
                    </div>
                    <div style={styles.cardInfo}>
                      <h4 style={styles.cardTitle}>{show.title}</h4>
                      <p style={styles.cardOverview}>{show.overview ? show.overview.substring(0, 90) + '...' : 'No overview details captured.'}</p>
                    </div>
                  </div>
                ))
              )
            ) : movies.length === 0 ? (
              <div style={styles.emptyGridNotice}>No movies match the current filters.</div>
            ) : (
              movies.map(movie => (
                <div key={movie.id} style={styles.mediaCard} onClick={() => handleSelectMovie(movie)}>
                  <div style={styles.posterWrapper}>
                    <img src={movie.poster_path || 'https://via.placeholder.com/200x300?text=No+Poster'} alt={movie.title} style={styles.poster} />
                    <PlexBadge inPlex={movie.in_plex} size="small" style={plexPosterBadgeStyle} />
                  </div>
                  <div style={styles.cardInfo}>
                    <h4 style={styles.cardTitle}>{movie.title}</h4>
                    <span style={styles.yearBadge}>{movie.release_date || movie.release_year || 'Unknown Year'}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer pagination only — search/sort/letter/filter controls stay up top */}
          <div style={{ marginTop: '20px' }}>
            <PaginationBar pagination={pagination} libraryLoading={libraryLoading} onFilterChange={handleLibraryFilterChange} />
          </div>
        </div>
      )}

      {/* VIEW B: UNIQUE MOVIE EXTENDED PROFILE VIEW */}
      {view === 'movie-detail' && selectedMovie && (
        <div style={styles.detailContainer}>
          <button style={styles.backBtn} onClick={goToLibrary}>← Back to Library</button>
          <div style={styles.heroRow}>
            <div style={styles.posterColumn}>
              <img src={selectedMovie.poster_path || 'https://via.placeholder.com/200x300?text=No+Poster'} alt={selectedMovie.title} style={styles.largePoster} />
              <FindMoreButton rawTitle={selectedMovie.title} releaseYear={selectedMovie.release_year} />
            </div>
            <div style={styles.heroMeta}>
              <h1 style={styles.mainTitle}>{selectedMovie.title}</h1>

              <ExternalLinksRow
                trailerUrl={selectedMovie.trailer_url}
                imdbUrl={getImdbUrl(selectedMovie.imdb_id)}
                tvdbUrl={getTvdbUrl(selectedMovie.tvdb_id, 'movie')}
                onPlayTrailer={setTrailerModalUrl}
              />

              <div style={styles.metaDatesRow}>
                <span style={styles.yearBadge}>Movie Entity</span>
                <PlexBadge inPlex={selectedMovie.in_plex} />
              </div>
              <div style={styles.metaDatesRow}>
                <span style={styles.metaDateItem}>
                  <strong>Released:</strong> {selectedMovie.release_date || (selectedMovie.release_year ? String(selectedMovie.release_year) : 'Unknown')}
                </span>
                <span style={styles.metaDateItem}>
                  <strong>Genre:</strong> {selectedMovie.genres && selectedMovie.genres.length ? selectedMovie.genres.join(', ') : 'Unknown'}
                </span>
                <span style={styles.metaDateItem}>
                  <strong>Language:</strong> {formatLanguage(selectedMovie.original_language) || 'Unknown'}
                </span>
              </div>
              <p style={styles.descriptionText}>{selectedMovie.overview || 'No overview summary logged.'}</p>

              <CastSection movieId={selectedMovie.id} />

              <div style={styles.ingestionBox}>
                <h3 style={styles.sectionHeading}>Linked Index Entries</h3>
                <p style={styles.subText}>Scraped targets bound to this unique movie profile:</p>
                <ScrapedEntriesDropdown movieId={selectedMovie.id} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW C: COMPLEX TV SHOW HIERARCHY FILTER SYSTEM */}
      {view === 'show-detail' && selectedShow && (
        <div style={styles.detailContainer}>
          <button style={styles.backBtn} onClick={goToLibrary}>← Back to Library</button>
          {showDetailError && <div style={styles.errorBanner}>{showDetailError}</div>}

          <div style={styles.heroRow}>
            <div style={styles.posterColumn}>
              <img src={selectedShow.poster_path || 'https://via.placeholder.com/200x300?text=No+Poster'} alt={selectedShow.title} style={styles.largePoster} />
              <FindMoreButton rawTitle={selectedShow.title} />
            </div>
            <div style={styles.heroMeta}>
              <h1 style={styles.mainTitle}>{selectedShow.title}</h1>

              <ExternalLinksRow
                trailerUrl={selectedShow.trailer_url}
                imdbUrl={getImdbUrl(selectedShow.imdb_id)}
                tvdbUrl={getTvdbUrl(selectedShow.tvdb_id, 'series')}
                onPlayTrailer={setTrailerModalUrl}
              />

              <div style={styles.metaDatesRow}>
                <span style={styles.metaStatusBadge}>{selectedShow.status}</span>
                <PlexBadge inPlex={selectedShow.in_plex} />
              </div>
              <div style={styles.metaDatesRow}>
                <span style={styles.metaDateItem}>
                  <strong>Last Aired:</strong> {formatDateOnly(selectedShow.last_aired)}
                </span>
                <span style={styles.metaDateItem}>
                  <strong>Last Published:</strong> {formatDateOnly(selectedShow.latest_published)}
                </span>
              </div>
              <div style={styles.metaDatesRow}>
                <span style={styles.metaDateItem}>
                  <strong>Genre:</strong> {selectedShow.genres && selectedShow.genres.length ? selectedShow.genres.join(', ') : 'Unknown'}
                </span>
                <span style={styles.metaDateItem}>
                  <strong>Language:</strong> {formatLanguage(selectedShow.original_language) || 'Unknown'}
                </span>
              </div>
              <p style={styles.descriptionText}>{selectedShow.overview || 'No structural show breakdown summary listed.'}</p>

              <CastSection showId={selectedShow.id} />
            </div>
          </div>

          {/* ROW 1: SEASON SELECTOR HEADER LABELS */}
          <div style={styles.rowContainer}>
            <h3 style={styles.rowLabelTitle}>Season Selector Filter Focus</h3>
            <div style={styles.seasonSelectorContainer}>
              {showSeasons.map(s => (
                <button
                  key={s.id}
                  style={activeSeasonFilter === s.season_number ? styles.seasonSelectBtnActive : styles.seasonSelectBtn}
                  onClick={() => handleSeasonFilterChange(s.season_number)}
                >
                  Season {s.season_number}
                </button>
              ))}
              {showSeasons.length === 0 && <span style={styles.subText}>No tracking season modules mapped to this title.</span>}
            </div>
          </div>

          {/* ROW 2: UNIQUE PACK ENTITIES ROW (FILTERED) */}
          <div style={styles.rowContainer}>
            <h3 style={styles.rowLabelTitle}>Universal Season Packs</h3>
            <div style={styles.itemListRow}>
              {showSeasonPacks
                .filter(p => p.season_number === activeSeasonFilter)
                .map(pack => (
                  <div key={pack.id} style={styles.packEntityCard}>
                    <div style={styles.packHeader}>
                      <h4 style={styles.entityCardTitle}>{pack.title}</h4>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={styles.packBadge}>Full Pack Release</span>
                        <PlexBadge inPlex={pack.in_plex} size="small" />
                      </div>
                    </div>
                    <ScrapedEntriesDropdown itemId={pack.id} isSeasonPack={true} seasonNumber={pack.season_number} showId={selectedShow.id} />
                  </div>
                ))}
              {showSeasonPacks.filter(p => p.season_number === activeSeasonFilter).length === 0 && (
                <div style={styles.emptyRowNotice}>No aggregate season pack releases indexed for Season {activeSeasonFilter}.</div>
              )}
            </div>
          </div>

          {/* ROW 3: DISTINCT TRACKED SUB-EPISODES (FILTERED) */}
          <div style={styles.rowContainer}>
            <h3 style={styles.rowLabelTitle}>Tracked Season Episodes</h3>
            <div style={styles.episodeListVerticalGrid}>
              {showEpisodes
                .filter(ep => ep.season_number === activeSeasonFilter)
                .sort((a,b) => a.episode_number - b.episode_number)
                .map(episode => (
                  <div key={episode.id} style={styles.episodeListRowCard}>
                    <div style={styles.epHeaderLayout}>
                      <span style={styles.epNumbering}>Episode {episode.episode_number}</span>
                      <h4 style={styles.episodeMainTitle}>{episode.title || `Episode ${episode.episode_number}`}</h4>
                      <PlexBadge inPlex={episode.in_plex} size="small" />
                      {episode.air_date && <span style={styles.subText}>Aired: {episode.air_date}</span>}
                    </div>
                    {episode.overview && <p style={styles.epCardOverviewText}>{episode.overview}</p>}
                    <ScrapedEntriesDropdown itemId={episode.id} />
                  </div>
                ))}
              {showEpisodes.filter(ep => ep.season_number === activeSeasonFilter).length === 0 && (
                <div style={styles.emptyRowNotice}>No granular target episodes cached under Season {activeSeasonFilter} yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW D: ADMIN CONSOLE WRAPPER */}
      {view === 'admin' && (
        <div style={{ marginTop: '20px' }}>
          <AdminDashboard />
        </div>
      )}

      {trailerModalUrl && (
        <TrailerModal url={trailerModalUrl} onClose={() => setTrailerModalUrl(null)} />
      )}
    </div>
  )
}

const styles = {
  appContainer: { padding: '20px', maxWidth: '1400px', margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#1a252f' },
  navbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #eef1f4', paddingBottom: '15px', marginBottom: '20px' },
  brandTitle: { margin: 0, cursor: 'pointer', fontSize: '1.4rem', color: '#2c3e50', fontWeight: 'bold' },
  navBtn: { padding: '8px 16px', border: '1px solid #ced4da', borderRadius: '6px', backgroundColor: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' },
  navActiveBtn: { padding: '8px 16px', border: '1px solid #2c3e50', borderRadius: '6px', backgroundColor: '#2c3e50', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' },
  typeToggleBar: { display: 'flex', gap: '10px', marginBottom: '25px', backgroundColor: '#f1f3f5', padding: '6px', borderRadius: '8px', maxWidth: '400px' },
  toggleActive: { flex: 1, padding: '8px', border: 'none', borderRadius: '6px', backgroundColor: '#fff', color: '#2c3e50', fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  toggleInactive: { flex: 1, padding: '8px', border: 'none', backgroundColor: 'transparent', color: '#6c757d', fontWeight: '600', fontSize: '0.85rem', cursor: 'pointer' },
  mediaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', marginTop: '8px', marginBottom: '8px' },
  mediaCard: { backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e9ecef', overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.15s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' },
  poster: { width: '100%', height: '280px', objectFit: 'cover', backgroundColor: '#dee2e6' },
  posterWrapper: { position: 'relative' },
  cardInfo: { padding: '12px' },
  cardTitle: { margin: '0 0 6px 0', fontSize: '0.9rem', fontWeight: '700', color: '#2c3e50', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardOverview: { margin: 0, fontSize: '0.75rem', color: '#6c757d', lineHeight: '1.4' },
  yearBadge: { display: 'inline-block', backgroundColor: '#e9ecef', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600', color: '#495057' },
  detailContainer: { marginTop: '10px' },
  backBtn: { padding: '6px 12px', border: 'none', backgroundColor: 'transparent', color: '#0d6efd', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem', marginBottom: '20px', paddingLeft: 0 },
  heroRow: { display: 'flex', gap: '30px', marginBottom: '35px', borderBottom: '1px solid #e9ecef', paddingBottom: '25px' },
  largePoster: { width: '220px', height: '320px', objectFit: 'cover', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
  posterColumn: { display: 'flex', flexDirection: 'column', gap: '10px', width: '220px' },
  heroMeta: { flex: 1 },
  findMoreWrap: { display: 'flex', flexDirection: 'column', gap: '4px' },
  findMoreBtn: { padding: '9px 14px', borderRadius: '6px', border: '1px solid #2c3e50', backgroundColor: '#fff', color: '#2c3e50', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer', textAlign: 'center' },
  catalogSearchPrompt: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', backgroundColor: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '8px', padding: '14px 18px', marginBottom: '16px' },
  catalogSearchPromptText: { margin: 0, fontSize: '0.85rem', color: '#495057' },
  metaDatesRow: { display: 'flex', gap: '20px', marginBottom: '14px', flexWrap: 'wrap' },
  metaStatusBadge: { fontSize: '0.85rem', color: '#495057', backgroundColor: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '6px', padding: '6px 12px' },
  metaDateItem: { fontSize: '0.85rem', color: '#495057', backgroundColor: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '6px', padding: '6px 12px' },
  mainTitle: { margin: '0 0 10px 0', fontSize: '2rem', fontWeight: 'bold', color: '#2c3e50' },
  descriptionText: { fontSize: '0.95rem', lineHeight: '1.6', color: '#495057', margin: '0 0 20px 0' },
  externalLinksRow: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' },
  externalLinkBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '9px 16px', borderRadius: '6px', border: '1px solid #2c3e50',
    backgroundColor: '#2c3e50', color: '#fff', fontSize: '0.8rem', fontWeight: '700',
    cursor: 'pointer', textDecoration: 'none', lineHeight: 1,
  },
  ingestionBox: { backgroundColor: '#f8f9fa', padding: '20px', borderRadius: '8px', border: '1px solid #e9ecef' },
  sectionHeading: { margin: '0 0 10px 0', fontSize: '1rem', fontWeight: '700' },
  castSection: { marginBottom: '20px' },
  castScrollRow: { display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px' },
  castCard: { flex: '0 0 100px', textAlign: 'center' },
  castPhoto: { width: '90px', height: '90px', borderRadius: '50%', objectFit: 'cover', backgroundColor: '#dee2e6', display: 'block', margin: '0 auto 8px auto' },
  castActorName: { margin: 0, fontSize: '0.8rem', fontWeight: '700', color: '#2c3e50' },
  castCharacterName: { margin: '2px 0 0 0', fontSize: '0.75rem', color: '#6c757d' },
  rowContainer: { marginBottom: '30px', backgroundColor: '#fff', border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' },
  rowLabelTitle: { margin: '0 0 15px 0', fontSize: '0.8rem', fontWeight: '800', color: '#6c757d', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #f1f3f5', paddingBottom: '6px' },
  seasonSelectorContainer: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  seasonSelectBtn: { padding: '8px 16px', borderRadius: '20px', border: '1px solid #ced4da', backgroundColor: '#fff', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer', color: '#495057' },
  seasonSelectBtnActive: { padding: '8px 16px', borderRadius: '20px', border: '1px solid #0d6efd', backgroundColor: '#0d6efd', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer', color: '#fff' },
  itemListRow: { display: 'flex', flexDirection: 'column', gap: '12px' },
  packEntityCard: { backgroundColor: '#fdfcfe', border: '1px solid #e1dbec', borderRadius: '6px', padding: '15px' },
  packHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  entityCardTitle: { margin: 0, fontSize: '0.95rem', fontWeight: '700', color: '#2c3e50' },
  packBadge: { backgroundColor: '#f3e8ff', color: '#6b21a8', padding: '3px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700' },
  episodeListVerticalGrid: { display: 'flex', flexDirection: 'column', gap: '15px' },
  episodeListRowCard: { backgroundColor: '#fafbfc', border: '1px solid #eaedf0', borderRadius: '6px', padding: '15px' },
  epHeaderLayout: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' },
  epNumbering: { backgroundColor: '#e8f2ff', color: '#1e40af', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700' },
  episodeMainTitle: { margin: 0, fontSize: '0.9rem', fontWeight: '700', color: '#2c3e50' },
  epCardOverviewText: { margin: '0 0 12px 0', fontSize: '0.8rem', color: '#6c757d', lineHeight: '1.4' },
  emptyRowNotice: { padding: '20px', textAlign: 'center', fontSize: '0.85rem', color: '#adb5bd', border: '1px dashed #dee2e6', borderRadius: '6px', width: '100%' },
  dropdownWrapper: { marginTop: '5px' },
  expandBtn: { padding: '6px 12px', border: '1px solid #ced4da', borderRadius: '4px', backgroundColor: '#fff', fontSize: '0.75rem', fontWeight: '600', color: '#495057', cursor: 'pointer' },
  entriesPanel: { marginTop: '10px', backgroundColor: '#fff', border: '1px solid #e9ecef', borderRadius: '4px', padding: '12px' },
  subText: { fontSize: '0.75rem', color: '#6c757d' },
  errorText: { fontSize: '0.75rem', color: '#dc3545' },
  errorBanner: { padding: '12px 16px', marginBottom: '16px', backgroundColor: '#f8d7da', color: '#842029', borderRadius: '6px', border: '1px solid #f5c2c7', fontSize: '0.85rem' },
  rawList: { listStyleType: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' },
  rawItem: { paddingBottom: '10px', borderBottom: '1px solid #f1f3f5' },
  entryTitle: { fontSize: '0.8rem', color: '#212529', display: 'block', marginBottom: '4px' },
  metaRow: { display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' },
  badge: { backgroundColor: '#e9ecef', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '500' },
  sizeBadge: { backgroundColor: '#eef2ff', color: '#3730a3', border: '1px solid #dfe4fb', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600' },
  magnetLink: { fontSize: '0.75rem', color: '#198754', fontWeight: '700', textDecoration: 'none', background: 'none', border: 'none', padding: 0, cursor: 'pointer' },
  magnetSentBtn: { fontSize: '0.75rem', color: '#6c757d', fontWeight: '700', textDecoration: 'none', background: 'none', border: 'none', padding: 0, cursor: 'default' },
  libraryToolbar: { backgroundColor: '#fff', border: '1px solid #e9ecef', borderRadius: '8px', padding: '14px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '12px' },
  toolbarRow: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' },
  searchInput: { flex: '1 1 220px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ced4da', fontSize: '0.85rem' },
  toolbarSelect: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ced4da', fontSize: '0.8rem', backgroundColor: '#fff', minWidth: '130px' },
  filterSelectLabel: { display: 'flex', flexDirection: 'column', gap: '4px' },
  filterSelectText: { fontSize: '0.7rem', fontWeight: '700', color: '#6c757d', textTransform: 'uppercase' },
  letterStrip: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  letterBtn: { padding: '4px 8px', borderRadius: '4px', border: '1px solid #dee2e6', backgroundColor: '#fff', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', color: '#495057' },
  letterBtnActive: { padding: '4px 8px', borderRadius: '4px', border: '1px solid #2c3e50', backgroundColor: '#2c3e50', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', color: '#fff' },
  resetBtn: { padding: '7px 12px', borderRadius: '6px', border: '1px solid #ced4da', backgroundColor: '#f8f9fa', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer', color: '#495057' },
  paginationBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingTop: '4px', borderTop: '1px solid #f1f3f5' },
  paginationMeta: { fontSize: '0.8rem', color: '#6c757d' },
  paginationControls: { display: 'flex', alignItems: 'center', gap: '10px' },
  pageBtn: { padding: '6px 12px', borderRadius: '4px', border: '1px solid #ced4da', backgroundColor: '#fff', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
  pageIndicator: { fontSize: '0.8rem', color: '#495057', fontWeight: '600' },
  emptyGridNotice: { gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: '#6c757d', fontSize: '0.9rem', border: '1px dashed #dee2e6', borderRadius: '8px', backgroundColor: '#fafbfc' },
  fixMatchBtn: { padding: '4px 10px', borderRadius: '4px', border: '1px solid #ced4da', backgroundColor: '#fff', fontSize: '0.7rem', fontWeight: '600', color: '#495057', cursor: 'pointer' }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)