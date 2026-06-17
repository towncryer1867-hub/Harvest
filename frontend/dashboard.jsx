import React, { useState, useEffect } from 'react'

function App() {
  const [entries, setEntries] = useState([]);
  const [sources, setSources] = useState([]);
  const [adminData, setAdminData] = useState({ stats: { matched: 0, unmatched: 0, failed: 0 }, failed_items: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('feed'); // 'feed', 'sources', 'admin'
  const [manualIds, setManualIds] = useState({}); // Tracks input box states per item row

  // --- NEW FEED FILTER STATE ---
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'matched', 'unmatched', 'failed'

  // --- NEW STATES FOR INTERACTIVE FORM CREATION ---
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [interval_minutes, setIntervalMinutes] = useState('');
  const [configString, setConfigString] = useState(
    JSON.stringify({
      parser: "xml",
      selectors: {
        item: "item",
        title: "title",
        source_link: "link",
        date_published: "pubDate",
        category: "category",
        description: "description",
        magnet_link: "enclosure"
      }
    }, null, 2)
  );
  const [statusMessage, setStatusMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const entriesRes = await fetch('/api/entries');
      const entriesData = await entriesRes.json();
      setEntries(entriesData.entries || []);

      const healthRes = await fetch('/api/health');
      const healthData = await healthRes.json();
      setSources(healthData.sources || []);

      const adminRes = await fetch('/api/admin/queue');
      const adminData = await adminRes.json();
      setAdminData(adminData);
    } catch (error) {
      console.error("Error communicating with Harvest backend API:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Submits a manual TVDB ID fix-override request
  const handleManualMatch = async (entryId) => {
    const tvdbId = manualIds[entryId];
    if (!tvdbId) return alert("Please type a valid TVDB ID number first!");

    try {
      const response = await fetch('/api/manual-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_id: entryId, tvdb_id: tvdbId.trim() })
      });
      const data = await response.json();
      
      if (data.success) {
        alert(data.message);
        fetchData(); 
      } else {
        alert(`Error matching: ${data.error}`);
      }
    } catch (err) {
      alert("Failed to submit manual match resolution override request.");
    }
  };

  // --- NEW SUBMIT HANDLER FOR THE LIVE FORM ---
  const handleSubmitSource = async (e) => {
    e.preventDefault();
    setStatusMessage('');
    setIsSubmitting(true);

    try {
      const parsedConfig = JSON.parse(configString);

      const response = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          url,
          interval_minutes,
          config: parsedConfig
        })
      });

      const data = await response.json();

      if (response.ok) {
        setStatusMessage(`✅ Success! Added "${data.name}"`);
        setName('');
        setUrl('');
        setIntervalMinutes('');
        fetchData(); // Live reload list view immediately
      } else {
        setStatusMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setStatusMessage(`❌ JSON Validation Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter feed entries dynamically based on chosen status dropdown selection
  const filteredEntries = statusFilter === 'all'
    ? entries
    : entries.filter(entry => entry.match_status === statusFilter);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.logoRow}>
          <span style={styles.logoIcon}>🌾</span>
          <h1 style={styles.logoText}>Harvest</h1>
        </div>
        <p style={styles.subtitle}>Lean PWA Ingestion Engine</p>
      </header>

      {/* Navigation Menu */}
      <nav style={styles.nav}>
        <button style={{...styles.navBtn, ...(activeTab === 'feed' ? styles.navBtnActive : {})}} onClick={() => setActiveTab('feed')}>
          Feed ({entries.length})
        </button>
        <button style={{...styles.navBtn, ...(activeTab === 'sources' ? styles.navBtnActive : {})}} onClick={() => setActiveTab('sources')}>
          Sources
        </button>
        <button style={{...styles.navBtn, ...(activeTab === 'admin' ? styles.navBtnActive : {})}} onClick={() => setActiveTab('admin')}>
          Admin ({adminData.stats.failed || 0})
        </button>
      </nav>

      <main style={styles.main}>
        {loading ? (
          <div style={styles.centered}>Syncing cluster arrays...</div>
        ) : activeTab === 'feed' ? (
          <div>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Latest Ingested Stream</h2>
              <button onClick={fetchData} style={styles.refreshBtn}>🔄 Refresh</button>
            </div>

            {/* =========================================================
                NEW FILTER ROW COMPONENT (FEED TAB STATUS SELECTOR)
               ========================================================= */}
            <div style={styles.filterRow}>
              <label style={styles.filterLabel}>Filter Status:</label>
              <select 
                style={styles.filterDropdown} 
                value={statusFilter} 
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Entries ({entries.length})</option>
                <option value="matched">Matched Only</option>
                <option value="unmatched">Unmatched (Pending)</option>
                <option value="failed">Failed Only</option>
              </select>
            </div>

            {filteredEntries.length === 0 ? (
              <div style={styles.centered}>No data entries match the selected status category.</div>
            ) : (
              filteredEntries.map(entry => (
                <div key={entry.id} style={styles.card}>
                  <div style={styles.cardHeader}>
                    <span style={styles.sourceTag}>{entry.source_name}</span>
                    <span style={{
                      ...styles.statusTag, 
                      backgroundColor: entry.match_status === 'unmatched' ? '#fff3cd' : entry.match_status === 'failed' ? '#f8d7da' : '#d1e7dd',
                      color: entry.match_status === 'unmatched' ? '#664d03' : entry.match_status === 'failed' ? '#842029' : '#0f5132'
                    }}>
                      {entry.match_status}
                    </span>
                  </div>
                  <h3 style={styles.entryTitle}>{entry.title}</h3>
                  <div style={styles.metaRow}>
                    <span>🗂️ {entry.category}</span>
                    <span>📅 {new Date(entry.date_published).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : activeTab === 'sources' ? (
          /* SOURCES TAB PANEL (WITH ADD FORM INTEGRATED) */
          <div>
            {/* Added Creation Form Section */}
            <div style={styles.formCard}>
              <h3 style={{...styles.sectionTitle, marginBottom: '10px'}}>➕ Add Ingestion Source</h3>
              <form onSubmit={handleSubmitSource} style={styles.formLayout}>
                <input 
                  type="text" 
                  placeholder="Source Display Name (e.g. LimeTorrents)" 
                  style={styles.formInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <input 
                  type="url" 
                  placeholder="RSS Feed Target URL" 
                  style={styles.formInput}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <input 
                  type="text" 
                  placeholder="Interval Minutes (e.g. 30)" 
                  style={styles.formInput}
                  value={interval_minutes}
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                  required
                />
                <label style={styles.formLabel}>Parser Field Maps (JSON Structure)</label>
                <textarea 
                  rows={8}
                  style={styles.formTextarea}
                  value={configString}
                  onChange={(e) => setConfigString(e.target.value)}
                  required
                />
                <button type="submit" disabled={isSubmitting} style={styles.formBtn}>
                  {isSubmitting ? 'Registering Source...' : '🚀 Save and Deploy Source'}
                </button>
              </form>
              
              {statusMessage && (
                <div style={{
                  ...styles.formStatus, 
                  backgroundColor: statusMessage.includes('✅') ? '#d1e7dd' : '#f8d7da',
                  color: statusMessage.includes('✅') ? '#0f5132' : '#842029'
                }}>
                  {statusMessage}
                </div>
              )}
            </div>

            <hr style={{border: 'none', borderTop: '1px solid #dee2e6', margin: '20px 0'}} />

            <h2 style={{...styles.sectionTitle, marginBottom: '10px'}}>Active Monitored Sources ({sources.length})</h2>
            {sources.map((source, idx) => (
              <div key={idx} style={styles.sourceCard}>
                <div style={styles.sourceRow}><strong>📡 {source.name}</strong><span>Interval: {source.interval_minutes}</span></div>
                <p style={styles.lastRunText}>Last Action: {source.last_run_at ? new Date(source.last_run_at).toLocaleTimeString() : 'Pending'}</p>
              </div>
            ))}
          </div>
        ) : (
          /* ADMIN QUEUE VIEW TAB PANEL */
          <div>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Pipeline Performance Logs</h2>
              <button 
                onClick={async () => {
                  setLoading(true);
                  try {
                    const res = await fetch('/api/admin/force-sync', { method: 'POST' });
                    const data = await res.json();
                    if (data.success) {
                      alert("Pipeline sync complete!");
                      fetchData(); 
                    }
                  } catch(e) {
                    alert("Sync action failed.");
                  } finally {
                    setLoading(false);
                  }
                }} 
                style={{...styles.refreshBtn, backgroundColor: '#198754', color: '#fff', fontWeight: 'bold'}}
              >
                ⚙️ Force Sync & Match
              </button>
            </div>
            
            <div style={styles.statsBar}>
              <div style={{...styles.statBox, backgroundColor: '#d1e7dd'}}><strong>{adminData.stats.matched || 0}</strong><small>Matched</small></div>
              <div style={{...styles.statBox, backgroundColor: '#fff3cd'}}><strong>{adminData.stats.unmatched || 0}</strong><small>Pending</small></div>
              <div style={{...styles.statBox, backgroundColor: '#f8d7da'}}><strong>{adminData.stats.failed || 0}</strong><small>Failed</small></div>
            </div>

            <h3 style={{...styles.sectionTitle, marginTop: '20px'}}>Failed Resolution Queue</h3>
            {adminData.failed_items.length === 0 ? (
              <p style={styles.centered}>Clear! No parsing match adjustments required.</p>
            ) : (
              adminData.failed_items.map(item => (
                <div key={item.id} style={{...styles.card, borderLeft: '4px solid #dc3545'}}>
                  <p style={{...styles.entryTitle, fontWeight: '600', fontSize: '0.9rem'}}>{item.title}</p>
                  <div style={styles.fixRow}>
                    <input 
                      type="text" 
                      placeholder="Enter TVDB ID (e.g. 361164)" 
                      style={styles.fixInput}
                      value={manualIds[item.id] || ''}
                      onChange={(e) => setManualIds({...manualIds, [item.id]: e.target.value})}
                    />
                    <button onClick={() => handleManualMatch(item.id)} style={styles.fixBtn}>Link</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// Styling parameters (Extended for form and filter presentation styles)
const styles = {
  container: { maxWidth: '500px', margin: '0 auto', backgroundColor: '#f8f9fa', minHeight: '100vh', fontFamily: 'sans-serif', color: '#212529' },
  header: { backgroundColor: '#198754', color: '#ffffff', padding: '20px 15px', textAlign: 'center' },
  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' },
  logoIcon: { fontSize: '2rem' },
  logoText: { margin: 0, fontSize: '1.8rem' },
  subtitle: { margin: '5px 0 0 0', opacity: 0.8, fontSize: '0.85rem' },
  nav: { display: 'flex', backgroundColor: '#ffffff', borderBottom: '1px solid #dee2e6' },
  navBtn: { flex: 1, padding: '15px', border: 'none', backgroundColor: 'transparent', fontWeight: '600', color: '#6c757d', cursor: 'pointer' },
  navBtnActive: { color: '#198754', borderBottom: '3px solid #198754', backgroundColor: '#f8f9fa' },
  main: { padding: '15px' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' },
  sectionTitle: { margin: 0, fontSize: '1.1rem', color: '#495057', fontWeight: '700' },
  refreshBtn: { padding: '6px 12px', backgroundColor: '#ffffff', border: '1px solid #ced4da', borderRadius: '4px', cursor: 'pointer' },
  centered: { textAlign: 'center', padding: '40px 0', color: '#6c757d' },
  card: { backgroundColor: '#ffffff', borderRadius: '8px', padding: '12px', marginBottom: '10px', border: '1px solid #e9ecef' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px' },
  sourceTag: { fontSize: '0.7rem', backgroundColor: '#e2e3e5', padding: '3px 6px', borderRadius: '4px' },
  statusTag: { fontSize: '0.7rem', padding: '3px 6px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: '700' },
  entryTitle: { margin: '0 0 8px 0', fontSize: '0.9rem', lineHeight: '1.4' },
  metaRow: { display: 'flex', gap: '15px', fontSize: '0.75rem', color: '#6c757d' },
  sourceCard: { backgroundColor: '#ffffff', borderRadius: '8px', padding: '15px', marginBottom: '10px', borderLeft: '4px solid #198754' },
  sourceRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '5px' },
  lastRunText: { margin: 0, fontSize: '0.8rem', color: '#6c757d' },
  statsBar: { display: 'flex', gap: '10px', marginTop: '10px' },
  statBox: { flex: 1, padding: '10px', borderRadius: '6px', display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' },
  fixRow: { display: 'flex', gap: '8px', marginTop: '5px' },
  fixInput: { flex: 1, padding: '6px 10px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.85rem' },
  fixBtn: { padding: '6px 14px', backgroundColor: '#198754', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '600', cursor: 'pointer' },
  
  /* --- NEW FEED STATUS FILTER RULES --- */
  filterRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px', backgroundColor: '#fff', padding: '10px', borderRadius: '8px', border: '1px solid #e9ecef' },
  filterLabel: { fontSize: '0.85rem', fontWeight: 'bold', color: '#495057' },
  filterDropdown: { flex: 1, padding: '6px 10px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.85rem', backgroundColor: '#ffffff', cursor: 'pointer' },

  /* --- NEW FORM DESIGN OBJECT VALUES --- */
  formCard: { backgroundColor: '#ffffff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' },
  formLayout: { display: 'flex', flexDirection: 'column', gap: '10px' },
  formInput: { padding: '8px 12px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.85rem' },
  formLabel: { fontSize: '0.75rem', fontWeight: 'bold', color: '#495057', marginTop: '4px' },
  formTextarea: { padding: '8px 10px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.8rem', fontFamily: 'monospace', backgroundColor: '#f8f9fa' },
  formBtn: { padding: '10px', backgroundColor: '#198754', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' },
  formStatus: { padding: '10px', borderRadius: '4px', fontSize: '0.8rem', textAlign: 'center', fontWeight: '500' }
};

export default App;