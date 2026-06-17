const xml2js = require('xml2js');

/**
 * Parses an XML feed string and extracts entries based on a dynamic source configuration mapping.
 * @param {string} xmlString - Raw XML content from the source URL.
 * @param {Object} mapping - The config_mapping object from the database.
 */
async function parseXMLFeed(xmlString, mapping) {
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
  const result = await parser.parseStringPromise(xmlString);
  
  // Navigate down to the items array based on common RSS formats (usually rss.channel.item)
  // If a feed is structured differently, we can adapt this path dynamically later.
  const channel = result.rss?.channel;
  if (!channel || !channel.item) {
    throw new Error("Invalid RSS/XML structure or no items found.");
  }

  const rawItems = Array.isArray(channel.item) ? channel.item : [channel.item];
  const selectors = mapping.selectors;

  // Map the raw XML structures to our unified database schema fields
  return rawItems.map(item => {
    // Magnet link extraction logic: LimeTorrents puts the magnet/torrent link in the <enclosure url="..."> tag
    let magnetLink = '';
    if (item[selectors.magnet_link]) {
      magnetLink = item[selectors.magnet_link].url || item[selectors.magnet_link];
    }

    return {
      title: item[selectors.title] || 'Untitled Entry',
      source_link: item[selectors.source_link] || '',
      category: item[selectors.category] || 'Unknown',
      description: item[selectors.description] || '',
      magnet_link: magnetLink,
      date_published: item[selectors.date_published] ? new Date(item[selectors.date_published]) : new Date()
    };
  });
}

module.exports = { parseXMLFeed };