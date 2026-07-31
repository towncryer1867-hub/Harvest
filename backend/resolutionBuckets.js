/**
 * Normalizes the raw `resolution` string produced by mediaParser.js (already
 * lowercased, e.g. '1080p', '4k', '576p', or null) into the fixed bucket set
 * offered by the Scheduler's resolution preference. '2160p' and '4k' are
 * kept as distinct buckets (exact-literal matching), not aliased together.
 */
const VALID_BUCKETS = new Set(['sd', '480p', '720p', '1080p', '2160p', '4k']);

function normalizeResolution(raw) {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();

  if (value === '4k') return '4k';
  if (value === '2160p') return '2160p';
  if (value === '1080p') return '1080p';
  if (value === '720p') return '720p';
  if (value === '480p') return '480p';
  if (/^\d{3,4}p$/.test(value)) return 'sd';

  return null;
}

// `preferences` is the scheduler item's resolution_preferences array
// (multi-select — see AddToSchedulerModal.jsx). Any release resolution
// matches if 'any' was selected, or if its bucket is one of the selected
// buckets.
function matchesPreference(bucket, preferences) {
  const prefs = Array.isArray(preferences) ? preferences : [preferences];
  if (prefs.includes('any')) return true;
  return bucket !== null && prefs.includes(bucket);
}

// Validates/normalizes a resolution_preferences array from a request body:
// dedupes, defaults to ['any'] when empty, returns null if any element
// isn't a recognized bucket (caller should treat null as a 400).
function normalizeResolutionPreferences(input) {
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const deduped = [...new Set(arr)];
  const values = deduped.length ? deduped : ['any'];
  for (const value of values) {
    if (value !== 'any' && !VALID_BUCKETS.has(value)) return null;
  }
  return values;
}

module.exports = { normalizeResolution, matchesPreference, normalizeResolutionPreferences, VALID_BUCKETS };
