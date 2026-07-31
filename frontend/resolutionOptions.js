// Mirrors backend/resolutionBuckets.js's VALID_BUCKETS (plus the 'any'
// meta-value) so labels stay in sync between the Add/Edit modal, the
// Scheduler card, and the Scheduler listing filter.
export const RESOLUTION_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'sd', label: 'SD' },
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '2160p', label: '2160p' },
  { value: '4k', label: '4K' },
];

const LABELS_BY_VALUE = Object.fromEntries(RESOLUTION_OPTIONS.map((opt) => [opt.value, opt.label]));

export function resolutionLabel(value) {
  return LABELS_BY_VALUE[value] || value;
}

export default RESOLUTION_OPTIONS;
