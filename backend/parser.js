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
    // Magnet link extraction logic: LimeTorrents puts the magnet/torrent link in the <enclosure url=\"...\"> tag
    let magnetLink = '';
    if (item[selectors.magnet_link]) {
      magnetLink = item[selectors.magnet_link].url || item[selectors.magnet_link];
    }

    // Extract raw category reference safely
    let rawCategory = item[selectors.category] || 'Unknown';
    let cleanCategory = 'Unknown';

    if (typeof rawCategory === 'string') {
      cleanCategory = rawCategory;
    } else if (rawCategory && typeof rawCategory === 'object') {
      // If xml2js captured attributes, look for the text property '_'
      cleanCategory = rawCategory['_'] || 'Unknown';
    }

    // --- NEW REGEX DESCRIPTION EXTRACTION LOGIC ---
    let rawDescription = item[selectors.description] || '';
    let seedsCount = 0;
    let leechersCount = 0;

    if (typeof rawDescription === 'string') {
      // Handles formats like "Seeds: 36" or "Seeds: 0" case-insensitively
      const seedsMatch = rawDescription.match(/Seeds:\s*(\d+)/i);
      // Handles formats like "Leechers: 5", "Leechers 5", or "Leechers: 0"
      const leechersMatch = rawDescription.match(/Leechers(?:\s*:\s*|\s+)(\d+)/i);

      if (seedsMatch) seedsCount = parseInt(seedsMatch[1], 10);
      if (leechersMatch) leechersCount = parseInt(leechersMatch[1], 10);
    }

    // Re-build a clean, normalized plain text copy string instead of keeping layout snippets
    const cleanDescription = `Seeds: ${seedsCount} | Leechers: ${leechersCount}`;

    return {
      title: item[selectors.title] || 'Untitled Entry',
      source_link: item[selectors.source_link] || '',
      category: cleanCategory.trim(),
      description: cleanDescription,
      magnet_link: magnetLink,
      date_published: item[selectors.date_published] || null
    };
  });
}

module.exports = { parseXMLFeed };