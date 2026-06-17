import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import AdminDashboard from './dashboard'

// Extracted Episode Row component to manage its own expansion state cleanly
function EpisodeRow({ ep, styles }) {
  const [expanded, setExpanded] = useState(false);
  const [rawEntries, setRawEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const toggleExpand = async () => {
    if (!expanded && rawEntries.length === 0) {
      try {
        setLoading(true);
        const res = await fetch(`/api/media/episodes/${ep.id}/entries`);
        const data = await res.json();
        setRawEntries(data.entries || []);
      } catch (e) {
        console.error("Error loading episode raw entries:", e);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div style={styles.episodeContainer}>
      <div style={styles.episodeRow} onClick={toggleExpand}>
        <div style={styles.epNumberBadge}>
          S{ep.season_number}E{ep.episode_number}
        </div>
        <div style={styles.epDetails}>
          <h4 style={styles.epTitle}>{ep.title || `Episode ${ep.episode_number}`}</h4>
          {ep.air_date && <small style={styles.epAirDate}>Aired: {ep.air_date}</small>}
          {ep.overview && <p style={styles.epOverview}>{ep.overview}</p>}
        </div>
        <div style={styles.expandArrow}>{expanded ? '▲' : '▼'}</div>
      </div>

      {/* Expanded Inner View: Lists the individual releases/entities */}
      {expanded && (
        <div style={styles.rawEntriesPanel}>
          <h5 style={styles.rawPanelTitle}>Harvested Files ({rawEntries.length})</h5>
          {loading ? (
            <div style={styles.rawLoading}>Querying matching index items...</div>
          ) : rawEntries.length === 0 ? (
            <div style={styles.rawLoading}>No direct match logs found for this item ID.</div>
          ) : (
            <div style={styles.rawList}>
              {rawEntries.map(entry => (
                <div key={entry.id} style={styles.rawEntryItem}>
                  <p style={styles.rawEntryTitle}>📄 {entry.title}</p>
                  <small style={styles.rawEntryMeta}>
                    Category: <strong>{entry.category || 'N/A'}</strong> • Scraped: {new Date(entry.date_scraped).toLocaleDateString()}
                  </small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Extracted Season Pack Row for clean arrangement within its respective accordion
function SeasonPackRow({ pack, styles }) {
  const [expanded, setExpanded] = useState(false);
  const [rawEntries, setRawEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const toggleExpand = async () => {
    if (!expanded && rawEntries.length === 0) {
      try {
        setLoading(true);
        // Uses a generic or specific endpoint matching your API schema for season pack source file logs
        const res = await fetch(`/api/media/episodes/${pack.id}/entries`);
        const data = await res.json();
        setRawEntries(data.entries || []);
        console.log(data);
      } catch (e) {
        console.error("Error loading pack entries:", e);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div style={styles.episodeContainer}>
      <div style={styles.episodeRow} onClick={toggleExpand}>
        <div style={{...styles.epNumberBadge, backgroundColor: '#d1e7dd', color: '#0f5132'}}>
          S{pack.season_number} PACK
        </div>
        <div style={styles.epDetails}>
          <h4 style={styles.epTitle}>{pack.title || `Season ${pack.season_number} Complete Pack`}</h4>
          <span style={{fontSize: '0.7rem', backgroundColor: '#e2e3e5', padding: '2px 5px', borderRadius: '3px', fontWeight: 'bold'}}>
            {pack.resolution || ''}
          </span>
        </div>
        <div style={styles.expandArrow}>{expanded ? '▲' : '▼'}</div>
      </div>

      {expanded && (
        <div style={styles.rawEntriesPanel}>
          <h5 style={styles.rawPanelTitle}>Harvested Archives ({rawEntries.length})</h5>
          {loading ? (
            <div style={styles.rawLoading}>Querying archives...</div>
          ) : rawEntries.length === 0 ? (
            <div style={styles.rawLoading}>No archive logs found.</div>
          ) : (
            <div style={styles.rawList}>
              {rawEntries.map(entry => (
                <div key={entry.id} style={styles.rawEntryItem}>
                  <p style={styles.rawEntryTitle}>📦 {entry.title}</p>
                  <small style={styles.rawEntryMeta}>Scraped: {new Date(entry.date_scraped).toLocaleDateString()}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConsumerApp() {
  const [view, setView] = useState(window.location.hash === '#admin' ? 'admin' : 'consumer');
  
  const [mediaItems, setMediaItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const [selectedSeries, setSelectedSeries] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [seasonFilter, setSeasonFilter] = useState('all');

  // --- NEW ACCORDION SELECTION STATES ---
  const [seasonPackOpen, setSeasonPackOpen] = useState(true);
  const [episodeGuideOpen, setEpisodeGuideOpen] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedYear, setSelectedYear] = useState('');
  const [timeWindow, setTimeWindow] = useState('');

  const fetchLibrary = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchQuery) params.append('query', searchQuery);
      if (selectedType !== 'all') params.append('type', selectedType);
      if (selectedYear) params.append('year', selectedYear);
      if (timeWindow) params.append('hours', timeWindow);

      const res = await fetch(`/api/media/search?${params.toString()}`);
      const data = await res.json();
      setMediaItems(data.media || []);
    } catch (e) {
      console.error("Error fetching library catalogs:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLibrary();
  }, [searchQuery, selectedType, selectedYear, timeWindow]);

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#admin') {
        setView('admin');
      } else {
        setView('consumer');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateToAdmin = () => {
    window.location.hash = 'admin';
  };

  const navigateToConsumer = () => {
    window.location.hash = '';
    setSelectedSeries(null);
  };

  const handleSelectSeries = async (seriesItem) => {
    setSelectedSeries(seriesItem);
    setSeasonFilter('all');
    try {
      setEpisodesLoading(true);
      const res = await fetch(`/api/media/series/${seriesItem.id}/episodes`);
      const data = await res.json();
      setEpisodes(data.episodes || []);
    } catch (e) {
      console.error("Error fetching episodes:", e);
    } finally {
      setEpisodesLoading(false);
    }
  };

  const handleMenuClick = (type, hours = '') => {
    setSelectedType(type);
    setTimeWindow(hours);
    setSelectedSeries(null);
    setMenuOpen(false);
  };

  if (view === 'admin') {
    return (
      <div>
        <button style={styles.backToStoreBtn} onClick={navigateToConsumer}>
          &lt;🔙 Return to Library Storefront
        </button>
        <AdminDashboard />
      </div>
    );
  }

  // Find all unique available numeric seasons across both packs and normal episodes
  const uniqueSeasons = [...new Set(episodes.map(ep => ep.season_number))].sort((a, b) => a - b);

  // Separate regular episodes vs season packs cleanly (handling 1/0 or "true"/"false" from DB)
  const rawSeasonPacks = episodes.filter(ep => String(ep.is_season_pack) === 'true' || ep.is_season_pack === 1 || ep.is_season_pack === true);
  const rawRegularEpisodes = episodes.filter(ep => !ep.is_season_pack || String(ep.is_season_pack) === 'false' || ep.is_season_pack === 0);

  // Filter both groups concurrently against the single dropdown selector value
  const filteredSeasonPacks = seasonFilter === 'all'
    ? rawSeasonPacks
    : rawSeasonPacks.filter(pack => pack.season_number === parseInt(seasonFilter, 10));

  const filteredEpisodes = seasonFilter === 'all' 
    ? rawRegularEpisodes 
    : rawRegularEpisodes.filter(ep => ep.season_number === parseInt(seasonFilter, 10));
    
  return (
    <div style={styles.container}>
      {/* Top Bar Navigation */}
      <header style={styles.topBar}>
        <button style={styles.menuIconBtn} onClick={() => setMenuOpen(!menuOpen)}>☰</button>
        <h1 style={{...styles.brandTitle, cursor: 'pointer'}} onClick={navigateToConsumer}>🌾 Harvest Library</h1>
        <button style={styles.adminToggleBtn} onClick={navigateToAdmin}>⚙️</button>
      </header>

      {menuOpen && (
        <div style={styles.drawerBackdrop} onClick={() => setMenuOpen(false)}>
          <div style={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.drawerHeading}>Browse Categories</h3>
            <button style={styles.drawerItem} onClick={() => handleMenuClick('all')}>📱 View All Media Assets</button>
            <button style={styles.drawerItem} onClick={() => handleMenuClick('series')}>📺 TV Shows Registry</button>
            <button style={styles.drawerItem} onClick={() => handleMenuClick('movie')}>🎬 Feature Movies</button>
            <hr style={styles.divider} />
            <h3 style={styles.drawerHeading}>Recent Arrivals</h3>
            <button style={styles.drawerItem} onClick={() => handleMenuClick('all', '24')}>⏱️ Added Last 24 Hours</button>
            <button style={styles.drawerItem} onClick={() => handleMenuClick('all', '48')}>⏱️ Added Last 48 Hours</button>
          </div>
        </div>
      )}

      {selectedSeries ? (
        <div style={styles.detailContainer}>
          <button style={styles.backBtn} onClick={() => setSelectedSeries(null)}>⬅ Back to Catalog</button>
          
          <div style={styles.seriesHeader}>
            {selectedSeries.poster_path ? (
              <img src={selectedSeries.poster_path} alt={selectedSeries.title} style={styles.detailPoster} />
            ) : (
              <div style={styles.detailPosterFallback}>🎬 No Art</div>
            )}
            <div style={styles.seriesHeaderText}>
              <h2 style={styles.detailTitle}>{selectedSeries.title}</h2>
              <p style={styles.detailYear}>Released: {selectedSeries.release_date ? selectedSeries.release_date.substring(0,4) : 'N/A'}</p>
              {selectedSeries.overview && <p style={styles.detailOverview}>{selectedSeries.overview}</p>}
            </div>
          </div>

          <hr style={styles.divider} />

          {/* =========================================================
              ROW 1: Isolated Dropdown Selection (Right Aligned)
             ========================================================= */}
          <div style={styles.dropdownRow}>
            <select style={styles.seasonDropdown} value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}>
              <option value="all">All Seasons</option>
              {uniqueSeasons.map(season => (
                <option key={season} value={season}>Season {season}</option>
              ))}
            </select>
          </div>

          {episodesLoading ? (
            <div style={styles.centered}>Loading archive components...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '10px' }}>
              
              {/* =========================================================
                  ROW 2: Collapsible Accordion - Season Packs Section
                 ========================================================= */}
              <div style={styles.accordionGroup}>
                <div style={styles.accordionHeader} onClick={() => setSeasonPackOpen(!seasonPackOpen)}>
                  <span>📦 Season Packs ({filteredSeasonPacks.length})</span>
                  <span>{seasonPackOpen ? '▲' : '▼'}</span>
                </div>
                {seasonPackOpen && (
                  <div style={styles.accordionContent}>
                    {filteredSeasonPacks.length === 0 ? (
                      <div style={styles.emptyAccordionText}>No custom season batches match filters.</div>
                    ) : (
                      <div style={styles.episodeList}>
                        {filteredSeasonPacks.map(pack => (
                          <SeasonPackRow key={pack.id} pack={pack} styles={styles} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* =========================================================
                  ROW 3: Collapsible Accordion - Current Episode Details
                 ========================================================= */}
              <div style={styles.accordionGroup}>
                <div style={styles.accordionHeader} onClick={() => setEpisodeGuideOpen(!episodeGuideOpen)}>
                  <span>🎬 Episode Guide Details ({filteredEpisodes.length})</span>
                  <span>{episodeGuideOpen ? '▲' : '▼'}</span>
                </div>
                {episodeGuideOpen && (
                  <div style={styles.accordionContent}>
                    {filteredEpisodes.length === 0 ? (
                      <div style={styles.emptyAccordionText}>No individual episodes match filters.</div>
                    ) : (
                      <div style={styles.episodeList}>
                        {filteredEpisodes.map(ep => (
                          <EpisodeRow key={ep.id} ep={ep} styles={styles} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      ) : (
        <>
          <section style={styles.filterSection}>
            <input 
              type="text" 
              placeholder="Search matched movies or series..." 
              style={styles.searchBar}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div style={styles.filterRow}>
              <select style={styles.dropdown} value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                <option value="all">All Types</option>
                <option value="movie">Movies Only</option>
                <option value="series">TV Series</option>
              </select>
              <input type="number" placeholder="Year" style={styles.yearInput} value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} />
            </div>
          </section>

          <main style={styles.mainContainer}>
            {loading ? (
              <div style={styles.centered}>Indexing curated payloads...</div>
            ) : mediaItems.length === 0 ? (
              <div style={styles.centered}>No curated matches align with your query filters yet.</div>
            ) : (
              <div style={styles.grid}>
                {mediaItems.map(item => (
                  <div key={item.id} style={{...styles.mediaCard, cursor: item.type === 'series' ? 'pointer' : 'default'}} onClick={() => item.type === 'series' && handleSelectSeries(item)}>
                    <div style={styles.posterContainer}>
                      {item.poster_path ? <img src={item.poster_path} alt={item.title} style={styles.posterImg} /> : <div style={styles.posterFallback}>🎬 No Art</div>}
                      <span style={{...styles.typeBadge, backgroundColor: item.type === 'movie' ? '#0d6efd' : '#fd7e14'}}>{item.type}</span>
                    </div>
                    <div style={styles.cardDetails}>
                      <h2 style={styles.mediaTitle}>{item.title}</h2>
                      <p style={styles.mediaYear}>{item.release_date ? item.release_date.substring(0,4) : 'N/A'}</p>
                      {item.type === 'series' && <p style={styles.episodeTag}>📦 {item.episode_count} Episode(s) Harvested</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </>
      )}
    </div>
  )
}

const styles = {
  container: { maxWidth: '500px', margin: '0 auto', backgroundColor: '#ffffff', minHeight: '100vh', fontFamily: 'sans-serif', color: '#212529', position: 'relative' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111', color: '#fff', padding: '10px 15px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' },
  menuIconBtn: { background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' },
  brandTitle: { fontSize: '1.2rem', margin: 0, fontWeight: '700', color: '#198754' },
  adminToggleBtn: { background: 'none', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer' },
  backToStoreBtn: { width: '100%', padding: '12px', backgroundColor: '#212529', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' },
  
  drawerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 999 },
  drawer: { width: '260px', backgroundColor: '#fff', height: '100%', padding: '20px 15px', boxShadow: '2px 0 10px rgba(0,0,0,0.1)' },
  drawerHeading: { fontSize: '0.85rem', color: '#999', textTransform: 'uppercase', margin: '15px 0 10px 0', letterSpacing: '0.5px' },
  drawerItem: { display: 'block', width: '100%', textAlign: 'left', padding: '12px 10px', border: 'none', background: 'none', fontSize: '1rem', cursor: 'pointer', borderRadius: '4px' },
  divider: { border: 'none', borderTop: '1px solid #eee', margin: '15px 0' },

  filterSection: { padding: '15px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #eee' },
  searchBar: { width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ced4da', fontSize: '0.95rem', marginBottom: '10px', boxSizing: 'border-box' },
  filterRow: { display: 'flex', gap: '10px' },
  dropdown: { flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ced4da' },
  yearInput: { flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ced4da', boxSizing: 'border-box' },

  mainContainer: { padding: '15px' },
  centered: { textAlign: 'center', padding: '40px 10px', color: '#6c757d' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' },
  mediaCard: { backgroundColor: '#f8f9fa', borderRadius: '8px', overflow: 'hidden', border: '1px solid #eee', display: 'flex', flexDirection: 'column' },
  posterContainer: { position: 'relative', width: '100%', height: '180px', backgroundColor: '#ddd' },
  posterImg: { width: '100%', height: '100%', objectFit: 'cover' },
  posterFallback: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: '0.9rem' },
  typeBadge: { position: 'absolute', top: '8px', left: '8px', color: '#fff', fontSize: '0.65rem', padding: '3px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' },
  cardDetails: { padding: '10px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' },
  mediaTitle: { margin: '0 0 4px 0', fontSize: '0.9rem', fontWeight: 'bold', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  mediaYear: { margin: 0, fontSize: '0.8rem', color: '#6c757d' },
  episodeTag: { margin: '5px 0 0 0', fontSize: '0.75rem', color: '#198754', fontWeight: 'bold' },

  /* Series Detail view */
  detailContainer: { padding: '15px' },
  backBtn: { padding: '8px 12px', backgroundColor: '#f8f9fa', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', marginBottom: '15px', fontWeight: '500' },
  seriesHeader: { display: 'flex', gap: '15px', alignItems: 'flex-start' },
  detailPoster: { width: '110px', height: '160px', objectFit: 'cover', borderRadius: '6px', boxShadow: '0 2px 5px rgba(0,0,0,0.15)' },
  detailPosterFallback: { width: '110px', height: '160px', backgroundColor: '#ddd', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '0.85rem' },
  seriesHeaderText: { flex: 1 },
  detailTitle: { margin: '0 0 5px 0', fontSize: '1.2rem', fontWeight: 'bold' },
  detailYear: { margin: '0 0 10px 0', fontSize: '0.85rem', color: '#6c757d' },
  detailOverview: { margin: 0, fontSize: '0.8rem', color: '#495057', lineHeight: '1.4', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  
  /* --- NEW 3-ROW UI LAYOUT STYLING RULES --- */
  dropdownRow: { display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: '10px' },
  seasonDropdown: { padding: '6px 12px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.85rem', backgroundColor: '#fff', fontWeight: '600' },
  accordionGroup: { border: '1px solid #e9ecef', borderRadius: '8px', backgroundColor: '#ffffff', overflow: 'hidden' },
  accordionHeader: { display: 'flex', justifyContent: 'space-between', padding: '12px 15px', backgroundColor: '#f8f9fa', fontWeight: 'bold', fontSize: '0.85rem', color: '#495057', cursor: 'pointer', userSelect: 'none' },
  accordionContent: { padding: '10px' },
  emptyAccordionText: { fontSize: '0.8rem', color: '#adb5bd', textAlign: 'center', padding: '15px 0' },
  
  /* Collapsible Episode Elements */
  episodeList: { display: 'flex', flexDirection: 'column', gap: '12px' },
  episodeContainer: { backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #eee', overflow: 'hidden' },
  episodeRow: { display: 'flex', gap: '12px', padding: '12px', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s' },
  epNumberBadge: { backgroundColor: '#e9ecef', padding: '6px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', color: '#495057', whiteSpace: 'nowrap' },
  epDetails: { flex: 1 },
  epTitle: { margin: '0 0 2px 0', fontSize: '0.85rem', fontWeight: 'bold' },
  epAirDate: { display: 'block', fontSize: '0.7rem', color: '#999', marginBottom: '4px' },
  epOverview: { margin: 0, fontSize: '0.75rem', color: '#6c757d', lineHeight: '1.3' },
  expandArrow: { fontSize: '0.8rem', color: '#adb5bd', padding: '0 5px' },

  /* Inner Entities Dropdown Panel */
  rawEntriesPanel: { backgroundColor: '#fff', borderTop: '1px solid #eef0f2', padding: '12px', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' },
  rawPanelTitle: { margin: '0 0 8px 0', fontSize: '0.75rem', color: '#198754', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '700' },
  rawLoading: { fontSize: '0.75rem', color: '#888', padding: '5px 0' },
  rawList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  rawEntryItem: { padding: '8px 10px', backgroundColor: '#fdfdfd', border: '1px solid #f1f3f5', borderRadius: '4px' },
  rawEntryTitle: { margin: 0, fontSize: '0.8rem', color: '#212529', fontFamily: 'monospace', wordBreak: 'break-all' },
  rawEntryMeta: { fontSize: '0.7rem', color: '#868e96', marginTop: '3px', display: 'block' }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConsumerApp />
  </React.StrictMode>,
)