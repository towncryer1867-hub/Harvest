import React, { useState, useEffect } from 'react'
import { fetchJson } from './apiClient'

function App() {
  const [entries, setEntries] = useState([]);
  const [sources, setSources] = useState([]);
  const [adminData, setAdminData] = useState({ stats: { matched: 0, unmatched: 0, failed: 0, ignored: 0 }, failed_items: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('feed'); 
  const [manualIds, setManualIds] = useState({}); 
  const [statusFilter, setStatusFilter] = useState('all'); 

  // --- FORM STATES FOR CREATE & EDIT ---
  const [editingSourceId, setEditingSourceId] = useState(null); // Null = Create Mode, Number = Edit Mode
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [interval_minutes, setIntervalMinutes] = useState('');
  const [isActive, setIsActive] = useState(true);
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
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const [dataEntries, dataSources, dataAdmin] = await Promise.all([
        fetchJson('/api/entries'),
        fetchJson('/api/admin/sources'),
        fetchJson('/api/admin/queue')
      ]);

      setEntries(dataEntries.entries || []);
      setSources(dataSources.sources || []);
      setAdminData(dataAdmin);
    } catch (err) {
      console.error("Error gathering system dashboard metrics:", err);
      setFetchError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Triggers loading existing profile metrics into input states
  const handleEditClick = (source) => {
    setEditingSourceId(source.id);
    setName(source.name);
    setUrl(source.url);
    setIntervalMinutes(source.interval_minutes);
    setIsActive(source.is_active);
    setConfigString(JSON.stringify(source.config_mapping || {}, null, 2));
  };

  const resetForm = () => {
    setEditingSourceId(null);
    setName('');
    setUrl('');
    setIntervalMinutes('');
    setIsActive(true);
    setConfigString(JSON.stringify({
      parser: "xml",
      selectors: { item: "item", title: "title", source_link: "link", date_published: "pubDate", category: "category", description: "description", magnet_link: "enclosure" }
    }, null, 2));
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    try {
      setStatusMessage('');
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(configString);
      } catch (parseErr) {
        alert("Configuration Error: Invalid JSON syntax template specified.");
        return;
      }

      const payload = {
        name,
        url,
        interval_minutes: parseInt(interval_minutes, 10),
        config: parsedConfig,
        is_active: isActive
      };

      const endpoint = editingSourceId ? `/api/admin/sources/${editingSourceId}` : '/api/admin/sources';
      const method = editingSourceId ? 'PUT' : 'POST';

      const data = await fetchJson(endpoint, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      alert(editingSourceId ? "Source configuration updated successfully!" : `Success! Source deployed with ID: ${data.id}`);
      resetForm();
      fetchData();
    } catch (err) {
      alert(`Error encountered: ${err.message}`);
      console.error(err);
    }
  };

  const handleForceSync = async () => {
    try {
      setStatusMessage('Executing asynchronous matching sync cascade...');
      const data = await fetchJson('/api/admin/force-sync', { method: 'POST' });
      if (data.success) {
        setStatusMessage('Sync complete! Pipeline updated successfully.');
        setAdminData(prev => ({ ...prev, stats: data.stats }));
        const dataEntries = await fetchJson('/api/entries');
        setEntries(dataEntries.entries || []);
      }
    } catch (err) {
      setStatusMessage(`Sync error: ${err.message}`);
    }
  };

  const handleManualMatchSubmit = async (entryId) => {
    const targetTvdbId = manualIds[entryId];
    if (!targetTvdbId) {
      alert("Please supply a valid numerical TVDB identifier token before submitting matching overrides.");
      return;
    }
    try {
      await fetchJson('/api/manual-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_id: entryId, tvdb_id: String(targetTvdbId).trim() })
      });
      alert("Manual database allocation match established successfully!");
      setManualIds(prev => { const updated = { ...prev }; delete updated[entryId]; return updated; });
      fetchData();
    } catch (err) {
      alert(`Match override failed: ${err.message}`);
    }
  };

  const handleIgnoreEntry = async (entryId) => {
    if (!window.confirm("Are you sure you want to permanently ignore this item from automatic metadata resolution?")) {
      return;
    }
    try {
      await fetchJson(`/api/admin/entries/${entryId}/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      alert("Entry successfully muted and flagged as ignored.");
      fetchData();
    } catch (err) {
      alert(`Failed to ignore item: ${err.message}`);
    }
  };
  
  const filteredEntries = entries.filter(entry => {
    if (statusFilter === 'all') return true;
    return entry.match_status === statusFilter;
  });

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif', color: '#666' }}>Loading system diagnostic control layers...</div>;
  }

  return (
    <div style={styles.dashboardContainer}>
      <header style={styles.header}>
        <div style={styles.branding}>
          <h1 style={styles.logoTitle}>Harvest Control Deck</h1>
          <span style={styles.subLogo}>Pipeline Automation Metrics</span>
        </div>
        <nav style={styles.nav}>
          <button style={activeTab === 'feed' ? styles.activeNavBtn : styles.navBtn} onClick={() => setActiveTab('feed')}>Scraped Streams</button>
          <button style={activeTab === 'sources' ? styles.activeNavBtn : styles.navBtn} onClick={() => setActiveTab('sources')}>Ingestion Sources</button>
          <button style={activeTab === 'admin' ? styles.activeNavBtn : styles.navBtn} onClick={() => setActiveTab('admin')}>System Settings</button>
        </nav>
      </header>

      <section style={styles.metricsGrid}>
        <div style={{ ...styles.metricCard, borderLeft: '4px solid #198754' }}>
          <h3 style={styles.metricTitle}>Matched</h3>
          <p style={{ ...styles.metricValue, color: '#198754' }}>{adminData.stats.matched}</p>
        </div>
        <div style={{ ...styles.metricCard, borderLeft: '4px solid #ffc107' }}>
          <h3 style={styles.metricTitle}>Unmatched</h3>
          <p style={{ ...styles.metricValue, color: '#ffc107' }}>{adminData.stats.unmatched}</p>
        </div>
        <div style={{ ...styles.metricCard, borderLeft: '4px solid #dc3545' }}>
          <h3 style={styles.metricTitle}>Parsing Failures</h3>
          <p style={{ ...styles.metricValue, color: '#dc3545' }}>{adminData.stats.failed}</p>
        </div>
        <div style={{ ...styles.metricCard, borderLeft: '4px solid #dc3545' }}>
          <h3 style={styles.metricTitle}>Ignored Entites</h3>
          <p style={{ ...styles.metricValue, color: '#dc3545' }}>{adminData.stats.ignored}</p>
        </div>
      </section>

      {fetchError && <div style={styles.errorBanner}>{fetchError}</div>}

      {statusMessage && <div style={styles.statusToast}>{statusMessage}</div>}

      <main style={styles.workspace}>
        {activeTab === 'feed' && (
          <div>
            <div style={styles.filterRow}>
              <label style={styles.filterLabel}>Filter Feed Status:</label>
              <select style={styles.filterDropdown} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">Display All Gathered Listings ({entries.length})</option>
                <option value="matched">Successfully Linked Catalog Items ({adminData.stats.matched})</option>
                <option value="unmatched">Awaiting Ingestion Processing ({adminData.stats.unmatched})</option>
                <option value="failed">Flagged Unresolved Strings ({adminData.stats.failed})</option>
                <option value="ignored">Manually Ignored Items Items ({adminData.stats.ignored})</option>
              </select>
            </div>

            <div style={styles.tableCard}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.tableHeaderRow}>
                    <th style={styles.th}>Title</th>
                    <th style={styles.th}>Category</th>
                    <th style={styles.th}>Source</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Manual Override Link</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map(entry => (
                    <tr key={entry.id} style={styles.tableBodyRow}>
                      <td style={styles.tdTitleColumn}>{entry.title}</td>
                      <td style={styles.tdCategoryColumn}><span style={styles.categoryBadge}>{entry.category || 'N/A'}</span></td>
                      <td style={styles.td}>{entry.source_name || 'Generic Feed'}</td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.statusBadge,
                          backgroundColor: entry.match_status === 'matched' ? '#e2f0d9' : entry.match_status === 'failed' ? '#fce4d6' : '#fff3cd',
                          color: entry.match_status === 'matched' ? '#385723' : entry.match_status === 'failed' ? '#c65911' : '#856404'
                        }}>
                          {entry.match_status}
                        </span>
                      </td>
                      <td style={styles.td}>
                      {entry.match_status !== 'matched' && entry.match_status !== 'ignored' && (
                        <div style={styles.actionColumnWrapper}>
                          <div style={styles.manualMatchWrapper}>
                            <input 
                              type="text" 
                              placeholder="TVDB ID" 
                              style={styles.manualInput} 
                              value={manualIds[entry.id] || ''} 
                              onChange={(e) => setManualIds({ ...manualIds, [entry.id]: e.target.value })} 
                            />
                            <button style={styles.manualSubmitBtn} onClick={() => handleManualMatchSubmit(entry.id)}>Link</button>
                          </div>
                          
                          <button 
                            style={styles.ignoreBtn} 
                            onClick={() => handleIgnoreEntry(entry.id)}
                            title="Ignore item permanently"
                          >
                            Ignore
                          </button>
                        </div>
                      )}
                      {entry.match_status === 'ignored' && (
                        <span style={{ fontSize: '0.8rem', color: '#6c757d', fontStyle: 'italic' }}>Skipped Pipeline</span>
                      )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'sources' && (
          <div style={styles.twoColumnGrid}>
            <div style={styles.tableCard}>
              <h2 style={styles.sectionHeaderTitle}>Configured Feed Aggregators</h2>
              {sources.map(src => (
                <div key={src.id} style={styles.sourceItemCard}>
                  <div style={styles.sourceHeader}>
                    <h4 style={styles.sourceName}>{src.name}</h4>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={src.is_active ? styles.activeSourceBadge : styles.inactiveSourceBadge}>
                        {src.is_active ? 'Active' : 'Disabled'}
                      </span>
                      <button style={styles.editFormInlineBtn} onClick={() => handleEditClick(src)}>Edit</button>
                    </div>
                  </div>
                  <code style={styles.sourceUrlCode}>{src.url}</code>
                  <p style={styles.sourceMetaText}>Frequency Sequence: Checks index endpoints every <strong>{src.interval_minutes} minutes</strong>.</p>
                </div>
              ))}
            </div>

            <div style={styles.formCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f3f5', paddingBottom: '10px', marginBottom: '15px' }}>
                <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '700', color: '#1a252f' }}>
                  {editingSourceId ? `Modify Aggregator (ID: ${editingSourceId})` : 'Deploy New Scraper Endpoint'}
                </h2>
                {editingSourceId && <button style={styles.cancelEditBtn} onClick={resetForm}>Cancel Edit</button>}
              </div>

              <form onSubmit={handleFormSubmit} style={styles.formLayout}>
                <label style={styles.formLabel}>Aggregator Source Name</label>
                <input type="text" placeholder="e.g., TorrentSource - Top Series Pack" style={styles.formInput} value={name} onChange={e => setName(e.target.value)} required />

                <label style={styles.formLabel}>Target RSS/XML Endpoint URL</label>
                <input type="url" placeholder="https://example.com/feed.xml" style={styles.formInput} value={url} onChange={e => setUrl(e.target.value)} required />

                <label style={styles.formLabel}>Check Interval Frequency (Minutes)</label>
                <input type="number" placeholder="60" style={styles.formInput} value={interval_minutes} onChange={e => setIntervalMinutes(e.target.value)} required />

                {editingSourceId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0' }}>
                    <input type="checkbox" id="isActiveCheckbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                    <label htmlFor="isActiveCheckbox" style={{ fontSize: '0.85rem', fontWeight: '600', color: '#495057' }}>Enable Active Scraping Schedules</label>
                  </div>
                )}

                <label style={styles.formLabel}>Selector Mapping Configuration Schema (JSON Object)</label>
                <textarea style={styles.formTextarea} value={configString} onChange={e => setConfigString(e.target.value)} required />

                <button type="submit" style={editingSourceId ? styles.updateSubmitBtn : styles.submitBtn}>
                  {editingSourceId ? 'Save Configurations' : 'Initialize Pipeline'}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'admin' && (
          <div style={styles.formCard}>
            <h2 style={styles.sectionHeaderTitle}>Daemon Engineering Overrides</h2>
            <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '20px' }}>
              Force immediate parsing execution over all items flagged inside the unresolved queue table cache.
            </p>
            <button style={styles.forceSyncBtn} onClick={handleForceSync}>Trigger Complete Pipeline Match Cycle</button>
          </div>
        )}
      </main>
    </div>
  )
}

const styles = {
  dashboardContainer: { padding: '24px', maxWidth: '1400px', margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: '#f8f9fa', minHeight: '100vh', color: '#212529' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #dee2e6', paddingBottom: '15px', marginBottom: '25px' },
  branding: { display: 'flex', flexDirection: 'column' },
  logoTitle: { margin: 0, fontSize: '1.5rem', fontWeight: 'bold', color: '#1a252f', letterSpacing: '-0.5px' },
  subLogo: { fontSize: '0.75rem', color: '#6c757d', fontWeight: '500', marginTop: '2px' },
  nav: { display: 'flex', gap: '8px' },
  navBtn: { padding: '8px 16px', borderRadius: '6px', border: '1px solid #dee2e6', backgroundColor: '#ffffff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', color: '#495057', transition: 'all 0.15s ease' },
  activeNavBtn: { padding: '8px 16px', borderRadius: '6px', border: '1px solid #1a252f', backgroundColor: '#1a252f', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', color: '#ffffff' },
  metricsGrid: { display: 'flex', gap: '15px', marginBottom: '25px' },
  metricCard: { flex: 1, backgroundColor: '#ffffff', borderRadius: '8px', padding: '15px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #e9ecef' },
  metricTitle: { margin: '0 0 5px 0', fontSize: '0.75rem', fontWeight: '700', color: '#6c757d', textTransform: 'uppercase', letterSpacing: '0.5px' },
  metricValue: { margin: 0, fontSize: '1.75rem', fontWeight: 'bold' },
  workspace: { marginTop: '10px' },
  tableCard: { backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e9ecef', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' },
  tableHeaderRow: { backgroundColor: '#f1f3f5', borderBottom: '1px solid #dee2e6' },
  th: { padding: '12px 16px', fontWeight: '600', color: '#495057' },
  tableBodyRow: { borderBottom: '1px solid #f1f3f5' },
  td: { padding: '12px 16px', color: '#495057', verticalAlign: 'middle' },
  tdTitleColumn: { padding: '12px 16px', color: '#1a252f', fontWeight: '500', width: '45%' },
  tdCategoryColumn: { padding: '12px 16px', width: '12%' },
  categoryBadge: { display: 'inline-block', backgroundColor: '#e9ecef', color: '#495057', padding: '3px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '500' },
  statusBadge: { display: 'inline-block', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.2px' },
  manualMatchWrapper: { display: 'flex', gap: '6px', alignItems: 'center' },
  actionColumnWrapper: { 
    display: 'flex', 
    alignItems: 'center', 
    gap: '12px' 
  },
  ignoreBtn: { 
    padding: '5px 10px', 
    borderRadius: '4px', 
    border: '1px solid #dc3545', 
    backgroundColor: '#fff', 
    color: '#dc3545', 
    fontSize: '0.8rem', 
    fontWeight: '600', 
    cursor: 'pointer',
    transition: 'all 0.15s ease'
  },
  manualInput: { padding: '5px 8px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.8rem', width: '110px', backgroundColor: '#fafafa' },
  manualSubmitBtn: { padding: '5px 10px', borderRadius: '4px', border: 'none', backgroundColor: '#0d6efd', color: '#fff', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' },
  twoColumnGrid: { display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '20px' },
  sectionHeaderTitle: { margin: '0', padding: '16px', borderBottom: '1px solid #f1f3f5', fontSize: '0.95rem', fontWeight: '700', color: '#1a252f' },
  sourceItemCard: { padding: '15px', borderBottom: '1px solid #f1f3f5', margin: '0 16px 16px 16px', backgroundColor: '#fafafa', borderRadius: '6px', border: '1px solid #e9ecef' },
  sourceHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  sourceName: { margin: 0, fontSize: '0.9rem', fontWeight: '700', color: '#212529' },
  activeSourceBadge: { fontSize: '0.7rem', color: '#155724', backgroundColor: '#d4edda', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' },
  inactiveSourceBadge: { fontSize: '0.7rem', color: '#721c24', backgroundColor: '#f8d7da', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' },
  sourceUrlCode: { display: 'block', fontSize: '0.75rem', color: '#6f42c1', backgroundColor: '#f8f1fa', padding: '6px 10px', borderRadius: '4px', marginBottom: '8px', overflowX: 'auto', whiteSpace: 'nowrap' },
  sourceMetaText: { margin: 0, fontSize: '0.75rem', color: '#6c757d' },
  statusToast: { padding: '12px 16px', backgroundColor: '#e2e3e5', color: '#383d41', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '500', marginBottom: '20px', border: '1px solid #d6d8db' },
  errorBanner: { padding: '12px 16px', backgroundColor: '#f8d7da', color: '#842029', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '500', marginBottom: '20px', border: '1px solid #f5c2c7' },
  forceSyncBtn: { padding: '10px 20px', backgroundColor: '#198754', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '600', cursor: 'pointer' },
  filterRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px', backgroundColor: '#fff', padding: '10px', borderRadius: '8px', border: '1px solid #e9ecef' },
  filterLabel: { fontSize: '0.85rem', fontWeight: 'bold', color: '#495057' },
  filterDropdown: { flex: 1, padding: '6px 10px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.85rem', backgroundColor: '#ffffff', cursor: 'pointer' },
  formCard: { backgroundColor: '#ffffff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef', alignSelf: 'start' },
  formLayout: { display: 'flex', flexDirection: 'column', gap: '10px' },
  formInput: { padding: '8px 12px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.85rem' },
  formLabel: { fontSize: '0.75rem', fontWeight: 'bold', color: '#495057', marginTop: '4px' },
  formTextarea: { padding: '8px 12px', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '0.8rem', fontFamily: 'monospace', minHeight: '160px', resize: 'vertical', backgroundColor: '#fafafa' },
  submitBtn: { padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: '#212529', color: '#fff', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer', marginTop: '5px' },
  editFormInlineBtn: { padding: '3px 8px', borderRadius: '4px', border: '1px solid #ced4da', backgroundColor: '#fff', fontSize: '0.75rem', fontWeight: '600', color: '#0d6efd', cursor: 'pointer' },
  cancelEditBtn: { padding: '4px 10px', borderRadius: '4px', border: '1px solid #dc3545', backgroundColor: '#fff', color: '#dc3545', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer' },
  updateSubmitBtn: { padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: '#0d6efd', color: '#fff', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer', marginTop: '5px' }
};

export default App;